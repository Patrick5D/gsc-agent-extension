/**
 * [INPUT]: 读取已安装的宿主清单、启动脚本、复制的扩展和在线宿主状态。
 * [OUTPUT]: 逐项返回检查结果与修复建议。
 * [POS]: 命令行 doctor 与 MCP 工具 gsc_doctor 共用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { version } from './config.js';
import { pingHosts, OFFLINE } from './run.js';
import { extensionId, hostManifests, installedExtension, launcher, readManifest } from './install.js';
import { HOST_NAME, AUTO_CONNECT } from '../extension/config.js';

const SETUP = '运行 gsc-agent setup（仓库内为 npm run setup）';
export async function doctor() {
  const checks = [];
  const add = (name, ok, detail, fix) => checks.push(ok ? {name, ok, detail} : {name, ok, detail, fix});
  let manifests = [];
  try { manifests = hostManifests(); } catch (error) { add('平台', false, error.message, '目前只能在 macOS 上使用'); }
  let installed;
  try { installed = await readManifest(installedExtension); } catch {}
  add('扩展文件', Boolean(installed), installed ? installedExtension + '（' + installed.version + '）' : '未找到 ' + installedExtension, SETUP);
  if (installed && installed.version !== version) add('扩展文件版本', false, '已复制 ' + installed.version + '，当前 ' + version, SETUP + '，再在 chrome://extensions 刷新扩展');
  for (const {browser, path} of manifests) {
    let host;
    try { host = JSON.parse(await readFile(path, 'utf8')); } catch {}
    if (!host) {
      add('宿主注册（' + browser + '）', false, '未找到 ' + path, SETUP);
      continue;
    }
    const expected = installed && 'chrome-extension://' + extensionId(installed.key) + '/';
    const problems = [
      host.name !== HOST_NAME && '宿主名不一致',
      host.path !== launcher && '启动脚本指向 ' + host.path,
      expected && !host.allowed_origins?.includes(expected) && '允许的扩展 ID 与已复制的扩展不一致'
    ].filter(Boolean);
    add('宿主注册（' + browser + '）', !problems.length, problems.join('；') || path, SETUP);
  }
  try {
    await access(launcher, constants.X_OK);
    const node = (await readFile(launcher, 'utf8')).match(/exec '((?:[^']|'\\'')*)'/)?.[1].replaceAll("'\\''", "'");
    const nodeOk = node && await access(node, constants.X_OK).then(() => true, () => false);
    add('宿主使用的 Node', nodeOk, node || '无法读取启动脚本', '切换或删除过 Node 版本时，' + SETUP);
  } catch {
    add('启动脚本', false, '未找到 ' + launcher, SETUP);
  }
  const hosts = await pingHosts();
  if (!hosts.length) {
    add('浏览器连接', false, '没有在线连接', OFFLINE + '，徽标显示 ON');
  } else if (hosts.length > 1) {
    add('浏览器连接', false, hosts.length + ' 个 Chrome 配置同时连接', AUTO_CONNECT ? '只在一个 Chrome 配置中启用扩展' : '只在一个 Chrome 配置中点击扩展图标');
  } else {
    const [host] = hosts;
    const ext = host.extension?.version;
    add('浏览器连接', !host.error, host.error || (host.busy ? '已连接，正在执行任务' : '已连接'));
    add('运行中的版本', ext === version && host.host === version,
      '扩展 ' + (ext || '未报告') + '，宿主 ' + host.host + '，MCP ' + version,
      '在 chrome://extensions 刷新扩展' + (AUTO_CONNECT ? '' : '，重新点击扩展图标') + '，并重启 agent 的 MCP 连接');
  }
  return {ok: checks.every(check => check.ok), version, checks};
}
