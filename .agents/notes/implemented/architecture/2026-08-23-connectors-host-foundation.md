# Agent Note: Connectors — predefined external connections as a state machine over MCP servers

Status: implemented

English | [中文](2026-08-23-connectors-host-foundation.zh.md)

## Problem

Predefined external connections (Notion, GitHub, Atlassian, Slack, Google, Microsoft 365) need a host-side identity before the chat-screen UI and API verbs can exist. Without one, each external MCP server is just another manual mcp-client mount: its secrets sit as literals in a `.mcp` document, nothing records which server belongs to which product concept, and no per-connector state distinguishes "not configured" from "configured but auth failed".

## Decision

A `connectors/` package group ships the host-side foundation in two packages:

- `@deepseek-ai/dsh-connectors` (`packages/connectors/connectors`) — the `Connectors` service registered as `ctx.connectors`: a YAML catalog (shipped `catalogDir` + user `userDir` under the harness home), per-connector configured and override documents, and a state machine over the ids.
- `@deepseek-ai/dsh-credentials-oauth-tokens` (`packages/credentials/oauth-tokens`) — a file-backed OAuth token bundle store at `<harness home>/.connectors/oauth-tokens.json`.

The state machine is the product vocabulary: `unconfigured | needs-auth | authorizing | connecting | connected | reconnecting | down | error`. State derives from what other services already know — mcp-manager's registry (mounted), the configured document, the in-memory `lastError` — and `connector/state` fires only on a transition.

Ownership stays with the existing services: mcp-manager/mcp-client owns mounting and live status, credentials-local owns secrets, oauth-tokens owns token bundles, agent-presets owns preset copy/remove. `Connectors` owns the catalog, the documents, the state derivation, and the events. Mount failures (`McpServerExistsError`) become `lastError` plus `error` state instead of a thrown operation; a credential slot with no stored secret throws `ConnectorCredentialMissingError` at the earliest resolvable point.

Interim decisions, documented in the package READMEs until the later phases land:

- Secrets are inlined into the generated `.mcp` documents. The `{$cred}` placeholder seam in mcp-client (with bearer-from-oauth-tokens) arrives in P1.
- `connect()` for `oauth` and `device` methods throws `ConnectorAuthUnavailableError`; `setAuthorizing` is the P3 oauth-flow engine's seam.
- A custom without auth auto-mounts at `addCustom`; `lastError` is in-memory only; override documents are a boot-time snapshot.
- The token store is passive (no timers) and mirrors the credentials-local storage discipline: `0600` file under `0700`, cross-process writer lock, chokidar hot-publish, wholesale snapshot replacement.

Mechanical pins: `tsconfig.base.json` gets explicit `paths` entries for both new packages plus a `./packages/connectors/*/src` wildcard group. The connectors tests `vi.mock` the MCP SDK without declaring it, resolving through mcp-client's own dependency — an extra devDependency there would trip knip without changing the mock identity.

The wire surface sits in `packages/host/apiproxy`: seven `connector.*` unary methods (`list`, `configure`, `connect`, `complete`, `disconnect`, `add`, `remove`) over the service. `list` is structurally secret-free and answers with an empty roster when the deployment composes no connectors service; the mutating verbs report `connector-unavailable` in the same case. The service's named rejections narrow to stable codes (`connector-not-found`, `connector-exists`, `connector-not-custom`, `connector-credential-missing`, `connector-override-missing`, `connector-auth-unavailable`), and plain rejections plus seam-missing reports fall to `internal` and `connector-unavailable`. `complete` is the store-and-connect half of the auth flow: until the P3 flow engine lands it is the same operation as `configure` with `{ token }`. A mutating verb re-reads the view after its commit and returns it, so a client updates one row without a roster round trip. The browser carrier pins the six mutating verbs to loopback same-origin requests — the `host.pickDirectory` privileged set — because `configure`/`complete` carry credential values and `add`/`remove` write manifests that may hold secrets, while `list` stays ordinary: its rows carry no secret, and the chat surface needs the roster.

The app composition mounts the service in the base bundle layer and patches in the shipped catalog root: `apps/cli`'s profile boot resolves `config/connectors/` (six manifests — `notion`, `github`, `google`, `slack`, `atlas`, `m365`) as the `catalogDir` overlay, while the writable `userDir` stays the service's own harness-home default. `apps/cli/tests/shipped-connectors.spec.ts` pins a real profile boot of that catalog on an OS-assigned port, because one malformed manifest fails the whole profile at boot.

## Alternatives considered

**Extend mcp-manager with per-connector state.** Rejected: mcp-manager's contract is a name-unique registry plus lifecycle; needs-auth/authorizing/error semantics are product concerns and would leak into a generic mechanism.

**Put token bundles in credentials-local.** Rejected: token bundles have different invariants (owner-keyed, `expiresAt`/`tokenEndpoint` fields, refresh semantics) and a different event (`oauth-tokens/updated`); a separate store keeps both schemas strict.

**Store connector secrets in per-connector documents.** Rejected: credentials-local is the single canonical secret store; a second store splits the trust model.

**Emit on every state evaluation.** Rejected: transition-only events keep the log quiet across reconnect churn; consumers that need a fresh value call `list()`.

## Consequences

The product now has an external-connection identity (id, state, lastError, documents), the API verbs that drive it (`connector.*`), and the shipped catalog the CLI boots — testable without a live MCP server, with the chat screen (P0b) as the remaining consumer. The costs: literals in persisted `.mcp` documents until P1, `lastError` lost on restart, and boot-time-only override reload. Both packages sit at 100% per-file coverage with watcher and drain specs mirroring the credentials-local patterns (faked chokidar, gated atomic write).

## Related

- [MCP client auto-reconnect](../feature/2026-08-06-mcp-client-auto-reconnect.md) — the reconnect policy behind `reconnecting`/`down`.
- [Provider credential lifecycle](../bug-fix/2026-08-06-provider-credential-lifecycle.md) — the secret-storage discipline the token store mirrors.

Deferred, in order: P0b ui-sidebar store + `client/ui-connectors`, P1 `{$cred}` in mcp-client, P3 oauth-flow engine, P4 device-code, P5 custom-connector UI.
