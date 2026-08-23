# @deepseek-ai/dsh-client-ui-connectors

English | [中文](README.zh.md)

Connectors sidebar region: the predefined external connection roster the [sidebar](../ui-sidebar/README.md) renders on its `connectors` tab, and the token dialog that is the only place a credential value enters the client. The region registers into the shell-declared `sidebar.connectors` hole; it holds no tab state of its own (the shell renders it only on that tab) and the rail renders one link icon that requests expansion.

The roster arrives through the `connector.list` wire verb as secret-free `ConnectorView`s — no server command, URL, header, or credential crosses the wire. Each row shows the derived state (dot + label), the connector's description, and its server mount summary. The row action follows the state: an unconfigured token method offers **Configure** (the token dialog, whose save is `connector.configure`), a configured or failed connector offers **Connect** (token mode through `connector.connect`, an OAuth method through `connector.authorize`, a device method through `connector.deviceLogin`), and a live mount offers **Disconnect** (`connector.disconnect`). Custom rows also offer **Remove** (`connector.remove`). The provider list header offers **New connector**, a form over the `AddCustomSpec` fields (name, optional id, stdio command/args or streamable-http url, optional token variable) whose save is `connector.add`. Mutations adopt the response's updated view into the local roster — the response is authoritative, so no re-list follows, except `add`/`remove` whose responses carry no view and re-list instead — and a row-level failure renders under its row until the next operation on it.

The region owns one controller in its `apply` closure: the roster snapshot (a `createSnapshotStore` the renderer binds to `useConnectors` through the inject `hooks` compartment) plus the mutation methods, which the region reaches as plain injected callbacks. Re-mounting the region (a tab switch) re-reads the roster, so the view is as fresh as the host.

Selecting a row opens the provider detail: a connected provider lists its own chats — the sessions the session feed marks with the provider's `presetId`, blank entries hidden, latest first — each row opening that session in the conversation area, and **New chat** minting one under the same preset (`session.create` with the provider's `agentPreset`, then open); a not-yet-connected provider keeps the placeholder until its first session exists. The detail's session callbacks (`openSession`/`newProviderChat`) forward into the runtime's session service; the provider preset id itself resolves from the roster copy.

`ConnectorsRegionProps` composes the shell owner share (`wide`, `expandSidebar`), the `connectors` locale namespace, and the inject face (the `hooks.connectors` store binding plus `load`/`openTokenDialog`/`setDialogDraft`/`closeDialog`/`saveToken`/`connect`/`authorize`/`deviceLogin`/`disconnect`/`selectProvider`/`openCustomDialog`/`setCustomDraft`/`closeCustomDialog`/`saveCustom`/`removeCustom`/`openSession`/`newProviderChat`), over which the global standard hooks already carry `useSessions` for the detail's chat list.

The `/client` exports are the plugin body (`apply`/`inject`), the contract types, the controller class and its state types, and the locale key union; the region component, its row sub-view, and the CSS modules remain package-internal behind the slot registration.

## Model Experience

None, as the region renders host-derived connector views; nothing here reaches a model request. The token the dialog sends is stored host-side under the connector's credential reference and is never echoed back across the wire.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **OAuth and device flows settle server-side** — `connector.authorize` and `connector.deviceLogin` start the flow and return; the region shows the row's `authorizing` state while the verify poll runs on the host and the roster re-reads on the next mount.
- **No wire push for state changes** — the roster re-reads on region mount and after each mutation; a background connector failure surfaces on the next visit to the tab.
- **The custom form covers the single-server case** — the `AddCustomSpec` behind `connector.add` carries one server and at most one token method per connector; multi-server or custom deployments without a token still need a hand-written manifest.
