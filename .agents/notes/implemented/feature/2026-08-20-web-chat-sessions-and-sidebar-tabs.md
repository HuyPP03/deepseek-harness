# Agent Note: Web chat sessions and the sidebar browsing tabs

Status: implemented

English | [中文](2026-08-20-web-chat-sessions-and-sidebar-tabs.zh.md)

## Problem

The Web sidebar's Session browser had one list: every session sat under a Workspace group or in a trailing "Ungrouped" bucket. Plain-conversation sessions (no Workspace) were mixed into that bucket next to workspace leftovers, and the only way to start one was the hero's "no project" action. Users wanted a first-class chat surface: a distinct session kind, a dedicated sidebar tab, a New Chat action, and a permission mode that is fixed to read-only rather than selectable.

## Decision

A **chat session** is a session with no `workspaceId` and `agentPreset: 'chat'` — a single coupling id, `CHAT_PRESET_ID`, exported by the client runtime (`@deepseek-ai/dsh-client-runtime/client`) and consumed by every UI brancher. The host side pins the behavior by preset:

- `dsh-permission-presets` gains `Config.chatPresetIds` (agent-preset ids whose sessions are chats; the web surface ships `chat`) and `Config.chatPreset` (default `read-only`). A session created under a listed preset pins the chat preset at creation instead of the default, and the `/permission` switch refuses any session still running a listed preset. The web patch (`cordis.patch.yml`) sets `chatPresetIds: [chat]` on the permission row.
- The web surface registers the `chat` agent preset (`apps/cli/config/agent-presets/chat/`) with a chat system prompt; `webSurfacePrompt` takes the chat flag.
- `session.create` already accepts and echoes `agentPreset`, so no wire change was needed; the client plumbs it through `sessions.create`.

Client side, the shell owns the tab:

- `ui-sidebar` gains a small store (`dsh.sidebar.view.v1`, default `chats`) and a two-tab control (wide column only; the rail follows the persisted tab). The active tab is an owner prop on `sidebar.workspaces`; the wordmark and New button dispatch on it — Workspaces keeps the existing New Session intent, Chats calls the injected `startChat`.
- `WorkspaceRuntime.startChat()` reuses an ungrouped blank session already created under `CHAT_PRESET_ID` (blank-reuse over the list mirror, coalescing concurrent calls) or mints `session.create({agentPreset: CHAT_PRESET_ID})`. The no-main branch of `startNewSession` (hero "no project") now mints a chat session too, so the hero lands on the chat kind.
- `ui-workspace` drops the Ungrouped bucket and the flat/grouped view option. The Workspaces tab renders the Workspace tree only (workspace groups, no ungrouped fallback); the Chats tab renders the flat list of every session no Workspace accounts for (`deriveChats`), keeping the ungrouped order account key (store key bumped `dsh.workspace.view.v5` → `v6`). Chat rows carry `blankChat` so the blank placeholder renders "New chat"; search and hover label chat sessions as **Chats**. Legacy ungrouped sessions (created before the split) keep their plain-session presentation in the chats list.
- The chat surfaces hide the permission machinery because the host refuses it: `InputBar` renders no Access chip for `agentPreset: 'chat'` sessions, `ui-commands` filters the host `/permission` row out of the candidate menu for them (a typed line still reaches the host and gets its error — deliberate: the client hides the menu, the host enforces), and the `ui-permission-presets` decoration reports `available: false` for them.

## Alternatives considered

**Keep the Ungrouped bucket and only add a "chat" badge.** Rejected: the bucket conflated two different kinds (workspace leftovers and plain conversations), and the badge does not give the product the tab-level separation the sidebar design requires.

**Derive "chat" from `cwd === undefined` alone.** Rejected: legacy sessions are cwd-less but were created by the old default flow; keying on the preset keeps their behavior unchanged and pins new chats to the host-fixed permission mode.

**A new session event or wire RPC for chat pinning.** Rejected: the wire `session.create` already carries `agentPreset`, and the host enforces the pin at creation plus the switch refusal — no new durable fact exists to log.

## Consequences

Chat sessions are distinguishable in the session list (`agentPreset` on the summary), their permission mode is host-fixed and host-enforced, and fork/resume of a chat session keeps the chat behavior because the preset travels in the seed. The tab state is browser-local view state (persisted under its own key, no host round-trip). Pre-release stance applied: the workspace view store key was bumped rather than migrated, and no compatibility shim was kept for the removed group/flat view option. The replay browser snapshots' sidebar expectations were updated to the tabbed shell; the GUI PR carries the recorded interaction GIF.
