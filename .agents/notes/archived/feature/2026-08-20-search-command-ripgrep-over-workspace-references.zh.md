# Agent Note: `/search` —— 在会话工作区与其参考项目上跑字面 ripgrep

Status: implemented
Archived: 2026-08-21

[English](2026-08-20-search-command-ripgrep-over-workspace-references.md) | 中文

## 问题

在会话中工作的用户没有一条快速的文本命令能在项目里找到某个字符串出现在哪里：面向模型的 `grep` 工具是留给模型轮次用的，通过提示词绕道用它要花一个轮次、一次请求、一段等待——而问题只是“哪个文件里有这句话？”。会话自身状态其实已经指明了人期望这样的搜索覆盖的地方——header 里的项目目录，以及附加到会话的参考项目——但没有任何东西把它们暴露成一行搜索。

## 决策

新增 host 包 `@deepseek-ai/dsh-command-search`，向 `ctx.commands` 贡献 `/search <字面文本>` 命令，挂载在 `standard` 与 `code` agent 预设中（`chat` 预设没有可搜索的项目目录，因此不挂载）。处理器仅从会话状态解析搜索根——先取 header 的 `cwd`，再取 `referencesOf` 从会话日志重放的参考集——并通过 `ctx.subprocess` 用固定、防御性的 argv 运行一次打包的 ripgrep 二进制（[`@vscode/ripgrep`](../architecture/2026-08-01-packaged-ripgrep-search.md)，与 grep 工具一样惰性解析）：`--no-config --fixed-strings -H --line-number --max-count 200 -- <pattern> <roots...>`，pattern 永远在 `--` 之后，因此永远不会被读成标志。

结果从三个方向限界，并折叠成 `path:line: text` 行：至多 200 条匹配（以 ripgrep 的每文件 `--max-count` 镜像）；折叠文本守住 16 KiB UTF-8 字节预算（单条超长行被截到该预算并加 `… (line truncated)` 标记；多条行放不下时从尾部重新折叠并加 `showing N of M matches` 说明）；以及一个 30 秒截止期，把发起分发的 UI 的取消汇入 ripgrep 进程树。ripgrep 退出码 1 是无匹配的成功；其他退出码是直接错误，携带裁剪后的 stderr 尾部；原始 stdout 超过 256 KiB 保留上限的运行以“收窄 pattern 或搜索根”的错误失败，而不是解析一个不完整的流。显示路径在项目目录内相对工作区，其余按原样。

取消及其 `command/done` 结算归命令执行器所有，不归处理器所有：被中止的请求记录该中止并通过汇入信号杀死进程树，处理器自己的中止检查只用于归类与中止竞态的启动失败。插件在处置前等待在途处理器结算，与 `command-compact` 一致。

## 曾考虑的替代方案

- **接受标志的搜索（正则、glob、文件类型）。** 暂缓。人用的一行命令要的是字面“找这个字符串”；面向模型的 `grep` 工具保留完整 ripgrep 表面，给人用命令加标志是为模型已经拥有的场景买复杂度。
- **只搜会话 cwd、忽略参考项目。** 否决。会话自身状态已向模型广告它的参考项目；一个悄悄跳过会话所附加项目的搜索会回答与模型 `grep` 在同一工作区上不同的问题。
- **从命令复用模型面向 `grep` 工具的执行器。** 否决。那个执行器绑定工具执行（schema、策略管线、spill 文件、模型面向呈现）；人用命令需要不同的结果表面与不同的界限，一个薄的、命令自有的 `ctx.subprocess` 运行删除的耦合比它能带来的更少。

## 后果

- `/search` 是 host 命令：它出现在组合了挂载它的预设的每个命令适配器上（CLI 与 Web 皆有）；没有命令适配器的自动化接口没有任何人用命令。
- 搜索按构造只读（ripgrep 从不写），因此不需要权限预设，除了 subprocess provider 自身策略外也没有沙箱考量。
- `@vscode/ripgrep` 成为命令包的直接依赖；其平台包解析保持惰性，因此损坏的可选平台安装会让第一次搜索以普通命令错误失败，而不是让 Loader 组合失败——与模型面向 grep 工具同一地位。
- 200 匹配 / 16 KiB / 30 秒界限是协议常量，不是部署配置；暂缓的更广搜索路径是更窄的 pattern、更少的参考项目，或模型的 `grep`/`bash` 工具。
- 命令在 agent 旁边结算：斜杠输入、运行与结果文本都不进入模型请求，因此不增加 token，也不触碰模型可见前缀或缓存复用。
