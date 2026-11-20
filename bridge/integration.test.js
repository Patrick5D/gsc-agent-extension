/**
 * [INPUT]: 使用临时主目录与模拟的 Chrome 消息管道。
 * [OUTPUT]: 验证单条兼容、版本报告与自检、本机配额、批次去重、互斥、进度、停止与中断续跑。
 * [POS]: 从 MCP 客户端跨进程验证原生桥接协议。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('单 URL、配额与批次经过 MCP 和本机宿主', {timeout:20000}, async t => {
  const temp = await mkdtemp(join(tmpdir(), 'gsc-test-'));
  const env = { ...process.env, HOME: temp, GSC_AGENT_DAILY_QUOTA: '1' };
  // 预置一个无人监听的残留套接字文件，应被跳过并删除。
  await mkdir(join(temp, '.gsc-agent'), {recursive:true});
  await writeFile(join(temp, '.gsc-agent', '1.sock'), '');
  const host = spawn(process.execPath, ['bridge/native.js'], {env});
  const client = new Client({name:'test', version:'1'});
  t.after(async () => {
    await client.close();
    host.stdin.end();
    await rm(temp, {recursive:true,force:true});
  });
  const stream = host.stdout[Symbol.asyncIterator]();
  let bytes = Buffer.alloc(0);
  async function nextFrame() {
    while (bytes.length < 4 || bytes.length < bytes.readUInt32LE() + 4) {
      const part = await stream.next();
      assert.equal(part.done, false);
      bytes = Buffer.concat([bytes, part.value]);
    }
    const end = bytes.readUInt32LE() + 4;
    const value = JSON.parse(bytes.subarray(4, end));
    bytes = bytes.subarray(end);
    return value;
  }
  function answer(value) {
    const body = Buffer.from(JSON.stringify(value));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    host.stdin.write(Buffer.concat([header,body]));
  }
  const invoke = async (name,args) => {
    const result = await client.callTool({name,arguments:args});
    assert.ok(!result.isError, result.content[0].text);
    return JSON.parse(result.content[0].text);
  };
  const reject = async (name,args) => {
    const result = await client.callTool({name,arguments:args});
    assert.equal(result.isError, true);
    return result.content[0].text;
  };
  async function settle(id) {
    let progress;
    do {
      progress = await invoke('gsc_batch_status',{id});
      if (progress.status === 'running' || progress.status === 'queued') await new Promise(resolve => setTimeout(resolve,20));
    } while (progress.status === 'running' || progress.status === 'queued');
    return progress;
  }

  assert.deepEqual(await nextFrame(), {ready:true});
  const {version} = JSON.parse(await readFile('package.json', 'utf8'));
  answer({hello:{version}});
  await client.connect(new StdioClientTransport({command:process.execPath, args:['bridge/mcp.js'], env}));
  const {tools} = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ['gsc_request_indexing','gsc_submission_history','gsc_start_batch','gsc_batch_status','gsc_stop_batch','gsc_doctor']);
  const checks = Object.fromEntries((await invoke('gsc_doctor',{})).checks.map(check => [check.name, check]));
  assert.equal(checks['浏览器连接'].ok, true);
  assert.equal(checks['运行中的版本'].ok, true, checks['运行中的版本'].detail);
  const url = 'https://example.com/article';
  const property = 'sc-domain:example.com';
  const waiting = client.callTool({name:'gsc_request_indexing', arguments:{url}});
  assert.deepEqual(await nextFrame(), {url});
  assert.ok(!(await readdir(join(temp, '.gsc-agent'))).includes('1.sock'));
  assert.match(await reject('gsc_request_indexing',{url}), /已有任务执行中/);
  const history = async status => invoke('gsc_submission_history',{url,status});
  assert.equal((await history('started')).length,1);
  assert.equal((await history('error')).length,1);
  const reply = {status:'submitted', url, property};
  answer(reply);
  assert.deepEqual(JSON.parse((await waiting).content[0].text), reply);
  assert.equal((await history('submitted')).length,1);
  assert.equal((await history('started')).length,0);

  const recent = await invoke('gsc_request_indexing',{url,skip_recent_hours:12});
  assert.equal(recent.status,'recently_submitted');

  // 配额设为 1：该资源已确认一次，下一次提交须带上已满资源。
  const limited = reject('gsc_request_indexing',{url});
  assert.deepEqual(await nextFrame(), {operation:{url, mode:'submit', exhausted:[property]}});
  answer({status:'blocked', error:'本机记录显示该资源 24 小时内的提交已达上限', property});
  assert.match(await limited, /上限/);

  const second = url + '2', third = url + '3';
  const job = await invoke('gsc_start_batch',{urls:[url,url,second,third],mode:'inspect',interval_seconds:0});
  assert.equal(job.duplicates,1);
  assert.deepEqual(await nextFrame(),{operation:{url,mode:'inspect'}});
  assert.match(await reject('gsc_start_batch',{urls:[url]}), /仍在运行/);
  assert.match(await reject('gsc_request_indexing',{url}), /正在使用浏览器/);
  answer({status:'inspected',indexed:true});
  assert.deepEqual(await nextFrame(),{operation:{url:second,mode:'inspect'}});
  answer({status:'blocked',error:'请先登录'});
  let progress = await settle(job.id);
  assert.equal(progress.status,'stopped');
  assert.deepEqual(progress.remaining,[third]);
  assert.deepEqual(progress.results.map(item=>item.status),['inspected','blocked']);

  const resumed = await invoke('gsc_start_batch',{urls:progress.remaining,mode:'if_unindexed'});
  assert.deepEqual(await nextFrame(),{operation:{url:third,mode:'if_unindexed',exhausted:[property]}});
  answer({status:'already_indexed',indexed:true});
  assert.equal((await settle(resumed.id)).status,'completed');

  // 确认提交后进入 60 秒间隔，停止请求在等待中生效。
  const other = 'https://other.com/a', after = 'https://other.com/b';
  const paced = await invoke('gsc_start_batch',{urls:[other, after],interval_seconds:60});
  assert.deepEqual(await nextFrame(),{operation:{url:other,mode:'submit',exhausted:[property]}});
  answer({status:'submitted',url:other,property:'sc-domain:other.com'});
  do progress = await invoke('gsc_batch_status',{id:paced.id}); while (!progress.nextAt);
  assert.equal((await invoke('gsc_stop_batch',{id:paced.id})).stop_requested,true);
  progress = await settle(paced.id);
  assert.equal(progress.status,'cancelled');
  assert.deepEqual(progress.remaining,[after]);
});
