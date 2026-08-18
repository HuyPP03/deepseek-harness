# @deepseek-ai/dsh-workspace-references

[English](README.md) | 中文

通过 `ctx.workspaceReferences`（[`WorkspaceReferenceService`](src/index.ts)）提供会话引用项目：会话除自身工作区（其 `header.cwd`，即主项目）之外，可附加用于对照的**只读**项目目录。

附加集合是整值日志状态：每次变更记录一条 `workspace/references` 事件，最后一条事件即当前集合。`set(session, paths)` 会规范化路径（realpath）、要求目录存在、去重、拒绝会话自身 cwd、按 `Config.maxReferences`（默认 2）截断；请求与当前集合一致时不追加事件。resume、fork 与 replay 随 seed 携带该集合，没有带外状态。

服务注册面向模型的 `workspace:references` prompt 上下文（order 115，紧随 `sandbox:policy` 的 110 之后）：固定的引导行加每条引用路径一行。空集合不渲染，因此附加或移除引用是本服务唯一的 prompt 变更。客户端从 `workspaceReferences` session-projection 键读取折叠集合与配置上限（未组合 projection 注册表时该键缺席，例如 headless 组合）。

引用永不作为可写根。现行沙箱策略已将写操作限制在会话工作区（加平台临时目录），而所有受限后端（bubblewrap、Landlock、Seatbelt）都允许读取其余文件系统，因此被接纳的引用目录可被 fs 工具与沙箱执行直接读取；本包不附带任何沙箱或文件系统 provider 变更。

## Model Experience

### 引用项目对照上下文

#### 模型看到的内容

会话存在引用时，每次组装含一个 `workspace:references` system prompt 段（order 115，在 `sandbox:policy` 之后）；集合为空时没有该段。不新增工具：引用用会话已有的文件工具读取。

##### 引用项目段

```markdown
Reference projects: these projects are attached to this session for comparison. They are read-only — never modify files under them; make changes only in the session workspace.
- /absolute/path/to/reference
```

#### Token 影响

固定引导行约 45 token，每条引用路径约 5-10 token，出现在每个请求的 system prompt 中；集合不变时跨 turn 字节稳定，空集合不贡献任何 token。

#### KV Cache 影响

该段位于固定位置（order 115，在 persona 与 `sandbox:policy` 上下文之后）。附加、移除或重排引用会从该点改写 system prompt，使下次组装的请求前缀缓存失效；无引用时 prompt 与未挂载本包的部署逐字节相同。

## Known Limitations and Deferred Work

- **上限是 service Config 字段** — Web UI 从 projection 读取，但部署方将 `maxReferences` 调高超出客户端渲染能力时，仍以 host 校验为准。
- **Subagent 子会话不继承引用** — 子代理获得带自身 seed 的新会话；需要引用项目的委派必须在任务文本中写明路径（延期：向子代理 seed 引用）。
- **引用路径仅在接纳时校验** — 目录后来被删除时事件保留（日志不可变）；随后读取以常规文件系统错误失败，prompt 渲染过期路径。
