/**
 * [INPUT]: 使用临时主目录运行命令行。
 * [OUTPUT]: 验证版本一致、setup 复制与按已安装浏览器注册、doctor 报告、config 输出和 uninstall。
 * [POS]: 保证一键安装在维护者改动后仍可用。在 macOS 与 Linux 上分别核对注册路径。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));

test('扩展与包版本一致', async () => {
  const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
  assert.equal(manifest.version, pkg.version);
});

// 各平台的浏览器数据目录：Chrome 总会注册，Brave 目录存在时才注册，Edge 未安装不注册。
const DIRS = {
  darwin: {base: 'Library/Application Support', chrome: 'Google/Chrome', brave: 'BraveSoftware/Brave-Browser', edge: 'Microsoft Edge'},
  linux: {base: '.config', chrome: 'google-chrome', brave: 'BraveSoftware/Brave-Browser', edge: 'microsoft-edge'}
}[process.platform];

test('setup、doctor、config 与 uninstall', {skip: !DIRS && '只支持 macOS 与 Linux'}, async t => {
  const home = await mkdtemp(join(tmpdir(), 'gsc-cli-'));
  t.after(() => rm(home, {recursive:true, force:true}));
  const base = join(home, DIRS.base);
  const hostFile = browser => join(base, DIRS[browser], 'NativeMessagingHosts', 'com.local.gsc_agent.json');
  await mkdir(join(base, DIRS.brave), {recursive:true});
  const env = {...process.env, HOME:home, XDG_CONFIG_HOME:join(home, '.config')};
  const cli = (...args) => run(process.execPath, ['bridge/cli.js', ...args], {env}).catch(error => error);
  const setup = await cli('setup');
  assert.match(setup.stdout, /已安装 GSC Agent/);
  const data = join(home, '.gsc-agent');
  const manifest = JSON.parse(await readFile(join(data, 'extension', 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, pkg.version);
  await assert.rejects(access(join(data, 'extension', 'page.test.js')));
  const host = JSON.parse(await readFile(hostFile('chrome'), 'utf8'));
  assert.deepEqual(JSON.parse(await readFile(hostFile('brave'), 'utf8')), host);
  await assert.rejects(access(hostFile('edge')));
  assert.equal(host.path, join(data, 'host', 'launcher'));
  assert.match(host.allowed_origins[0], /^chrome-extension:\/\/[a-p]{32}\/$/);
  assert.match(await readFile(host.path, 'utf8'), /host\/native\.js'/);

  const doctor = await cli('doctor');
  assert.equal(doctor.code, 1);
  assert.match(doctor.stdout, /✓ 扩展文件/);
  assert.match(doctor.stdout, /✓ 宿主注册（chrome）/);
  assert.match(doctor.stdout, /✓ 宿主注册（brave）/);
  assert.match(doctor.stdout, /✓ 宿主使用的 Node/);
  assert.match(doctor.stdout, /✗ 浏览器连接/);

  assert.match((await cli('config', 'codex')).stdout, /bridge\/mcp\.js[\s\S]*tool_timeout_sec = 270/);
  assert.equal((await cli('config', 'nope')).code, 1);

  await cli('uninstall');
  await assert.rejects(access(hostFile('chrome')));
  await assert.rejects(access(hostFile('brave')));
  await assert.rejects(access(join(data, 'extension')));
});
