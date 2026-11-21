/**
 * [INPUT]: 用 jsdom 搭建模拟 GSC 页面，注入 submit.js 与 property.js 的函数源码。
 * [OUTPUT]: 验证网址比对、等待检查框、遮挡判断、旧按钮替换、跨资源提示、配额阻止、跳过已收录、资源列表展开与筛选。
 * [POS]: 以函数源码注入，确认注入函数自包含。资源选择器按真实 GSC 观察到的结构搭建，报告页仍为简化模拟。
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
  const page = {window, document:window.document, add, inject:fn => window.eval('(' + fn + ')')};
  // jsdom 不做命中测试：page.cover 为遮在控件上方的元素，未设置时控件可点。
  window.document.elementFromPoint = () => page.cover || null;
  return page;
}

function inspectPage({property = 'sc-domain:example.com', headline = '网址未收录到 Google', shown, inputDelay = 0, ui = UI, outside = false, stale = false} = {}) {
  const page = browser('/search-console/performance/search-analytics?resource_id=' + encodeURIComponent(property));
  const {window, document, add} = page;
  page.clicks = 0;
  const mount = () => {
    const input = document.createElement('input');
    input.setAttribute('aria-label', '检查“example.com”中的任何网址');
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      window.setTimeout(() => {
        if (outside) {
          // 检查框仍属于旧资源时，GSC 弹窗提示网址不在该资源中，不打开报告。
          const box = add(document.body, '', {role:'dialog'});
          add(box, '此网址不在该资源中');
          add(box, '关闭', {role:'button'});
          return;
        }
        window.history.pushState({}, '', '/search-console/inspect?resource_id=' + encodeURIComponent(property) + '&id=r1');
        const main = document.querySelector('main');
        main.replaceChildren();
        add(main, shown ?? input.value);
        add(main, headline);
        if (stale) {
          // 旧报告的按钮排在前面，被新报告的浮层盖住，点击无效。
          const old = add(main, '请求编入索引', {role:'button'});
          const layer = add(document.body, '', {role:'dialog'});
          old.getBoundingClientRect = () => ({left:100, top:100, width:0, height:0});
          document.elementFromPoint = x => x === 100 ? layer : null;
        }
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
  page.run = (...args) => page.inject(submitInPage)(ui, ...args);
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

test('展开的导航菜单带 dialog 角色但不遮挡时照常操作', async () => {
  const page = inspectPage();
  page.add(page.document.body, '概述\n效果\n网址检查', {role:'dialog'});
  const result = await page.run('https://example.com/a', 'sc-domain:example.com', 'submit');
  assert.equal(result.status, 'submitted', result.error);
  assert.equal(page.clicks, 1);
});

const quick = {...UI, timeouts:{...UI.timeouts, unblock:300}};

test('弹窗遮住检查框时不输入并说明原因', async () => {
  const page = inspectPage({ui:quick});
  page.cover = page.add(page.document.body, '日期范围', {role:'dialog'});
  const result = await page.run('https://example.com/a', 'sc-domain:example.com', 'submit');
  assert.equal(result.status, 'blocked');
  assert.match(result.error, /遮挡/);
  assert.equal(page.clicks, 0);
});

test('遮挡很快消失时继续提交', async () => {
  const page = inspectPage({ui:quick});
  const cover = page.cover = page.add(page.document.body, '正在检索', {role:'dialog'});
  setTimeout(() => { page.cover = null; cover.remove(); }, 100);
  const result = await page.run('https://example.com/a', 'sc-domain:example.com', 'submit');
  assert.equal(result.status, 'submitted', result.error);
});

test('旧报告的按钮被盖住时点击当前可点的按钮', async () => {
  const page = inspectPage({ui:quick, stale:true});
  const result = await page.run('https://example.com/a', 'sc-domain:example.com', 'submit');
  assert.equal(result.status, 'submitted', result.error);
  assert.equal(page.clicks, 1);
});

test('GSC 提示网址不在该资源中时立即停下', async () => {
  const page = inspectPage({outside:true});
  const started = Date.now();
  const result = await page.run('https://example.com/a', 'sc-domain:example.com', 'submit');
  assert.equal(result.status, 'blocked');
  assert.match(result.error, /不在该资源中/);
  assert.ok(Date.now() - started < 2000);
  assert.equal(page.clicks, 0);
});

test('网址不在资源中时直接阻止', async () => {
  const page = inspectPage();
  const result = await page.run('https://other.com/a', 'sc-domain:example.com', 'submit');
  assert.equal(result.status, 'blocked');
  assert.equal(page.clicks, 0);
});

// 结构按真实 GSC 的资源选择器搭建：列表嵌在按钮内，展开后才渲染选项；选项带 data-resourceid，
// 末尾有创作者资料和「添加资源」等非网站项。
function pickerPage(properties, current, {openOn = 'click', delay = 0} = {}) {
  const page = browser('/search-console?resource_id=' + encodeURIComponent(current));
  const {window, document, add} = page;
  const picker = add(document.body, '', {role:'button', 'aria-label':'搜索资源', 'aria-haspopup':'menu', 'aria-expanded':'false'});
  const input = document.createElement('input');
  input.setAttribute('role', 'combobox');
  picker.append(input);
  const list = add(picker, '', {role:'listbox'});
  const option = (attrs, text) => {
    const el = document.createElement('div');
    el.setAttribute('role', 'option');
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    el.textContent = text;
    el.addEventListener('click', () => { page.clicked = attrs['data-resourceid'] || text; });
    return el;
  };
  // 模拟只渲染前 3 个匹配项的列表。
  const render = filter => list.replaceChildren(
    ...properties.filter(id => id.includes(filter)).slice(0, 3).map(id =>
      option({'aria-label':id, 'data-resourceid':id, title:id.replace(/^sc-domain:/, '')}, '网域资源')),
    option({'aria-label':'sc-creator-profile:1', 'data-resourceid':'sc-creator-profile:1'}, '@example / X'),
    option({}, '添加资源'));
  // openOn 模拟按钮响应的事件，none 表示怎么都打不开；delay 模拟列表加载时间。
  if (openOn !== 'none') picker.addEventListener(openOn, () => {
    picker.setAttribute('aria-expanded', 'true');
    window.setTimeout(() => render(''), delay);
  });
  input.addEventListener('input', () => window.setTimeout(() => render(input.value), 30));
  page.run = url => page.inject(selectProperty)(UI, url);
  return page;
}

const many = ['https://a.com/', 'https://b.com/', 'https://c.com/', 'https://d.com/'];

test('未筛选列表看不到目标时，按主机名筛选后选最具体的资源，不点击选项', async () => {
  const page = pickerPage([...many, 'sc-domain:example.com', 'https://blog.example.com/'], many[0]);
  const result = await page.run('https://blog.example.com/post');
  assert.equal(result.property, 'https://blog.example.com/', result.error);
  await new Promise(resolve => setTimeout(resolve, 100));
  // 由 worker 整页打开资源，避免单页切换残留旧资源的检查框。
  assert.equal(page.clicked, undefined);
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

test('资源按钮只响应鼠标按下时也能展开列表', async () => {
  const page = pickerPage([...many, 'sc-domain:example.com'], many[0], {openOn:'mousedown'});
  const result = await page.run('https://example.com/');
  assert.equal(result.property, 'sc-domain:example.com', result.error);
});

test('资源按钮只响应键盘时也能展开列表', async () => {
  const page = pickerPage([...many, 'sc-domain:example.com'], many[0], {openOn:'keydown'});
  const result = await page.run('https://example.com/');
  assert.equal(result.property, 'sc-domain:example.com', result.error);
});

test('资源列表加载较慢时等待选项出现', async () => {
  const page = pickerPage([...many, 'sc-domain:example.com'], many[0], {delay:1500});
  const result = await page.run('https://example.com/');
  assert.equal(result.property, 'sc-domain:example.com', result.error);
});

test('资源列表打不开时明确提示', async () => {
  const page = pickerPage([...many, 'sc-domain:example.com'], many[0], {openOn:'none'});
  assert.match((await page.run('https://example.com/')).error, /没有展开/);
});

test('没有匹配资源时返回错误', async () => {
  const page = pickerPage(many, many[0]);
  assert.match((await page.run('https://nomatch.org/')).error, /没有匹配/);
});
