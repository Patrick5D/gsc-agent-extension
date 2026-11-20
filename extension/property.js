/**
 * [INPUT]: 读取 config.js 的文案规则、目标 URL、当前资源和 GSC 的资源选项。
 * [OUTPUT]: 返回选中的资源 ID，必要时点击对应选项。
 * [POS]: 在网址检查前选择资源，worker 等待切换完成。函数随脚本注入，须自包含。
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
    if (picker.getAttribute('aria-expanded') !== 'true') picker.click();
    const sleep = () => new Promise(resolve => setTimeout(resolve, 100));
    const options = () => [...document.querySelectorAll('[role="option"][aria-label]')].filter(el => el.getClientRects().length);
    try {
      for (let i = 0; !options().length && i < 30; i++) await sleep();
      const input = picker.querySelector('input[role="combobox"]');
      if (!input) throw Error('找不到资源搜索框');
      const type = text => {
        input.focus();
        input.value = text;
        input.dispatchEvent(new Event('input', {bubbles:true}));
      };
      // 列表可能只渲染部分资源。依次用完整主机名和各级上级域名筛选，汇总出现过的资源。
      const seen = new Set(options().map(el => el.getAttribute('aria-label')));
      const labels = target.hostname.split('.');
      for (let i = 0; i < Math.max(1, labels.length - 1); i++) {
        type(labels.slice(i).join('.'));
        for (let j = 0; j < 8; j++) {
          await sleep();
          for (const el of options()) seen.add(el.getAttribute('aria-label'));
        }
      }
      const chosen = [...seen].filter(id => specificity(id)).sort((a,b) => specificity(b) - specificity(a))[0];
      if (!chosen) throw Error('资源列表中没有匹配该网址的资源');
      type(chosen.replace(/^sc-domain:/, ''));
      await sleep();
      for (let i = 0; i < 30; i++) {
        const item = options().find(el => el.getAttribute('aria-label') === chosen);
        if (item) {
          // 先向 worker 返回资源 ID，再触发可能重载页面的点击。
          setTimeout(() => item.click(), 50);
          return chosen;
        }
        await sleep();
      }
      throw Error('筛选后找不到相同资源 ID');
    } catch (error) {
      picker.querySelector('input[role="combobox"]')?.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', keyCode:27, bubbles:true}));
      throw error;
    }
  }
}
