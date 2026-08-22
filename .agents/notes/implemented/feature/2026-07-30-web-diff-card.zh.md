# Agent Note: Web diff 卡片 —— write/edit 渲染意图抵达浏览器

Status: implemented

[English](2026-07-30-web-diff-card.md) | 中文

## Problem

`write` 和 `edit` 工具为其 call 和 result 都声明了 `card: 'diff'`（[render-intent union](../architecture/2026-07-02-tool-render-intent-union.md)）：call view 携带从参数推导的预期改动，result view 携带已应用的上下文 hunk（`FileDiff[]`，由 `packages/fs/tool-fs/src/diff.ts` 计算，并持久化在 result `meta` 中以便回放重建）。该视图早已抵达浏览器 —— host、connection、runtime 将它作为 `callView`/`resultView` 投递到 `ConversationSnapshot` —— TUI 也已将其渲染为按文件分组的 `+`/`-` 块加 `+A -R · N file(s)` 页脚。

Web 客户端忽略了它。write/edit 调用落到 `GenericToolCard`，其行从原始工具参数推导，详情面板把 result 的 content block 摊平进一个 `<pre>`。`diffs` 载荷 —— result 的全部意义 —— 被丢弃，于是一次文件改动读起来只是一行确认、看不到任何改动。

这是把 [terminal 卡片](2026-07-28-web-terminal-card.md) 对 `diff` 这一支重做一遍：那次改动让 Web 客户端成为 `terminal` 渲染意图的消费者；这次让它成为 `diff` 渲染意图的消费者，复用同一套四层结构。

## Decision

`DiffBlock` 是一个 `ui-primitives` 组件，把文件改动渲染为内联 diff 表面，write/edit 调用的两个 Web 渲染点都通过它消费 diff 渲染意图：chat 工具行的行体和详情面板的 Output 区。`ui-tool/src/client/tool/models/diff-card-model.ts` 是唯一把快照的 `callView`/`resultView` 对转成组件 props 的地方，因此两个渲染点不会对一次改动产生分歧。当两侧都未声明 `card: 'diff'` 时它返回 null —— 走通用路径 —— 包括本客户端版本不认识的 `card` 值，以及已结算调用的 result view 是 generic 的情况（write/edit 的执行错误正是这样留在通用路径上的）。调用结算后 result 侧是权威：已应用的 hunk 替换仅从参数推导的 call 时 diff。分页窗口丢弃了 call 头也仍能渲染，因为 result view 携带完整改动。

该组件与 TUI 共用单栏框架、行终止符规则和去重路径计数。行分类与 TUI 的统一形式一致 —— 中性 context 行、删除行、新增行 —— TUI 用有界比较派生，Web 用 `diffLines` 对每个 hunk 携带的文本做行 diff 派生。Web 额外渲染 hunk 标注的起始行与语言提示所支持的内容：行号 gutter 与每侧语法高亮。TUI 保持其纯文本无行号卡片，忽略 result meta 中携带的同样可选字段。

- **路径分组。** 新文件开启一个粗体路径头；同文件的第二个 hunk（分散编辑，或 `replace_all`）以一个 `⋯` gap 开启，而非重复路径。TUI 在每个 hunk 上都保留路径头，但两个前端的 `N file(s)` 页脚都按去重路径计数，因此同文件两个 hunk 在两端都读作 `1 file`。
- **改动配色、gutter 与行内标记。** 删除行坐在删除侧整行洗色上、error-token `-` 符号；新增行坐在新增侧洗色上、success-token `+` 符号；中性 context 行保持纯文本、空白符号；符号有自己独立的列，可选 gutter 可以置于其旁。当 hunk 标注 `oldStart`/`newStart` 时，gutter 从这些 1-based 起始行给每一行编号（修改行对在各侧保留其配对行号，context 推进两个光标）；只标注一侧的 hunk 让另一侧的行在占位列中保持无编号，没有任何 hunk 标注时不绘制 gutter 列。每个 hunk 的两侧通过共享 shiki 路径按 `lang` 提示高亮 —— context 属于两侧，因此每侧一次性 tokenize 自己的行 —— 修改行对（等长删/增相邻块，`diffWordsWithSpace`，超过 `INTRA_LINE_MAX` = 2000 字符时跳过）内精确变更的词段获得更强标记，该标记切分 token span 使标记保留其周围的 token 颜色；不等长相邻块退化为独立的删除块和新增块。各行为横向滚动盒子中的 `white-space: pre` —— 源码行靠缩进阅读，因此滚动而不折行。新建（`oldText: null`）没有删除侧。
- **高度上限带展开控件。** 长于 `DEFAULT_DIFF_MAX_LINES`（16）的 diff 显示 `ceil(max/2)` 个头部行加剩余尾部行，中间一个按钮报告隐藏行数。分割算术与 `TerminalBlock` 和 TUI 的折叠卡片一致，因此长 diff 的头尾切片在两个前端一致。
- **行终止符。** 每一侧的内容按 `TerminalBlock` 与 TUI 共用的终止符规则在 `\n` 上切分：空文本是零行（整文件删除的 `newText`、新建缺失的 `oldText` 侧），单个结尾换行终止其最后一行而非新增一条幻影空行，内部空行保留。
- **页脚与复制。** 暗色 `└ +A -R · N file(s)` 页脚只统计变更行 —— 中性 context 不计入 —— Web 页脚现在与 TUI 报告同一改动。复制控件复制带前缀的 Web diff 文本（路径头、`- `/`+ ` 行、两空格 context、`⋯` gap），使多文件复制保持可辨别归属。

