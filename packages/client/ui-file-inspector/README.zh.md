# @deepseek-ai/dsh-client-ui-file-inspector

[English](README.md) | 中文

对话文件检视器：`conversation.details.file` 槽位的占用方（该槽位由 `dsh-client-ui-conversation` 的 details 入口声明），当用户选中一个文件时打开——来自 diff 卡片行或产物文件条目。一个面板，选中文件的两个座位：

- **变更** — 当前窗口内触及该文件的最新 diff 卡片（write/edit 调用的已结算 result 视图，顶级或任意深度的子调度；相对的 model-facing 路径按会话工作区根解析），通过共享 `DiffBlock` 绘制，带行号槽、高亮和行内标记。窗口内没有该文件的 diff 时隐藏此标签。
- **代码** — 通过运行时的 `fileBytes` 服务读取整个文件的逐字节内容（host 的 raw 通道，`GET /api/file/<sessionId>/<path>`），按行虚拟化（只挂载可见窗口），带行号和共享 shiki 高亮；前导 8 KiB 内出现 NUL 时座位切换为二进制提示，raw 通道的拒绝以本地化状态呈现（413 超过 25 MiB 边界、500 不可读）。

字节读取是运行时服务的 `read(sessionId, path)` — 每个会话每个文件一次 fetch（服务的有界 LRU），并发读取共享，因此检视器绝不会为预览或其他表面已 fetch 的文件发出第二次下载。

## 模型体验

无 — 检视器渲染既有的会话内容（diff 卡片）和既有文件（raw 通道）；不增加任何模型可见内容，不改变 prompt。

#### KV Cache 影响

无。

## 已知限制与后续工作

- **变更标签只显示最新的一张卡片** — 窗口内更早的同一文件变更不会累积；完整的按文件历史仍属于轨迹视图。
- **二进制和超大文件尚无预览** — 代码座位会提示它们；文档预览（markdown/html/图片，然后是 docx/xlsx）是后续工作，读取同一个 raw 通道。
