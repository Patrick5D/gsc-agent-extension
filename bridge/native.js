/**
 * [INPUT]: 从本机套接字接收 URL 与操作模式或状态询问，从 Chrome 读取带长度的 JSON。
 * [OUTPUT]: 向选中的扩展连接发送任务，向调用方返回结果、宿主与扩展版本。
 * [POS]: 由 Chrome 启动，每个浏览器连接占一个套接字，退出或收到信号时删除。只依赖 Node 内置模块。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import net from 'node:net';
import fs from 'node:fs';
import { join } from 'node:path';
import { socketDir, version } from './config.js';

fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
const endpoint = join(socketDir, process.pid + '.sock');
let active;
let extension;
function sendChrome(value) {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([header, body]));
}
const server = net.createServer(socket => {
  socket.on('error', () => {});
  let data = '';
  socket.setEncoding('utf8');
  socket.on('data', chunk => {
    data += chunk;
    if (!data.includes('\n')) return;
    socket.removeAllListeners('data');
    try {
      const message = JSON.parse(data);
      // 状态询问不占用任务，执行中也立即回答。
      if (message.ping) return socket.end(JSON.stringify({ pong: true, host: version, extension, busy: Boolean(active) }) + '\n');
      if (active) throw Error('已有任务执行中');
      const { url } = message.operation || message;
      if (typeof url !== 'string') throw Error('缺少网址');
      active = socket;
      sendChrome(message.operation ? { operation:message.operation } : {url});
    } catch (err) {
      socket.end(JSON.stringify({ error: err.message }) + '\n');
    }
  });
});
server.listen(endpoint, () => sendChrome({ ready: true }));
let pending = Buffer.alloc(0);
process.stdin.on('data', chunk => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 4) {
    const length = pending.readUInt32LE();
    if (pending.length < length + 4) break;
    const frame = pending.subarray(4, 4 + length).toString();
    pending = pending.subarray(4 + length);
    // 扩展连接后先报告自身版本，这一帧不是任务回包。
    let hello;
    try { hello = JSON.parse(frame).hello; } catch {}
    if (hello) {
      extension = hello;
      continue;
    }
    if (active && !active.destroyed) active.end(frame + '\n');
    active = undefined;
  }
});
process.stdin.on('end', () => process.exit());
// 信号默认不触发 exit 事件，转为正常退出以删除套接字。
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => process.exit());
process.on('exit', () => fs.rmSync(endpoint, { force: true }));
