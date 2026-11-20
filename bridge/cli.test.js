/**
 * [INPUT]: 使用临时主目录运行命令行。
 * [OUTPUT]: 验证版本一致、setup 复制与注册、doctor 报告、config 输出和 uninstall。
 * [POS]: 保证一键安装在维护者改动后仍可用。注册路径只在 macOS 上测试。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));

test('扩展与包版本一致', async () => {
  const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
  assert.equal(manifest.version, pkg.version);
});

test('setup、doctor、config 与 uninstall', {skip: process.platform !== 'darwin' && '注册路径仅支持 macOS'}, async t => {
  const home = await mkdtemp(join(tmpdir(), 'gsc-cli-'));
  t.after(() => rm(home, {recursive:true, force:true}));
  const cli = (...args) => run(process.execPath, ['bridge/cli.js', ...args], {env:{...process.env, HOME:home}})
    .catch(error => error);
  const setup = await cli('setup');
  assert.match(setup.stdout, /已安装 GSC Agent/);
  const data = join(home, '.gsc-agent');
  const manifest = JSON.parse(await readFile(join(data, 'extension', 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, pkg.version);
  await assert.rejects(access(join(data, 'extension', 'page.test.js')));
  const host = JSON.parse(await readFile(join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.local.gsc_agent.json'), 'utf8'));
  assert.equal(host.path, join(data, 'host', 'launcher'));
  assert.match(host.allowed_origins[0], /^chrome-extension:\/\/[a-p]{32}\/$/);
  assert.match(await readFile(host.path, 'utf8'), /host\/native\.js'/);

  const doctor = await cli('doctor');
  assert.equal(doctor.code, 1);
  assert.match(doctor.stdout, /✓ 扩展文件/);
  assert.match(doctor.stdout, /✓ 宿主注册/);
  assert.match(doctor.stdout, /✓ 宿主使用的 Node/);
  assert.match(doctor.stdout, /✗ 浏览器连接/);

  assert.match((await cli('config', 'codex')).stdout, /bridge\/mcp\.js[\s\S]*tool_timeout_sec = 270/);
  assert.equal((await cli('config', 'nope')).code, 1);

  await cli('uninstall');
  await assert.rejects(access(host.path));
  await assert.rejects(access(join(data, 'extension')));
});
