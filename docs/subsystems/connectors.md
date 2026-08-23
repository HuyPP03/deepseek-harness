# Connectors

English | [中文](connectors.zh.md)

The connector subsystem gives predefined external services a host-side identity: a [dsh-connectors](../../packages/connectors/connectors) catalog of YAML manifests, one per provider, plus a derived state per connector. A manifest declares the provider's MCP servers, the auth methods it supports, and the agent preset and workspace a session with it uses; the [Connectors](../../packages/connectors/connectors) service (`ctx.connectors`) mounts the servers through the mcp-manager, stores non-secret fields in per-connector override documents, and derives `unconfigured` through `connected` from what the other services already know — the registry (mounted), the credential seams (configured), and the last failed operation. Companion package [dsh-credentials-oauth-tokens](../../packages/credentials/oauth-tokens) (`ctx.oauthTokens`) stores the provider token bundles the later auth-flow phases put and remove.

Source: [`packages/connectors/connectors/src/index.ts`](../../packages/connectors/connectors/src/index.ts)

## Manifest

A manifest is a strict YAML document: `id`, display `name`/`description`, `presetId`, `workspaceDirName`, an `auth` list (one entry per mode: `token` with its `credentialRefs`, or `oauth`/`device` with optional `byoApp` and `setupGuide`), and the `servers` the connector mounts. Server slots resolve from literal values, `{ $cred: REF }` (a credential reference, resolved at mount), and `{ $override: FIELD }` (a field of the connector's stored override document). A manifest that fails validation refuses the boot — a silently skipped provider reads as "the connection is not available".

```ts type-equiv
/** Connection lifecycle state of one connector, derived at read time. */
type ConnectorState =
  | 'unconfigured'
  | 'needs-auth'
  | 'authorizing'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'down'
  | 'error'
```

## State machine

`stateOf` derives the state at read time and publishes `connector/state` only on a transition: while an auth flow is flagged in flight the state is `authorizing`; a mounted server reports its worst live status (`down` → `error` when a last error exists, then `reconnecting`, `connecting`, `connected`); unmounted, a recorded last error shows `error`, a stored configuration shows `needs-auth`, and nothing shows `unconfigured`. Registry status flips that happen without a connector operation are not emitted — surfaces poll `list`.

## Token bundles

`ctx.oauthTokens` is a file-backed store of owner-keyed [`OAuthTokenBundle`](../../packages/credentials/oauth-tokens) records at `.connectors/oauth-tokens.json` under the harness home: `0600` file under `0700`, a cross-process writer lock on every patch, chokidar hot-publish of external edits, and wholesale snapshot replacement on every reload. The store is passive — no timers refresh or expire bundles; the connector auth flow re-puts a refreshed bundle or removes it, and consumers read the current bundle at each use.

## Interim behavior

Until the `{$cred}` placeholder seam lands in mcp-client, a configured connector's token value is inlined into the generated `.mcp` server document; `connect` through `oauth` or `device` methods refuses with `ConnectorAuthUnavailableError` while the flow engine (with its `setAuthorizing` seam) is unbuilt; and a custom connector without auth auto-mounts at `addCustom`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxconnectors--connectors"></a>

### `ctx.connectors` — `Connectors`

The catalog, the user's overrides, and the operations over both.

```ts cordis-catalog
/**
 * Every catalog and custom connector as a wire-safe view, sorted by id.
 * @returns the connector views.
 */
async list(): Promise<readonly ConnectorView[]>

/**
 * One connector's wire-safe view.
 * @param id - the connector id.
 * @returns the view, or `undefined` while the id is not in the catalog.
 */
async get(id: string): Promise<ConnectorView | undefined>

/**
 * The raw manifest of one connector, for host-internal consumers; the wire
 * surface is the view, which carries no server commands or URLs.
 * @param id - the connector id.
 * @returns the manifest, or `undefined` while the id is not in the catalog.
 */
manifest(id: string): ConnectorManifest | undefined

/**
 * Mark one connector's auth flow in flight or settled. The flow engine is
 * the only writer: while flagged, the derived state is `authorizing`
 * regardless of the seams underneath.
 * @param id - the connector id.
 * @param inFlight - whether a flow is in flight.
 */
setAuthorizing(id: string, inFlight: boolean): void

/**
 * Configure one connector: store the provided credential values through
 * the credentials seam, persist the non-secret fields in its override
 * document, and — for a token method that is fully configured for the
 * first time — mount its servers.
 *
 * @param id - the connector id.
 * @param fields - the fields to set; absent fields are left untouched.
 */
async configure(id: string, fields: ConnectorConfigureFields): Promise<void>

/**
 * Connect one connector: mount its servers with every slot resolved.
 * `token` mode resolves now; `oauth` and `device` modes need their flow
 * engines, which a deployment opts into separately, and refuse until then.
 *
 * @param id - the connector id.
 * @param mode - the auth mode to connect through.
 */
async connect(id: string, mode: 'token' | 'oauth' | 'device'): Promise<void>

/**
 * Disconnect one connector: unmount its servers, remove its stored
 * credentials and token bundle, and delete its override document.
 * @param id - the connector id.
 */
async disconnect(id: string): Promise<void>

/**
 * Author one custom connector: persist its manifest under the user
 * directory and copy the shipped `custom` preset to it. A failed preset
 copy leaves no manifest file; a failed manifest write removes the preset
 copy.
 *
 * @param spec - the custom connector definition.
 * @returns the new connector id.
 */
async addCustom(spec: AddCustomSpec): Promise<string>

/**
 * Remove one custom connector: remove its preset copy, its manifest, its
 * servers, and its stored credentials. Shipped connectors refuse.
 * @param id - the custom connector id.
 */
async removeCustom(id: string): Promise<void>
```

Source: [`packages/connectors/connectors/src/index.ts:224`](../../packages/connectors/connectors/src/index.ts)

<a id="ctxoauthtokens--oauthtokenstore"></a>

### `ctx.oauthTokens` — `OAuthTokenStore`

File-backed OAuth token bundle store (`.connectors/oauth-tokens.json`).

```ts cordis-catalog
/**
 * The current bundle for one owner, read from the live snapshot.
 * @param ownerId - the owner to look up.
 * @returns the stored bundle, or `undefined` while the owner is unconfigured.
 */
get(ownerId: string): OAuthTokenBundle | undefined

/**
 * The owner ids currently in the snapshot, sorted.
 * @returns the stored owner ids.
 */
list(): readonly string[]

/**
 * Durably store one owner's bundle, replacing any bundle the owner already
 * holds. The write folds in unobserved on-disk state under a cross-process
 * writer lock, so a concurrent writer or an external edit cannot be lost.
 * `createdAt` keeps the first stored value for this owner; `updatedAt` is
 * always the commit time.
 * @param ownerId - the owner to store for.
 * @param bundle - the bundle to store.
 */
put(ownerId: string, bundle: OAuthTokenBundle): Promise<void>

/**
 * Remove one owner's bundle; removing an absent owner is a no-op.
 * @param ownerId - the owner to remove.
 */
remove(ownerId: string): Promise<void>
```

Source: [`packages/credentials/oauth-tokens/src/index.ts:198`](../../packages/credentials/oauth-tokens/src/index.ts)

<a id="connector-events"></a>

### `connector/*` events

<a id="connectorstate--emit"></a>

#### `connector/state` — emit

A connector's derived state changed as the result of a connector operation (configure, connect, disconnect, add, remove) or an auth flow transition. Registry status flips that happen without a connector operation are not emitted; surfaces poll `list` for those. Listener failures are contained and logged, except `INVARIANT`-coded failures, which rethrow after every listener ran.

```ts cordis-catalog
/**
 * A connector's derived state changed as the result of a connector
 * operation (configure, connect, disconnect, add, remove) or an auth
 * flow transition. Registry status flips that happen without a connector
 * operation are not emitted; surfaces poll `list` for those. Listener
 * failures are contained and logged, except `INVARIANT`-coded failures,
 * which rethrow after every listener ran.
 * @param connectorId - the connector whose state changed.
 * @param state - the new derived state.
 * @mode emit
 */
'connector/state'(connectorId: string, state: ConnectorState): void
```

Source: [`packages/connectors/connectors/src/types.ts:225`](../../packages/connectors/connectors/src/types.ts)

<a id="oauth-tokens-events"></a>

### `oauth-tokens/*` events

<a id="oauth-tokensupdated--emit"></a>

#### `oauth-tokens/updated` — emit

Committed change to one owner's stored bundle: a `put`, a `remove`, or an external edit observed in storage. Listener failures are contained and logged — a sync throw and an async rejection alike — without changing the committed operation's outcome, except `INVARIANT`-coded failures, which rethrow after every listener ran; that rethrow reaches the emitter only from synchronous listeners, so invariant checks on this event must not be async functions.

```ts cordis-catalog
/**
 * Committed change to one owner's stored bundle: a `put`, a `remove`,
 * or an external edit observed in storage. Listener failures are
 * contained and logged — a sync throw and an async rejection alike —
 * without changing the committed operation's outcome, except
 * `INVARIANT`-coded failures, which rethrow after every listener ran;
 * that rethrow reaches the emitter only from synchronous listeners,
 * so invariant checks on this event must not be async functions.
 * @param ownerId - the owner whose stored bundle changed.
 * @mode emit
 */
'oauth-tokens/updated'(ownerId: string): void
```

Source: [`packages/credentials/oauth-tokens/src/types.ts:49`](../../packages/credentials/oauth-tokens/src/types.ts)
<!-- END GENERATED cordis-surface -->
