# @deepseek-ai/dsh-client-ui-file-inspector

[English](README.md) | 中文

对话文件检视器：`conversation.details.file` 槽位的占用方（该槽位由 `dsh-client-ui-conversation` 的 details 入口声明），当用户选中一个文件时打开——来自 diff 卡片行、read 行或产物文件条目。一个面板，选中文件至多三个座位：

- **预览** — 仅对可预览的扩展名：Markdown（`.md`/`.markdown`）通过共享的 `MarkdownText` 管线渲染已读文本；HTML（`.html`/`.htm`）通过沙箱化的 `<iframe>`（空沙箱——不透明源，预览永远无法执行自身脚本或触及应用存储）指向 raw 通道自己的 URL 加载；图片与 SVG（`.svg` 及常见位图类型）直接把 `<img>` 指向同一 URL，浏览器自行解码字节，无需 JS 拷贝；docx（`.docx`）通过 mammoth 转换为同样的沙箱框架表面（`srcDoc`）；xlsx/csv（`.xlsx`/`.csv`）通过 SheetJS 解析第一个工作表为显示单元格表格。存在时该标签是默认座位，否则隐藏。
- **变更** — 当前窗口内触及该文件的最新 diff 卡片（write/edit 调用的已结算 result 视图，顶级或任意深度的子调度；相对的 model-facing 路径按会话工作区根解析），通过共享 `DiffBlock` 绘制，带行号槽、高亮和行内标记。窗口内没有该文件的 diff 时隐藏此标签。
- **代码** — 通过运行时的 `fileBytes` 服务读取整个文件的逐字节内容（host 的 raw 通道，`GET /api/file/<sessionId>/<path>`），按行虚拟化（只挂载可见窗口），带行号和共享 shiki 高亮；前导 8 KiB 内出现 NUL 时座位切换为二进制提示，raw 通道的拒绝以本地化状态呈现（413 超过 25 MiB 边界、500 不可读）。纯图片文件不设代码标签——它的字节不是文本视图。

字节读取是运行时服务的 `read(sessionId, path)` — 每个会话每个文件一次 fetch（服务的有界 LRU），并发读取共享，因此检视器绝不会为预览或其他表面已 fetch 的文件发出第二次下载。

## 模型体验

无 —— 本包只是为人类渲染已记录的会话内容（diff 材料）与 raw 通道服务的文件；不改变任何模型请求、工具执行或会话事件。

#### KV Cache 影响

无。本包是纯客户端呈现。

## 已知限制与后续工作

- **变更标签只显示最新的一张卡片** — 窗口内更早的同一文件变更不会累积；完整的按文件历史仍属于轨迹视图。
- **Office 解析器内联进插件 bundle** — 浏览器的冻结模块表只为已注册的模块 id 应答 `require()`，因此代码分割出的兄弟 chunk 无法加载；mammoth 与 SheetJS 因此随 `lib/client.js` 一起打包（转换只在预览 office 文件时运行，字节读取与其他座位共用同一个缓存读取）。
- **预览的 HTML/docx 框架的空沙箱是刻意的** — 该框架的不透明源同样阻止被预览页面读取应用同源存储；需要更多能力的预览是安全变更，不是配置。
- **只预览第一个工作表** — 工作簿的其他工作表不呈现；表格以显示字符串呈现第一个工作表的全部行。
