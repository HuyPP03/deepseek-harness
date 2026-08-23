# @deepseek-ai/dsh-client-ui-connectors

English | [中文](README.zh.md)

Connectors sidebar region: the predefined external connection roster the [sidebar](../ui-sidebar/README.md) renders on its `connectors` tab, and the token dialog that is the only place a credential value enters the client. The region registers into the shell-declared `sidebar.connectors` hole; it holds no tab state of its own (the shell renders it only on that tab) and the rail renders one link icon that requests expansion.

The roster arrives through the `connector.list` wire verb as secret-free `ConnectorView`s — no server command, URL, header, or credential crosses the wire. Each row shows the derived state (dot + label), the connector's description, and its server mount summary. The row action follows the state: an unconfigured token method offers **Configure** (the token dialog, whose save is `connector.configure`), a configured or failed connector offers **Connect** (`connector.connect` with the token mode), and a live mount offers **Disconnect** (`connector.disconnect`). Mutations adopt the response's updated view into the local roster — the response is authoritative, so no re-list follows — and a row-level failure renders under its row until the next operation on it.

The region owns one controller in its `apply` closure: the roster snapshot (a `createSnapshotStore` the renderer binds to `useConnectors` through the inject `hooks` compartment) plus the mutation methods, which the region reaches as plain injected callbacks. Re-mounting the region (a tab switch) re-reads the roster, so the view is as fresh as the host.

`ConnectorsRegionProps` composes the shell owner share (`wide`, `expandSidebar`), the `connectors` locale namespace, and the inject face (the `hooks.connectors` store binding plus `load`/`openTokenDialog`/`setDialogDraft`/`closeDialog`/`saveToken`/`connect`/`disconnect`).

The `/client` exports are the plugin body (`apply`/`inject`), the contract types, the controller class and its state types, and the locale key union; the region component, its row sub-view, and the CSS modules remain package-internal behind the slot registration.

## Model Experience

None, as the region renders host-derived connector views; nothing here reaches a model request. The token the dialog sends is stored host-side under the connector's credential reference and is never echoed back across the wire.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **OAuth and device flows render guidance only** — `connect` with those modes rejects host-side (`connector-auth-unavailable`) until the oauth-flow engine lands; the rows show the method's `howTo`/`setupGuide` copy in the meantime.
- **No wire push for state changes** — the roster re-reads on region mount and after each mutation; a background connector failure surfaces on the next visit to the tab.
- **Custom connectors are read-only here** — authoring and deleting custom connectors (`connector.add`/`remove`) has no UI yet.
