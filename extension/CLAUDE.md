# extension/
> L2 | 父级: ../CLAUDE.md

config.js: 宿主名、GSC 文案规则与等待时间，维护者的可定制入口之一。
manifest.json: 声明工具栏入口、扩展公钥、最小权限与 GSC 站点权限。
worker.js: 将点击的标签页绑定到本机连接，报告版本，按本机配额阻止提交。
property.js: 按主机名逐级筛选资源列表，选最具体的资源。
submit.js: 按模式读取报告、跳过已收录项或请求重抓，DOM 变化驱动等待。
page.test.js: 用 jsdom 模拟页面验证注入函数。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
