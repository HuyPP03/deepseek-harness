# @deepseek-ai/dsh-client-ui-file-inspector

[English](README.md) | 中文

对话文件检视器：`conversation.details.file` 槽位的占用方（该槽位由 `dsh-client-ui-conversation` 的 details 入口声明），当用户选中一个文件时打开——来自 diff 卡片行、read 行或产物文件条目。一个面板，选中文件至多三个座位：

- **预览** — 仅对可预览的扩展名（`.md`/`.markdown`、`.html`/`.htm`、`.svg` 及常见位图类型）：Markdown 通过共享的 `MarkdownText` 管线渲染已读文本；HTML 通过沙箱化的 `<iframe>`（空沙箱——不透明源，预览永远无法执行自身脚本或触及应用存储）指向 raw 通道自己的 URL 加载；图片/SVG 直接把 `<img>` 指向同一 URL，浏览器自行解码字节，无需 JS 拷贝。存在时该标签是默认座位，否则隐藏。
- **变更** — 当前窗口内触及该文件的最新 diff 卡片（write/edit 调用的已结算 result 视图，顶级或任意深度的子调度；相对的 model-facing 路径按会话工作区根解析），通过共享 `DiffBlock` 绘制，带行号槽、高亮和行内标记。窗口内没有该文件的 diff 时隐藏此标签。
- **代码** — 通过运行时的 `fileBytes` 服务读取整个文件的逐字节内容（host 的 raw 通道，`GET /api/file/<sessionId>/<path>`），按行虚拟化（只挂载可见窗口），带行号和共享 shiki 高亮；前导 8 KiB 内出现 NUL 时座位切换为二进制提示，raw 通道的拒绝以本地化状态呈现（413 超过 25 MiB 边界、500 不可读）。纯图片文件不设代码标签——它的字节不是文本视图。

字节读取是运行时服务的 `read(sessionId, path)` — 每个会话每个文件一次 fetch（服务的有界 LRU），并发读取共享，因此检视器绝不会为预览或其他表面已 fetch 的文件发出第二次下载。

## 模型体验

无 — 检视器渲染既有的会话内容（diff 卡片）和既有文件（raw 通道）；不增加任何模型可见内容，不改变 prompt。

#### KV Cache 影响

无。

## 已知限制与后续工作

- **变更标签只显示最新的一张卡片** — 窗口内更早的同一文件变更不会累积；完整的按文件历史仍属于轨迹视图。
- **Office 文档尚无预览** — docx（mammoth）与 xlsx/csv（SheetJS）是剩余的后续预览；它们将懒加载各自的解析器并读取同一个 raw 通道。
- **HTML 预览的空沙箱是刻意的** — 该框架的不透明源同样阻止被预览页面读取应用同源存储；需要更多能力的预览是安全变更，不是配置。
