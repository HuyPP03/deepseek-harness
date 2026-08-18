# @deepseek-ai/dsh-workspace-references

English | [中文](README.zh.md)

Session reference projects through `ctx.workspaceReferences` ([`WorkspaceReferenceService`](src/index.ts)): the additional READ-ONLY project directories a session may attach for comparison, on top of the session's own workspace (its `header.cwd`, the main project).

The attached set is whole-value log state: one `workspace/references` event per change, the last event the current set. `set(session, paths)` canonicalizes (realpath), requires existing directories, deduplicates, rejects the session's own cwd, caps at `Config.maxReferences` (default 2), and appends nothing when the request matches the current set. Resume, fork, and replay carry the set with the seed; there is no out-of-band state.

The service registers the model-facing `workspace:references` prompt context (order 115, right after `sandbox:policy`'s 110): the pinned intro line plus one line per reference path. An empty set renders nothing, so attaching or detaching references is the only prompt change this service makes. Clients read the folded set plus the configured cap from the `workspaceReferences` session-projection key (absent when no projection registry is composed, e.g. headless assemblies).

References are never writable roots. The standing sandbox policy already confines writes to the session workspace (plus platform temp areas) while every confined backend (bubblewrap, Landlock, Seatbelt) leaves the rest of the filesystem readable, so an admitted reference directory is readable as-is by the fs tools and sandboxed execution; no sandbox or filesystem provider change ships with this package.

## Model Experience

### Reference-project comparison context

#### What the model sees

One `workspace:references` system-prompt section (order 115, after `sandbox:policy`) in every assembly while the session has references, and none when the set is empty. No new tools: references are read with the file tools the session already has.

##### Reference projects section

```markdown
Reference projects: these projects are attached to this session for comparison. They are read-only — never modify files under them; make changes only in the session workspace.
- /absolute/path/to/reference
```

#### Token effect

The pinned intro line costs about 45 tokens and each reference path about 5-10, in the system prompt of every request; while the set is unchanged the bytes stay stable across turns, and an empty set contributes nothing.

#### KV Cache effect

The section sits at a fixed position (order 115, after the persona and the `sandbox:policy` context). Attaching, detaching, or reordering references rewrites the system prompt from that point on, invalidating the request-prefix cache for the next assembly; with no references the prompt is byte-identical to the unmounted deployment.

## Known Limitations and Deferred Work

- **The cap is a service Config field** — the Web UI reads it from the projection, but a deployment raising `maxReferences` beyond what a client renders still relies on the host validation as authority.
- **Subagent children do not inherit references** — a child gets a fresh session with its own seed; a delegation that needs a reference project must state the path in the task text (deferred: seed references into children).
- **Reference paths are validated at admission only** — a directory removed later keeps its event (the log is immutable); reads then fail with the ordinary filesystem error, and the prompt renders the stale path.
