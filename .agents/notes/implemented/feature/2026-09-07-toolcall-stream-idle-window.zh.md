# Agent Note: tool call 的按阶段流空闲窗口

Status: implemented

[English](2026-09-07-toolcall-stream-idle-window.md) | 中文

## Problem

LLM 适配器用一个五分钟的流空闲 watchdog 限制每次未完成的提供方读取。watchdog 在每个 `StreamChunk` 上重新布防，因此它能跟踪服务器发出的每一个 token——但它无法跟踪服务器没有发出的 token。针对一个真实部署（vLLM 提供 Qwen 模型）的测量表明，该 OpenAI 兼容端点会对 tool call 参数做批量处理：`write` 工具的 `content` 值在生成继续期间被服务器扣留，再在一个迟到的 SSE 事件中一次性发出，期间 wire 完全静默。因此，凡是生成时长超过五分钟基础窗口的文件，都会被读成提供方静默、触发 watchdog，随后常规重试策略从头重跑生成，最多两次，最终 turn 以 `TIMEOUT` 结束。

客户端在那段间隙内没有任何途径观察服务器的在途 token，所以修复不可能是"检测出模型还在工作"。它是要让窗口与阶段相匹配：text 与 reasoning 保留能抓住真实卡死的短窗口，而 tool call 阶段——参数批量处理在此是合法的——拥有自己独立的、由部署配置的窗口。

## Decision

空闲窗口按阶段切换，切换发生在每个适配器的流循环中：

- `dsh-timeout` 的 `IdleWatchdog` 增加 `setIdleTimeout(ms)`。新间隔适用于调用之后的每次布防；一个已经在途的请求保持其原定期限；`TimeoutReason` 报告其 timer 触发时生效的间隔。
- `dsh-llm` 导出 `toolCallPhaseAfter(chunk, inToolCall)`：`tool-call-delta` 进入（或保持）tool call 阶段，`text-delta` 或 `reasoning-delta` 离开该阶段，其余 chunk 类型（`block-start`、`block-end`、`usage`、`finish`）保持阶段不变。
- 两个适配器（`dsh-llm-deepseek`、`dsh-llm-pi-ai`）对它们 yield 的 chunk 运行同一个状态机，并在每次阶段切换时调用 `watchdog.setIdleTimeout`。超时错误消息报告实际触发的那个窗口。
- 每个提供方的配置增加 `toolCallStreamIdleTimeoutMs`（正的有限 Node 定时器延迟），默认值取该提供方的 `streamIdleTimeoutMs`，因此不配置该字段的部署完全保持现有行为。

阶段以 delta chunk 为键，而不是以 `block-start`/`block-end`：两个适配器都把 `block-end` 延迟到流结束，因此基于 block 边界的状态机一旦有 tool call 打开，就会把窗口加宽到整条流的剩余部分。以最后观察到的 delta 类型为准，模型一旦回到 text 或 reasoning，基础窗口随即恢复。

## Alternatives considered

**改服务器。** 一个逐 token 流式发出 tool call 参数（或在生成期间发送 SSE keepalive）的 vLLM 部署会让基础窗口重新变得正确，这是该部署的根本性修复。但它帮不到其它参数做批量处理的部署，而且 harness 无法检测自己在和哪种服务器对话，所以更宽的阶段窗口仍然作为部署可调的答案保留。

**一旦出现 tool call 就把整条流的窗口加宽。** 更简单（不需要状态机），但 tool call 之后 text 阶段的卡死就会等待宽窗口而不是基础窗口。以 delta 为键的状态机每个适配器只多四行，并让基础窗口在 tool 阶段之外保持诚实。

**按工具名列表（只有 `write` 加宽）。** 批量处理行为属于服务器的 tool 参数处理，而不是某个工具名：`edit`、`bash` heredoc，以及任何带大参数的工具都会遇到同样的间隙。名单是一个带假阴性的硬编码可调值。

**改为重试感知（不重试已产出输出的 `TIMEOUT`）。** 正交加固：重试无论如何都从头重跑生成，而且部署已经能通过其提供方 `retryPolicy.retryableCodes` 表达"不重试超时"。不属于本变更。

## Testing

- `dsh-timeout`：`setIdleTimeout` 在两次布防之间的间隔切换、在途请求的期限规则、触发时原因中的间隔、以及边界校验。
- 两个适配器套件：tool call 内部的 wire 间隙在 tool 窗口下存活；同样的间隙在默认（基础）窗口下、以及短于该间隙的 tool 窗口下超时，并在消息中报告 tool 窗口；即使配置了 tool 窗口，text 间隙仍按基础窗口超时；tool call 之后的 text 间隙按恢复后的基础窗口超时。
- 两个插件套件：`toolCallStreamIdleTimeoutMs` 默认取基础窗口，以及在解析器与插件加载边界拒绝非正、非有限与超上限的值。

## Consequences

- 服务器对 tool 参数做批量处理的部署现在可以承载长文件写入：在 `~/.dsh/settings.yaml`（或 entry 配置）中为受影响的提供方设置 `toolCallStreamIdleTimeoutMs`。未触碰的部署在所有阶段保持五分钟行为。
- 在 tool call 中途卡死的服务器现在会等待已配置的 tool 窗口（宽窗口）才报 `TIMEOUT`，而不是五分钟；想要更短上限的部署配置更小的 `toolCallStreamIdleTimeoutMs`。
- 在 tool 阶段，watchdog 的超时消息与 `TimeoutReason.timeoutMs` 可能不同于提供方的基础窗口；解析消息文本的消费方看到的是实际触发的那个窗口，这才是诚实的事实。

## Related

- [有界 LLM 请求恢复](../architecture/2026-06-21-bounded-llm-request-recovery.md) 拥有本 note 所扩展的基础 `streamIdleTimeoutMs` watchdog 语义。
- [按提供方路由的 LLM 适配器](../architecture/2026-07-14-provider-routed-llm-adapters.md) 拥有两个空闲窗口在其下解析的按 profile 作用域。
