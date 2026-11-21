# GSC Agent

[English](README.en.md) · 简体中文

让你本机的 AI agent（Claude Code、Codex、Cursor、Claude Desktop 等）借用你在 Chrome 中已登录的 Google Search Console，替你为网址点击「请求编入索引」，并如实报告 Google 是否确认。

- 不需要 Google OAuth、API Key 或 Google Cloud 项目，用的就是你浏览器里的登录状态。
- Chrome 打开后扩展自动连接，agent 使用你已打开的 GSC 标签页；没有时在后台新开一个。想固定用某个标签页，在那一页点击扩展图标。
- 读到 Google 的确认才报告「已提交」，不确定时如实说明。

## 能做什么

- **单个或批量提交**：给 agent 一个或一组网址，它在后台按顺序处理，同批重复的网址只处理一次。
- **默认只检查**：问收录情况时 agent 用 `gsc_inspect_url` 只读检查，不消耗配额，并说出未收录原因。只有你在对话中明确同意提交，agent 才会调用提交：`submit` 直接请求编入索引（适合更新过的页面），`if_unindexed` 先检查，明确未收录才提交。批次默认也只检查。
- **自动选资源**：按网址自动切换到对应的 GSC 资源，网址前缀资源和网域资源都支持。当前打开的资源已包含该网址时直接使用，否则选匹配最具体的那个。
- **保护配额**：按资源统计 24 小时内的提交次数，到上限自动停下。批次中每次提交后默认间隔 120 秒，降低被限流的风险。
- **可停止、可续跑、可追溯**：批次可以随时停止，未开始的网址可以交给新批次接着跑；每次操作都记录在本机。
- **自检**：一条命令检查安装、浏览器连接和版本是否一致，并给出修复办法；加上 `--page` 还会在真实 GSC 页面只读核对一遍，GSC 改版时能直接指出要改哪条规则。

不能做的事：不能保证 Google 收录（只负责把请求送到）；不读取搜索表现数据，也不提交 sitemap。

## 工作原理

```
AI agent ──MCP──> 本机 MCP 服务 ──套接字──> 本机宿主 ──原生消息──> Chrome 扩展 ──> 你的 GSC 标签页
```

扩展在页面中执行的操作和你手动操作一样：填写网址检查框、等待报告、点击「请求编入索引」、读取确认框。

## 环境要求

- macOS 或 Linux。Windows 暂不支持。
- Chromium 系浏览器：Chrome、Chromium、Edge、Brave、Vivaldi，macOS 上还有 Arc。Linux 上用 Snap 或 Flatpak 安装的浏览器不能启动本机宿主，请改用官方安装包。
- Node.js 22.22 或更高版本
- GSC 界面语言为简体中文或英文（其他语言见[维护自己的版本](CUSTOMIZE.md)）

## 安装

```sh
git clone https://github.com/Patrick5D/gsc-agent-extension.git gsc-agent
cd gsc-agent
npm install
npm run setup
```

`setup` 把扩展和本机宿主复制到 `~/.gsc-agent/`，为已安装的浏览器注册宿主，然后打印后续步骤。之后再装其他浏览器，重新运行一次 `setup`。

1. 打开浏览器的扩展管理页（Chrome 为 `chrome://extensions`，Edge 为 `edge://extensions`，Brave 为 `brave://extensions`），开启「开发者模式」，点击「加载已解压的扩展程序」，选择 `~/.gsc-agent/extension`（setup 会打印完整路径；macOS 的选择框中按 ⌘⇧. 可显示隐藏目录）。
2. 把 MCP 服务加入你的 agent，见下一节。
3. 确认浏览器已登录 Search Console。扩展加载后会自动连接，徽标显示 ON。
4. 运行 `npm run doctor`，全部打勾即可使用。

## 接入 agent

运行 `npm run config` 打印所有客户端的配置，或者指定一个客户端：`npm run config -- claude-code`。可选的客户端有 `claude-code`、`codex`、`cursor`、`claude-desktop`、`json`。要把配置存成 JSON 文件，用 `node bridge/cli.js config json > mcp.json`（`npm run` 会多输出两行提示，不是纯 JSON）。配置里使用 Node 和本仓库的绝对路径，图形界面客户端也能找到。

单条提交最长需要约 4 分钟，请把客户端的工具超时调到 270 秒以上：

- **Claude Code**：用 `MCP_TOOL_TIMEOUT=270000 claude` 启动。
- **Codex**：在 `~/.codex/config.toml` 的 `[mcp_servers.gsc-agent]` 段加入 `tool_timeout_sec = 270`。
- **不能调超时的客户端**：让 agent 用 `gsc_start_batch` 处理单个网址。它立即返回，之后用 `gsc_batch_status` 查结果。

