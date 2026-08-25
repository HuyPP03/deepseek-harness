# Connectors

[English](connectors.md) | 中文

连接器子系统为预定义外部服务提供宿主侧身份：[dsh-connectors](../../packages/connectors/connectors) 的 YAML 清单目录（每个提供方一份），以及按连接器派生的状态。清单声明提供方的 MCP 服务器、支持的授权方式，以及使用它的会话所采用的 agent preset 与工作区；[Connectors](../../packages/connectors/connectors) 服务（`ctx.connectors`）通过 mcp-manager 挂载服务器，把非密字段存进按连接器的覆盖文档，并从其他服务已知的信息派生 `unconfigured` 到 `connected` 的状态 —— 注册表（已挂载）、凭据 seam（已配置）、以及最近一次失败的操作。配套包 [dsh-credentials-oauth-tokens](../../packages/credentials/oauth-tokens)（`ctx.oauthTokens`）存放后续授权流程阶段写入与移除的提供方令牌包。

源码：[`packages/connectors/connectors/src/index.ts`](../../packages/connectors/connectors/src/index.ts)

## Manifest

清单是一份严格的 YAML 文档：`id`、显示用的 `name`/`description`、`presetId`、`workspaceDirName`、一个 `auth` 列表（每种模式一项：带 `credentialRefs` 的 `token`，或可选 `byoApp` 与 `setupGuide` 的 `oauth`/`device`），以及连接器要挂载的 `servers`。服务器槽位从字面量值、`{ $cred: REF }`（凭据引用，挂载时解析）和 `{ $override: FIELD }`（连接器所存覆盖文档的字段）解析。校验失败的清单会让启动失败 —— 一个被静默跳过的提供方会被读成"这个连接不可用"。

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

`stateOf` 在读取时派生状态，且只在状态跃迁时发布 `connector/state`：授权流程被标记为进行中时状态是 `authorizing`；已挂载的服务器报告其最差的实时状态（`down` 在有最近错误时显示 `error`，其后是 `reconnecting`、`connecting`、`connected`）；未挂载时，有记录的最近错误显示 `error`，有已存配置显示 `needs-auth`，什么都没有则显示 `unconfigured`。没有连接器操作发生的注册表状态翻转不会发出事件 —— 界面轮询 `list`。

## Token bundles

`ctx.oauthTokens` 是一个以 owner 为键的 [`OAuthTokenBundle`](../../packages/credentials/oauth-tokens) 记录的文件化存储，位于 harness home 下的 `.connectors/oauth-tokens.json`：`0700` 目录下的 `0600` 文件，每次补丁都带跨进程写锁，chokidar 热发布外部编辑，每次重载都整体替换快照。该存储是被动的 —— 没有定时器刷新或过期令牌包；连接器授权流程重新写入刷新后的令牌包或将其移除，消费者在每次使用时读取当前令牌包。

## Interim behavior

在 mcp-client 的 `{$cred}` 占位接缝落地之前，已配置连接器的令牌值会被内联进生成的 `.mcp` 服务器文档；`connect` 经由 `oauth` 或 `device` 方式会以 `ConnectorAuthUnavailableError` 拒绝，直到带 `setAuthorizing` 接缝的流程引擎建成；无授权的自定义连接器在 `addCustom` 时自动挂载。

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
 * The byoApp client id the user configured through `configure`, while
 * configured; the flow engine reads it at registration.
 * @param id - the connector id.
 * @returns the configured client id, or `undefined` while unconfigured.
 */
overrideClientId(id: string): string | undefined

/**
 * Record an auth-flow failure for one connector and republish its state:
 * the failure surfaces as the connector's `error` state with the message
 * as `lastError`, until the next successful operation clears it.
 * @param id - the connector id.
 * @param message - the failure to surface.
 */
async recordFlowFailure(id: string, message: string): Promise<void>

/**
 * Settle an auth flow that completed without a stored credential (a
 * device login): clear the authorizing flag, drop any recorded failure,
 * and republish the connector's view.
 * @param id - the connector the flow settled for.
 */
async settleAuthFlow(id: string): Promise<void>

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
 * `token` mode resolves now; `oauth` mode mounts through the stored token
 * bundle (refreshing it through the flow engine when one is composed);
 * `device` mode mounts first, then hands the mount to the device-code flow
 * engine, which drives the provider's login tool and settles the state in
 * the background.
 *
 * @param id - the connector id.
 * @param mode - the auth mode to connect through.
 * @throws {@link ConnectorAuthPendingError} when an oauth connector has no stored bundle yet.
 * @returns the device flow's start facts for a `device` connect; `undefined` otherwise.
 */
async connect(id: string, mode: 'token' | 'oauth' | 'device'): Promise<DeviceFlowStart | undefined>

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

Source: [`packages/connectors/connectors/src/index.ts:244`](../../packages/connectors/connectors/src/index.ts)

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

Source: [`packages/connectors/connectors/src/types.ts:305`](../../packages/connectors/connectors/src/types.ts)

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
