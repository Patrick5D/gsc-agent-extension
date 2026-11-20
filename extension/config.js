/**
 * [INPUT]: 无。维护者按自己的 GSC 界面语言和需要修改本文件。
 * [OUTPUT]: 本机宿主名、GSC 页面文案规则与页面等待时间。
 * [POS]: 扩展唯一的可定制入口。worker 读取后作为参数传入注入函数，setup 读取宿主名。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// 本机宿主名。分支版本若要与原版并存，改成自己的名字，并运行 keygen 换扩展 ID。
export const HOST_NAME = 'com.local.gsc_agent';

// GSC 页面文案规则。新增语言时，在 GSC 中切换到该语言，把页面上的原文加入对应规则。
// 规则以 [source, flags] 传入页面，页面内用 new RegExp 还原。
const rules = {
  // 资源选择器按钮的 aria-label。
  propertyPicker: /^(搜索资源|搜尋資源|search propert(?:y|ies))$/i,
  // 顶部网址检查框的 placeholder 或 aria-label。
  inspectInput: /inspect|检查|檢查/i,
  // 检查报告标题：已收录。
  indexed: /^(?:URL is on Google|网址已收录到 Google(?: 中| 上)?)$/i,
  // 检查报告标题：未收录。
  unindexed: /^(?:URL is not on Google|网址(?:尚未收录到|未收录到|不在) Google(?: 中| 上)?|网址未被 Google 收录)$/i,
  // 「请求编入索引」按钮文字。
  requestButton: /^(请求编入索引|request indexing)(?:\s|$)/i,
  // 提交成功对话框文字。
  confirmed: /indexing requested|added to a priority crawl queue|已请求(?:将网址)?编入索引|已请求(?:将网址)?编入工作索引|已加入优先抓取队列|已添加到优先抓取队列/i,
  // 出现即停止的对话框文字：配额、验证码、出错。
  problem: /quota|captcha|something went wrong|couldn.t submit|request rejected|配额|验证码|出了点问题|请求遭拒|无法提交/i,
  // 成功对话框的关闭按钮文字。
  closeButton: /^(知道了|确定|关闭|好|got it|ok|close|dismiss)$/i
};

// 页面等待时间（毫秒）。四项相加须小于 bridge/config.js 的 requestTimeoutMs。
const timeouts = {
  propertySwitch: 8000,
  inspectInput: 15000,
  report: 80000,
  confirmation: 150000
};

export const UI = {
  ...Object.fromEntries(Object.entries(rules).map(([name, rule]) => [name, [rule.source, rule.flags]])),
  timeouts
};