接好后重启客户端，确认工具列表中有 `gsc_inspect_url` 和 `gsc_request_indexing`。

## 使用

直接用自然语言告诉 agent，例如：

- 「https://example.com/article 收录了吗？」（只检查）
- 「提交 https://example.com/article」
- 「检查这 20 个网址有没有收录，只提交没收录的，做完逐条告诉我结果。」
- 「查一下这个网址最近一次有没有确认提交，给我报告链接。」

### 用哪个标签页

- 默认自动选：已打开的 GSC 资源页中，优先当前显示的那个，其次最近看过的。一个批次自始至终用同一个标签页。
- 一个都没有时，在后台新开一个 GSC 页面并沿用。未登录时会提示先登录，不会反复新开。
- 在某个 GSC 页面点击扩展图标，agent 就固定用这一页；关闭这一页后恢复自动选择。
- 想回到手动连接，把 `extension/config.js` 的 `AUTO_CONNECT` 改为 `false`：只有点击扩展图标后才连接，且只操作被点击的那一页。

### 工具

| 工具 | 作用 |
|---|---|
| `gsc_inspect_url` | 只读检查单个网址是否收录，返回原因，不消耗配额。参数：`url` |
| `gsc_request_indexing` | 提交单个网址，须用户同意。参数：`url`、`mode`（`submit` 默认，或 `if_unindexed`）、`skip_recent_hours` |
| `gsc_start_batch` | 后台按顺序处理一组网址，立即返回批次 `id`。参数：`urls`、`mode`（默认 `inspect`，提交须用户同意）、`interval_seconds`、`skip_recent_hours` |
| `gsc_batch_status` | 查看批次进度、每条结果、进行中的网址和未开始的网址 |
| `gsc_stop_batch` | 停止批次，进行中的网址会先执行完 |
| `gsc_submission_history` | 查询本机操作记录，可按 `url`、`status` 筛选 |
| `gsc_doctor` | 检查安装、连接和版本，返回修复建议 |

`skip_recent_hours`：如果该网址在指定小时内已有确认过的提交，就跳过。默认 0，即不跳过。

### 结果状态

- `submitted`：GSC 已确认收到请求。是否收录由 Google 另行决定。
- `inspected` / `already_indexed`：检查完成，或已收录而跳过。`reason` 是报告里的状态行，未收录时写明原因，例如「网页未编入索引：已发现 - 尚未编入索引」。`submitted` 也会带上提交前的 `reason`。
- `recently_submitted`：命中 `skip_recent_hours`，按本机记录跳过。
- `blocked`：点击提交前停下，比如未登录、找不到资源、遇到配额或出错提示。
- `unconfirmed`：已经点了提交，但没读到明确确认。请先查看标签页，再决定要不要重试。

## 批次、间隔与配额

- 同一时间只运行一个批次。批次运行期间，单条工具和新批次都会被拒绝。
- 每次确认提交后等待 `interval_seconds` 秒（默认 120），只读检查之间最多等 3 秒。等待期间 `nextAt` 给出下一条的开始时间。
- 遇到错误，或成功框需要手动关闭时，批次会停下。把 `remaining` 交给新批次即可续跑。
- GSC 每个资源每天大约只能提交 10 次。本机按资源统计 24 小时内已点击的提交（未确认的也计入）。达到 `GSC_AGENT_DAILY_QUOTA`（默认 10）后，`submit` 模式在检查前停下，`if_unindexed` 模式在检查后、点击前停下。在 MCP 配置里设置这个环境变量可以调整上限，设为 0 关闭。手动在 GSC 页面提交的次数不会计入。
- Chrome 会放慢后台标签页的定时器。跑长批次时，建议把绑定的标签页单独放在一个可见窗口里。

## 操作历史

记录保存在 `~/.gsc-agent/history/`，批次快照保存在 `~/.gsc-agent/batches/`。每次操作开始时写入 `started`，结束后补上资源、结果或错误。如果进程中断，`started` 表示结果待核实。

## 自检与排错

运行 `npm run doctor`，或让 agent 调用 `gsc_doctor`，按提示处理。

怀疑 GSC 改版或换了界面语言时，运行 `npm run doctor -- --page`（agent 调用时传 `page: true`）。它会在你的 GSC 标签页上展开资源列表，再只读检查当前资源的首页，不提交，约需 10–30 秒。哪一项失败，就提示改 `extension/config.js` 里的哪条规则。

