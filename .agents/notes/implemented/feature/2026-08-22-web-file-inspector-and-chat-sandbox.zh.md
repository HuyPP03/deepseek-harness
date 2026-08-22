# Agent Note：Web 文件检视器 —— 单一 raw 通道之上的预览、diff 与代码座位

Status: implemented

[English](2026-08-22-web-file-inspector-and-chat-sandbox.md) | 中文

## 问题

Web 会话把文件工作显示为不透明文本：`write`/`edit` 的结果是 `<path>…</path>` 信封，`read` 的结果是带行号的文本，用户没有任何途径查看文件本身。没有渲染预览（Markdown/HTML/图片/Office 文档），没有针对变更的改动行视图，也无法检视一次聊天产生的文件——没有 workspace 的聊天会话运行在宿主进程目录里，它产生的工件散落在服务器启动处的任何位置。

## 决策

`@deepseek-ai/dsh-client-ui-file-inspector` 拥有一个详情列（AppFrame 网格的 480 px 轨道），为选中文件提供三个座位：**预览**（可用时是默认座位）、**改动**（`write`/`edit` 调用的已应用 diff）与**代码**（对受限字节的虚拟视图）。一条选择通道驱动它：`SelectionTarget` 携带 `callId`（工具行打开它的 diff）、`filePath`（文件行的路径链接打开该文件，宿主侧相对会话 cwd 解析）或 `browse` 目录（会话文件列表）。

文件字节流经一条接缝：`fileBytes`（宿主）与其 raw 通道（载体）。给 `files.read` 把关的同一套包含证明（词法 + 符号链接解析后位于会话 cwd 或已附着 reference 内）给 `GET /api/file/<sessionId>/<path>` 把关：它在 25 MiB 边界内以精选 content type 与 `nosniff` 流式送出逐字节原文。预览座位把元素指向该 URL——浏览器自行解码图片、在沙箱框架中加载 HTML/docx（空 `sandbox` 属性：不透明源，预览永远无法执行自身脚本或触及应用存储）——而 office 解析器（mammoth 处理 docx、SheetJS 处理 xlsx/csv）在浏览器中对 LRU 缓存的读取运行，因此预览从不触发第二次下载。

两条 bundle 约束塑造了客户端构建：浏览器模块表只为已注册 id 应答 `require()`，所以插件构建关闭代码分割（兄弟 chunk 的 `require("./chunk-*.cjs")` 会在加载时漏掉模块表），解析器内联进单一 `lib/client.js`；且 xlsx 探测 `typeof require`（在打包的 CJS 工厂内为真）并走它 node 专属的 `require('stream')` 分支，所以客户端构建把 `stream` 别名到一个空 stub。

没有 workspace 的聊天会话（既不带 workspace 也不带 cwd 的 `sessions.create`）现在落在它自己的沙箱 `<harness home>/chat/<sessionId>`：网关向 `createApiProxy` 传入 `chatCwdFor` 默认值，显式 cwd 或 workspace 仍优先，且沙箱位于会话 cwd 之内，所以检视器的通道能服务聊天创建的文件。

产物文件表面只派生自变更工具——shell 命令创建的文件不产生任何宣布，因此没有检视器入口。修复是浏览模式，而不是新的宣布通道：会话标题栏的**会话文件**操作（`conversation.session.header.actions` 的占用方，仅当会话记录了 cwd 时渲染）在 `conversation.details.files` 座位上打开 details 面板，该座位通过既有的 `files.list` RPC 列出会话工作集（与 composer 的 `@` 来源共用的有界遍历；无宿主变更）。点击列表中的行会重新选中该文件，常规座位接管。跨插件层面，该手势经由 ui-conversation 提供的 `detailsPanel` 服务（`open(sessionId, target)` / `close`），它桥接到 details 入口注册 inject 中捕获的绑定动作——按会话的 store 无法跨插件共享，所以服务是唯一许可的路线。

## 替代方案

- **服务端渲染预览**（在宿主转换 markdown/Office）。否决：它复制客户端的 Markdown 渲染器、阻断浏览器原生图片解码，并为每次查看增加宿主工作；raw 通道让宿主保持字节服务器。
- **首次预览时按需拉取的分割解析器 chunk。** 否决：冻结的模块表无法应答兄弟 chunk 的 require（启动屏会因插件加载失败而挂掉）；内联用约 2 MB bundle 体积换可加载性。
- **预览框架使用 `allow-same-origin`。** 否决：同源预览能读取应用存储；不透明源是该功能需要的隔离。
- **聊天沙箱位置的 `Config` 字段。** 否决：harness home 是环境级根目录，`chat/` 是与 `.mcp/` 并列的布局常量；没有可暴露的部署可变选择。
- **从真实模型轮次录制 e2e 种子。** 否决：Web e2e 车道无密钥且确定；种子是带真实事件信封的已提交 fixture。

## 后果

- 检视器插件 bundle 较重（解析器内联）；代价在插件加载时支付，而非首次预览。模块表若能应答 chunk 的 require，分割可以回归。
- 文件列表是每次打开时的一份有界快照（100 行、截断提示、本地过滤；无实时刷新），且没有按目录导航——遍历的平铺相对路径就是整个浏览。
- 聊天沙箱在 harness home 下累积。它们不是会话工件（日志在持久化根内）；清理被延后。
- TUI 保留朴素 diff 卡片；带行槽、按语言高亮与行内标记的行对齐正文是 Web 投影。
- 超过 25 MiB 的文件在 raw 通道作答 413，未映射扩展名服务 `application/octet-stream`；座位降级到代码座位或下载。
- 覆盖：预览座位（含 docx/xlsx/csv 与失败态）在已提交 fixture 上单测；e2e 端到端证明各座位（捕获 raw 通道请求、断言沙箱框架），聊天场景通过 scaffold 的活上下文在进程内断言真实的宿主回退，会话文件按钮场景针对聊天沙箱证明 header 操作 → 文件列表 → 点击行 → 检视器预览。
