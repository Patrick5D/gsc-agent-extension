#!/usr/bin/env node
/**
 * [INPUT]: 读取命令行参数。
 * [OUTPUT]: 安装、卸载、自检、打印各客户端 MCP 配置、生成新扩展 ID 或启动 MCP 服务。
 * [POS]: 包的唯一命令入口 gsc-agent，仓库内经 npm run 调用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { root, setup, uninstall, keygen } from './install.js';

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
// 从 npx 缓存运行时，配置里写 npx 命令；否则写当前 Node 与本仓库 mcp.js 的绝对路径。
const viaNpx = root.includes('/_npx/');
const server = viaNpx
  ? {command: 'npx', args: ['-y', pkg.name, 'mcp']}
  : {command: process.execPath, args: [join(root, 'bridge', 'mcp.js')]};
const shell = value => /^[\w@%+=:,./-]+$/.test(value) ? value : "'" + value.replaceAll("'", "'\\''") + "'";
const line = [server.command, ...server.args].map(shell).join(' ');
const json = JSON.stringify({mcpServers: {'gsc-agent': server}}, null, 2);

const CLIENTS = {
  'claude-code': () => [
    'claude mcp add gsc-agent -- ' + line,
    '# 单条提交可能超过 60 秒。启动时调大工具超时：',
    'MCP_TOOL_TIMEOUT=270000 claude'
  ].join('\n'),
  codex: () => [
    'codex mcp add gsc-agent -- ' + line,
    '# 在 ~/.codex/config.toml 的 [mcp_servers.gsc-agent] 段加入：',
    'tool_timeout_sec = 270'
  ].join('\n'),
  cursor: () => '# 写入 ~/.cursor/mcp.json：\n' + json,
  'claude-desktop': () => '# 写入 ~/Library/Application Support/Claude/claude_desktop_config.json：\n' + json,
  json: () => json
};
function config(client) {
  if (client && !CLIENTS[client]) throw Error('未知客户端 ' + client + '，可选：' + Object.keys(CLIENTS).join('、'));
  if (client === 'json') return json;
  const names = client ? [client] : Object.keys(CLIENTS).filter(name => name !== 'json');
  const text = names.map(name => '## ' + name + '\n' + CLIENTS[name]()).join('\n\n');
  return text + (client ? '' : '\n\n客户端不能调大工具超时时，让 agent 用 gsc_start_batch 处理单个网址：它立即返回，再用 gsc_batch_status 查询结果。');
}

const HELP = `gsc-agent ${pkg.version}

用法：gsc-agent <命令>

  setup              复制扩展和本机宿主到 ~/.gsc-agent，注册 Chrome 宿主
  config [客户端]    打印 MCP 配置：${Object.keys(CLIENTS).join(' | ')}
  doctor             检查安装、浏览器连接和版本
  uninstall          删除宿主注册与复制的文件，保留操作历史
  keygen             为自己的分支版本生成新扩展 ID
  mcp                启动 MCP 服务（由 agent 客户端调用）
`;

const [command, arg] = process.argv.slice(2);
try {
  if (command === 'setup') {
    const result = await setup();
    console.log(`已安装 GSC Agent ${result.version}
  扩展：${result.extension}
  扩展 ID：${result.id}
  宿主注册：${result.manifests.map(item => item.path).join('、')}
  宿主使用的 Node：${result.node}

下一步：
1. 打开 chrome://extensions，开启「开发者模式」，点击「加载已解压的扩展程序」，选择：
   ${result.extension}
   已加载过的，点击该扩展卡片上的刷新按钮。
2. 把 MCP 服务加入你的 agent（重新打印：gsc-agent config）：

${config()}

3. 确认 Chrome 已登录 Search Console，扩展会自动连接，徽标显示 ON。
   （extension/config.js 的 AUTO_CONNECT 为 false 时，需在 GSC 页面点击扩展图标。）
4. 运行 gsc-agent doctor 检查（仓库内为 npm run doctor）。`);
  } else if (command === 'config') {
    console.log(config(arg));
  } else if (command === 'doctor') {
    const { doctor } = await import('./doctor.js');
    const report = await doctor();
    for (const check of report.checks) {
      console.log((check.ok ? '✓ ' : '✗ ') + check.name + '：' + check.detail + (check.fix ? '\n    → ' + check.fix : ''));
    }
    process.exitCode = report.ok ? 0 : 1;
  } else if (command === 'uninstall') {
    const removed = await uninstall();
    console.log('已删除：\n' + removed.map(path => '  ' + path).join('\n') + '\n操作历史保留在 ~/.gsc-agent。请在 chrome://extensions 移除 GSC Agent 扩展。');
  } else if (command === 'keygen') {
    const result = await keygen();
    console.log(`已写入新公钥：${result.manifest}
新扩展 ID：${result.id}
若要与原版并存，再修改 extension/config.js 的 HOST_NAME。然后运行 setup，并在 Chrome 重新加载扩展。`);
  } else if (command === 'mcp') {
    await import('./mcp.js');
  } else {
    console.log(HELP);
    process.exitCode = command && !['help', '-h', '--help'].includes(command) ? 1 : 0;
  }
} catch (error) {
  console.error('错误：' + error.message);
  process.exitCode = 1;
}
