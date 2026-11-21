/**
 * [INPUT]: 读取 config.js 的文案规则与等待时间、当前 GSC 资源、目标网址、报告页面和本机配额判断。
 * [OUTPUT]: 返回检查状态、未收录原因或提交确认，关闭已识别的成功框。检查框或按钮被遮住时停下。
 * [POS]: 在标签页内完成单网址操作。函数随脚本注入，须自包含。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export async function submitInPage(ui, rawUrl, expectedProperty, mode = "submit", canSubmit = true) {
  const rule = name => new RegExp(...ui[name]);
  const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const elements = (selector, root = document) => [...root.querySelectorAll(selector)].filter(visible);
  const lines = el => el.innerText.split(/\n/).map(line => line.trim());
  const report = () => new URL(location.href);
  const property = report().searchParams.get('resource_id');
  let clicked = false;
  try {
    if (!['submit','inspect','if_unindexed'].includes(mode)) throw Error('未知操作模式');
    const target = new URL(rawUrl);
    if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) throw Error('请输入完整的 HTTP(S) 网址');
    if (location.origin !== 'https://search.google.com' || !location.pathname.startsWith('/search-console') || !property) throw Error('请连接已登录的 GSC 资源页');
    if (expectedProperty && expectedProperty !== property) throw Error('资源已切换，请重新检查目标资源');
    const domain = property.startsWith('sc-domain:') && property.slice(10);
    const inProperty = domain
      ? target.hostname === domain || target.hostname.endsWith('.' + domain)
      : target.href.startsWith(new URL(property).href);
    if (!inProperty) throw Error('网址不在已连接的 GSC 资源中');

    // 报告里的网址可能是解码后的中文路径、原始输入或省略根路径斜杠的形式。
    const shown = new Set([target.href, String(rawUrl).trim()]);
    try { shown.add(decodeURI(target.href)); } catch {}
    if (target.pathname === '/' && !target.search && !target.hash) {
      for (const value of [...shown]) shown.add(value.replace(/\/$/, ''));
    }

    const dialogs = () => elements('[role="dialog"],[role="alertdialog"],[aria-modal="true"]');
    // 只有弹窗或固定定位的覆盖层盖住控件中心才算遮挡。展开的导航菜单不盖住控件时不影响操作，
    // 输入框的浮动标签等与控件同属一个外层的元素也不算。
    const covered = el => {
      if (!document.elementFromPoint) return false;
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      for (let node = hit; node && node !== document.body; node = node.parentElement) {
        if (node.contains(el)) return false;
        if (node.matches('[role="dialog"],[role="alertdialog"],[aria-modal="true"]') || getComputedStyle(node).position === 'fixed') return true;
      }
      return false;
    };
    const requestButtons = (root = document) => elements('button,[role="button"]', root).filter(el =>
      !el.disabled && el.getAttribute('aria-disabled') !== 'true' && rule('requestButton').test(el.innerText.trim()));
    const unblocked = (el, message) => {
      el.scrollIntoView?.({block:'center', inline:'center'});
      return wait(() => !covered(el) && el, ui.timeouts.unblock, message);
    };
    // DOM 变化时立即检查，定时器兜底。后台标签页的定时器会被节流，DOM 回调不受影响。
    function wait(check, timeout, message = '等待 GSC 页面确认超时') {
      const end = Date.now() + timeout;
      return new Promise((resolve, reject) => {
        let done = false, queued = false, timer, last = 0;
        // 距上次检查不足 100ms 的变化交给下一次定时检查，避免频繁读取布局。
        const observer = new MutationObserver(() => {
          if (queued || done || Date.now() - last < 100) return;
          queued = true;
          Promise.resolve().then(() => { queued = false; poll(); });
        });
        function finish(settle, value) {
          done = true;
          observer.disconnect();
          clearTimeout(timer);
          settle(value);
        }
        function poll() {
          if (done) return;
          last = Date.now();
          try {
            if (report().searchParams.get('resource_id') !== property) throw Error('资源已切换');
            const result = check();
            if (result) return finish(resolve, result);
            const problem = dialogs().map(el => el.innerText).find(text => rule('problem').test(text));
            if (problem) throw Error(problem.slice(0, 300));
            if (Date.now() >= end) throw Error(message);
          } catch (error) {
            return finish(reject, error);
          }
          clearTimeout(timer);
          timer = setTimeout(poll, Math.min(350, Math.max(0, end - Date.now())));
        }
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        poll();
      });
    }

    const indexedTitle = rule('indexed');
    const unindexedTitle = rule('unindexed');
    const coverage = rule('coverage');
    const isHeadline = line => indexedTitle.test(line) || unindexedTitle.test(line);
    // GSC 在同一页保留旧报告，每份报告是一个 role="main" 区域，新报告排在后面。旧报告隐藏前可能短暂可见，
    // 所以优先看输入网址后新出现的区域，取其中最后一个带报告标题的。找不到这种区域时退回整页。
    let before = new Set();
    const reportArea = () => {
      const areas = elements('[role="main"]');
      const added = areas.filter(el => !before.has(el));
      return [added, areas].map(list => list.filter(el => lines(el).some(isHeadline)).at(-1)).find(Boolean) || document.body;
    };
    const reasonIn = area => lines(area).find(line => coverage.test(line));

    const input = await wait(() => elements('input').find(el => rule('inspectInput').test(
      [el.placeholder, el.getAttribute('aria-label')].join(' '))), ui.timeouts.inspectInput, '找不到网址检查框，请检查 config.js 的 inspectInput 规则');
    await unblocked(input, '网址检查框被遮挡，请关闭 GSC 页面上的弹窗或菜单后重试');
    const previousId = report().searchParams.get('id');
    before = new Set(document.querySelectorAll('[role="main"]'));
    input.focus();
    input.value = target.href;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    for (const type of ['keydown', 'keyup']) {
      input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    }

    let headlineAt;
    const fresh = await wait(() => {
      const current = report();
      const id = current.searchParams.get('id');
      if (current.pathname !== '/search-console/inspect' || !id || id === previousId) return;
      if (!lines(document.body).some(line => shown.has(line))) return;
      const area = reportArea();
      if (mode !== 'submit') {
        const headline = lines(area).find(isHeadline);
        if (!headline) return;
        // 原因行可能比标题稍晚渲染，最多再等 2 秒；仍没有时照常返回，不带原因。
        const reason = reasonIn(area);
        headlineAt ??= Date.now();
        if (!reason && Date.now() - headlineAt < 2000) return;
        const indexed = indexedTitle.test(headline);
        if (mode === 'inspect' || indexed) return {indexed, headline, ...(reason && {reason})};
      }
      return requestButtons(area)[0];
    }, ui.timeouts.report);
    if ('indexed' in fresh) {
      return {status:mode === 'inspect' ? 'inspected' : 'already_indexed', ...fresh, url:target.href, reportUrl:location.href};
    }
    if (!canSubmit) throw Error('本机记录显示该资源 24 小时内的提交已达上限，未点击提交');
    // 报告渲染时按钮节点可能被替换，或旧报告的按钮留在新报告下方。每次重新找当前未被遮住的按钮。
    fresh.scrollIntoView?.({block:'center', inline:'center'});
    const reason = reasonIn(reportArea());
    const button = await wait(() => requestButtons(reportArea()).find(el => !covered(el)), ui.timeouts.unblock,
      '「请求编入索引」按钮被遮挡，请关闭 GSC 页面上的弹窗或菜单后重试');
    button.click();
    clicked = true;
    const confirmation = await wait(() => dialogs().find(el => rule('confirmed').test(el.innerText)), ui.timeouts.confirmation);
    const result = {status:'submitted', url:target.href, reportUrl:location.href, ...(reason && {reason}), confirmation:confirmation.innerText.slice(0,500)};
    const close = [...confirmation.querySelectorAll('button,[role="button"]')].find(el =>
      visible(el) && rule('closeButton').test(el.innerText.trim()));
    if (close) close.click();
    else result.notice = '请关闭 GSC 的成功提示后继续';
    return result;
  } catch (err) {
    return { error: err.message, status: clicked ? 'unconfirmed' : 'blocked' };
  }
}
