# GSC Agent - 从本机 agent 请求单页编入索引
Chrome Manifest V3 + Node.js 22 + MCP SDK。

<directory>
extension/ - 自动连接本机，在选用或点击固定的 GSC 标签页执行页面操作。
bridge/ - 连接 MCP 客户端与 Chrome 原生消息端口。
</directory>
<config>
package.json - 运行依赖、命令入口与测试脚本。
package-lock.json - 固定依赖版本。
README.md - 中文安装、接入、使用与排错说明。
README.en.md - 英文说明。
CHANGELOG.md - 版本记录与对外接口的兼容约定。
CUSTOMIZE.md - 维护自己版本的改法。
LICENSE - MIT 许可证。
.github/workflows/test.yml - 在 macOS 与 Linux 上运行测试。
.github/ISSUE_TEMPLATE/ - 问题反馈表单，要求附 doctor --page 输出、系统、浏览器与 GSC 语言。
</config>

按 URL 选择资源，单条或后台批次逐项执行，批次单个运行并按间隔提交。本机保存提交操作历史并按资源限额。Google 确认后才报告已提交。
