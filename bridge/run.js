/**
 * [INPUT]: 接收单个网址和执行模式，连接本机 Chrome 宿主。
 * [OUTPUT]: 返回页面结果并写入操作历史，附带已达本机配额的资源；提供宿主状态询问。
 * [POS]: 单条工具、批次执行器和自检共用同一条浏览器链路。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { startRecord, finishRecord, readHistory, exhaustedProperties } from './history.js';
import net from 'node:net';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { socketDir, defaults } from './config.js';
import { AUTO_CONNECT } from '../extension/config.js';

// 没有在线连接时的修复建议，自检共用。
export const OFFLINE = AUTO_CONNECT
  ? '请确认 Chrome 已打开。刚安装或更新时，在 chrome://extensions 刷新扩展；仍未连接时在 GSC 页面点击扩展图标'
  : '请在已登录的 GSC 标签页点击扩展图标';

// 逐个尝试连接，删除无人监听的残留套接字。
async function liveSockets() {
  const names = (await readdir(socketDir).catch(err => {
    if (err.code === 'ENOENT') return [];
    throw err;
  })).filter(name => /^\d+\.sock$/.test(name));
  const attempts = await Promise.all(names.map(name => new Promise(resolve => {
    const path = join(socketDir, name);
    const socket = net.createConnection(path);
    const fail = err => {
      if (['ECONNREFUSED','ENOENT','ENOTSOCK'].includes(err.code)) rm(path, {force:true}).catch(() => {});
      resolve();
    };
    socket.once('error', fail);
    socket.once('connect', () => { socket.off('error', fail); resolve(socket); });
  })));
  return attempts.filter(Boolean);
}
function exchange(socket, message, timeout) {
  return new Promise((resolve, reject) => {
    let data = '';
    socket.setEncoding('utf8');
    socket.setTimeout(timeout, () => socket.destroy(Error('等待超时，请查看 GSC 页面确认提交状态')));
    socket.on('data', chunk => { data += chunk; });
    socket.on('error', reject);
    socket.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { reject(Error('浏览器连接中断，请查看 GSC 确认状态')); }
    });
    socket.write(JSON.stringify(message) + '\n');
  });
}
// 返回每个在线宿主的版本、扩展版本和是否正在执行。
export async function pingHosts() {
  const sockets = await liveSockets();
  return Promise.all(sockets.map(socket => exchange(socket, {ping:true}, 3000).catch(error => ({error:error.message}))));
}
async function request(url, mode, exhausted) {
  const live = await liveSockets();
  if (live.length !== 1) {
    live.forEach(socket => socket.destroy());
    throw Error(live.length ? '请只保留一个连接的 Chrome 配置' : OFFLINE);
  }
  const message = mode === 'submit' && !exhausted.length ? {url}
    : {operation:exhausted.length ? {url, mode, exhausted} : {url, mode}};
  return exchange(live[0], message, defaults.requestTimeoutMs);
}
export async function runUrl(url, mode, skipRecentHours = 0) {
  const record = await startRecord(new URL(url).href, mode);
  let result;
  try {
    if (skipRecentHours > 0 && mode !== 'inspect') {
      const [previous] = await readHistory({url:record.url,status:'submitted',limit:1});
      if (previous && Date.now() - Date.parse(previous.finishedAt) <= skipRecentHours * 3600000) {
        result = {status:'recently_submitted',url:record.url, previousId:previous.id,
          confirmedAt:previous.finishedAt, reportUrl:previous.reportUrl};
      }
    }
    if (!result) {
      const exhausted = mode === 'inspect' ? [] : await exhaustedProperties(defaults.dailyQuota);
      result = await request(url, mode, exhausted);
    }
  } catch (error) {
    result = {error:error.message};
  }
  await finishRecord(record, result);
  return result;
}