常见情况：

| 现象 | 处理 |
|---|---|
| 徽标显示 OFF，提示找不到 native messaging host | 运行 `npm run setup`，然后在 `chrome://extensions` 刷新扩展 |
| 「请确认 Chrome 已打开」，自检显示没有在线连接 | 打开 Chrome；刚安装或更新时在 `chrome://extensions` 刷新扩展；仍不行就在 GSC 页面点击扩展图标 |
| 「自动打开的 GSC 页面没有进入资源页」 | 在 Chrome 登录 Search Console，然后重试 |
| 「网址检查框被遮挡」或「按钮被遮挡」 | 关闭 GSC 页面上的弹窗；如果菜单盖住了检查框，把左侧菜单收起或把窗口拉宽 |
| 「使用中的 GSC 标签页已关闭或刷新」 | 重试即可，会自动换一个标签页 |
| 「找不到网址检查框」或一直等不到报告 | 运行 `npm run doctor -- --page` 找出失效的规则；或把 GSC 界面语言切换为简体中文或英文，或按 [CUSTOMIZE.md](CUSTOMIZE.md) 添加规则 |
| 「GSC 资源列表没有展开」 | 在该 GSC 标签页手动点开一次资源选择框再关闭，然后重试。见下方「局限与风险」 |
| 工具调用超时 | 调大客户端超时，或改用 `gsc_start_batch` |
| 切换或删除过 Node 版本 | 重新运行 `npm run setup` |
| 批次在后台很慢 | 把正在使用的 GSC 标签页放到单独的可见窗口 |
| 同时装在多个 Chrome 配置里，提示只保留一个连接 | 只在一个配置中启用扩展 |

## 升级与卸载

- **升级**：`git pull && npm install && npm run setup`，然后在扩展管理页刷新扩展，再重启 agent 的 MCP 连接。升级前看一眼 [CHANGELOG.md](CHANGELOG.md)，标注「不兼容」的改动可能需要改你给 agent 的提示词。
- **卸载**：`node bridge/cli.js uninstall`，然后在扩展管理页移除扩展。操作历史会保留在 `~/.gsc-agent/`。

## 维护自己的版本

所有可定制项集中在两个文件里：自动连接开关、GSC 页面文案规则、宿主名和等待时间在 `extension/config.js`，数据目录和默认值在 `bridge/config.js`。增加界面语言、适配 GSC 改版、换成自己的扩展 ID 等做法，见 [CUSTOMIZE.md](CUSTOMIZE.md)。

## 局限与风险

- 本工具操作的是 GSC 网页，不是官方 API。GSC 改版可能导致它失效，失效时按 CUSTOMIZE.md 更新规则即可。
- 自动操作网页的用法是否符合 Google 的服务条款，请自行判断。请把提交频率控制在正常人工使用的范围内。
- 目前只支持 macOS 和 Linux，Windows 暂不支持。
- 跨资源切换要打开资源列表。从未被人手点过资源选择框的 GSC 标签页（包括扩展在后台新开的那页），脚本打不开这个列表。在该页手动点开一次再关闭即可，之后刷新也有效。目标网址就在当前资源中时不受影响。

## 安全边界

- **本机信任范围是你的系统账户。** 本机宿主在 `~/.gsc-agent/` 下开套接字，目录只有你自己能读写。但同一账户下运行的任何程序，都能通过它操作你已登录的 GSC，和你在同一账户下运行的其他工具一样。不要在不信任的环境里安装。
- **扩展权限很小。** 只申请原生消息、脚本注入，以及 `https://search.google.com/*` 的站点权限。它不读其他网站，也不接触 Google 的登录凭据。
- **「提交须经你同意」是写给 agent 的规则，不是硬性拦截。** 工具说明要求 agent 在你明确同意后才调用提交；真正挡住大量误提交的硬限制，只有按资源计算的每日上限 `GSC_AGENT_DAILY_QUOTA`。
- **操作历史只存在本机** `~/.gsc-agent/history/`，里面有网址和报告链接，分享截图或日志时注意。

## 开发与测试

```sh
npm test
```

测试包括：用模拟的 Chrome 消息验证 MCP 到本机宿主的完整链路；用 jsdom 模拟页面验证页面脚本；用模拟的 chrome 接口验证扩展的自动连接与选页；验证命令行的安装、自检与卸载。测试不会向 Google 提交任何请求。资源选择器和报告区域按真实 GSC 页面的结构搭建，但仍不能代替在真实页面上核对。

## 许可证

[MIT](LICENSE)
