# bridge/
> L2 | 父级: ../CLAUDE.md

config.js: 数据目录、版本号与桥接默认值，维护者的可定制入口之一。
cli.js: 命令入口 gsc-agent：setup、config、doctor、uninstall、keygen、mcp。
install.js: 复制扩展与宿主到数据目录，在 macOS 与 Linux 上为已安装的 Chromium 系浏览器注册宿主，卸载，生成扩展公钥。
doctor.js: 检查安装、连接与版本，可选在真实 GSC 页面只读核对文案规则，命令行和 MCP 共用。
native.js: 将 Chrome 消息帧接到本机套接字，记录扩展版本，回答状态询问，退出时清理。
history.js: 按调用记录开始与结果，提供历史筛选与资源配额统计，只读检查不计入配额。
mcp.js: 发布只读检查、提交、批次、停止、查询和自检工具；检查与批次默认只读，提交工具要求用户同意。
run.js: 单条、批次与自检共用宿主连接、残留套接字清理、离线提示与操作历史，转发页面自检。
batch.js: 独立子进程按间隔顺序执行批次，单批互斥，支持停止。
integration.test.js: 用模拟 Chrome 端验证 MCP 调用链、网址校验、版本报告、页面自检、配额与批次控制。
cli.test.js: 用临时主目录验证版本一致与按已安装浏览器注册、自检、卸载。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
