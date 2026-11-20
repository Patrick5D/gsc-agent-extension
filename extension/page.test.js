/**
 * [INPUT]: 用 jsdom 搭建模拟 GSC 页面，注入 submit.js 与 property.js 的函数源码。
 * [OUTPUT]: 验证网址比对、等待检查框、配额阻止、跳过已收录与资源筛选。
 * [POS]: 以函数源码注入，确认注入函数自包含。模拟页面只按本项目假设的结构搭建，不代表真实 GSC。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { submitInPage } from './submit.js';
import { selectProperty } from './property.js';
import { UI } from './config.js';

function browser(path) {
  const dom = new JSDOM('<body><header></header><main></main></body>',
    {url:'https://search.google.com' + path, runScripts:'outside-only'});
  const {window} = dom;
  // jsdom 不做布局：已挂载且不在 hidden 内即视为可见；innerText 按块元素换行。
  window.Element.prototype.getClientRects = function () {
    return this.isConnected && !this.closest('[hidden]') ? [{}] : [];
  };
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {get() {
    const text = node => node.nodeType === 3 ? node.data
      : [...node.childNodes].map(text).join(node.tagName === 'SPAN' ? '' : '\n');
    return text(this);
  }});
  const add = (parent, text = '', attrs = {}) => {
    const el = window.document.createElement('div');
    if (text) el.textContent = text;
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    parent.append(el);
    return el;
  };
  return {window, document:window.document, add, inject:fn => window.eval('(' + fn + ')')};
}

function inspectPage({property = 'sc-domain:example.com', headline = '网址未收录到 Google', shown, inputDelay = 0} = {}) {
  const page = browser('/search-console/performance/search-analytics?resource_id=' + encodeURIComponent(property));
  const {window, document, add} = page;
  page.clicks = 0;
  const mount = () => {
    const input = document.createElement('input');
    input.setAttribute('aria-label', '检查“example.com”中的任何网址');
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      window.setTimeout(() => {
        window.history.pushState({}, '', '/search-console/inspect?resource_id=' + encodeURIComponent(property) + '&id=r1');
        const main = document.querySelector('main');
        main.replaceChildren();
        add(main, shown ?? input.value);
        add(main, headline);
        add(main, '请求编入索引', {role:'button'}).addEventListener('click', () => {
          page.clicks++;
          const testing = add(document.body, '正在测试实际网址能否编入索引', {role:'dialog'});
          window.setTimeout(() => {
            testing.remove();
            const done = add(document.body, '', {role:'dialog'});
            add(done, '已请求编入索引');
            add(done, '知道了', {role:'button'}).addEventListener('click', () => done.remove());
          }, 50);
        });
      }, 50);
    });
    document.querySelector('header').append(input);
  };
  if (inputDelay) window.setTimeout(mount, inputDelay); else mount();
  page.run = (...args) => page.inject(submitInPage)(UI, ...args);
  page.dialogs = () => document.querySelectorAll('[role="dialog"]').length;
  return page;
}

test('报告显示解码后的中文路径时仍能提交并关闭成功框', async () => {
  const raw = 'https://example.com/文章/一';
  const page = inspectPage({shown:raw});
  const result = await page.run(raw, 'sc-domain:example.com', 'submit');
  assert.equal(result.status, 'submitted', result.error);
  assert.equal(result.url, new URL(raw).href);
  assert.equal(page.clicks, 1);
  assert.equal(page.dialogs(), 0);
  assert.equal(result.notice, undefined);
});

test('根路径报告省略末尾斜杠时也能识别', async () => {
  const page = inspectPage({shown:'https://example.com'});
  const result = await page.run('https://example.com/', 'sc-domain:example.com', 'inspect');
  assert.equal(result.status, 'inspected', result.error);
  assert.equal(result.indexed, false);
});

test('检查框延迟渲染时等待出现', async () => {
  const page = inspectPage({inputDelay:400});
  const result = await page.run('https://example.com/a', 'sc-domain:example.com', 'submit');
  assert.equal(result.status, 'submitted', result.error);
});

test('if_unindexed 遇到已收录时不点击', async () => {
  const page = inspectPage({headline:'网址已收录到 Google'});
  const result = await page.run('https://example.com/a', 'sc-domain:example.com', 'if_unindexed');
  assert.equal(result.status, 'already_indexed');
  assert.equal(page.clicks, 0);
});

test('本机配额已满时检查后停在点击前', async () => {
  const page = inspectPage();
  const result = await page.run('https://example.com/a', 'sc-domain:example.com', 'if_unindexed', false);
  assert.equal(result.status, 'blocked');
  assert.match(result.error, /上限/);
  assert.equal(page.clicks, 0);
});

test('网址不在资源中时直接阻止', async () => {
  const page = inspectPage();
  const result = await page.run('https://other.com/a', 'sc-domain:example.com', 'submit');
  assert.equal(result.status, 'blocked');
  assert.equal(page.clicks, 0);
});

function pickerPage(properties, current) {
  const page = browser('/search-console?resource_id=' + encodeURIComponent(current));
  const {window, document, add} = page;
  const picker = add(document.body, '', {role:'button', 'aria-label':'搜索资源', 'aria-expanded':'false'});
  const input = document.createElement('input');
  input.setAttribute('role', 'combobox');
  picker.append(input);
  const list = add(document.body);
  // 模拟只渲染前 3 个匹配项的列表。
  const render = filter => list.replaceChildren(...properties.filter(id => id.includes(filter)).slice(0, 3).map(id => {
    const option = document.createElement('div');
    option.setAttribute('role', 'option');
    option.setAttribute('aria-label', id);
    option.addEventListener('click', () => { page.clicked = id; });
    return option;
  }));
  picker.addEventListener('click', () => { picker.setAttribute('aria-expanded', 'true'); render(''); });
  input.addEventListener('input', () => window.setTimeout(() => render(input.value), 30));
  page.run = url => page.inject(selectProperty)(UI, url);
  return page;
}

const many = ['https://a.com/', 'https://b.com/', 'https://c.com/', 'https://d.com/'];

test('未筛选列表看不到目标时，按主机名筛选后选最具体的资源', async () => {
  const page = pickerPage([...many, 'sc-domain:example.com', 'https://blog.example.com/'], many[0]);
  const result = await page.run('https://blog.example.com/post');
  assert.equal(result.property, 'https://blog.example.com/', result.error);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(page.clicked, 'https://blog.example.com/');
});

test('子域名回退到上级网域资源', async () => {
  const page = pickerPage([...many, 'sc-domain:example.com'], many[0]);
  const result = await page.run('https://blog.example.com/post');
  assert.equal(result.property, 'sc-domain:example.com', result.error);
});

test('当前资源已覆盖网址时不打开选择器', async () => {
  const page = pickerPage(many, 'sc-domain:example.com');
  assert.equal((await page.run('https://www.example.com/')).property, 'sc-domain:example.com');
  assert.equal(page.clicked, undefined);
});

test('没有匹配资源时返回错误', async () => {
  const page = pickerPage(many, many[0]);
  assert.match((await page.run('https://nomatch.org/')).error, /没有匹配/);
});
