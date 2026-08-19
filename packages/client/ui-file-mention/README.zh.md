# @deepseek-ai/dsh-client-ui-file-mention

[English](README.md) | 中文

Web 文件引用（file mention）source 插件：向 `ctx.inputTriggers` 注册 `@` file source。候选来自按会话寻址的 `files.list` RPC——宿主解析会话的项目 cwd 与其已附着的 reference 项目，用实时 query 过滤并排序，客户端从不提交路径。选中某一行会在 draft 中落入纯文本 `@<path> `（plain-text-reference 决策：prompt 发送同一字面量，user message 即 session log）。菜单显示简短的展示形式——workspace 为 `rel/path`，reference 为 `rootname/rel/path`，目录带结尾斜杠；pick 通过 settled 缓存映射回插入形式，缓存被清空后退化为展示形式。

插入形式按 root 区分：主项目条目插入 workspace 相对路径（模型以自身 cwd 寻址 workspace），reference 条目插入规范绝对路径（它位于模型 cwd 之外，而所有 confined mode 下读操作不受限），目录附加结尾斜杠——纯文本惯例，把这次选取标记为文件夹。拉取按 (session, query) key 缓存：browse key（空 query）保持 15 秒 TTL——文件树没有变更推送，短 TTL 用于限制陈旧度——实时 query 以 2 秒 TTL 重新拉取；新的实时 query 会中止该会话先前的在飞实时拉取。scope 出生时 warm 预热 browse key，失败拉取不污染 key，`connection/reset` 清空全部。subagent scope 不列任何内容。

## Model Experience（模型体验）

### user message 中的 `@<path>` 引用

#### 模型看到什么

选中的引用以字面量 `@<path>` 文本进入普通 user message——没有专用块、没有宿主侧解析、没有 prompt section。模型将其读作文件或目录路径引用，并用其 file 工具处理。

#### Token 影响

条件性且仅追加：引用只向其所在的新的 user message 增加路径 token。菜单浏览与过滤不增加任何模型 token。

#### KV Cache 影响

仅追加。本包从不修改先前请求的 token。

## Known Limitations and Deferred Work（已知限制与延期工作）

- **draft 中无 chip 装饰**——输入机器的 text-reference 扫描器只匹配类词名（不含点号或斜杠），文件路径不会点亮为 plain-text reference；扩展扫描器属于输入机器变更。
- **列表陈旧度最长 15 秒 browse TTL（实时 query 为 2 秒）**——没有 fs-watch 推送；创建、重命名或删除的文件在 TTL 后进入下一次拉取。
- **有界遍历，静默截断**——`files.list` 最深遍历 8 层、跨 root 至多扫描 20000 个条目、返回至多 100 行，跳过所有点前缀条目与 `src/files-skip.json` 中的目录清单（node_modules、依赖缓存、虚拟环境、构建产物）以及符号链接，以 `truncated` 报告而无菜单错误层；菜单至多 50 行。
- **仅名称，无内容搜索**——query 过滤条目名（basename 前缀 优于 路径前缀 优于 子串）；不读取任何文件内容。
