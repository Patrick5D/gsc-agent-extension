/**
 * [INPUT]: 接收提交开始时间、目标 URL、执行模式与工具结果。
 * [OUTPUT]: 保存本机操作记录，按 URL 和状态查询，统计各资源 24 小时提交数（只读检查不计入）。
 * [POS]: 每次调用独占一个文件，原子替换执行结果。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { socketDir } from './config.js';

const directory = join(socketDir, 'history');
async function save(record) {
  const path = join(directory, record.id + '.json');
  await writeFile(path + '.tmp', JSON.stringify(record), {mode:0o600});
  await rename(path + '.tmp', path);
}
export async function startRecord(url, mode) {
  await mkdir(directory, {recursive:true, mode:0o700});
  const record = {id: randomUUID(), startedAt:new Date().toISOString(), url, mode, status:'started'};
  await save(record);
  return record;
}
export async function finishRecord(record, result) {
  await save({...record, ...result, status:result.status || 'error', finishedAt:new Date().toISOString()});
}
async function readAll() {
  let files;
  try { files = await readdir(directory); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const records = [];
  for (const file of files.filter(name => name.endsWith('.json'))) {
    // 单个损坏文件不影响其余记录。
    try { records.push(JSON.parse(await readFile(join(directory,file),'utf8'))); } catch {}
  }
  return records;
}
export async function readHistory({url, status, limit}) {
  const matches = (await readAll()).filter(item => (!url || item.url === url) && (!status || item.status === status));
  return matches.sort((a,b) => b.startedAt.localeCompare(a.startedAt)).slice(0,limit);
}
// 可能已点击提交的记录都计入配额，未确认的也算，宁可高估。只读检查不会点击，旧版误记的只读记录也一并排除。
export async function exhaustedProperties(limit, now = Date.now()) {
  if (!(limit > 0)) return [];
  const counts = new Map();
  for (const item of await readAll()) {
    if (item.mode === 'inspect' || !item.property || !['submitted','unconfirmed'].includes(item.status)) continue;
    if (now - Date.parse(item.finishedAt) > 24 * 3600000) continue;
    counts.set(item.property, (counts.get(item.property) || 0) + 1);
  }
  return [...counts].filter(([, count]) => count >= limit).map(([property]) => property);
}
