/**
 * [INPUT]: 读取 config.js 的文案规则与等待时间、当前 GSC 资源、目标网址、报告页面和本机配额判断。
 * [OUTPUT]: 返回检查状态或提交确认，关闭已识别的成功框。
 * [POS]: 在标签页内完成单网址操作。函数随脚本注入，须自包含。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export async function submitInPage(ui, rawUrl, expectedProperty, mode = "submit", canSubmit = true) {
  const rule = name => new RegExp(...ui[name]);
  const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const elements = selector => [...document.querySelectorAll(selector)].filter(visible);
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

    if (dialogs().length) throw Error('请先关闭 GSC 对话框');
    const input = await wait(() => elements('input').find(el => rule('inspectInput').test(
      [el.placeholder, el.getAttribute('aria-label')].join(' '))), ui.timeouts.inspectInput, '找不到网址检查框，请检查 config.js 的 inspectInput 规则');
    const previousId = report().searchParams.get('id');
    input.focus();
    input.value = target.href;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    for (const type of ['keydown', 'keyup']) {
      input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    }

    const indexedTitle = rule('indexed');
    const unindexedTitle = rule('unindexed');
    const fresh = await wait(() => {
      const current = report();
      const id = current.searchParams.get('id');
      if (current.pathname !== '/search-console/inspect' || !id || id === previousId) return;
      const lines = document.body.innerText.split(/\n/).map(line => line.trim());
      if (!lines.some(line => shown.has(line))) return;
      if (mode !== 'submit') {
        const headline = lines.find(line => indexedTitle.test(line) || unindexedTitle.test(line));
        if (!headline) return;
        const indexed = indexedTitle.test(headline);
        if (mode === 'inspect' || indexed) return {indexed, headline};
      }
      return elements('button,[role="button"]').find(el =>
        !el.disabled && el.getAttribute('aria-disabled') !== 'true' &&
        rule('requestButton').test(el.innerText.trim()));
    }, ui.timeouts.report);
    if ('indexed' in fresh) {
      return {status:mode === 'inspect' ? 'inspected' : 'already_indexed', ...fresh, url:target.href, reportUrl:location.href};
    }
    if (!canSubmit) throw Error('本机记录显示该资源 24 小时内的提交已达上限，未点击提交');
    if (dialogs().length) throw Error('请求按钮被对话框遮挡');
    fresh.click();
    clicked = true;
    const confirmation = await wait(() => dialogs().find(el => rule('confirmed').test(el.innerText)), ui.timeouts.confirmation);
    const result = {status:'submitted', url:target.href, reportUrl:location.href, confirmation:confirmation.innerText.slice(0,500)};
    const close = [...confirmation.querySelectorAll('button,[role="button"]')].find(el =>
      visible(el) && rule('closeButton').test(el.innerText.trim()));
    if (close) close.click();
    else result.notice = '请关闭 GSC 的成功提示后继续';
    return result;
  } catch (err) {
    return { error: err.message, status: clicked ? 'unconfirmed' : 'blocked' };
  }
}
