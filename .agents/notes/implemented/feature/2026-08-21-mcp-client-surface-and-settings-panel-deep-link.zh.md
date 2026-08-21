# Agent Note：Web 上的 `/mcp` —— MCP 设置区与面板深链

Status: implemented

[English](2026-08-21-mcp-client-surface-and-settings-panel-deep-link.md) | 中文

## 问题

宿主侧 `/mcp` 命令（见 [`/mcp` 状态视图](2026-08-20-mcp-status-command.md)）用聊天文本回答了"哪些服务器连着、是否健康"——但也止步于此。Web 端没有任何表面回答问题的另一半：该改什么？用户 MCP 服务器（`mcp.list` 中 `managed` 的行，声明在 `$DSH_HOME/.mcp/` 下）只能手改 YAML 文件，一个抖动中的服务器只能重启部署来重连，而 `/mcp` 菜单选中后也没有比聊天气泡更合适的去处。

## 决策

一个新包 `@deepseek-ai/dsh-client-ui-mcp` 在既有 `mcp` 线调用上承载两个 Web 表面；`@deepseek-ai/dsh-client-ui-settings-general` 中的一个服务成为两者的深链：

- **MCP 设置区**（slot `settings.section`，id `mcp`，order 40——排在既有功能区之后，因为 MCP 服务器是部署级接线，不是按会话的配置）。一个控制器（`McpSectionController`）拥有一个快照：名册拉取、添加表单、删除确认门与进行中的重连。每行显示名称、状态与工具数；**添加**打开模态表单（stdio：command/args/env/cwd；streamable-http：url/headers；共用超时），校验并解析行格式后提交 `mcp.add`；**删除**只提供给 `managed` 行，且置于 `RiskConfirmation` 门后；**重连**按行提供，同样有门。每次写入后都重新拉取名册——宿主保持唯一事实源，页面从不保留服务器自己的副本。
- **`/mcp` 装饰**（popupSelect）挂在宿主命令上：裸选 `/mcp` 打开名册弹层，每行携带 `detail`（状态 · 工具数）与 `confirmation` 块，使重连成为一次说清自己会打断什么的有意识的两步操作；末尾的 `__add__` 行深链进设置区，不执行任何命令。
- **`SettingsPanelController`**——ui-settings-general 中的一个 cordis `Service`，注册为 `settingsPanel`，持有面板的 `{ open, activeId }`，动作 `openSection(id?)`、`closePanel()`、`setActiveId(id)`。`SettingsRoot` 过去把这个状态放在局部 `useState` 里；现在它从控制器的 store 渲染，并通过注入面暴露三个动作，使面板之外的注册者（`/mcp` 弹层）可以带着选定的节打开面板。

## 备选方案

- **`/mcp` 弹层里放裸名册列表，无门。** 否决：弹层中唯一可操作的行是重连，而重连会打断进行中的工具调用——设置区的删除与重连用 `RiskConfirmation` 的同一个理由，正是裸一键行会跳过的东西。
- **添加表单直接放进 `/mcp` 弹层。** 否决：一个六字段带校验的表单装不进单阶段菜单弹层，而名册本来就住在设置区；弹层的职责是把它指过去（`__add__`）以及重连。
- **自定义深链机制**（slot 事件、全局回调）。否决：带动作的跨插件共享状态走 cordis 服务是既有模式；为一个消费者再开一条临时通道反而是异类。
- **把设置区挂进 ui-slash-tools，连同 `/mcp` 装饰。** 否决：设置区与装饰都渲染 MCP 数据；拥有数据的包拥有两个表面（见 [斜杠表面归属](../architecture/2026-08-21-slash-surface-ownership-to-feature-packages.md)）。

## 影响

- ui-settings-general 现在发布一个跨插件服务：ui-mcp 经 `ctx.inject(['settingsPanel'])` 成为其第一个消费者。面板状态从 React 局部态移入 cordis 快照 store；`SettingsRoot` 经 `hooks.settingsPanel` 渲染，它自己的 open/active 动作就是控制器的。
- [宿主侧 `/mcp` 注记](2026-08-20-mcp-status-command.md)不再是"仅宿主"：它的状态视图在 Web 上是弹层的数据源，该注记的影响清单已如实说明。
- 添加表单把空字段解析省略后组成线上 `McpServerSpec`；`mcp.add` 的宿主校验仍是裁决者（重名、非托管目标与 `serverName` 规则都在那里被拒，页面把宿主回答显示在表单上）。
- `mcp.list` 仍是唯一读口：弹层、设置区与宿主命令都从它拉取，三个表面因此不会漂移。
