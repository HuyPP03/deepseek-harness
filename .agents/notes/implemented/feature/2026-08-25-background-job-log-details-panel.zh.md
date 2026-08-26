# Agent Note：后台任务日志详情面板

Status: implemented

[English](2026-08-25-background-job-log-details-panel.md) | 中文

## 问题

[Web 后台任务列表](2026-08-08-web-background-job-display.md)让人类看到了注册表的状态——有哪些任务、状态如何、耗时多少——但运行中任务的输出仍然只对模型可见。被点击的行无处落脚：注册表唯一的读取 `read()` 会消费任务唯一的读取游标，并在终止读取时把任务标记为已报告，因此一个轮询它的浏览器会悄悄偷走模型 `job_output` 应得的字节，并抑制完成通知。列表暂缓的阶段——逐任务流式输出——被一个 seam 事实卡住：`JobRegistry` 没有非消费式读取。

## 决策

人类读取成为它自己的 seam 方法，列表行打开的面板则是浏览器在新的详情席位上的占位者。

### Seam：`JobRegistry.log`

```ts ignore-check
abstract log(id: JobId, caller?: Agent): JobLogRead
```

`log` 返回任务保留的人类视图输出，不触碰面向模型的状态：`read` 消费的游标不推进，任务也不被标记为已报告，因此模型的下次读取依然完整。owner 栅栏与其他方法一样做会话 id 比较。

`LocalJobRegistry` 把每次抽干的生产方增量 tee 进每任务的 `logText`——被包装的 `readOutput` 保持唯一的消费点，`read` 的增量变成 `logText` 中模型游标之后的切片。保留是一个配置字段 `jobLogRetainChars`，正安全整数，默认 `2_097_152`（以 UTF-16 码元计的 2 MiB；`String.length` 让尾部边界保持 O(1)）。超出上限时头部被丢弃，模型游标位于同一窗口内：完全位于游标之后的丢弃只平移游标；吞掉了模型尚未消费字节的丢弃则把游标重置到保留部分头部，且模型的下次 `read()` 携带一次性的 `[job log head dropped]\n` 标记。除这一个标记外，`read()` 的文本与此前无界行为逐字节一致，且 `log()` 从不消费——两者都由注册表 spec 钉住。

### 线路：`jobs.log`

宿主 ApiProxy 既有 `jobs` 域上的一个单射方法，请求 `{ sessionId, jobId }`，应答 `{ text, truncated }`。请求会话的活体 Agent 就是栅栏调用方，解析方式与 `session/jobs` 帧完全一致（`ctx.agents.get(sessionId)`，因此冷会话只能读无主任务，且绝不会被恢复）。未知 id 应答新错误码 `job-not-found`（details 携带 `sessionId` + `jobId`），他人会话的任务应答 `job-unauthorized`（details 携带 `jobId`），没有注册表的部署应答 `internal`。宿主把每个响应按 UTF-8 尾部截断到 `JOB_LOG_WIRE_TAIL_BYTES`（256 KiB）——协议常量而非配置字段——从末尾按码点回溯，从不拆断多字节字符；`truncated` 标记该截断。

### 客户端：行点击 → 详情席位

[ui-jobs](../../../../packages/client/ui-jobs/README.md) 列表的每一行都是一个按钮。点击会关闭弹层，并通过 ui-conversation 的 `detailsPanel` 服务以 `{ turnSeq: 0, jobId }` 打开详情面板——与 Files 动作用的是同一个被认可的跨插件手势通道，因此 ui-jobs 既不触碰聊天存储也不触碰布局。选择通道新增 `jobId` 作为与 `filePath`、`browse` 并列的第四个互斥的、不带 `callId` 的字段；早于该字段而持久化的目标会像更早的字段一样重新水化为空操作选择。

详情面板多声明一个席位 `conversation.details.job`，并以 `jobId` 为键渲染它，使占位者的状态在目标之间重置。[`ui-jobs`](../../../../packages/client/ui-jobs/README.md) 占据该席位：状态行来自头部列表读取的同一个 `jobsBySession` 镜像（标记、kind、label、有 `detail` 时以 `detail` 取代状态词），下方是保留的日志——挂载时读取一次，镜像显示任务活跃时每 1500 ms 重读一次，结算翻转落定后再做最后一次读取，然后停止。`job-not-found` 应答渲染「已释放」状态，其他任何失败渲染通用提示，宿主的尾部截断渲染截断提示，空的活跃日志渲染占位文案。

## 已考虑的替代方案

**从浏览器轮询 `read()`。** 拒绝：它会消费游标并把任务标记为已报告，浏览器将偷走模型 `job_output` 的字节并抑制完成通知——正是游标要保护的那份投递。

**为人类读取开第二条生产方订阅或旁路通道。** 拒绝：生产方协议只有一个 `readOutput`，第二个抽干点需要在每个生产者插件内部讲自己的投递与顺序故事。对唯一消费点做 tee 让生产者保持不动。

**通过 mux 推送日志字节。** 拒绝：字节又大又密，而状态帧已经在推送。面板打开期间以有界间隔拉取，关闭时零成本；1500 ms 间隔是 UI 常量，不是部署选项。

**`session/jobs` 帧上加 `JobSnapshot.logTail` 字段。** 拒绝：它会为只有一个面板读取的界面，向每个已订阅会话发送每个任务的字节，而这份帧的职责是权威状态集合。

## 测试

- `dsh-jobs-local` spec：逐字节一致的模型读取、非消费式的人类读取、不认领报告、最终输出语义、带一次性标记的尾部上限、不重投递的平移情形、第二次丢弃后标记重新武装，以及栅栏。
- 宿主 ApiProxy spec：模型游标不动的 ok 路径、`job-not-found`、`job-unauthorized`、无注册表的 `internal`、多字节负载上的 UTF-8 尾部边界、最终输出任务先存活后结算的读取，以及冷会话恢复前读取无主任务。
- RPC schemas spec：两个新错误码分支及其必填 details。
- ui-jobs 组件 spec：面板的「活跃时轮询／结算时终读」状态机、已释放与失败状态、截断提示、卸载时的中止；行点击的打开手势与可访问名称。
- 真实堆栈席位 spec：占位者经 slot 机制落座、任务选择路由到它、头部行点击经 `detailsPanel` 服务打开它。
- [Web e2e 场景](../../../../apps/web/tests/background-job-list.e2e.ts)新增详情面板捕获；其命令现在先打印 50 行再保持，列表 golden 重新录制，因为行现在是一个按钮。

## 后果

**每个流任务现在最多保留到上限的日志文本。** 注册表此前完全不留人类视图；长任务会在 owner 销毁释放前在内存中持有约 2 MiB 的 UTF-16 文本。上限是供想要更多或更少的部署使用的配置。

**保留机制可能出现在模型文本中。** 只有当头丢弃吞掉了模型尚未消费的字节，模型才会看到 `[job log head dropped]`——每轮丢弃一次——非常健谈的任务的保留上限由此成为模型可见事实。

**人类读取会抽干生产方。** `log()` 与 `read()` 都穿过唯一消费点，因此打开的面板会把生产方的输出向前拉取——就是模型下次读取会拿到的同一批字节，现在为双方一起累积。

**面板显示的是尾部。** 线上超过 256 KiB 的应答只显示最新部分，并由 `truncated` 标记；超出线上边界的保留头部无法从浏览器取回。

**面板没有取消能力。** 行打开的是日志，不是停止控件。人类取消的面向模型后果（`kill()` 会把终态投递标为已上报，模型会继续以为它的任务在跑）仍是该阶段欠下的决策。
