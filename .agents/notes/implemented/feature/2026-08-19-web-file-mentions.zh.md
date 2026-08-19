# Agent Note：Web 文件引用（files.list 之上的 @ source）

Status: implemented

[English](2026-08-19-web-file-mentions.md) | 中文

## Problem（问题）

用户在 composer 中引用文件时没有任何选取途径：`@` 触发符上只有 subagent source，而手敲路径既容易出错，在文件位于会话 cwd 之外的已附着 reference 项目时更无法解析。模型需要一个可以交给其 file 工具的路径，且路径形式必须按 root 区分——主项目用 workspace 相对路径，reference 用绝对路径。后续报告：长深层路径会让菜单消失、目录无法引用——结果边界在路径所在子树被遍历到之前就切断了目录，且遍历仅含文件。

## Decision（决策）

新增 `files` RPC 域（按会话寻址，`files.list`），以及新的客户端插件 `ui-file-mention`，在既有 input-trigger 管线上注册 `@` `files` source。

- **宿主侧**——`packages/host/apiproxy`：`files.list({ sessionId, query? })` 在宿主侧解析会话工作集——`session.header.cwd` 加上 `referencesOf(session)`（从会话日志折叠出的 reference 集合）——并按 wire 契约的固定边界遍历：深度 8（即使前缀剪枝下也相对 root）、至多 20000 个已扫描条目（病态树以 `truncated: true` 停止）、至多 100 行结果。遍历列出文件**和目录**，应用噪声规则（所有点前缀条目加上 `src/files-skip.json` 中的目录 basename 清单：node_modules、依赖缓存、虚拟环境、构建产物），绝不跟随符号链接（防环；悬空链接不命名任何工作集条目）。边界是契约的协议常量，不是部署可调参数；跳过清单是可编辑的数据而非逻辑。遍历只读元数据（不读内容），运行于宿主进程、在 agent 沙箱之外。消失或不可读的 root 记为空而非令列表失败。请求的 abort signal 在下一个目录边界取消遍历（被取代的击键或断连不得让宿主继续遍历）。
- **宿主侧 query**——客户端的实时 `@` token 是 `query` 过滤串，绝不是宿主会解析的路径：它过滤并排序遍历自身的枚举结果（大小写不敏感、分隔符归一——'/' 与 '\' 相同：basename 前缀 优于 路径前缀 优于 子串；同分者取更短、再按字节序字典序的相对路径），因此即使树超过结果边界，长深层路径也能命中——query 遍历运行到其自然终点（只有扫描边界与深度边界会停），100 行边界在排序后才施加，因此 walk-order 上的弱头部不会把更高排序的匹配挤出扫描。以分隔符结尾的 query 是目录前缀意图：在把前缀验证为安全相对路径（无 `..`、无绝对、无空段）之后，遍历剪枝到该子树，并先列出前缀目录本身。中段路径 query（无结尾分隔符）保持全扫描——子串匹配可能位于树的任何位置。
- **Wire**——`FileEntry { path, relative, root, isDirectory }`，`root` = `'workspace'` 或 reference 的 basename；与 `skill.list` 一样按会话寻址（客户端从不提交路径；不创建或恢复任何 Agent）。
- **客户端**——`packages/client/ui-file-mention`（仅 browser half）：一个 source，`trigger: '@', name: 'files'`。候选把修剪后的实时 query 发给宿主，并对返回窗口在本地重排（宿主已过滤）。菜单显示简短的展示形式——workspace 为 `rel/path`，reference 为 `rootname/rel/path`，目录带结尾斜杠；`onPick` 通过 settled 缓存映射回**插入形式**，落入纯文本 `@<path> `：主项目用 workspace 相对路径（模型以自身 cwd 寻址 workspace），reference 用规范绝对路径（位于模型 cwd 之外；所有 confined mode 下读操作不受限），目录附加结尾斜杠（纯文本惯例，把这次选取标记为文件夹）。缓存被清空后退化为展示形式。
- **缓存**——每个 (session, query) key 一个单飞拉取：browse key（空 query）保持 15 秒 TTL（文件树没有变更推送）；实时 query 以 2 秒 TTL 重新拉取。新的实时 query 会中止该会话先前的在飞实时拉取。scope 出生时 warm 预热 browse key；失败拉取不污染 key；`connection/reset` 清空全部。subagent scope 不列任何内容。
- **菜单标题**——管线既有 `slash.menu` locale namespace 中的 `files` key（`Files` / `文件`）；组标题按 source 名开放式查表。

## Consequences（后果）

- 选中的引用以字面量 `@<path>` 文本进入普通 user message 供模型读取——plain-text-reference 决策（[Web 输入机器与 slash 管线](../architecture/2026-07-25-web-input-machine-and-slash-pipeline.md)）：无专用块、无宿主侧解析、无新 session event、无 prompt section、不推动 `SESSION_FORMAT_VERSION`；message 即 log，因此"模型可见 ⟺ 已记录"在既有表面上成立。
- `files.list` 遍历在宿主侧且只读元数据：它向浏览器暴露条目名（从不暴露内容），点前缀跳过规则把秘密文件（`.env` 一类）挡在引用选择器之外。
- Web GUI 获得第三个触发 source 组；fixture API client 提供静态四行工作集（含一个目录行）供离线验收。
- 已知限制：无 chip 装饰（输入机器的 text-reference 扫描器只匹配类词名——不含点号或斜杠——路径永不点亮；扩展扫描器属于输入机器变更）、browse 最长 15 秒陈旧度（实时 query 为 2 秒）、遍历静默截断（无菜单错误层）、无内容搜索（仅名称）。

## Alternatives considered（已考虑的方案）

- **复用 `host.listDirectory`**：它是在 `browse` 能力下由客户端提交原始路径的逐层浏览器列表——与按会话寻址的引用 source 的取向相反，且深度 8 的树需要许多次顺序往返。
- **客户端过滤无界目录**：初始设计；1000 条目边界把深层路径切出目录（即被报告的菜单消失 bug），且每次击键向浏览器发送整棵树扩展性差。宿主侧过滤把 wire 保持在 ≤ 100 行，同时深层路径可命中。
- **带 codec 的 `ReferenceInsert` chip**：chip 能给出带样式的出现位置，但纯文本路径是 skill source 的先例，无需 codec，且作为普通 message 文本可在重放中存活。
- **通过 source lexicon 做 chip 装饰**：text-reference 扫描器的名称模式（`[\\w-]+`）无法匹配文件路径，lexicon roll 永不点亮；现在实现它只是死重（已知限制记录了后续跟进）。
