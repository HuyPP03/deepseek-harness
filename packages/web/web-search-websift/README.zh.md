# @deepseek-ai/dsh-web-search-websift

[English](README.md) | 中文

由 [websift](https://www.npmjs.com/package/websift) 支持的 `WebSearchProvider`，用于 harness [web 能力 seam](../web/README.md)（`ctx.web`）。它把 websift TypeScript 库以进程内方式嵌入——没有 MCP 边车，也没有独立传输进程——驱动其无需密钥的后端：`ddgs`（DuckDuckGo HTML 搜索，零配置）与 `searxng`（位于 `baseUrl` 之后的自有 SearXNG 实例）。

这是一个**实现**包：它向 `ctx.web` 注册提供方，拥有无需密钥的后端允许列表与设置分节，不注册面向模型的工具。与 `@deepseek-ai/dsh-web-search-deepseek` 一样，它是函数／命名空间插件（`inject: ['web']`）。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `provider` | `ddgs` | 无需密钥的 websift 后端：`ddgs` 或 `searxng`。 |
| `baseUrl` | 省略 | SearXNG 端点基址（`provider` 为 `searxng` 时必需）；无法解析时提供方不可用。 |
| `allowHttp` | `false` | 允许本地／自托管实例的 `http://` SearXNG 端点。 |

```yaml
- id: web-search-websift
  name: '@deepseek-ai/dsh-web-search-websift'
  config:
    provider: searxng
    baseUrl: http://searxng.internal:8080
    allowHttp: true
```

以上条目是 `web-search-websift` 设置分节的基底层：其上的用户层在下次搜索时生效，因为提供方按调用投影分节，而不是在注册时捕获它。因此，当后端或端点变化时，seam 的提供方选择不会闪烁。

## 映射

websift 不返回模型生成的答案，因此 `content` 被省略。`sources[]` 来自 websift 的 `SearchResult[]`：`url` ← `url`、`title` ← `title`、`snippet` ← `snippet`。无需密钥的后端不返回发布日期，因此 `publishedAt` 从不出现。`url` 为空的结果被丢弃，空的 `title`／`snippet` 字段被省略而不是臆造。

`maxResults` 作为请求界限发送（各后端都遵守它；在 SearXNG 线上它是 `number_of_results`），seam 再通过截断 `sources[]` 并设置 `truncated` 再次强制执行。

提供方失败以 `WebError` `WEB_PROVIDER_ERROR` 呈现——websift 结构化的 `errorCategory`／`errorMessage` 被净化进消息，意外拒绝变为 `websift search failed: <error>`；当响应携带类别但无消息时，回退为 `websift search failed (<category>)`。调用方取消以 `WEB_ABORTED` 呈现。

## 模型体验

间接地，通过 [`dsh-tool-web`](../tool-web/README.md)：它保留该提供方经 `maxResults` 限定的 URL、标题与摘要，或其确切失败 `websift search failed: <error>`、`websift search failed (<category>)` 与 `websift search aborted`（置于消费者的错误包装之下），而提供方私有字段留在上下文之外。

#### KV 缓存影响

无直接失效；被点名的消费者拥有任何请求前缀变化。

## 已知限制与推迟工作

- **无 `publishedAt`** — websift 的无需密钥后端不返回发布日期，因此工具渲染的源不带日期后缀。
- **带密钥的后端被推迟** — websift 的 `brave`／`exa`／`serper`／`tavily` 提供方携带 API 密钥，但其 `ProviderHttpClient` 会跟随重定向（`redirect: "follow"`），违反本包组对携带凭据的提供方请求的"拒绝重定向"规则。带密钥的后端将在上游客户端能在触碰 `Location` 目标之前拒绝重定向时落地。
- **`ddgs` 是 DuckDuckGo HTML 抓取** — 无需密钥但受速率限制且可能被地区封锁；自托管 SearXNG 端点是稳定替代，SearXNG 后端在端点不可达时会在搜索时响亮失败。
- **仅搜索；fetch 位于姊妹包** — 本包不暴露 fetch 路线。该库的页面抓取（SSRF 安全、HTML→markdown、PDF→文本）以 [`@deepseek-ai/dsh-web-fetch-websift`](../web-fetch-websift/README.md) 交付，base 挂载它、把 `web.fetchProvider` 指向它，并启用 `web_fetch`。
