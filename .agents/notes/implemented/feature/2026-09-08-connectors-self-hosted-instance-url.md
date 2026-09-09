# Agent Note: connectors — per-user instance URL for self-hosted services

Status: implemented

English | [中文](2026-09-08-connectors-self-hosted-instance-url.zh.md)

## Problem

A self-hosted service (Confluence Data Center / Server) authenticates with a per-user personal access token *and* a per-user base URL — two users of the same deployment point at different instances. The connector override mechanism (`{ $override: url }` server slots resolved from the user's override document) already supported the URL, but nothing surfaced it: the client's token dialog only offered credential fields, so a URL-requiring connector could only be configured by hand-editing the override JSON, and storing the token alone left the row in an opaque `error` state with no path back to a form.

## Decision

Confluence ships as a catalog manifest, and the URL becomes a first-class field of its own configure flow:

- `apps/cli/config/connectors/confluence.yml`: stdio `uvx mcp-atlassian`, env `CONFLUENCE_URL: { $override: url }` plus `CONFLUENCE_PERSONAL_TOKEN: { $cred: CONFLUENCE_PERSONAL_TOKEN }`, reusing the shipped `custom` preset. It ships as a catalog manifest — not a custom connector — because `addCustom` env and headers are literals only and cannot carry an `$override` slot.
- `ConnectorView` gains `urlRequired` (the manifest resolves a base URL from the override document) and `url` (the stored value once set); the apiproxy wire schema passes both through.
- The state gate tightens: for a URL-requiring manifest, "configured" — the gate between `unconfigured` and `needs-auth` — additionally means the `url` override is stored. Storing the token alone keeps the row on `Configure`.
- A mount failure from the missing override is a configuration precondition, not an operation failure: `configure`'s auto-mount catch does not record `lastError` for `ConnectorOverrideMissingError`, so the row stays on its configure gate instead of settling into `error`.
- The token dialog of a `urlRequired` row shows an "Instance URL" field, prefilled from the stored `url`, and Save requires it alongside the credentials; `configure` sends it as `fields.url`. `canConfigure` also offers `Configure` while a token is stored but the URL is not.

## Alternatives considered

**A generic env field on the New-connector dialog (first attempt).** It reached the user, but it bakes a literal URL into a hand-authored manifest — the URL then belongs to one user's deployment and cannot be re-resolved per user, and it is not Confluence's own flow. The user asked for the URL on Confluence's own Configure step precisely because other users' instances differ.

**Keep the `error` state for a missing override and let the user retry `Connect`.** The error message names the field, but the card offers no form: the user re-enters nothing and gets the same failure, or edits JSON. The configure gate reaches the same place through a dialog.

**A `url` argument on `connect`.** The override document is already the written store for non-secret per-user fields, and `configure` already accepts it; a second write path would need its own persistence, event, and clear-on-disconnect story.

## Testing

- `dsh-connectors`: the URL gate on a clean boot (token stored alone → `unconfigured`; URL stored → `needs-auth` with `url` on the view) and the extended override-resolution flow.
- `dsh-apiproxy`: the wire test now asserts the gate instead of the error state — the response view carries `urlRequired`/`url`, the connect still rejects with `connector-override-missing`, and the URL configure arms `needs-auth`.
- `dsh-client-ui-connectors`: controller (URL draft prefill from the stored value, `setDialogUrl` guards for non-URL rows and a closed dialog, save sends `fields.url`), directory (a token-stored URL-missing card offers `Configure`, a URL-stored card offers `Connect`; the dialog renders the URL field and keeps Save closed until both are drafted), and the inject face.
- `shipped-connectors.spec`: the roster includes `confluence` and its view advertises `urlRequired`.

## Consequences

- Confluence's flow is Configure (instance URL + personal access token) → Connect; the URL is stored in the user's override document and cleared with everything else by `disconnect`.
- Any future self-hosted catalog connector follows the same pattern: a `{ $override: url }` slot plus the token dialog's URL field — no new UI surface per service.
- The shipped roster in the working tree is Confluence, Figma, GitHub, Notion, Slack (the atlas, Google, and Microsoft 365 manifests are locally hidden by the user; the roster spec matches the working tree and must be re-updated if they return).

## Related

- [connectors multi-reference token dialog](2026-08-23-connectors-multi-ref-token-dialog.md) owns the per-credential-reference dialog this note extends with the URL field.
- [connectors split surface list and directory](2026-08-24-connectors-split-surface-list-and-directory.md) owns the directory surface where the card actions live.
