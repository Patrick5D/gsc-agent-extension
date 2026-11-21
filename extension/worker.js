/**
 * [INPUT]: 接收浏览器启动、标签页变化、工具栏点击、网址、操作模式和已达本机配额的资源，读取 config.js。
 * [OUTPUT]: 连接后报告扩展版本，选定 GSC 标签页并整页打开目标资源，向桥接进程返回本次提交结果；页面自检时逐项返回核对结果。
 * [POS]: 自动连接时选用已打开的 GSC 标签页，没有就后台新开；点击图标固定到当前页。手动模式下只操作被点击的标签页，关闭后断开。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { selectProperty } from './property.js';
import { submitInPage } from './submit.js';
import { HOST_NAME, AUTO_CONNECT, UI } from './config.js';

const GSC = 'https://search.google.com/search-console';
const isGsc = url => Boolean(url?.startsWith(GSC));
const hasProperty = url => isGsc(url) && Boolean(new URL(url).searchParams.get('resource_id'));
let connection;
let boundTab;   // 点击图标固定的标签页
let autoTab;    // 自动选用的标签页，批次中沿用
let opened;     // 自动新开的标签页，未登录时重复使用，避免每次请求都新开
let tabClosed = false;
let busy = false;
const TAB_GONE = AUTO_CONNECT
  ? '使用中的 GSC 标签页已关闭或刷新，请重试'
  : '绑定的 GSC 标签页已关闭或刷新，请在 GSC 页面重新点击扩展图标';

async function indicate(text, title) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setTitle({ title });
}
const connectedTitle = () => boundTab !== undefined
  ? 'Agent 已连接当前 GSC 标签页'
  : 'Agent 已连接，自动使用已打开的 GSC 标签页';

function release() {
  connection?.disconnect();
  connection = undefined;
  boundTab = undefined;
  tabClosed = false;
  void indicate('OFF', TAB_GONE);
}

// 手动模式下，绑定页关闭后断开本机连接，自检随即显示离线。正在执行的操作先返回结果再断开，避免丢失提交状态。
// 自动模式下只解除固定，下次请求重新选页。
chrome.tabs.onRemoved.addListener(id => {
  if (id === autoTab) autoTab = undefined;
  if (id === opened) opened = undefined;
  if (id !== boundTab) return;
  if (AUTO_CONNECT) {
    boundTab = undefined;
    if (connection) void indicate('ON', connectedTitle());
  } else if (busy) tabClosed = true;
  else release();
});

chrome.action.onClicked.addListener(tab => {
  if (busy) return;
  if (!isGsc(tab.url)) {
    if (!connection) void indicate('GSC?', '请打开已登录的 GSC 资源页，再点击连接');
    return;
  }
  // 点击即重新连接，宿主更新后也能换上新版本。
  connect();
  boundTab = tab.id;
  tabClosed = false;
  keep(tab.id);
});

if (AUTO_CONNECT) {
  // 浏览器启动时唤醒后台脚本；脚本每次启动都会执行下面的 connect。
  chrome.runtime.onStartup.addListener(() => {});
  // 连接断开后，打开或刷新 GSC 页面时重新连接。
  chrome.tabs.onUpdated.addListener((id, change, tab) => {
    if (!connection && !busy && change.status === 'complete' && isGsc(tab.url)) connect();
  });
  connect();
}

// 批次可能长时间在后台运行，避免 Chrome 回收该标签页。
function keep(tabId) {
  void chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});
}

function connect() {
  connection?.disconnect();
  const port = chrome.runtime.connectNative(HOST_NAME);
  connection = port;
  let ready = false;
  port.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message || '连接已关闭';
    if (connection !== port) return;
    connection = undefined;
    boundTab = undefined;
    autoTab = undefined;
    void indicate('OFF', reason);
    // 已连通过的宿主意外退出时重连一次。宿主未安装或启动失败时不反复重试。
    if (AUTO_CONNECT && ready) setTimeout(() => { if (!connection) connect(); }, 1000);
  });
  port.onMessage.addListener(async message => {
    if (message.ready) {
      ready = true;
      port.postMessage({ hello: { version: chrome.runtime.getManifest().version } });
      return indicate('ON', connectedTitle());
    }
    if (busy) return port.postMessage({ error: '当前已有提交正在执行' });
    busy = true;
    let response;
    try {
      response = await (message.operation?.mode === 'probe' ? probe() : operate(message.operation || message));
    } finally {
      busy = false;
    }
    if (connection === port) port.postMessage(response);
    if (tabClosed) release();
  });
}

// 等标签页加载完成且网址符合要求，最长 propertySwitch。
async function settle(tabId, ok, message) {
  for (let end = Date.now() + UI.timeouts.propertySwitch; Date.now() < end;) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete' && ok(tab.url)) return tab;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw Error(message);
}

// 固定的标签页优先；自动模式下沿用上次选的页，否则选活动的、再选最近看过的 GSC 资源页，都没有就后台新开一个并沿用。
async function pickTab() {
  if (boundTab !== undefined) return boundTab;
  if (!AUTO_CONNECT) throw Error('请在已登录的 GSC 标签页点击扩展图标');
  const last = autoTab !== undefined && await chrome.tabs.get(autoTab).catch(() => undefined);
  if (last && hasProperty(last.url)) return last.id;
  const tabs = (await chrome.tabs.query({ url: GSC + '*' })).filter(tab => hasProperty(tab.url));
  tabs.sort((a, b) => (b.active - a.active) || ((b.lastAccessed || 0) - (a.lastAccessed || 0)));
  let tab = tabs[0];
  if (!tab) {
    const previous = opened !== undefined && await chrome.tabs.get(opened).catch(() => undefined);
    tab = previous || await chrome.tabs.create({ url: GSC, active: false });
    opened = autoTab = tab.id;
    // 已登录时 GSC 首页会跳到上次使用的资源；未登录时跳到登录页，等不到资源页。
    await settle(tab.id, hasProperty, '自动打开的 GSC 页面没有进入资源页，请先在 Chrome 登录 Search Console 后重试');
  }
  autoTab = tab.id;
  keep(tab.id);
  return tab.id;
}

const isGone = error => /No tab with id|Frame with ID \d+ was removed|tab was closed/i.test(error.message);

// 页面自检：在真实 GSC 页面上只读核对 config.js 的规则。展开资源列表后关闭，再检查当前资源的首页，不点击提交。
const PROBE_URL = 'https://gsc-agent-probe.invalid/';
const RULES = '对照 CUSTOMIZE.md「GSC 改版后失效」一节，在 extension/config.js 中修改 ';
async function probe() {
  const checks = [];
  const add = (name, ok, detail, rules) => checks.push(ok ? {name, ok, detail} : {name, ok, detail, fix: RULES + rules});
  try {
    const tabId = await pickTab();
    const [{result: page}] = await chrome.scripting.executeScript({ target: { tabId },
      func: () => ({ url: location.href, lang: document.documentElement.lang }) });
    const property = new URL(page.url).searchParams.get('resource_id');
    checks.push({name: 'GSC 资源页', ok: true, detail: property + '，界面语言 ' + (page.lang || '未知')});
    const [list] = await chrome.scripting.executeScript({ target: { tabId }, func: selectProperty, args: [UI, PROBE_URL, true] });
    const properties = list?.result?.properties;
    const listError = list?.result?.error || '';
    if (/没有展开/.test(listError)) {
      // 从未被人手点过选择器的标签页里，脚本打不开列表，与文案规则无关。
      checks.push({name: '资源列表', ok: false, detail: listError, fix: '在该 GSC 标签页手动点开一次资源选择框再关闭，然后重新自检。跨资源操作前也需要这样做'});
    } else add('资源列表', Boolean(properties?.length), listError || properties.length + ' 个网站资源', 'propertyPicker');
    const home = property.startsWith('sc-domain:') ? 'https://' + property.slice(10) + '/' : property;
    const result = await operate({ url: home, mode: 'inspect' });
    add('网址检查（只读，未提交）', result.status === 'inspected', result.error || home + '：' + result.headline, 'inspectInput、indexed、unindexed、problem');
    if (result.status === 'inspected') add('收录状态行', Boolean(result.reason), result.reason || '报告中没有读到状态行', 'coverage');
  } catch (error) {
    checks.push({name: 'GSC 标签页', ok: false, detail: isGone(error) ? TAB_GONE : error.message});
  }
  return { checks };
}

async function operate({url, mode = 'submit', exhausted = []}) {
  let property;
  let submitting = false;
  try {
    const tabId = await pickTab();
    const [selection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: selectProperty, args: [UI, url]
    });
    if (selection?.result?.error) throw Error(selection.result.error);
    property = selection?.result?.property;
    if (!property) throw Error('无法确定目标资源，请检查资源列表');
    const canSubmit = !exhausted.includes(property);
    if (mode === 'submit' && !canSubmit) throw Error('本机记录显示该资源 24 小时内的提交已达上限，未打开检查');
    // 需要换资源或页面停在旧报告上时，整页打开目标资源。GSC 单页切换会残留旧资源的检查框或旧报告按钮。
    const clean = url => url && new URL(url).searchParams.get('resource_id') === property && !new URL(url).pathname.startsWith('/search-console/inspect');
    if (!clean((await chrome.tabs.get(tabId)).url)) {
      await chrome.tabs.update(tabId, { url: GSC + '?resource_id=' + encodeURIComponent(property) });
    }
    await settle(tabId, clean, 'GSC 资源页加载未完成，请确认已登录后重试');
    submitting = true;
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId }, func: submitInPage, args: [UI, url, property, mode, canSubmit]
    });
    return { ...(frame?.result || { status: mode === 'inspect' ? 'blocked' : 'unconfirmed', error: '页面已离开或未返回确认' }), property };
  } catch (error) {
    // 只读检查不会点击。提交模式在页面脚本运行中中断时，无法确定是否已点击。
    return { error: isGone(error) ? TAB_GONE : error.message, status: submitting && mode !== 'inspect' ? 'unconfirmed' : 'blocked', property };
  }
}
