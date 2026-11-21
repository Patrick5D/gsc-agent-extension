# 维护自己的版本

GSC 会改版，每个人的界面语言和使用习惯也不同。本项目把需要改的地方集中在两个文件里，fork 之后通常只改它们就够了。

## 两个配置文件

| 文件 | 内容 |
|---|---|
| `extension/config.js` | 本机宿主名 `HOST_NAME`；GSC 页面文案规则（资源选择器、检查框、报告标题、按钮、确认框、错误提示、关闭按钮）；页面各阶段的等待时间 |
| `bridge/config.js` | 数据目录 `~/.gsc-agent`；每个资源的每日提交上限、批次默认间隔、单条操作的总超时 |

改完任何文件，都按这个顺序走一遍：

```sh
npm test          # 确认没改坏
npm run setup     # 把新版本复制到 ~/.gsc-agent
```

然后在 `chrome://extensions` 点扩展卡片上的刷新按钮，在 GSC 页面重新点击扩展图标，重启 agent 的 MCP 连接，最后运行 `npm run doctor`。

## 常见改法

### 增加 GSC 界面语言

1. 在 GSC 右上角的设置中切换到目标语言。
2. 手动检查一个网址，记下页面上的原文：检查框的提示文字、「网址已收录 / 未收录」标题、「请求编入索引」按钮、成功对话框的文字和关闭按钮、资源选择器按钮的 aria-label（用开发者工具查看）。
3. 把原文用 `|` 加进 `extension/config.js` 的对应规则，例如：

   ```js
   requestButton: /^(请求编入索引|request indexing|Indexierung beantragen)(?:\s|$)/i,
   ```

4. 在 `extension/page.test.js` 里照现有用例加一条，用新语言的文字搭模拟页面，确认能识别。

欢迎把新增的语言规则提 PR 回原仓库，让更多人直接用上。

### GSC 改版后失效

先看 agent 返回的错误停在哪一步，再对照 `extension/config.js` 中的规则，到真实页面上核对文字有没有变：

| 错误 | 对应规则 |
|---|---|
| 找不到 GSC 资源选择器 | `propertyPicker` |
| GSC 资源列表没有展开 | `extension/property.js` 中的 `attempts`（打开列表的方式） |
| 一直等不到报告，页面上其实有 GSC 的出错弹窗 | `problem`（把弹窗标题加进去，出现时立即停下） |
| 找不到网址检查框 | `inspectInput` |
| 一直等不到报告，或 `if_unindexed` 停在检查阶段 | `indexed`、`unindexed`、`requestButton` |
| 点击后 `unconfirmed` | `confirmed` |
| 返回 `notice`，需要手动关闭成功框 | `closeButton` |

如果是页面结构变了（不只是文字变了），要改 `extension/property.js` 或 `extension/submit.js`。注意：这两个文件里的函数会被序列化后注入页面执行，**不能引用函数外的任何变量或 import**，需要的数据都通过参数传入。`page.test.js` 用同样的注入方式运行它们，测试通过就说明没破坏这条规则。

### 调整默认值

- **每日上限**：在 MCP 配置中设置环境变量 `GSC_AGENT_DAILY_QUOTA`，不用改代码。也可以改 `bridge/config.js` 的 `dailyQuota` 默认值。
- **批次间隔**：agent 调用时可以传 `interval_seconds`，默认值改 `bridge/config.js` 的 `intervalSeconds`。
- **等待时间**：改 `extension/config.js` 的 `timeouts`。各项之和必须小于 `bridge/config.js` 的 `requestTimeoutMs`，并且客户端的工具超时要比 `requestTimeoutMs` 更长。

### 用自己的扩展 ID，与原版并存

所有人默认共用同一个扩展 ID（由 `extension/manifest.json` 的 `key` 决定）和同一个宿主名，所以同一台机器上只能装一份。如果你的分支要和原版同时安装：

```sh
node bridge/cli.js keygen   # 生成新公钥写入 manifest.json，打印新扩展 ID
```

然后把 `extension/config.js` 的 `HOST_NAME` 改成自己的名字（例如 `com.yourname.gsc_agent`），并把 `bridge/config.js` 的 `socketDir` 改成另一个目录，最后运行 `npm run setup`。改名后记得把 MCP 配置中的服务名也换掉，避免两个版本混在一起。

### 支持更多浏览器

在 `bridge/install.js` 的 `BROWSERS` 表中，为对应平台加一行原生宿主目录即可，例如 macOS 上的 Chromium 系浏览器：

```js
darwin: {
  chrome: 'Library/Application Support/Google/Chrome/NativeMessagingHosts',
  edge: 'Library/Application Support/Microsoft Edge/NativeMessagingHosts'
}
```

`setup` 会为表中的每个浏览器写入宿主清单，`doctor` 也会逐个检查。目前只验证过 Google Chrome。

## 开发时直接加载仓库目录

频繁修改扩展时，可以在 `chrome://extensions` 直接加载仓库的 `extension/` 目录，改完点刷新即可，不用每次都运行 setup。它和 setup 复制出的 `~/.gsc-agent/extension` 是同一个扩展 ID，两者只能加载一个。改了 `bridge/native.js` 或 `bridge/config.js`，仍需运行 `npm run setup`，因为 Chrome 启动的是复制出去的宿主。

## 发版检查

- `package.json` 和 `extension/manifest.json` 的版本号必须一致，测试会检查。
- `bridge/native.js` 只能依赖 Node 内置模块和 `bridge/install.js` 中 `HOST_FILES` 列出的文件，因为宿主是被单独复制出去运行的。
- 提交前运行 `npm test`。仓库的 GitHub Actions 会在 macOS 和 Linux 上自动跑同样的测试。
