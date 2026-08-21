# @deepseek-ai/dsh-command-search

[English](README.md) | 中文

面向用户的 `/search` 命令：在会话自己的工作区中搜索。该插件通过 [`ctx.commands`](../../interaction/commands/README.md) 注册一个命令，把用户的查询组合成一条搜索指令，然后**引导**（steer）接收它的 agent。搜索本身是 agent 自己的轮次——它运行自己的文件搜索工具，并回复一份具体的匹配文件清单（每个路径附一行说明它为何匹配），而不是原始匹配行的堆砌。命令结果只确认搜索已入队；文件清单作为 agent 的回复到达。

## 命令约定

| 输入 | 结果 |
|---|---|
| `/search <query>` | `Search queued for this session.`——agent 被以搜索指令引导，文件清单作为 agent 的回复到达。 |
| `/search`（无查询） | `Usage: /search <query> — asks the agent to search this session workspace and list the matching files` |

查询是自由文本，不是字面 pattern：agent 自行解释它（一个短语、一个概念、一个路径片段），并选择如何搜索——内容用 `grep` 工具、路径用 `glob`、确认用 `read`。指令要求它去重路径、按相关度排序，并在无匹配时用一行说明。

这条引导是一条用户消息，agent 以 `{ kind: 'plugin', plugin: 'command-search' }` 来源收到它。它对该消息的轮次就是搜索：工具调用与最终清单像任何其他工作一样记录在会话日志里。空闲的 agent 立即开始轮次；运行中的 agent 在下一个步边界消费该引导。

## 组合

该命令注入 `commands`。挂载命令注册表与本插件：

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: command-search
  name: '@deepseek-ai/dsh-command-search'
```

随附 `dsh` 预设把它挂载在 `standard` 与 `code` agent 预设中；`chat` 预设不挂载，因为 chat 会话没有可搜索的项目目录。插件处置会先注销 `/search`，再等待所有已开始的处理器结算，因此根级 teardown 不会越过仍在运行的处理器。

## 模型体验

### 用户 `/search` 控制

#### 模型看到的内容

一条携带搜索指令的用户消息——查询原文加上固定的指令文本——带 `command-search` 插件来源标记。模型像对待任何其他用户消息一样回应它：运行搜索工具并返回文件清单。指令、工具调用与清单都位于会话日志中。

#### Token 影响

指令增加一条用户消息（查询原文加上约 300 token 的固定指令）。搜索轮次本身的开销是搜索工作本身：工具调用与文件清单。

#### KV Cache 影响

指令消息扩展会话前缀；agent 的搜索轮次从那里建立其工作状态。

## 已知限制与暂缓事项

- **仅会话工作区**——被引导 agent 的文件工具被沙箱限定在会话的项目目录内；参考项目在默认沙箱模式下不对其授权，因此 `/search` 触及不到它们。
- **每次调用一个查询**——没有标志或根过滤；收窄或扩大搜索范围靠换一个查询。
