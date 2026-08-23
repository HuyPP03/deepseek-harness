# dsh-connectors

English | [中文](README.zh.md)

The connector catalog and state machine: predefined connections (Notion, GitHub, Atlassian, Slack, Google, Microsoft 365, …) and user-authored custom connectors, each mounting one or more MCP servers through [`dsh-mcp-manager`](../../mcp/mcp-manager/README.md).

A connector is a manifest: the MCP server(s) it mounts, how it authenticates them, and the agent preset a session with it composes with. State is **derived at read time** from the authoritative seams — the credential store, the OAuth token store, the live MCP registry — so a connector can never claim a state the seams do not show.

## Manifest

Shipped manifests are YAML files in the configured catalog directory; custom connectors persist as JSON in the user directory.

```yaml
id: notion
name: Notion
description: Read and write Notion.
presetId: notion
workspaceDirName: notion
auth:
  - mode: token
    credentialRefs: [NOTION_API_TOKEN]
    howTo: Create an internal integration.
servers:
  - serverName: notion
    transport: stdio
    command: npx
    args: ['-y', '@notionhq/notion-mcp-server']
    env:
      NOTION_API_KEY: { $cred: NOTION_API_TOKEN }
suggestions:
  - Summarize my workspace
```

- `auth` lists `token` (one or more credential references), `oauth` (server URL, optional bring-your-own-app client), or `device` (login/verify tool names) methods. An empty list means the server needs no auth.
- Server `env`/`headers` values may be literals or the placeholders `{ $cred: REF }` and `{ $override: FIELD }`. A `$cred` reference passes through to the mounted server's document and mcp-client resolves it at every connection attempt from the credentials store (or, for an OAuth connector's bearer header, the token store as `Bearer <accessToken>`); a `$override` reference resolves at mount time from the connector's user override document (`url`, `clientId`, `products`, `orgMode`, `readOnly`). In YAML, write a placeholder as a mapping — `{ $cred: REF }` — not a quoted string.
- Every manifest is parsed strictly; an invalid manifest fails boot instead of being skipped.

## Service

`ctx.connectors` (`Connectors`):

| Operation | Meaning |
|---|---|
| `list()` | Every catalog + custom connector as a wire-safe view, sorted by id. |
| `get(id)` | One view, or `undefined`. |
| `manifest(id)` | The raw manifest (host-internal; views never carry commands, env, or URLs). |
| `setAuthorizing(id, inFlight)` | Flag an in-flight auth flow; the state reads `authorizing` while flagged. |
| `configure(id, fields)` | Store token/credential values and/or override fields. Auto-connects once a token method is fully configured; a failed mount records `lastError` instead of losing the stored values. |
| `connect(id, mode)` | Mount with a token; every declared credential reference must be stored first (`ConnectorCredentialMissingError` otherwise). `oauth` and `device` reject with `ConnectorAuthUnavailableError` until the flow engine lands. |
| `disconnect(id)` | Unmount, unset the connector's credentials, remove its token bundle, and delete its override document. |
| `addCustom(spec)` | Author `custom-<slug>`: copy the `custom` preset, persist the manifest, auto-mount when no auth is needed. |
| `removeCustom(id)` | Unmount, unset credentials, delete the manifest and the preset copy. Shipped ids are refused. |

The wire view is secret-free by construction: server entries carry `serverName`, `mounted`, and `status`; auth entries carry `mode`, `configured`, and user-facing hints — never values.

### State

`unconfigured` → `needs-auth` → (`authorizing`) → `connecting` → `connected` → `reconnecting`/`down`, plus `error` while a failed operation's `lastError` is pending. Derivation: a mounted server's status comes from the registry; a pending mount failure wins over a same-name registry view the connector does not own (a taken name shows `error`, not the squatter's status).

### Events

`connector/state(connectorId, state)` — emitted only when a connector operation or auth-flow transition changes the derived state. Registry status flips without a connector operation are not emitted; surfaces poll `list()`.

## Config

| Field | Default | Meaning |
|---|---|---|
| `catalogDir` | none | Directory of shipped `.yml` manifests; without it the catalog is custom-only. |
| `userDir` | `<harness home>/.connectors` | Custom manifests (`.json`, id-matched) and override documents. |
| `dshHome` | `$DSH_HOME` or `~/.dsh` | Harness home for the `userDir` default. |

Optional seams: `credentials`, `oauthTokens`, and `agentPresets` are consumed through `ctx.get`; an operation that needs a missing seam fails with `ConnectorSeamUnavailableError`, and reads still work without them.

## Interim behavior (until the auth-flow engine lands)

- `$cred` resolution lives in mcp-client: the persisted `.mcp` document keeps the reference, and every connection attempt resolves it from the credentials store or the OAuth token store, so a stored or refreshed value reaches the next attempt. `$override` still resolves at mount time (a boot-time snapshot of the user override document).
- OAuth and device flows have no engine in this phase: `connect(id, 'oauth'|'device')` rejects with a named error, and a byoApp OAuth method is "configured" once client id + secret are stored (state `needs-auth`).

## Model Experience

None, as a connected connector's tools are ordinary MCP tools under their `mcp__<server>__<tool>` names, the catalog and states never enter a prompt, and `configure`/`connect`/`disconnect` are host operations, not model tools.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- **Boot-time credential failures surface as server down** — a mounted server whose document references an unconfigured credential fails its mcp-client connection attempts (reconnect backoff, state `down`); the product-level guard (`connect`'s pre-check) fails loud before a mount, so this only reaches a server whose credential was unset out from under it.
- **No OAuth or device engine** — the `connectors/oauth-flow` package (loopback callback + code-paste fallback) and the M365 device-code loop land in later phases.
- **Polling for passive state** — registry flips without a connector operation (a server dropping, reconnecting) are visible on the next `list()`; no event is emitted for them.
- **Overrides are a boot-time snapshot** — external edits of the override documents are not hot-reloaded.
- **`lastError` is in-memory** — a failed mount's message survives until the next successful operation, not across restarts.
