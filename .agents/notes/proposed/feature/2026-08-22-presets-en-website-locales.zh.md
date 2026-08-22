# Agent Note: 随附预设、GUI 文档与文档站点改用英语

Status: proposed

English | [中文](2026-08-22-presets-en-website-locales.md)

## Problem

客户端 locale 规范已在 [locale 集合注记](2026-08-22-client-locale-en-first-vietnamese.md)中翻转为英语优先，但三个产品表面仍以中文为默认：五个随附 agent preset 在 `preset.yml`（`dsh preset list`、preset 复制流程与参考文档背后的事实来源）里以中文发布显示名与描述；组装后的 GUI 文档声明 `lang="zh-CN"`；文档网站在根路由提供中文、`/en/` 下提供英文，产品文档的默认落地语言是中文。

## Proposal

**随附预设承载英语产品文案。** 五个 `preset.yml` 的 `name` 与 `description` 字段改为客户端 locale 表 `en` 列已有的英文字符串。系统 preset 的 GUI 显示不受影响——`trust: 'system'` 行仍由本地化表覆盖文件元数据——所以变动的是文件派生表面：CLI preset 列表、复制流程（复制一份随附 preset 现在继承英文描述；authoring e2e 已固定该断言）与参考文档。中文 locale 的浏览器仍从表中看到本地化名。

**GUI 文档改为英语。** `apps/web/index.html` 声明 `lang="en"`。客户端样式与 PWA manifest 均不按文档语言分支，翻转除声明语言外无渲染后果。

**首个越南语 web 测试表面。** 全新 Host home 上的 `vi-VN` 浏览器启动进入越南语设置表面（无已存偏好时，临时 locale 跟随 navigator），Language 行循环全部三种 locale——English、中文、Tiếng Việt——每次切换实时本地化设置文案，并把显式选择持久化到 Host 设置文档。

**文档网站根路由改为英语。** 两 locale 清单（root = 中文、`/en/` = 英文）变为三 locale：根路由提供英文源，中文移到 `/zh/`，新增 `/vi/` locale。旧 `/en/` 地址直接落到根路由，不做重定向垫片——预发布立场把兼容垫片留给真实存在的消费者，而该站点没有这样的消费者。每个 `/vi/` 路由在越南语文档波次落地 `.vi.md` 文件之前有意投影英文源；清单既有规则（缺少译文时投影可用源而非复制 Markdown）承载这座桥，vi 侧栏 chrome 为越南语、标签镜像英文。

## Related

- [客户端 locale 英语优先：三种语言、英语为默认与键源](2026-08-22-client-locale-en-first-vietnamese.md)——locale 集合、en 键源规范与 en 回退；本注记在 preset、文档与网站表面上完成它。
- [Quickstart 文档首页](../../implemented/simplification/2026-08-11-quickstart-documentation-home.md)——其 locale 根重定向机制保留；其路由事实已就地更新以反映 `/en/` 迁移。

## Alternatives considered

- **保留中文 preset 文件、仅本地化 GUI**：GUI 本就通过表本地化系统 preset；文件派生表面（CLI 列表、复制出的用户 preset、参考文档）会停留在中文，与英语的产品文案规范相悖——文件派生表面的事实来源必须与规范一致。
- **保留 `/en/` 作为根路由的重定向别名**：为没有外部消费者的地址做兼容垫片；预发布立场拒绝首个正式版本必须携带的垫片。
- **等越南语文档落地再加 `/vi/` locale**：产品声明三种语言期间，切换器停留在两向；vi locale 的 chrome 与集合会随内容一起发布而非先行就位；清单的投影规则使 vi 树可以廉价地预先就位。
- **vi locale 在文档落地前使用英语 chrome**：locale chrome 正是 locale 的意义——选择了 Tiếng Việt 的越南语浏览器，即使页面内容仍是投影的英文源，也应读到越南语的导航、页脚与搜索字符串。

## Acceptance criteria

- 五个 `preset.yml` 为英文；preset authoring 复制流程继承英文描述（e2e 固定），zh GUI 表不变。
- 全新 `vi-VN` 浏览器启动进入越南语设置表面，三 locale 循环持久化每次显式选择（e2e 场景 `language-locale.e2e.ts`）。
- 站点根路由提供英文源；`/zh/` 提供中文源、`/vi/` 提供投影的英文源；`website:build`（兼作死链检查）为绿。
- 阶段验收阶梯为绿：`test:gui`、`typecheck`、`DSH_SNAPSHOT=replay pnpm run test:web`、`doc-sync`、`website:build`、`verify-translation-pairing` 与 `lint`。
- 拉取请求内嵌一张语言切换 GIF（English → Tiếng Việt → 中文），从该请求自身的 commit 录制。

## Risks

- 旧 `/en/` 地址翻转后 404；预发布立场接受这一点（尚无外部消费者），首个版本说明应载明该迁移。
- 越南语读者在 vi 文档波次到来前读到的是越南语 chrome 下的英文内容；切换器诚实地标注 locale，投影规则是清单对缺少译文的既有回答。
- 复制一份随附 preset 会以英文描述起步；中文用户的新 preset 继承英文元数据，可就地编辑。
