# Agent Note: 无密钥 SSRF 安全 fetch 路线（web-fetch-websift）

Status: implemented

[English](2026-08-22-web-fetch-websift.md) | 中文

## 问题

`web_fetch` 在每一种组合中都以禁用状态交付：`dsh-base` 层没有挂载任何 fetch 提供方，且每个 agent 预设的 `tool-web` 条目都设置了 `fetch: false`。唯一存在的 fetch 提供方 `dsh-web-fetch-http` 推迟了 SSRF 保护（不拦截私有／环回、不做 DNS 再校验），而请求目标由模型选择，因此默认启用它会把这个 harness 变成开箱即用的 SSRF 工具。搜索路线已经嵌入的 websift 库本身就提供 SSRF 安全的页面抓取（非全局地址预检、HTML→markdown、PDF→文本），但其 fetch 部分并未被暴露为 `WebFetchProvider`。

## 决策

`@deepseek-ai/dsh-web-fetch-websift` 把 websift 的 `fetchStructured` 包装为 `WebFetchProvider`，以 id `websift` 注册到 web 能力 seam 上——它是 `web-search-websift` 在 fetch 侧的姊妹包。每次操作用一个 `WebSearchClient`，从 `AppSettings.create()` 构建，使库的环境变量永远不会泄漏进 harness 的配置面；提供方配置为 `allowHttp`（默认 `false`）、`timeoutMs`（默认 `30_000`，换算为库的秒数）与 `maxPageChars`（默认 `128_000`，即库自身的默认值）。

seam 映射把库渲染的 markdown 原样作为 `text` body 保留（因此 `dsh-tool-web` 的文本路径原样透传），把 `finalUrl` 作为 `url` 返回，并把库的页面截断映射到 seam 的 `truncated`。失败类别映射到 seam 词汇表：`blocked` → `WEB_BLOCKED_URL`、`empty_input` → `WEB_INVALID_URL`、`timeout` → `WEB_FETCH_TIMEOUT`、`overflow` → `WEB_FETCH_TOO_LARGE`、`unsupported_content` → `WEB_UNSUPPORTED_CONTENT_TYPE`，其余全部（包括被分类的非 2xx 类别 `http_error`／`auth`／`rate_limit`／`unavailable`）→ `WEB_PROVIDER_ERROR`，附带库的净化消息，回退为 `websift fetch failed (<category>)`。调用方取消与库调用竞速（`WEB_ABORTED`），因为库不接受信号。

`dsh-base` 层现在挂载该条目、把 `web.fetchProvider` 指向 `websift`（显式，镜像 `searchProvider`），并从基底层与全部四个 agent 预设的 `tool-web` 条目移除 `fetch: false` 覆盖——`web_fetch` 在每一种模式下都与 `web_search` 同一条无密钥路线启用。

SSRF 墙是固定不变量，不是配置：库在任何请求离开进程之前拒绝环回、私有、链路本地、CGNAT 与唯一本地目的地——包括 DNS 解析出的主机和 IPv4 映射的 IPv6 字面量——并且除非设置 `allowHttp` 否则拒绝 `http://` 目标（地址墙仍然生效）。非 2xx 响应在这条路线上是一个*失败*——库对状态分类，提供方呈现被分类的失败——与 `dsh-web-fetch-http` 不同，在那里非 2xx 响应是带状态码与主体的结果。

无密钥 ACP 快照场景 `web-fetch-websift`（人工编写，非录制：真实模型无法被诱导进行稳定的环回 fetch）驱动脚本化的模型用环回 `https` URL 和一个 `http` URL 调用 `web_fetch`；真实提供方在任何请求离开进程之前拒绝两者，工具结果固定了面向模型的错误 `Error: Blocked: '127.0.0.1' is a non-global address.` 与 `Error: Blocked: http URLs are not allowed (set FETCH_ALLOW_HTTP=true).` 及其 `WEB_BLOCKED_URL` 元数据。该场景与现有的 `web-fetch` 场景共享 `web` header 钉扎类，因为两者组合产生相同的请求头。

## 已考虑的替代方案

- **默认启用 `web-fetch-http`。** 拒绝：它推迟了 SSRF 保护，且请求目标由模型选择；默认启用它会开箱交付一个 SSRF 工具。它作为显式组合选择保留，供接受该风险的部署使用。
- **暴露库的更细粒度开关（`allowedPorts`、`allowedDomains`、`deniedDomains`）。** 推迟：没有交付中的组合需要它们；墙是安全不变量，部署特定的允许列表是一个独立信任决策，随真实消费方一起落地。
- **把非 2xx 当作结果（与 `web-fetch-http` 对齐）。** 拒绝：库对非 2xx 响应的约定是结构化、被分类的失败，强行做成结果会为 seam 无法担保的解码主体凭空制造保证。面向模型的差异记录在包的 README 中。

## 后果

- `web_fetch` 开箱即可无密钥使用，与 `web_search` 同一条进程内 websift 路线；基底层按 id 显式选择两个提供方。
- 环回与私有目标按设计对模型不可达——本地开发服务器够不到，且没有配置能收窄这面墙。
- 非 2xx 响应呈现为 `Error: Failed to fetch URL: HTTP <status>` 而不是带主体的结果：比 `dsh-web-fetch-http` 信号更粗糙，这是把该路线默认启用的代价。
- 提取质量、10 MiB 下载上限、PDF 边界（50 页 / 128,000 字符）与 5 跳重定向边界跟随锁定的 websift 版本；本包只暴露其三个配置键。
- `dsh-web-fetch-http` 仍是 seam 上的第二个 fetch 后端；需要其"非 2xx 作为结果"语义（并接受缺失的 SSRF 保护）的组合按 id 选择它。
- 没有 UI 设置区：可调项是 per-composition 的 `cordis.yml` 配置，与 `dsh-web-fetch-http` 对等。

## 验证

- `packages/web/web-fetch-websift`：32 个单元测试，每文件 100% 覆盖——通过真实 `WebSearchClient` 内一个假的 backend 提供方覆盖成功、映射、截断与 `statusCode: null` 处理；生产客户端 SSRF 拒绝（环回 `https`、私有 IP、`http` scheme、格式错误与空输入、`allowHttp` 解除 scheme 但不解除墙）；类别映射；取消（预先中止、进行中中止、构建期间同步中止、abort 形态的 rejection）；`Config({})` 默认值；以及经由 `WebRuntime` 与 `ctx.web.fetch`、带 fiber 释放的真实组合测试。
- 无密钥 ACP 快照场景 `web-fetch-websift` 经由真实工具管线重放，在会话日志中固定了这两条拒绝文案以及 `WEB_BLOCKED_URL` 错误元数据。
- `dsh-base` 与预设接线反映在重新生成的 `apps/cli/composition.md` 中；该提供方不注册设置区，因此 `plugin-config` golden 不受影响。
