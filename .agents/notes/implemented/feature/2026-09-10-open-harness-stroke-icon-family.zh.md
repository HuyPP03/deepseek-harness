# Agent Note: Open Harness 描边图标族

Status: implemented

[English](2026-09-10-open-harness-stroke-icon-family.md) | 中文

## 问题

`ui-primitives` 图标集是一堆 Figma 填充路径提取（一个 deepsuite 批次加上仅 harness 的 figma 提取），每个视觉重量都不同：实填充形状、部分带 20% 内填充，以及一个带遮罩的目标图标。在品牌红仪表盘刷新之后，这些混合的填充图标比周围的线描 chrome（按钮、卡片、边框）更重，割裂了产品的视觉统一性。

## 决策

把每个图标重绘为同一个描边族：单一 1.5px `currentColor` 描边、圆头端点与圆角拐角，各自画在自己的原生 viewBox 上，使整套图标在任何尺寸下都呈现一致的线宽。共享的 `Frame`（描边）与 `FillFrame`（填充）辅助函数承载公共的 svg 属性；每个图标只提供自己的内部几何。

- 填充图标保留 `currentColor` 填充：`*Fill` 变体（Stop、Like、Dislike、TriangleRight、Close）、`Sparkle16`，以及双色 `FolderOpen16`（描边上叠一块 25% 透明度的背板）。
- 名称、默认绘制尺寸与 `IconProps` `{size, className}` 契约保持不变；颜色仍走 `currentColor`，任何图标都不硬编码调色板。
- 任何图标都不使用文档级全局 `id` 或 `clip-path`，因此实例可自由组合（原先带遮罩的目标图标现在是单纯的同心圆环）。
- 整套共 78 个图标：仪表盘刷新前已有的 69 个，加上刷新期间新增的 9 个（三个 18px 仪表盘主图标、统计图、自定义 subagent，以及四个文件类型标记），全部用同一套描边语言重绘。

## 备选方案

**只把现有 Figma 填充调向红色强调，而不重绘。** 否决：问题在于混合的填充重量与视觉统一性，而非颜色；只调色会保留厚重的实心图标。

**采用第三方描边图标集（Lucide / Feather / Tabler）。** 否决：产品图标是自有的（agent preset、tree corner、仪表盘主图标、文件类型标记），没有任何图标库携带它们；换库仍会需要自定义补充，并且会混合两个视觉来源。

**逐一手调每个图标的描边而不共享 frame。** 否决：78 个独立 svg 的线宽与端点样式会各自漂移；共享 frame 把族的契约固定在一处。

## 后果

- 图标集在侧边栏、仪表盘、工具卡片与详情栏中呈现为一致的线族。
- `icons.client.spec.tsx` 断言 78 个图标的数量、逐图标默认尺寸、`currentColor` 且无硬编码调色板，以及无 id/clip-path 的目标图标。
- `ui-primitives` README（en + zh）现在称作「描边图标族」，而非 `ic_ds_*` Figma 图标集。

## 相关

- [Open Harness 仪表盘、暗色调色板与品牌红色强调](2026-09-10-open-harness-dashboard-and-red-accent.md) — 本次刷新新增九个图标并入此族所跟随的强调色刷新。
- [Open Harness 详情、文件检查器与终端 chrome](2026-09-10-open-harness-details-terminal-chrome.md) — 本线宽所对齐的 chrome。
- [Web 样式系统](../process/2026-07-19-web-styling-system.md) — 本图标族遵循的禁止字面颜色规则。
