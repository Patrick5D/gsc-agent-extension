# GSC Agent

[English](README.en.md) · 简体中文

让你本机的 AI agent（Claude Code、Codex、Cursor、Claude Desktop 等）借用你在 Chrome 中已登录的 Google Search Console，替你为网址点击「请求编入索引」，并如实报告 Google 是否确认。

- 不需要 Google OAuth、API Key 或 Google Cloud 项目，用的就是你浏览器里的登录状态。
- agent 只能操作你点击扩展图标绑定的那一个 GSC 标签页。
- 读到 Google 的确认才报告「已提交」，不确定时如实说明。

## 能做什么

- **单个或批量提交**：给 agent 一个或一组网址，它在后台按顺序处理，同批重复的网址只处理一次。
- **三种模式**：`submit` 直接请求编入索引（适合更新过的页面）；`inspect` 只检查是否已收录；`if_unindexed` 先检查，明确未收录才提交。
- **自动选资源**：按网址自动切换到对应的 GSC 资源，网址前缀资源和网域资源都支持，选匹配最具体的那个。
- **保护配额**：按资源统计 24 小时内的提交次数，到上限自动停下。批次中每次提交后默认间隔 120 秒，降低被限流的风险。
- **可停止、可续跑、可追溯**：批次可以随时停止，未开始的网址可以交给新批次接着跑；每次操作都记录在本机。
- **自检**：一条命令检查安装、浏览器连接和版本是否一致，并给出修复办法。

不能做的事：不能保证 Google 收录（只负责把请求送到）；不读取搜索表现数据，也不提交 sitemap。

## 工作原理

```
AI agent ──MCP──> 本机 MCP 服务 ──套接字──> 本机宿主 ──原生消息──> Chrome 扩展 ──> 你的 GSC 标签页
```

扩展在页面中执行的操作和你手动操作一样：填写网址检查框、等待报告、点击「请求编入索引」、读取确认框。

## 环境要求

- macOS 与 Google Chrome
- Node.js 22.22 或更高版本
- GSC 界面语言为简体中文或英文（其他语言见[维护自己的版本](CUSTOMIZE.md)）

## 安装

```sh
git clone https://github.com/Patrick5D/gsc-agent-extension.git gsc-agent
cd gsc-agent
npm install
npm run setup
```

`setup` 把扩展和本机宿主复制到 `~/.gsc-agent/`，在 Chrome 中注册宿主，然后打印后续步骤：

1. 打开 `chrome://extensions`，开启「开发者模式」，点击「加载已解压的扩展程序」，选择 `~/.gsc-agent/extension`（setup 会打印完整路径；在选择框中按 ⌘⇧. 可显示隐藏目录）。
2. 把 MCP 服务加入你的 agent，见下一节。
3. 在 Chrome 打开已登录的 GSC 资源页，点击扩展图标，徽标显示 ON 即已连接。
4. 运行 `npm run doctor`，全部打勾即可使用。

## 接入 agent

运行 `npm run config` 打印所有客户端的配置，或者指定一个客户端：`npm run config -- claude-code`。可选的客户端有 `claude-code`、`codex`、`cursor`、`claude-desktop`、`json`。配置里使用 Node 和本仓库的绝对路径，图形界面客户端也能找到。

单条提交最长需要约 4 分钟，请把客户端的工具超时调到 270 秒以上：

- **Claude Code**：用 `MCP_TOOL_TIMEOUT=270000 claude` 启动。
- **Codex**：在 `~/.codex/config.toml` 的 `[mcp_servers.gsc-agent]` 段加入 `tool_timeout_sec = 270`。
- **不能调超时的客户端**：让 agent 用 `gsc_start_batch` 处理单个网址。它立即返回，之后用 `gsc_batch_status` 查结果。

接好后重启客户端，确认工具列表中有 `gsc_request_indexing`。

## 使用

直接用自然语言告诉 agent，例如：

- 「用 gsc_request_indexing 提交 https://example.com/article」
- 「检查这 20 个网址有没有收录，只提交没收录的，做完逐条告诉我结果。」
- 「查一下这个网址最近一次有没有确认提交，给我报告链接。」

重启 Chrome 后，要在 GSC 页面重新点一次扩展图标。想换一个标签页，在新标签页上点图标即可重新绑定。

### 工具

| 工具 | 作用 |
|---|---|
| `gsc_request_indexing` | 处理单个网址，参数：`url`、`mode`、`skip_recent_hours` |
| `gsc_start_batch` | 后台按顺序处理一组网址，立即返回批次 `id`。参数：`urls`、`mode`、`interval_seconds`、`skip_recent_hours` |
| `gsc_batch_status` | 查看批次进度、每条结果、进行中的网址和未开始的网址 |
| `gsc_stop_batch` | 停止批次，进行中的网址会先执行完 |
| `gsc_submission_history` | 查询本机操作记录，可按 `url`、`status` 筛选 |
| `gsc_doctor` | 检查安装、连接和版本，返回修复建议 |

`skip_recent_hours`：如果该网址在指定小时内已有确认过的提交，就跳过。默认 0，即不跳过。

### 结果状态

- `submitted`：GSC 已确认收到请求。是否收录由 Google 另行决定。
- `inspected` / `already_indexed`：检查完成，或已收录而跳过。
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

运行 `npm run doctor`，或让 agent 调用 `gsc_doctor`，按提示处理。常见情况：

| 现象 | 处理 |
|---|---|
| 徽标显示 OFF，提示找不到 native messaging host | 运行 `npm run setup`，然后在 `chrome://extensions` 刷新扩展 |
| 「请在已登录的 GSC 标签页点击扩展图标」 | 在 GSC 资源页点击扩展图标，徽标显示 ON |
| 「找不到网址检查框」或一直等不到报告 | 把 GSC 界面语言切换为简体中文或英文，或按 [CUSTOMIZE.md](CUSTOMIZE.md) 添加规则 |
| 工具调用超时 | 调大客户端超时，或改用 `gsc_start_batch` |
| 切换或删除过 Node 版本 | 重新运行 `npm run setup` |
| 批次在后台很慢 | 把绑定的标签页放到单独的可见窗口 |

## 升级与卸载

- **升级**：`git pull && npm install && npm run setup`，然后在 `chrome://extensions` 刷新扩展，在 GSC 页面重新点击图标，再重启 agent 的 MCP 连接。
- **卸载**：`node bridge/cli.js uninstall`，然后在 `chrome://extensions` 移除扩展。操作历史会保留在 `~/.gsc-agent/`。

## 维护自己的版本

所有可定制项集中在两个文件里：GSC 页面文案规则、宿主名和等待时间在 `extension/config.js`，数据目录和默认值在 `bridge/config.js`。增加界面语言、适配 GSC 改版、换成自己的扩展 ID 等做法，见 [CUSTOMIZE.md](CUSTOMIZE.md)。

## 局限与风险

- 本工具操作的是 GSC 网页，不是官方 API。GSC 改版可能导致它失效，失效时按 CUSTOMIZE.md 更新规则即可。
- 自动操作网页的用法是否符合 Google 的服务条款，请自行判断。请把提交频率控制在正常人工使用的范围内。
- 目前只支持 macOS 上的 Google Chrome。

## 开发与测试

```sh
npm test
```

测试包括：用模拟的 Chrome 消息验证 MCP 到本机宿主的完整链路；用 jsdom 模拟页面验证页面脚本；验证命令行的安装、自检与卸载。测试不会向 Google 提交任何请求。模拟页面是按本项目对 GSC 页面结构的假设搭建的，不能代替在真实页面上核对。

## 许可证

[MIT](LICENSE)