几何、圆角、字体镜像 `CodeBlock`/`TerminalBlock`，使 diff 卡片、terminal 卡片、代码块读起来是一家；`white-space: pre` 加横向滚动是刻意的分歧。复制控件浮在卡片右上角，而非占据自己的 banner 行，因为只放一个复制按钮的 banner 会在第一行 diff 上方画出一条空带 —— TUI 的 diff 卡片也没有 banner，只有页脚。

chat 行把 diff 常驻渲染在路径链接摘要之下，上限 `CHAT_DIFF_MAX_LINES`（8），对应面板的 16 —— 与 [terminal 卡片](2026-07-28-web-terminal-card.md#inline-output-in-the-chat-row-reverses-a-stated-convention)记录的内联输出决策、以及流内表面与阅读表面的同一划分一致。write/edit 行是单文件的，所以它的摘要既是可打开的路径链接，其 diff 卡片又展开；两者共存，因为卡片不是路径的参数体。

## Alternatives considered

**并排（双栏）diff。** owner 目前拒绝：它更密但不适合狭窄的 chat 行，目标是与 TUI 单栏统一形式对齐。详情面板里的双栏模式是后续的 props 改动，不是重设计。

**git 式行号槽（后续已交付）。** 原始 `FileDiff` 约定只携带 `{ path, oldText, newText }` —— `structuredPatch` 的 hunk 起始行在 `diff.ts` 里被丢弃，所以没有行号抵达客户端，本变更刻意保持为该约定的纯 Web 消费者。后续改动在约定中加入可选的 `oldStart`/`newStart` 与 `lang` 语法提示，并让 tool-fs 的 presenter 从有界前像中戳印它们 —— call 时没有前像的 presenter 省略它们，因此旧日志回放为无行号纯文本卡片 —— `DiffBlock` 渲染上述 gutter。TUI 保持其纯文本无行号卡片：字段是可选的且 TUI 渲染器忽略它们，所以 TUI 行号槽是后续消费同一戳印 meta 的 TUI 改动。

**复用 `CodeBlock`。** 因与 terminal 卡片相同的理由拒绝：`CodeBlock` 会折行，且没有每行 `+`/`-` 角色、没有路径头、没有页脚。两者共享几何与字体 token，那是唯一一处一个实现对两者都正确的部分。

## Consequences

`DiffBlock` 只读 diff view 的字段，因此它是渲染意图所携带内容的纯函数 —— 与产出该视图的 presenter 一样回放安全。没有 diff 能力的 UI 仍得到 bridge 的通用回退。升级后的正文为一个运行时依赖加入 `ui-primitives`：`diff`（jsdiff），用于 hunk 行 diff 与行内词段；每侧高亮复用 read 卡片已在运行的 shiki 路径，没有新的语法依赖。缺失戳印位置或 `lang` 提示时，卡片回退到无行号纯文本渲染，因此旧日志回放不变。

`DiffBlock` 的多文件支路（一张卡、多个路径头）今天没有生产者：`write`/`edit` 每次调用各改一个文件，所以真实卡片显示一个文件带一个或多个 hunk。该支路为将来的多文件改动工具而构建并测试，不是为当前消费者。

## Testing

`packages/client/ui-primitives/tests/diff-block.client.spec.tsx` 钉住组件：新建支路（只有新增、无删除侧）、统一编辑正文（context 行不计入页脚、等长行对配对并带行内标记、不等长相邻块退化为独立块、hunk 末尾刷出尾部删除块）、从戳印起始行的 1-based gutter（单侧戳印保持空位、无戳印不绘制 gutter）、经共享 shiki 路径的每侧高亮（无 `lang` 提示时纯文本）、行内标记及其 `INTRA_LINE_MAX` 跳过、同文件 `⋯` gap 对比新文件自己的头、空 diffs 的 null 渲染、页脚计数及其单复数、头尾上限及其 `aria-expanded` 切换、以及复制控件在接受与拒绝两条剪贴板路径上断言带前缀的 diff 文本（含两空格 context）。Per-file 100%。

`packages/client/ui-tool/tests/diff-card.client.spec.tsx` 钉住每个渲染点的接线：`diffCardModel` 的派生及其每个 null 支路（包括畸形的 `oldStart`/`newStart`/`lang` 拒绝整个载荷）、戳印位置与语言提示透传到卡片、result hunk 替换 call 时 diff、窗口截断的 call 仍从 result 渲染、chat 行的 diff 体、`FileMutationRow` 的常驻卡片及其路径链接经 host 以 cwd 解析打开、其在 `write` 与 `edit` 下的注册、以及面板的 Output 区。

fixture（`packages/client/connection/src/client/fixture.ts`）携带三个 diff turn，使 `?fixture` 服务与 per-package 接线测试套件在两个渲染点演练全部三个支路：单 hunk 编辑（turn 62，keyed `FileMutationRow`）、新建/写入（turn 63）、多 hunk 编辑（turn 67，一个文件内两处分散 hunk 之间的 `⋯` gap）。built-boot snapshot（`apps/web/tests/built-boot.snapshot.ts`）是启动装配 smoke，只断言图挂载并抵达 chat 内容（`data-sample="bash-global"`）；按其自身约定它不带 diff 行为断言，那由接线套件负责。

## Related

- [Web terminal 卡片](2026-07-28-web-terminal-card.md) —— `terminal` 支路的同一套四层结构；本 note 复用其内联输出决策与头尾上限算术。
- [工具调用呈现的标签化 render-intent union](../architecture/2026-07-02-tool-render-intent-union.md) —— 本改动消费的 `card` 标签词汇；Web 客户端现在也是 `diff` 支路的消费者。
- [Web 客户端架构](../architecture/2026-07-19-gui-web-client-architecture.md) —— 两个渲染点所处的 slot 与快照分层。
