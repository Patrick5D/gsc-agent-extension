/**
 * [INPUT]: 用内存中的 chrome 对象模拟标签页、本机端口与脚本注入，每个用例重新加载 worker.js。
 * [OUTPUT]: 验证自动连接、选页顺序、批次沿用、后台新开、未登录不重复新开、点击固定与解除、断线重连。
 * [POS]: 只覆盖 worker 的连接与选页，页面内操作由 page.test.js 覆盖。按 config.js 的 AUTO_CONNECT 默认值运行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const GSC = 'https://search.google.com/search-console';
const page = id => GSC + '?resource_id=' + encodeURIComponent('sc-domain:' + id);

function fakeChrome(tabs = []) {
  const listeners = {};
  const event = name => ({ addListener: fn => (listeners[name] ??= []).push(fn) });
  const store = new Map(tabs.map(tab => [tab.id, {status:'complete', active:false, lastAccessed:0, ...tab}]));
  const ports = [];
  const created = [];
  const executed = [];
  let next = 100;
  const port = () => {
    const on = {message:[], disconnect:[]};
    const value = {
      sent: [], closed: false,
      postMessage: message => value.sent.push(message),
      disconnect: () => { value.closed = true; },
      onMessage: { addListener: fn => on.message.push(fn) },
      onDisconnect: { addListener: fn => on.disconnect.push(fn) },
      deliver: message => Promise.all(on.message.map(fn => fn(message))),
      drop: () => on.disconnect.forEach(fn => fn())
    };
    return value;
  };
  const chrome = {
    ports, created, executed, store,
    fire: (name, ...args) => (listeners[name] || []).forEach(fn => fn(...args)),
    // 发送一条只读检查，返回 worker 的回包。
    inspect: async (url = 'https://www.example.com/a') => {
      const current = ports.at(-1);
      await current.deliver({operation:{url, mode:'inspect'}});
      return current.sent.at(-1);
    },
    runtime: {
      connectNative: () => { const value = port(); ports.push(value); return value; },
      getManifest: () => ({version:'test'}),
      onStartup: event('startup')
    },
    action: {
      setBadgeText: async ({text}) => { chrome.badge = text; },
      setTitle: async ({title}) => { chrome.title = title; },
      onClicked: event('clicked')
    },
    tabs: {
      onRemoved: event('removed'),
      onUpdated: event('updated'),
      get: async id => {
        if (!store.has(id)) throw Error('No tab with id: ' + id + '.');
        return {...store.get(id)};
      },
      query: async ({url}) => [...store.values()].filter(tab => tab.url?.startsWith(url.replace(/\*$/, ''))).map(tab => ({...tab})),
      create: async ({url, active}) => {
        const tab = {id: next++, url, active, status:'loading'};
        store.set(tab.id, tab);
        created.push(tab);
        chrome.onCreate?.(tab);
        return {...tab};
      },
      update: async (id, props) => {
        const tab = store.get(id);
        if (!tab) throw Error('No tab with id: ' + id + '.');
        if (props.url) Object.assign(tab, {url: props.url, status:'complete'});
        return {...tab};
      }
    },
    scripting: {
      executeScript: async ({target:{tabId}, func}) => {
        executed.push({tabId, func: func.name});
        return [{result: func.name === 'selectProperty' ? {property:'sc-domain:example.com'} : {status:'inspected'}}];
      }
    }
  };
  return chrome;
}

async function start(tabs) {
  const chrome = fakeChrome(tabs);
  globalThis.chrome = chrome;
  await import('./worker.js?' + Math.random());
  await chrome.ports.at(-1).deliver({ready:true});
  return chrome;
}
const usedTab = chrome => chrome.executed.at(-1).tabId;

test('启动即连接本机并报告扩展版本', async () => {
  const chrome = await start();
  assert.equal(chrome.ports.length, 1);
  assert.deepEqual(chrome.ports[0].sent[0], {hello:{version:'test'}});
  assert.equal(chrome.badge, 'ON');
});

test('选活动的 GSC 资源页，忽略非资源页，批次中沿用同一页', async () => {
  const chrome = await start([
    {id:1, url:GSC + '/welcome', active:true},
    {id:2, url:page('a.com'), lastAccessed:9},
    {id:3, url:page('b.com'), active:true, lastAccessed:1},
    {id:4, url:'https://example.com/', active:true}
  ]);
  assert.equal((await chrome.inspect()).status, 'inspected');
  assert.equal(usedTab(chrome), 3);
  chrome.store.get(3).active = false;
  chrome.store.get(2).active = true;
  await chrome.inspect();
  assert.equal(usedTab(chrome), 3);
  assert.equal(chrome.created.length, 0);
});

test('没有活动的 GSC 页时选最近看过的', async () => {
  const chrome = await start([
    {id:2, url:page('a.com'), lastAccessed:1},
    {id:3, url:page('b.com'), lastAccessed:9}
  ]);
  await chrome.inspect();
  assert.equal(usedTab(chrome), 3);
});

test('没有 GSC 页时在后台新开一个，进入资源页后继续', async () => {
  const chrome = await start([{id:1, url:'https://example.com/', active:true}]);
  chrome.onCreate = tab => setTimeout(() => Object.assign(tab, {url:page('a.com'), status:'complete'}), 50);
  const response = await chrome.inspect();
  assert.equal(response.status, 'inspected', response.error);
  assert.equal(chrome.created.length, 1);
  assert.equal(chrome.created[0].active, false);
  assert.equal(usedTab(chrome), chrome.created[0].id);
});

test('未登录时说明原因，再次请求不重复新开标签页', async () => {
  const chrome = await start();
  chrome.onCreate = tab => Object.assign(tab, {url:undefined, status:'complete'});
  mock.timers.enable({apis:['setTimeout', 'Date']});
  try {
    for (let round = 0; round < 2; round++) {
      const pending = chrome.inspect();
      for (let i = 0; i < 100; i++) {
        await new Promise(resolve => setImmediate(resolve));
        mock.timers.tick(200);
      }
      const response = await pending;
      assert.match(response.error, /登录/);
      assert.equal(response.status, 'blocked');
    }
  } finally {
    mock.timers.reset();
  }
  assert.equal(chrome.created.length, 1);
});

test('点击图标固定到当前页，关闭后恢复自动选页且不断开', async () => {
  const chrome = await start([
    {id:2, url:page('a.com')},
    {id:3, url:page('b.com'), active:true}
  ]);
  chrome.fire('clicked', {id:2, url:page('a.com')});
  await chrome.ports.at(-1).deliver({ready:true});
  assert.match(chrome.title, /当前 GSC 标签页/);
  await chrome.inspect();
  assert.equal(usedTab(chrome), 2);
  chrome.store.delete(2);
  chrome.fire('removed', 2);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(chrome.ports.at(-1).closed, false);
  assert.match(chrome.title, /自动使用/);
  await chrome.inspect();
  assert.equal(usedTab(chrome), 3);
});

test('非 GSC 页面上点击图标不影响已有连接', async () => {
  const chrome = await start();
  chrome.fire('clicked', {id:9, url:'https://example.com/'});
  assert.equal(chrome.ports.length, 1);
  assert.equal(chrome.badge, 'ON');
});

test('宿主意外退出后重连一次，从未连通时只在打开 GSC 页面时再试', async () => {
  const chrome = await start();
  chrome.ports[0].drop();
  assert.equal(chrome.badge, 'OFF');
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(chrome.ports.length, 2);
  chrome.ports[1].drop();
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(chrome.ports.length, 2);
  chrome.fire('updated', 1, {status:'complete'}, {url:page('a.com')});
  assert.equal(chrome.ports.length, 3);
});

test('使用中的标签页被关闭时说明原因', async () => {
  const chrome = await start([{id:3, url:page('b.com'), active:true}]);
  chrome.scripting.executeScript = async () => { throw Error('No tab with id: 3.'); };
  const response = await chrome.inspect();
  assert.match(response.error, /已关闭或刷新/);
  assert.equal(response.status, 'blocked');
});
