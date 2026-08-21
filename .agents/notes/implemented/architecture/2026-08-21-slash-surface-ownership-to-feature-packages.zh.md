# Agent Note：斜杠表面与其功能包同住 —— `/mode` 移入 ui-agent-preset

Status: implemented

[English](2026-08-21-slash-surface-ownership-to-feature-packages.md) | 中文

## 问题

`/mode` 装饰与 `/clear`、`/help` 一起注册在 `@deepseek-ai/dsh-client-ui-slash-tools` 里，但它的——预设名册、选择器规则、显示文案——属于 `@deepseek-ai/dsh-client-ui-agent-preset`。一个通用斜杠工具包持有别家的功能，是所有权倒置：每次名册变更都要在错误的包里改，而新的 `/mcp` 装饰（渲染 MCP 数据）撞上了同一个问题。

其次，名册行直接照预设元数据文件渲染名称与描述，而部署用一种语言写这些文件。出厂预设（`standard`、`code`、`minimal`、`cordis`、`chat`）因此在每个浏览器语言下都显示成文件语言——中文元数据文件在英文 Web 上显示中文名。

## 决策

- **斜杠装饰住在它渲染的数据所属的功能包里。** `/mode` 从 ui-slash-tools 移入 ui-agent-preset（成为其第五个表面，注册方式与之前完全一致：非 chat 会话可用、名册来自 `agentPreset.list` 且省略损坏预设、选中提交完整的 `/mode <preset>` 行走宿主命令——机制见 [ `/help` 与 `/mode` 笔记](../feature/2026-08-20-web-help-mode-client-surfaces.md)，机制本身未变）。`/mcp` 按同一规则住在 `@deepseek-ai/dsh-client-ui-mcp`（见 [其笔记](../feature/2026-08-21-mcp-client-surface-and-settings-panel-deep-link.md)）。ui-slash-tools 只保留没有功能归属方的表面：`/clear`（纯客户端会话重置）与 `/help`（合并菜单视图）；其 inject 列表去掉 `connection` 与 `remote.commands`。
- **出厂预设文案是客户端所有的本地化内容。** ui-agent-preset 的所有名册行都经 `presetDisplayText` 渲染：`trust: 'system'` 且 id 为出厂预设（`standard`、`code`、`minimal`、`cordis`、`chat`）的预设，名称与描述取自 `settings.agentPreset` 语言表；其余照用文件元数据（名称回退为 id）。用户自撰的预设文件不做可翻译化——客户端无法拥有部署文件的语言，而强行给元数据格式加 i18n 会让部署格式变成本地化格式，并默默丢掉用户自己的措辞。

## 备选方案

- **`/mode` 留在 ui-slash-tools，注入 ui-agent-preset 的 store。** 否决：把倒置固化下来——数据归属方要靠一个通用工具包承载自己的表面——且之后每次预设变更都要再跨一次边界。
- **给预设元数据文件加 i18n**（按语言的名称/描述字段）。否决：文件是用户手改的部署产物；翻译 schema 会把部署格式变成本地化格式，并对未知语言默默丢掉用户自己的措辞。
- **只定逐表面的规则而不定通用所有权规则。** 否决：`/mcp` 表面在同一次变更里给出了第二个实例；规则才是决策，两次移动是它的实例。

## 影响

- ui-slash-tools 变小也更诚实：两个表面、四个注入、不再线读别家功能的数据。
- 新增出厂预设 id 必须在同一次变更里补上 `settings.agentPreset` 语言表键，否则回退文件元数据（名称回退为 id）。
- [Web help/mode 笔记](../feature/2026-08-20-web-help-mode-client-surfaces.md)就地更新为 `/mode` 装饰现在注册于何处；其机制决策（走宿主命令提交、排除 chat、过滤损坏预设）未变。
