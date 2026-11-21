# 更新记录

对外接口是 MCP 工具名、参数和结果字段，以及 `gsc-agent` 命令。0.x 阶段的约定：

- 不兼容的改动升次版本号（0.5 → 0.6），并在下面标注 **不兼容**，写明怎么改。
- 只有修复和兼容的新增时升修订号（0.6.0 → 0.6.1）。
- 每个版本在 git 中有对应的 `v` 标签，例如 `v0.6.0`。

升级步骤见 README 的「升级与卸载」。

## 0.6.0

- 支持 Linux，并支持 Chromium 系浏览器：Chrome（含 Beta、Canary/Dev）、Chromium、Edge、Brave、Vivaldi，macOS 上还有 Arc。`setup` 为已安装的浏览器注册宿主，之后装了新浏览器再运行一次。
- 页面自检：`gsc-agent doctor --page`，或 `gsc_doctor` 传 `page: true`。在真实 GSC 页面只读核对文案规则：展开资源列表，检查当前资源首页，不提交。失败时指出要改的规则。
- README 增加「安全边界」。新增本文件，版本开始打标签。

## 0.5.0

- 新增 `gsc_inspect_url`：只读检查，不消耗配额。
- 检查结果带 `reason`，即 GSC 报告「网页索引编制」下的状态行，未收录时写明原因。提交结果也带提交前的 `reason`。
- 同一页残留旧报告时只读最新那份，避免读到上一次的结果。
- **不兼容**：`gsc_request_indexing` 只负责提交，`mode` 只接受 `submit`（默认）和 `if_unindexed`。原来的 `mode: "inspect"` 改用 `gsc_inspect_url`。
- **不兼容**：`gsc_start_batch` 的 `mode` 默认值从 `submit` 改为 `inspect`。要提交，须显式传 `submit` 或 `if_unindexed`。

## 0.4.0

- 默认自动连接：浏览器启动后扩展自行连接本机，不用先点击扩展图标。
- 自动选用已打开的 GSC 资源页（优先当前显示的，其次最近看过的），批次中沿用同一页；没有时在后台新开一个。
- 点击扩展图标把 agent 固定到当前页。`extension/config.js` 的 `AUTO_CONNECT` 设为 `false` 可恢复手动连接。

## 0.3.3

- 跨资源自动切换：展开资源列表，按主机名筛选，再整页打开目标资源。
- 遮挡判断改为命中测试，展开的导航菜单不再误判。
- 只读检查不计入资源配额。

## 0.3.0

- 首个公开版本：Chrome 扩展 + 本机宿主 + MCP 服务，支持单条与后台批次，有本机配额、操作历史和 `setup` / `doctor` 等命令。
