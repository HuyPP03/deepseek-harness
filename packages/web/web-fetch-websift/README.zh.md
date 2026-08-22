# @deepseek-ai/dsh-web-fetch-websift

[English](README.md) | 中文

基于 [websift](https://www.npmjs.com/package/websift) 的 `WebFetchProvider`，服务于 harness [web 能力 seam](../web/README.md)（`ctx.web`）。它在进程内嵌入 websift TypeScript 库，让每个目标 URL 都经过库的 SSRF 安全获取：环回、私有与链路本地地址在任何请求离开进程之前就被拒绝，随后页面被转换为 markdown（或按 PDF 读取为文本）。它是 [base bundle](../../bundle/base/README.md) 随 `web_fetch` 启用而交付的 fetch 路线——第一条可以"开着交付"的无密钥 fetch 路线，因为其安全墙是硬不变量，而不是推迟工作。

这是一个**实现**包：它向 `ctx.web` 注册提供方，不拥有该键，也不注册面向模型的工具。与 [`@deepseek-ai/dsh-web-search-websift`](../web-search-websift/README.md) 一样，它是函数／命名空间插件（`inject: ['web']`）。

## 职责拆分

提供方拥有 **SSRF 安全获取**：URL 验证、scheme 策略、非全局地址拒绝、传输（字节上限、同进程重定向边界、超时）与提取（HTML→markdown、PDF→文本、渲染页面上限）。[`@deepseek-ai/dsh-tool-web`](../tool-web/README.md) 拥有**呈现**：它原样透传该提供方的渲染文本，按自身输出上限截断，并用工具的错误格式包装提供方失败。

与 [`dsh-web-fetch-http`](../web-fetch-http/README.md) 不同，这里的非 2xx HTTP 响应是*失败*而非*结果*：库对状态码分类（401/403/407 → `auth`，429 → `rate_limit`，5xx → `unavailable`，其他 4xx → `http_error`），提供方把每一类都以 `WEB_PROVIDER_ERROR` 连同库的净化消息呈现。

提供方的 `timeoutMs` 是直接 `ctx.web.fetch()` 调用方与配置有误的部署所用的资源兜底，不是面向模型的工具调用预算。[`dsh-tool-call-timeout-policy`](../../guard/timeout-policy/README.md) 通过让 `exec.signal` 在超时时触发来拥有 `web_fetch` 工具调用预算，提供方把它映射为 `WEB_ABORTED`。

## SSRF 墙

- 在任何请求发出之前拒绝一切**非全局目的地**：环回（`127.0.0.0/8`、`::1`）、私有（`10/8`、`172.16/12`、`192.168/16`）、链路本地、CGNAT（`100.64/10`）、IPv6 唯一本地与多播——包括 DNS 解析出的主机和 IPv4 映射的 IPv6 字面量。这一拒绝是设计使然，且没有配置旁路；正因如此，这条路线才能开着交付。
- 默认拒绝 `http://`（非 TLS）目标；`allowHttp: true` 只解除 scheme 策略——地址墙仍然生效。
- 面向模型的拒绝文案是库的原文：`Error: Blocked: '127.0.0.1' is a non-global address.` 与 `Error: Blocked: http URLs are not allowed (set FETCH_ALLOW_HTTP=true).` 无密钥 ACP 快照场景 `web-fetch-websift` 通过真实提供方固定了这两条。

## 映射

成功获取返回库渲染的 markdown 作为 `text` body（因此消费方的文本路径原样透传）、`url` 取最终（重定向后）URL 或请求 URL、库的状态码，以及来自库页面截断的 `truncated`。

失败携带库的净化消息；某类失败没有消息时，回退为 `websift fetch failed (<category>)`：

| websift 类别 | seam 代码 |
|---|---|
| `blocked`（scheme、凭据、非全局地址） | `WEB_BLOCKED_URL` |
| `empty_input` | `WEB_INVALID_URL` |
| `timeout` | `WEB_FETCH_TIMEOUT` |
| `overflow`（原始下载超过库的字节上限） | `WEB_FETCH_TOO_LARGE` |
| `unsupported_content` | `WEB_UNSUPPORTED_CONTENT_TYPE` |
| 其他（`http_error`、`auth`、`rate_limit`、`unavailable`、`network`、`decode`、`redirect`、`provider`、`unknown`） | `WEB_PROVIDER_ERROR` |

来自库的意外 rejection 成为 `WEB_PROVIDER_ERROR` 的 `websift fetch failed: <error>`；调用方取消呈现为 `websift fetch aborted`（`WEB_ABORTED`）。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `allowHttp` | `false` | 允许 `http://`（非 TLS）目标 URL；非全局地址墙仍然生效。 |
| `timeoutMs` | `30_000` | 提供方 fetch 超时（毫秒），换算为库的秒数——直接 `ctx.web.fetch()` 调用方的资源兜底，不是面向模型的工具调用预算（那是 `dsh-tool-call-timeout-policy`）。 |
| `maxPageChars` | `128_000` | 渲染页面上限（字符）；超出时库截断页面文本（结果仍然成功，标记 `truncated`）。原始字节下载上限是另一个库常量，超出会失败（`WEB_FETCH_TOO_LARGE`）。 |

```yaml
- id: web-fetch-websift
  name: '@deepseek-ai/dsh-web-fetch-websift'
  config:
    allowHttp: true
```

base bundle 以默认值挂载该条目，并把 `web.fetchProvider` 指向 `websift`，与无密钥搜索路线并列。

## 模型体验

间接，通过 [`dsh-tool-web`](../tool-web/README.md)：它在该提供方的渲染 markdown（连同库的截断标记）或其精确失败——被拒 URL 的 `Error: Blocked: …`、非 2xx 响应的 `Error: Failed to fetch URL: HTTP <status>`、`Error: websift fetch failed: <error>`——之下保留消费方的错误包装，而提供方私有字段（字节数、重定向次数、内容类型）留在上下文之外。

#### KV 缓存影响

无直接失效；被点名的消费方拥有任何请求前缀变更。

## 已知限制与推迟工作

- **非 2xx 响应永远不会作为结果到达模型**——模型看到的是库净化的状态消息，而不是状态码或响应主体，这比 `dsh-web-fetch-http` 的"带状态码的结果"是更粗糙的信号（代价换来的是这条路线可以开着交付）。
- **地址墙没有旁路**——环回与私有目标总是被拒绝；本地开发服务器按设计不可达。库的更细粒度开关（`allowedPorts`、`allowedDomains`、`deniedDomains`）未暴露。
- **提取跟随 websift 库版本**——HTML→markdown 质量、PDF 支持（50 页 / 128,000 字符）、10 MiB 下载上限与 5 跳重定向边界来自库的传输基线（`AppSettings.create()` 默认值，绝不用其环境变量）；本包只暴露上面三个配置键。
- **没有 UI 设置区**——与 `dsh-web-fetch-http` 对等；可调项是 per-composition 的 `cordis.yml` 配置，而不是 per-user 设置卡片。
