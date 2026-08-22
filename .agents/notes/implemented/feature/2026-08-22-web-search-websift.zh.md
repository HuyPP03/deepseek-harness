# Agent Note: 无密钥的进程内 websift 搜索路由

Status: implemented

[English](2026-08-22-web-search-websift.md) | 中文

## 问题

`web_search` 已交付的默认路由需要密钥：`dsh-base` 层把 `web.searchProvider` 指向 DeepSeek 提供方，而该提供方在缺少 `DEEPSEEK_API_KEY` 时不可用，因此全新安装的无密钥部署只能得到一个只会失败的模型工具。当时唯一可用的无密钥路由（websift 的 DuckDuckGo 后端）只存在于用户自己配置中的带外 MCP sidecar 里——为一个搜索调用付出了独立进程、独立传输与独立生命周期的代价。

## 决策

`@deepseek-ai/dsh-web-search-websift` 在进程内嵌入 [websift](https://www.npmjs.com/package/websift) TypeScript 库，并向 web 能力 seam 注册提供方 id `websift`。它恰好暴露两个无密钥后端——`ddgs`（DuckDuckGo，零配置，默认）与 `searxng`（`baseUrl` 之后的自托管端点，`allowHttp` 允许 `http://` 实例）——并拥有 `web-search-websift` 设置分节。该提供方按每次搜索投影分节，因此一次设置写入即在下一次搜索生效，无需重新注册，seam 的选择不闪烁。

`dsh-base` 层现在组装 `web.searchProvider: websift` 与新配置项，并保留 `web-search-deepseek` 挂载但 `disabled: true`：重新启用带密钥路由只需把 `web.searchProvider` 指回 `deepseek-official` 并取消禁用该配置项（它解析与 Models 页管理的同一把密钥）。base 层与四个 agent 预设中 `tool-web` 配置项上残留的 `searchTimeoutMs: 60000` 覆盖被移除，两项操作均适用工具中性的 30 秒默认值。

设置卡片随之改动：`ui-settings-plugins` 的 web-search 卡片改为闭集后端选择字段加端点字段，凭据机制（`CardSecretSpec` 及其接线）在失去唯一消费者后离开 `CardForm`。`web-search-round` web e2e 改为无密钥：真实提供方对着一个遵守 `number_of_results` 的本地 SearXNG double 运行，提供方在传输层约束请求，seam 恰好收到其上限，收敛后的卡片不带截断注记呈现。

## 考虑过的替代方案

- **保留 MCP sidecar 作为默认。** 不予采纳：它为一个库在进程内即可完成的工作付出了独立进程与 streamable-HTTP 传输的代价；进程内路由删除了传输、其凭据与其生命周期。仍挂载 sidecar 的用户配置继续工作——seam 按提供方 id 选择，路由由部署自己的补丁决定。
- **保留 DeepSeek 搜索作为已交付默认。** 不予采纳：它是带密钥路由；全新安装没有密钥，默认路由必须无密钥才能让 `web_search` 可用。
- **交付带密钥的 websift 后端（`brave`、`exa`、`serper`、`tavily`）。** 暂缓：websift 的 `ProviderHttpClient` 跟随重定向（`redirect: "follow"`），而本包组的规则要求携带凭据的提供方请求拒绝重定向。待上游客户端能在接触 `Location` 目标前拒绝重定向后再交付。
- **Perplexity 或 Exa 作为默认。** 以与 DeepSeek 相同的理由不予采纳：两者都带密钥，且 Perplexity 对无密钥默认并不多出所需的能力。

## 后果

- `web_search` 开箱即用且无需密钥；`ddgs` 默认是 DuckDuckGo HTML 抓取——有速率限制、部分地区封锁——自托管 SearXNG 端点是稳定替代，可通过设置卡片或该分节的 cordis 层配置。
- 无密钥后端不返回发布日期，因此工具渲染来源时不带日期后缀，结构化结果中永不出现 `publishedAt` 字段。
- seam 的截断注记只在 seam 确实裁剪时出现：因为每个后端都遵守请求层约束，已交付路由的列表是完整的，注记通常缺席。
- 想要 DeepSeek 路由的部署把 `web.searchProvider` 指回并取消禁用该配置项；两条路由在 `dsh-base` 中共存，seam 按 id 选择。

## 验证

- `packages/web/web-search-websift`：26 个单元测试，逐文件 100% 覆盖率，包括真实组合设置测试（存储的端点在下一次搜索生效、卸载时释放命名空间）与一个断言 SearXNG 传输参数的本地 HTTP double。
- `pnpm run test:gui` 覆盖重做的卡片（暂存、闭集拒绝、保存/清空）；`plugin-config` web e2e 在 aria golden 中固定新卡片文案。
- `apps/web/tests/web-search-round.e2e.ts`（replay 模式，无密钥）经由真实提供方端到端对着 double 驱动，并固定收敛卡片 golden；`DSH_SNAPSHOT=refresh` 在有意的呈现改动后重写 golden。
