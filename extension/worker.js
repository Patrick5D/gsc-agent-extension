/**
 * [INPUT]: 接收工具栏点击、网址、操作模式和已达本机配额的资源，读取 config.js。
 * [OUTPUT]: 连接后报告扩展版本，整页打开目标资源，向桥接进程返回本次提交结果。绑定页关闭后断开连接。
 * [POS]: 只操作用户点击绑定的 GSC 标签页，并禁止该页被自动丢弃。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { selectProperty } from './property.js';
import { submitInPage } from './submit.js';
import { HOST_NAME, UI } from './config.js';

let connection;
let boundTab;
let tabClosed = false;
let busy = false;
const TAB_GONE = '绑定的 GSC 标签页已关闭或刷新，请在 GSC 页面重新点击扩展图标';

async function indicate(text, title) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setTitle({ title });
}

function release() {
  connection?.disconnect();
  connection = undefined;
  boundTab = undefined;
  tabClosed = false;
  void indicate('OFF', TAB_GONE);
}

// 绑定页关闭后断开本机连接，自检随即显示离线。正在执行的操作先返回结果再断开，避免丢失提交状态。
chrome.tabs.onRemoved.addListener(id => {
  if (id !== boundTab) return;
  if (busy) tabClosed = true;
  else release();
});

chrome.action.onClicked.addListener(tab => {
  if (busy) return;
  if (!tab.url?.startsWith('https://search.google.com/search-console')) {
    void indicate('GSC?', '请打开已登录的 GSC 资源页，再点击连接');
    return;
  }
  // 批次可能长时间在后台运行，避免 Chrome 回收该标签页。
  void chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
  connection?.disconnect();
  const port = chrome.runtime.connectNative(HOST_NAME);
  connection = port;
  boundTab = tab.id;
  tabClosed = false;
  port.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message || '连接已关闭';
    if (connection === port) {
      connection = undefined;
      boundTab = undefined;
      void indicate('OFF', reason);
    }
  });
  port.onMessage.addListener(async message => {
    if (message.ready) {
      port.postMessage({ hello: { version: chrome.runtime.getManifest().version } });
      return indicate('ON', 'Agent 已连接当前 GSC 标签页');
    }
    if (busy) return port.postMessage({ error: '当前已有提交正在执行' });
    const {url, mode = 'submit', exhausted = []} = message.operation || message;
    busy = true;
    let response;
    let property;
    let submitting = false;
    try {
      const [selection] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: selectProperty, args: [UI, url]
      });
      if (selection?.result?.error) throw Error(selection.result.error);
      property = selection?.result?.property;
      if (!property) throw Error('无法确定目标资源，请检查资源列表');
      const canSubmit = !exhausted.includes(property);
      if (mode === 'submit' && !canSubmit) throw Error('本机记录显示该资源 24 小时内的提交已达上限，未打开检查');
      // 需要换资源或页面停在旧报告上时，整页打开目标资源。GSC 单页切换会残留旧资源的检查框或旧报告按钮。
      const clean = url => url && new URL(url).searchParams.get('resource_id') === property && !new URL(url).pathname.startsWith('/search-console/inspect');
      if (!clean((await chrome.tabs.get(tab.id)).url)) {
        await chrome.tabs.update(tab.id, { url: 'https://search.google.com/search-console?resource_id=' + encodeURIComponent(property) });
      }
      let ready = false;
      for (let end = Date.now() + UI.timeouts.propertySwitch; Date.now() < end;) {
        const current = await chrome.tabs.get(tab.id);
        if (current.status === 'complete' && clean(current.url)) {
          ready = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (!ready) throw Error('GSC 资源页加载未完成，请确认已登录后重试');
      submitting = true;
      const [frame] = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, func: submitInPage, args: [UI, url, property, mode, canSubmit]
      });
      response = frame?.result || { status: mode === 'inspect' ? 'blocked' : 'unconfirmed', error: '页面已离开或未返回确认' };
    } catch (error) {
      const gone = /No tab with id|Frame with ID \d+ was removed|tab was closed/i.test(error.message);
      // 只读检查不会点击。提交模式在页面脚本运行中中断时，无法确定是否已点击。
      response = { error: gone ? TAB_GONE : error.message, status: submitting && mode !== 'inspect' ? 'unconfirmed' : 'blocked' };
    } finally {
      busy = false;
    }
    if (connection === port) port.postMessage({ ...response, property });
    if (tabClosed) release();
  });
});
