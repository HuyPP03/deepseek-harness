# DeepSeek Harness

[English](README.md) | 中文 | [Tiếng Việt](README.vi.md)

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它通过浏览器 Web UI、命令行与 Python SDK 在你的项目上运行智能体。架构是**一切皆插件**：每项能力——工具、模型适配器、沙箱、UI 面板——都是插件，在启动时组合成一份部署；同一份组合在所有界面下原样运行。

底层框架是 [Cordis](https://github.com/cordiverse/cordis)，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

## 开发者预览

DeepSeek Harness 目前处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

## 功能

- **在你的项目中工作。** 会话锚定到一个工作区目录；智能体读写文件、运行持久 shell 会话，并在浏览器中规划多步任务。
- **对照只读引用项目。** 一个会话可附加最多两个额外项目目录作为模型的只读对照上下文；完全不选项目的聊天是一个普通会话，运行在你启动 `dsh` 的目录。
- **接入任意模型。** DeepSeek 开箱即用；可添加 Anthropic、OpenAI 与任意 OpenAI 兼容网关，支持按会话选择模型。
- **保持掌控。** 权限策略在敏感操作前询问，受限执行运行在平台沙箱之后，只允许写入会话工作区。
- **自动化。** Python SDK 与 Agent Client Protocol 服务让你的代码驱动同一份组合出的智能体。
- **扩展。** 用 TypeScript 编写插件——工具、模型适配器、服务与 UI 面板——通过一份组合文件加载。

## 需求

- 一个 DeepSeek API key，或另一个[受支持的提供商](docs/user/guide/providers.md)的凭据。
- 从 `npm` 运行：Node.js，在 Linux 或 macOS 上。
- 从源码运行：Node.js `^22.19 || >=24` 与 `pnpm`。
- 使用 Python SDK：Python 3.10 或更新版本，Linux x64/arm64，或 arm64 上的 macOS 14 或更新版本。

## 运行

### 通过 `npm` 运行

安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令会启动 Web UI，默认地址为 `http://127.0.0.1:3080`。详见 [Web UI 指南](docs/user/guide/index.md)。

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

### 首次步骤

服务器运行后，打开 **设置 → 模型** 并保存 DeepSeek API key。选择一个或多个项目目录作为会话工作区——外加最多两个只读引用项目，或完全不选项目以进行普通聊天——然后发送第一个任务。[Web UI 指南](docs/user/guide/index.md)逐步讲解每个步骤。

## 文档

| 从这里开始 | 内容 |
|---|---|
| [使用 Web UI](docs/user/guide/index.md) | 模型配置、选择工作区、运行与续接会话 |
| [配置模型](docs/user/guide/providers.md) | DeepSeek、目录提供商、自定义 OpenAI 兼容端点 |
| [Python SDK](docs/user/guide/python-sdk.md) | 从你自己的 Python 程序驱动同一智能体 |
| [插件开发](docs/user/develop/basic/index.md) | 你的第一个插件、工具、配置、发布 |
| [框架指南](docs/user/develop/framework/index.md) | 插件生命周期、服务与事件系统 |
| [架构](docs/architecture.md) | harness 如何组合；修改 `packages/` 前必读 |
| [Cordis 入门](docs/cordis-primer.md) | `dsh` 所构建其上的插件框架 |

## 工作原理

三个思想承载了设计：

- **一切皆插件。** 工具、模型适配器、沙箱与 UI 面板都是插件；`cordis.yml` 组合决定一份部署挂载什么。插件在共享上下文上注册能力，插件卸载时所有注册自动清理。
- **会话即日志。** 会话是类型化事件的只追加日志。resume、fork 与 replay 从该日志重建会话，模型能看到的一切都可从日志重建。
- **能力而非命令。** 如 Bash 执行这样的能力拆分为 Service Definition、Service Provider 与 Consumer，使实现可通过配置替换。

[架构文档](docs/architecture.md)按顺序映射组合结构，[cookbook](docs/cookbook/adding-a-package.md)在你添加包、工具或插件时逐步指导。

## 社区与支持

- 欢迎通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群：扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="assets/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="assets/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="assets/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开发

请先阅读[开发指南](docs/development.md)与[架构文档](docs/architecture.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
