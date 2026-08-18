# DeepSeek Harness

English | [中文](README.zh.md) | [Tiếng Việt](README.vi.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It runs an agent on your projects through a browser-based Web UI, a command line, and a Python SDK. The architecture is **everything is a plugin**: every capability — tools, model adapters, sandboxes, UI panels — is a plugin composed into a deployment at startup, and the same composition runs unmodified in every interface.

The framework underneath is [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## What it can do

- **Work in your projects.** A session anchors to a workspace directory; the agent reads and edits files, runs persistent shell sessions, and plans multi-step tasks in the browser.
- **Compare read-only reference projects.** A session can attach up to two additional project directories as read-only comparison context for the model; a chat with no project at all is a plain session that runs in the directory where you started `dsh`.
- **Bring any model.** DeepSeek works out of the box; Anthropic, OpenAI, and any OpenAI-compatible gateway can be added, with per-session model selection.
- **Stay in control.** A permission policy asks before sensitive operations, and confined execution runs behind a platform sandbox that writes only to the session workspace.
- **Automate it.** The Python SDK and the Agent Client Protocol server drive the same composed agent from your own code.
- **Extend it.** Write plugins in TypeScript — tools, model adapters, services, and UI panels — and load them through one composition file.

## Requirements

- A DeepSeek API key, or credentials for another [supported provider](docs/user/guide/providers.md).
- To run from `npm`: Node.js, on Linux or macOS.
- To run from source: Node.js `^22.19 || >=24` and `pnpm`.
- To use the Python SDK: Python 3.10 or newer on Linux x64/arm64, or macOS 14 or newer on arm64.

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI, served at `http://127.0.0.1:3080` by default. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

### First steps

Once the server is running, open **Settings → Models** and save a DeepSeek API key. Choose one or more project directories as the session workspace — plus up to two read-only reference projects, or no project at all for a plain chat — and send your first task. The [Web UI guide](docs/user/guide/index.md) walks through each step.

## Documentation

| Start here | What it covers |
|---|---|
| [Use the Web UI](docs/user/guide/index.md) | Model setup, choosing a workspace, running and continuing a session |
| [Configure models](docs/user/guide/providers.md) | DeepSeek, catalog providers, custom OpenAI-compatible endpoints |
| [Python SDK](docs/user/guide/python-sdk.md) | Drive the same agent from your own Python program |
| [Plugin development](docs/user/develop/basic/index.md) | Your first plugin, tools, configuration, publishing |
| [Framework guide](docs/user/develop/framework/index.md) | Plugin lifecycle, services, and the event system |
| [Architecture](docs/architecture.md) | How the harness is composed; read before changing `packages/` |
| [Cordis primer](docs/cordis-primer.md) | The plugin framework `dsh` is built on |

## How it works

Three ideas carry the design:

- **Everything is a plugin.** Tools, model adapters, sandboxes, and UI panels are plugins; a `cordis.yml` composition decides what a deployment mounts. Plugins register capabilities on a shared context, and every registration is cleaned up automatically when the plugin unloads.
- **Sessions are logs.** A session is an append-only log of typed events. Resume, fork, and replay rebuild the session from that log, and anything the model can see is reconstructable from it.
- **Capabilities, not commands.** A capability such as Bash execution splits into a Service Definition, a Service Provider, and a Consumer, so implementations are replaceable through configuration.

The [architecture documentation](docs/architecture.md) maps the composition in order, and the [cookbook](docs/cookbook/adding-a-package.md) guides you step by step when you add a package, tool, or plugin.

## Community and support

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
