# @deepseek-ai/dsh-command-search

[English](README.md) | 中文

面向用户的 `/search` 命令：在会话的项目目录与其附加的参考项目（reference project）中做字面文本搜索。该插件通过 [`ctx.commands`](../../interaction/commands/README.md) 注册一个命令，并通过 [`ctx.subprocess`](../../subprocess/subprocess/README.md) 运行一次打包的 ripgrep 二进制（`@vscode/ripgrep`），因此用户可以在无需模型轮次的情况下搜索会话创建时所在的工作区——以及附加到会话的每个参考项目。搜索根完全来自会话自身状态：先取 header 的 `cwd`，再取 [`referencesOf`](../../workspace/workspace-references/README.md) 从会话日志重放得到的参考集。

## 命令约定

| 输入 | 结果 |
|---|---|
| `/search <字面文本>` | 有界的 `path:line: text` 匹配列表，覆盖会话工作区与其参考项目，按 ripgrep 输出顺序排列。项目目录内的路径相对该目录显示；其余路径按原样显示。 |
| `/search`（无 pattern） | `Usage: /search <literal text> — searches this session workspace and its reference projects` |
| 会话既无 `cwd` 也无参考项目 | `This session has no project directory and no reference projects to search.` |
| 零匹配 | `No matches for "<pattern>".`——是成功，不是错误。 |

pattern 按**字面**搜索（`--fixed-strings`）：特殊字符无需转义，pattern 也永远不会被解释为 ripgrep 正则表达式或标志（它总是放在 `--` 之后）。运行从三个方向限界：

- **匹配数**——至多 200 条匹配被折叠进结果（并以 ripgrep 的每文件 `--max-count` 镜像）；
- **体积**——折叠文本守住 16 KiB UTF-8 字节预算；单条超长行被截到该预算并加 `… (line truncated)` 标记，多条行放不下时从尾部重新折叠并加 `… truncated to fit the result budget (showing N of M matches)` 说明；
- **时间**——30 秒截止期把发起分发的 UI 的取消信号汇入 ripgrep 进程树（SIGTERM → 3 秒宽限 → SIGKILL），截止期胜出时报告 `Search timed out after 30s.`。

ripgrep 退出码 1（无匹配）是成功；其他退出码是直接错误，携带裁剪后的 stderr 尾部。原始 stdout 超过 256 KiB 保留上限的运行以“收窄 pattern 或搜索根”的错误失败，而不是解析一个不完整的流。取消由命令执行器负责：被中止的请求把 `command/done` 事件对结算为该中止，并通过汇入的信号杀死进程树。

搜索使用 `--no-config`，并尊重各搜索根自己的忽略文件，与面向模型的 `grep` 工具相同。默认跳过 Git 忽略文件与二进制文件；匹配行按文本显示，不做按文件分组。

## 组合

该命令注入 `commands` 与 `subprocess`。挂载命令注册表、一个 subprocess provider 与本插件：

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: subprocess
  name: '@deepseek-ai/dsh-subprocess-local'
- id: command-search
  name: '@deepseek-ai/dsh-command-search'
```

随附 `dsh` 预设把它挂载在 `standard` 与 `code` agent 预设中；`chat` 预设不挂载，因为 chat 会话没有可搜索的项目目录。插件处置会先注销 `/search`，再等待所有已开始的处理器结算，因此根级 teardown 不会越过仍在运行的搜索。

## 模型体验

### 用户 `/search` 控制

#### 模型看到的内容

斜杠输入、ripgrep 运行与结果文本都不进入模型请求。该命令像其他人用命令一样通过纯日志的 `command/run` / `command/done` 事件对结算；没有任何内容加入会话 surface 或派生消息。

#### Token 影响

该命令不增加任何模型 token，无论有无匹配。

#### KV Cache 影响

该命令不触碰模型可见前缀，因此缓存复用不受影响。

## 已知限制与暂缓事项

- **仅字面搜索**——`/search` 只接受一个字面 pattern，不接受任何标志（无正则、include/exclude glob 或文件类型过滤）；这些场景保留给面向模型的 `grep` 工具的完整 ripgrep 表面。
- **固定界限**——200 匹配 / 16 KiB / 30 秒界限是协议常量，不是部署配置；更广的搜索范围靠更窄的 pattern、更少的参考项目集合，或模型的 `grep`/`bash` 工具。
- **无路径范围**——搜索根永远是会话工作区加上所有已附加的参考项目；按调用收窄路径或搜索根的过滤暂缓到有人用搜索确实需要时再做。
