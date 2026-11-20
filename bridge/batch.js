/**
 * [INPUT]: 接收 URL 列表、执行模式与提交间隔，复用 runUrl。
 * [OUTPUT]: 保存进度、逐条结果和未开始的网址，支持停止请求。
 * [POS]: 独立子进程运行批次，同一时间只允许一个批次，MCP 可随时查询。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { socketDir } from './config.js';
import { runUrl } from './run.js';

const dir = join(socketDir,'batches');
const pathFor = id => join(dir,id + '.json');
const stopFor = id => join(dir,id + '.stop');
const stopRequested = id => access(stopFor(id)).then(() => true, () => false);
async function save(job) {
  const path = pathFor(job.id);
  await writeFile(path + '.tmp', JSON.stringify(job), {mode:0o600});
  await rename(path + '.tmp',path);
}
export async function readBatch(id) {
  const job = JSON.parse(await readFile(pathFor(id),'utf8'));
  if (job.status === 'running' && job.pid) {
    try { process.kill(job.pid,0); } catch { job.status = 'interrupted'; }
  } else if (job.status === 'queued' && Date.now() - Date.parse(job.createdAt) > 30000) {
    job.status = 'interrupted';
  }
  return job;
}
export async function activeBatch() {
  const names = await readdir(dir).catch(err => {
    if (err.code === 'ENOENT') return [];
    throw err;
  });
  for (const name of names.filter(name => name.endsWith('.json'))) {
    const job = await readBatch(name.slice(0,-5)).catch(() => undefined);
    if (job && ['queued','running'].includes(job.status)) return job;
  }
}
export async function startBatch(urls,mode,skipRecentHours,intervalSeconds) {
  const running = await activeBatch();
  if (running) throw Error('批次 ' + running.id + ' 仍在运行，请等待结束或调用 gsc_stop_batch');
  // 按规范化网址去重，保留首次输入的原文，便于页面比对未编码的地址。
  const unique = new Map();
  for (const url of urls) if (!unique.has(new URL(url).href)) unique.set(new URL(url).href, url);
  const remaining = [...unique.values()];
  const job = {id:randomUUID(), createdAt:new Date().toISOString(), mode, skipRecentHours, intervalSeconds,
    status:'queued', duplicates:urls.length-remaining.length, remaining, current:null, nextAt:null, results:[]};
  await mkdir(dir,{recursive:true,mode:0o700});
  await save(job);
  const child = spawn(process.execPath,[fileURLToPath(import.meta.url),job.id],{detached:true,stdio:'ignore'});
  await new Promise((resolve,reject) => {child.once('spawn',resolve); child.once('error',reject);});
  child.unref();
  return {id:job.id, total:remaining.length, duplicates:job.duplicates};
}
export async function stopBatch(id) {
  const job = await readBatch(id);
  const active = ['queued','running'].includes(job.status);
  if (active) await writeFile(stopFor(id), '', {mode:0o600});
  return {id, status:job.status, stop_requested:active, current:job.current, remaining:job.remaining};
}
// 返回 true 表示等待期间收到停止请求。
async function pause(id, seconds) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await stopRequested(id)) return true;
    await new Promise(resolve => setTimeout(resolve, Math.min(1000, end - Date.now())));
  }
  return stopRequested(id);
}
async function execute(id) {
  const job = await readBatch(id);
  job.pid = process.pid;
  job.status = 'running';
  try {
    while (job.remaining.length) {
      if (await stopRequested(id)) {
        job.status = 'cancelled';
        break;
      }
      job.current = job.remaining.shift();
      job.nextAt = null;
      await save(job);
      const result = await runUrl(job.current,job.mode,job.skipRecentHours);
      job.results.push({...result,url:new URL(job.current).href});
      job.current = null;
      if (result.error || result.notice) {
        job.status = 'stopped';
        break;
      }
      if (!job.remaining.length || result.status === 'recently_submitted') continue;
      // 确认提交后按设定间隔等待，只读检查最多等 3 秒。
      const seconds = result.status === 'submitted' ? job.intervalSeconds : Math.min(job.intervalSeconds, 3);
      if (!seconds) continue;
      job.nextAt = new Date(Date.now() + seconds * 1000).toISOString();
      await save(job);
      if (await pause(id, seconds)) {
        job.status = 'cancelled';
        break;
      }
    }
    if (job.status === 'running') job.status = 'completed';
  } catch (error) {
    job.status = 'interrupted';
    job.error = error.message;
  }
  job.nextAt = null;
  await save(job);
  await rm(stopFor(id), {force:true});
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await execute(process.argv[2]);
