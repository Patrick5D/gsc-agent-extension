/**
 * [INPUT]: 接收工具栏点击、网址、操作模式和已达本机配额的资源，读取 config.js。
 * [OUTPUT]: 连接后报告扩展版本，向桥接进程返回本次提交结果。
 * [POS]: 只操作用户点击绑定的 GSC 标签页，并禁止该页被自动丢弃。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { selectProperty } from './property.js';
import { submitInPage } from './submit.js';
import { HOST_NAME, UI } from './config.js';

let connection;
let busy = false;

async function indicate(text, title) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setTitle({ title });
}

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
  port.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message || '连接已关闭';
    if (connection === port) {
      connection = undefined;
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
      let ready = false;
      for (let end = Date.now() + UI.timeouts.propertySwitch; Date.now() < end;) {
        const current = await chrome.tabs.get(tab.id);
        if (current.status === 'complete' && current.url && new URL(current.url).searchParams.get('resource_id') === property) {
          ready = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (!ready) throw Error('资源切换未完成');
      submitting = true;
      const [frame] = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, func: submitInPage, args: [UI, url, property, mode, canSubmit]
      });
      response = frame?.result || { status: 'unconfirmed', error: '页面已离开或未返回确认' };
    } catch (error) {
      response = { error: error.message, status: submitting ? 'unconfirmed' : 'blocked' };
    } finally {
      busy = false;
    }
    if (connection === port) port.postMessage({ ...response, property });
  });
});
