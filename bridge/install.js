/**
 * [INPUT]: 读取本项目的扩展目录、宿主文件、Node 路径和扩展公钥。
 * [OUTPUT]: 把扩展与宿主复制到数据目录，写入 Chrome 原生宿主清单；卸载；生成新扩展公钥。
 * [POS]: 安装后不再依赖项目位置，npx 缓存或移动仓库都不影响已注册的宿主。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { socketDir, version } from './config.js';
import { HOST_NAME } from '../extension/config.js';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const installedExtension = join(socketDir, 'extension');
export const hostDir = join(socketDir, 'host');
export const launcher = join(hostDir, 'launcher');
// 本机宿主运行所需文件。宿主只能依赖 Node 内置模块和这里列出的文件。
const HOST_FILES = ['native.js', 'config.js'];

// Chrome 系浏览器在 macOS 上的原生宿主目录。新增浏览器时在此加一行。
const BROWSERS = {
  darwin: {chrome: 'Library/Application Support/Google/Chrome/NativeMessagingHosts'}
};
export function hostManifests() {
  const table = BROWSERS[process.platform];
  if (!table) throw Error('暂不支持 ' + process.platform + '，目前仅支持 macOS 上的 Google Chrome');
  return Object.entries(table).map(([browser, dir]) => ({browser, path: join(homedir(), dir, HOST_NAME + '.json')}));
}
export function extensionId(key) {
  return [...createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)]
    .map(char => String.fromCharCode(97 + parseInt(char, 16))).join('');
}
export async function readManifest(dir = join(root, 'extension')) {
  return JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
}
export async function setup() {
  const manifests = hostManifests();
  const manifest = await readManifest();
  if (manifest.version !== version) throw Error('extension/manifest.json 版本 ' + manifest.version + ' 与 package.json 版本 ' + version + ' 不一致');
  const id = extensionId(manifest.key);
  await mkdir(socketDir, {recursive:true, mode:0o700});
  await rm(installedExtension, {recursive:true, force:true});
  await cp(join(root, 'extension'), installedExtension, {recursive:true,
    filter: source => !source.endsWith('.test.js') && basename(source) !== 'CLAUDE.md'});
  await rm(hostDir, {recursive:true, force:true});
  await mkdir(hostDir, {recursive:true, mode:0o700});
  for (const file of HOST_FILES) await cp(join(root, 'bridge', file), join(hostDir, file));
  await writeFile(join(hostDir, 'package.json'), JSON.stringify({private:true, type:'module', version}, null, 2) + '\n');
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  await writeFile(launcher, '#!/bin/sh\nexec ' + quote(process.execPath) + ' ' + quote(join(hostDir, 'native.js')) + '\n');
  await chmod(launcher, 0o700);
  for (const {path} of manifests) {
    await mkdir(join(path, '..'), {recursive:true});
    await writeFile(path, JSON.stringify({
      name: HOST_NAME, description: 'GSC Agent local bridge', path: launcher,
      type: 'stdio', allowed_origins: ['chrome-extension://' + id + '/']
    }, null, 2) + '\n');
  }
  return {version, id, extension: installedExtension, manifests, node: process.execPath};
}
export async function uninstall() {
  const removed = [];
  for (const {path} of hostManifests()) {
    await rm(path, {force:true});
    removed.push(path);
  }
  for (const dir of [installedExtension, hostDir]) {
    await rm(dir, {recursive:true, force:true});
    removed.push(dir);
  }
  return removed;
}
// 为分支版本生成新的扩展公钥。私钥不需要保存：未打包加载只用公钥确定 ID。
export async function keygen() {
  const path = join(root, 'extension', 'manifest.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  const { publicKey } = generateKeyPairSync('rsa', {modulusLength: 2048});
  manifest.key = publicKey.export({type:'spki', format:'der'}).toString('base64');
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
  return {id: extensionId(manifest.key), manifest: path};
}
