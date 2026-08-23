# dsh-credentials-oauth-tokens

English | [中文](README.zh.md)

File-backed store for OAuth token bundles: one JSON document, one owner at a time, no expiry of its own.

The document is a strict JSON mapping of owner id to token bundle:

```json
{
  "notion": {
    "accessToken": "…",
    "expiresAt": 1754000000000,
    "tokenEndpoint": "https://api.notion.com/v1/oauth/token",
    "refreshToken": "…",
    "scope": "search:read page:read",
    "createdAt": 1753900000000,
    "updatedAt": 1753900000000
  }
}
```

An owner id outside the store's id shape (`[a-z0-9][a-z0-9-]{0,31}`), a bundle without a non-empty access token, a non-finite `expiresAt`, a missing `tokenEndpoint`, or an empty optional field is rejected rather than skipped — a silently unparseable bundle would read as "the token I stored has no effect". Deviations fail loud at boot and warn-and-keep-the-last-good-snapshot on a live reload.

The store is passive: it never refreshes, expires, or deletes a bundle on a timer. The owner — a connector auth flow — re-puts a refreshed bundle or removes it, and consumers read the current bundle at each use, so a rotated grant reaches the next use without a restart.

## Service

`ctx.oauthTokens` (`OAuthTokenStore`):

| Operation | Meaning |
|---|---|
| `get(ownerId)` | The current bundle from the live snapshot, or `undefined`. |
| `list()` | Stored owner ids, sorted. |
| `put(ownerId, bundle)` | Durable store; keeps `createdAt`, stamps `updatedAt`, publishes `oauth-tokens/updated`. |
| `remove(ownerId)` | Durable delete; an absent owner is a no-op. |

## Config

| Field | Default | Meaning |
|---|---|---|
| `path` | `<harness home>/.connectors/oauth-tokens.json` | Token document location. |
| `dshHome` | `$DSH_HOME` or `~/.dsh` | Harness home used when `path` is omitted. |
| `watch` | `true` | Hot-publish external edits. |
| `debounceMs` | `100` | Watcher write-settle window. |

## Storage discipline

The discipline mirrors [`credentials-local`](../credentials-local/README.md): the document is written `0600` under an owner-only (`0700`) directory, a POSIX file readable beyond its owner fails before its contents are read, and every write re-reads the document under the cross-process writer lock of [`dsh-atomic-write`](../../util/atomic-write/README.md) before patching only its own owner — so a concurrent writer or an external edit inside the watcher's debounce window is folded in rather than overwritten.

External edits publish `oauth-tokens/updated` per changed owner after the snapshot is replaced **wholesale** — an owner deleted on disk never lingers in memory. The store's own writes are recognized by content and publish exactly their commit events; an unchanged re-commit publishes none.

## Security boundary

The document is `0600` under a `0700` directory, which stops other OS users — **not** the model. Tool processes run as the same user and can read it like any other file the user owns; the harness never hands the model a resolved path to the document. That is discretion, not a boundary — see the [credentials-local security boundary](../credentials-local/README.md#security-boundary) for the deferred OS-keychain answer.

## Model Experience

None, as token bundles never enter a prompt, a tool schema, or a tool result, and the consumers (connector MCP servers) present the access token to their provider out-of-band.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- **Passive expiry** — an expired bundle stays readable until its owner refreshes or removes it; consumers must check `expiresAt` before presenting.
- **Same-owner concurrent writes are last-write-wins** — the writer lock and read-modify-write keep concurrent writers from dropping each other's owners, but two writers editing one owner still resolve to the later write; there is no revision check.
- **Atomic, not crash-durable** — inherited from `dsh-atomic-write`; the store re-reads on boot.
