# Agent Note: client locale 转向 en-first：三语言，英文为默认与 key 源

Status: proposed

[English](2026-08-22-client-locale-en-first-vietnamese.md) | 中文

## Problem

client locale 基座落地时是双语、中文为产品默认：`zh` 是字典 key 源，`en` 是对其锁定的译文，`FALLBACK_LOCALE` 是 `zh`。重新定位后的产品以英文出货：无信号的全新浏览器应落在英文界面，越南语是主要用户群的一等语言，中文转为次要。旧规范让英文成了二等公民——key 身份、查找兜底、key 回显失败模式全由中文表定义；一个英文默认的产品会要求英文同时是兜底底线和非源译文，而完整性校验却对着错误的表执行。

## Proposal

**语言集为 `['en', 'vi', 'zh']`，`en` 为默认与 key 源。** `packages/client/locale` 的 `LOCALE_IDS`/`FALLBACK_LOCALE` 移至 `en`；settings store 接受 `vi`；语言行列出三个以自身语言自述的选项（English / Tiếng Việt / 中文，各在自己的 settings 字典里自述）。查找链形状不变，`en` 在每一层成为底线：`ns[active] → ns[en] → common[active] → common[en] → key echo`。

**字典规范翻转。** 每个命名空间表以 `en` 为 key 源（`satisfies Record<string, string>`）；`vi` 与 `zh` 是 `Record<XxxKey, string>`，编译器强制两者覆盖每个 key。common 命名空间的 key 集为 `keyof en`。新增一个 key 的编写成本是三张表，换来运行时零未翻译。

**代码中的产品文案是英文。** zero-cordis 的 ui-primitives 原子组件从中文硬编码串移到英文默认值——不传 props 的消费方渲染英文界面。四个内容块（Diff/Read/Search/Web）获得 TerminalBlock/JsonTree 已有的 `labels` prop；它们的共享词汇（展开/收起 aria、截断、showing-of、复数单位、空态）移入 common locale 命名空间，因为同样的块由两个不同席位的特性渲染——会话工具行与文件检视器——而跨插件导入不是正路。每个特性用一个小 label builder 经自己的席位解析 common key。`verify-product-copy` gate 把 CJK 挡在 client `src` 之外，除 allow-list 字典（locale 包、各命名空间 `locales.ts`、onboarding 文案、一个刻意保留的 wire fixture）与一行级 allow（QuestionComposer 的 wire 正则）。

**边界决定。** preset 显示名在三张表里都是英文。ui-trajectory 的 `vi` 刻意镜像 `en`（开发者检查面，与其 `zh` 全英文同一裁决）；镜像表带一个窄 `jscpd:ignore` 标记，让重复率 gate 把这份镜像读作边界本身。CJK 测试 fixture（ansi 宽字符、markdown CJK 标点、connection fixture、刻意的 wire 串）保持 CJK。持久的 `preference: 'zh'` 仍然有效——无数据迁移；未知 id 依旧失败。

**相对 e2e 口径的范围。** web e2e 用例继续断言它们所断言的文案（zh 用例开 `zh-CN` 浏览器）；快照重录到英文默认值与首个 `vi` 用例落在同一计划的后续阶段。

## Related

- [client 文案全量接入 typed locale 席位](../../implemented/architecture/2026-07-30-client-locale-full-rollout.md)——其机制（label thunk、`t` 席位、zero-cordis 原子的 props 化、不翻译边界）继续有效；其双语规范与 zh 默认被本 note 取代。
- [由浏览器推导初始 locale](../../implemented/feature/2026-07-31-browser-derived-initial-locale.md)——暂定 locale 机制原样不变；本 note 改变它回落的兜底，从 `zh` 到 `en`。

## Alternatives considered

- **保留 `zh` 为 key 源、只加 `vi`**：改动最小，但 key 身份与查找兜底仍是中文而产品默认是英文——兜底语言不是 key 源，完整性校验对着错误的表执行。
- **双语、`vi` 别名到 `en`**：vi 是主要用户群的一等产品语言，不是兜底别名；别名会静默降级越南语用户并掩盖降级。
- **保留中文原子默认值、在每个调用点传英文 label**：原子默认值正是尚未接线的消费方所渲染的；英文优先的产品里保留中文默认值会让未迁移界面保持中文——正是该 gate 要抓的混合语言事故。
- **默认 locale 做成配置项**：默认值是产品决定，不是部署变量；仓库政策把 `Config` 字段留给有当前消费方的部署可变选择。

## Acceptance criteria

- 无 Host 偏好的全新浏览器按其 navigator 请求的语言打开（vi、zh 或 en）；完全无信号落在英文。
- 每个已注册命名空间的三张 locale 表相对 en key 集编译完整；typecheck 即 gate。
- `verify-product-copy` 在全树通过，且在 client `src` allow-list 外植入一个游离 CJK 字面量时失败（exit 1 带 `file:line`）。
- 块界面不传 props 渲染英文默认值、传 labels 渲染字典文案；locale 包测试钉死三选项列表、兜底链与三值往返。
- `test:gui` 与仓库 typecheck 全绿。

## Risks

- vi 译文是 ~700 条 client 串的首版质量；面向用户的措辞后续可调整而不改变机制（表是唯一编辑点）。
- 新 key 的成本从两张表变三张表；漏掉 vi 或 zh 的值会让构建失败，而不是在 UI 里回显 key。
- allow-list 内的 CJK（wire fixture、QuestionComposer 正则）按设计在 gate 视野之外；清单增长时必须审查。
- en-first 翻转改变了无信号浏览器所见；一切假设 zh 默认值的界面（文档、截图、e2e zh 用例口径）由计划后续阶段覆盖，不由本 note 承担。
