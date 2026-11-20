/**
 * [INPUT]: 读取当前用户主目录、包版本和可选环境变量。
 * [OUTPUT]: 数据目录、版本号与桥接默认值。
 * [POS]: bridge 唯一的可定制入口，随本机宿主一起复制，只依赖 Node 内置模块。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// 套接字、历史、批次、复制的扩展和宿主都放在这里。
export const socketDir = join(homedir(), '.gsc-agent');

// 仓库内读根目录 package.json，复制后的宿主读同目录 package.json。
const manifest = ['./package.json', '../package.json'].map(path => new URL(path, import.meta.url))
  .find(url => existsSync(url));
export const version = manifest ? JSON.parse(readFileSync(manifest, 'utf8')).version : 'unknown';

export const defaults = {
  // 每个资源 24 小时内的提交上限。环境变量 GSC_AGENT_DAILY_QUOTA 可覆盖，0 表示关闭。
  dailyQuota: Number(process.env.GSC_AGENT_DAILY_QUOTA ?? 10),
  // 批次中确认提交后的默认等待秒数。
  intervalSeconds: 120,
  // 单条操作等待浏览器回包的上限，须大于扩展各阶段等待时间之和。
  requestTimeoutMs: 265000
};
