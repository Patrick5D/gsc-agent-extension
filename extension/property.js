/**
 * [INPUT]: 读取 config.js 的文案规则、目标 URL、当前资源和 GSC 的资源选项。
 * [OUTPUT]: 返回应使用的资源 ID，不点击选项。资源列表打不开时说明原因。
 * [POS]: 在网址检查前选择资源，由 worker 整页打开该资源。函数随脚本注入，须自包含。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export async function selectProperty(ui, rawUrl) {
  try { return {property:await choose()}; } catch (error) { return {error:error.message}; }
  async function choose() {
    const target = new URL(rawUrl);
    if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) throw Error('请输入有效的 HTTP(S) 网址');
    const current = new URL(location.href).searchParams.get('resource_id');
    if (location.origin !== 'https://search.google.com' || !location.pathname.startsWith('/search-console') || !current) throw Error('请先打开已登录的 GSC 资源页');

    function specificity(id) {
      if (id.startsWith('sc-domain:')) {
        const host = id.slice(10);
        return target.hostname === host || target.hostname.endsWith('.' + host) ? host.length : 0;
      }
      if (!/^https?:\/\//.test(id) || !target.href.startsWith(id)) return 0;
      return 10000 + id.length;
    }
    if (specificity(current)) return current;
    const picker = [...document.querySelectorAll('[role="button"][aria-label],button[aria-label]')]
      .find(el => new RegExp(...ui.propertyPicker).test(el.getAttribute('aria-label').trim()) && el.getClientRects().length);
    if (!picker) throw Error('找不到 GSC 资源选择器');
    const sleep = () => new Promise(resolve => setTimeout(resolve, 100));
    const close = () => picker.querySelector('input[role="combobox"]')?.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', keyCode:27, bubbles:true}));
    // 真实选项带 data-resourceid，aria-label 与其相同，作为后备。
    const options = () => [...document.querySelectorAll('[role="option"][data-resourceid],[role="option"][aria-label]')].filter(el => el.getClientRects().length);
    const seen = new Set();
    const collect = () => { for (const el of options()) seen.add(el.dataset.resourceid || el.getAttribute('aria-label')); };
    // 真实页面首次展开要先加载列表，约 0.5–0.7 秒；闲置较久的标签页曾出现 click 不响应。
    // 依次尝试点击、按下鼠标和键盘，每种最多等 2 秒。
    // 列表已展开但选项还在加载时不再触发，避免把列表又关上。
    const attempts = [
      () => picker.click(),
      () => { for (const type of ['mousedown', 'mouseup']) picker.dispatchEvent(new MouseEvent(type, {bubbles:true, cancelable:true, view:window, button:0})); },
      () => { picker.focus(); for (const key of ['Enter', 'ArrowDown']) picker.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles:true, cancelable:true})); }
    ];
    try {
      for (const attempt of attempts) {
        if (options().length) break;
        if (picker.getAttribute('aria-expanded') !== 'true') attempt();
        for (let i = 0; !options().length && i < 20; i++) await sleep();
      }
      if (!options().length) throw Error('GSC 资源列表没有展开。请在 GSC 页面手动点开一次资源选择框，关闭后重试');
      collect();
      // 列表可能只渲染部分资源。有搜索框时，依次用完整主机名和各级上级域名筛选，汇总出现过的资源。
      const input = picker.querySelector('input[role="combobox"]');
      if (input) {
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        const type = text => {
          input.focus();
          setValue.call(input, text);
          input.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:text}));
        };
        const labels = target.hostname.split('.');
        for (let i = 0; i < Math.max(1, labels.length - 1); i++) {
          type(labels.slice(i).join('.'));
          for (let j = 0; j < 8; j++) {
            await sleep();
            collect();
          }
        }
      }
      const chosen = [...seen].filter(id => specificity(id)).sort((a,b) => specificity(b) - specificity(a))[0];
      if (!chosen) throw Error('资源列表中没有匹配该网址的资源');
      // 只返回资源 ID，由 worker 整页打开该资源。GSC 单页切换可能残留旧资源的检查框。
      close();
      return chosen;
    } catch (error) {
      close();
      throw error;
    }
  }
}
