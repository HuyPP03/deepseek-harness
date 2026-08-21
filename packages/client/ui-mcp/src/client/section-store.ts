/**
 * MCP settings-section controller: the live server roster, the reconnect and
 * remove actions, and the add-server form.
 *
 * The host stays the single fact source. Every mutation writes through the
 * wire and the page re-reads the roster afterwards, because an add or remove
 * changes the row it targeted and every row that shares the tool namespace.
 */

import type { IApiClient, McpServerRow, McpServerSpec } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Server-name rule mirrored from the host: the tool prefix is a namespace. */
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

/** One roster row the page renders. */
export type McpRow = McpServerRow

/** The add form's transport choice. */
export type AddTransport = 'stdio' | 'streamable-http'

/**
 * The open add form. Text fields are the raw typed values; the controller
 * parses them into the wire spec at submit, so the form never round-trips
 * through a structured value it cannot display.
 */
export interface AddDraft {
  serverName: string
  transport: AddTransport
  /** stdio: the executable to spawn. */
  command: string
  /** stdio: newline-separated arguments. */
  args: string
  /** stdio: newline-separated KEY=value pairs. */
  env: string
  /** stdio: child working directory. */
  cwd: string
  /** streamable-http: the endpoint URL. */
  url: string
  /** streamable-http: newline-separated Name: value headers. */
  headers: string
  /** Optional per-tool-call timeout, blank for the host default. */
  timeoutMs: string
  /** Whether the add is in flight. */
  saving: boolean
  /** The last failure, cleared by the next edit. */
  error: string | null
}

/** Page snapshot. */
export interface McpSectionState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load failure text. */
  error: string | null
  /** Every server currently reporting, sorted by serverName. */
  rows: readonly McpRow[]
  /** The open add form, or null. */
  add: AddDraft | null
  /** The server awaiting remove confirmation. */
  pendingRemove: string | null
  /** Whether the pending remove gate's acknowledgement checkbox is checked. */
  removeAcknowledged: boolean
  /** Whether the pending remove is in flight. */
  removing: boolean
  /** The server whose manual reconnect is in flight, if any. */
  reconnecting: string | null
}

const INITIAL: McpSectionState = {
  status: 'idle',
  error: null,
  rows: [],
  add: null,
  pendingRemove: null,
  removeAcknowledged: false,
  removing: false,
  reconnecting: null,
}

/** Build the blank add form, stdio transport and no fields set.
 * @returns a fresh, submittable-shape draft.
 */
export function blankDraft(): AddDraft {
  return {
    serverName: '',
    transport: 'stdio',
    command: '',
    args: '',
    env: '',
    cwd: '',
    url: '',
    headers: '',
    timeoutMs: '',
    saving: false,
    error: null,
  }
}

/**
 * Why this draft cannot be submitted yet, as a locale key, or undefined when
 * it can. Client-side only: the host re-checks the name and the mount, and
 * its answer is what the form reports on failure.
 * @param draft - the open add form.
 * @param rows - the current roster, for the collision check.
 * @returns the blocking reason's locale key, or undefined when submittable.
 */
export function draftBlocker(
  draft: AddDraft,
  rows: readonly McpRow[],
): 'nameRequired' | 'nameInvalid' | 'nameTaken' | 'commandRequired' | 'urlRequired' | 'urlInvalid' | undefined {
  const name = draft.serverName.trim()
  if (name === '') return 'nameRequired'
  if (!SERVER_NAME.test(name)) return 'nameInvalid'
  if (rows.some(row => row.serverName === name)) return 'nameTaken'
  if (draft.transport === 'stdio' && draft.command.trim() === '') return 'commandRequired'
  if (draft.transport === 'streamable-http') {
    const url = draft.url.trim()
    if (url === '') return 'urlRequired'
    try {
      new URL(url)
    } catch {
      return 'urlInvalid'
    }
  }
  return undefined
}

/** One non-blank, trimmed line of a newline-separated field. */
function linesOf(value: string): string[] {
  return value.split('\n').map(line => line.trim()).filter(line => line !== '')
}

/** Split one line into whitespace-separated entries, blank dropped. */
function wordsOf(value: string): string[] {
  return value.split(/\s+/).filter(word => word !== '')
}

/** Parse a KEY=value / Name: value line; undefined for a line without a separator. */
function pairOf(line: string, separator: string): [string, string] | undefined {
  const at = line.indexOf(separator)
  if (at <= 0) return undefined
  return [line.slice(0, at).trim(), line.slice(at + separator.length).trim()]
}

/** Parse the optional timeout field; undefined for a blank or invalid value. */
function timeoutOf(value: string): number | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const ms = Number(trimmed)
  if (!Number.isInteger(ms) || ms <= 0) return undefined
  return ms
}

/**
 * Build the wire add spec from a validated draft. Empty fields are omitted
 * from the spec (the host applies its defaults), and env/header lines without
 * a separator are dropped rather than rejected — a stray line must not block
 * an add, and a line without a key carries nothing to send.
 * @param draft - a draft that passed {@link draftBlocker}.
 * @returns the wire spec for `mcp.add`.
 */
export function specOf(draft: AddDraft): McpServerSpec {
  const name = draft.serverName.trim()
  const timeout = timeoutOf(draft.timeoutMs)
  if (draft.transport === 'stdio') {
    const env: Record<string, string> = {}
    for (const line of linesOf(draft.env)) {
      const pair = pairOf(line, '=')
      if (pair !== undefined) env[pair[0]] = pair[1]
    }
    return {
      serverName: name,
      transport: 'stdio',
      command: draft.command.trim(),
      ...(wordsOf(draft.args).length === 0 ? {} : { args: wordsOf(draft.args) }),
      ...Object.keys(env).length === 0 ? {} : { env },
      ...(draft.cwd.trim() === '' ? {} : { cwd: draft.cwd.trim() }),
      ...(timeout === undefined ? {} : { toolCallTimeoutMs: timeout }),
    }
  }
  const headers: Record<string, string> = {}
  for (const line of linesOf(draft.headers)) {
    const pair = pairOf(line, ':')
    if (pair !== undefined) headers[pair[0]] = pair[1]
  }
  return {
    serverName: name,
    transport: 'streamable-http',
    url: draft.url.trim(),
    ...Object.keys(headers).length === 0 ? {} : { headers },
    ...(timeout === undefined ? {} : { toolCallTimeoutMs: timeout }),
  }
}

/** Reads the roster and drives the add form, the remove gate, and reconnects. */
export class McpSectionController {
  /** Page snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<McpSectionState> = createSnapshotStore(INITIAL)

  constructor(
    private readonly api: Pick<IApiClient, 'mcp'>,
  ) {}

  private set(patch: Partial<McpSectionState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  private patchAdd(patch: Partial<AddDraft>): void {
    const { add } = this.store.getSnapshot()
    if (add === null) return
    this.set({ add: { ...add, ...patch } })
  }

  /**
   * Read the roster. An empty roster is a valid deployment (no MCP server
   * configured), not a failure — the section renders its empty state.
   * @returns once the snapshot reflects the host.
   */
  async load(): Promise<void> {
    this.set({ status: 'loading', error: null })
    try {
      const response = await this.api.mcp.list({})
      if (!response.result.ok) {
        this.set({ status: 'error', error: response.result.error.message })
        return
      }
      this.set({ status: 'ready', rows: response.result.value.servers.map(row => ({ ...row, tools: [...row.tools] })) })
    } catch (error) {
      this.set({ status: 'error', error: String(error) })
    }
  }

  /** Open the add form. */
  beginAdd(): void {
    this.set({ add: blankDraft(), error: null })
  }

  /** Close the add form, discarding whatever was typed. */
  cancelAdd(): void {
    this.set({ add: null })
  }

  /**
   * Edit one add-form field; every edit clears the last failure, so a
   * corrected field can retry without re-triggering the old message.
   * @param field - the form field to edit.
   * @param value - the typed value for that field.
   */
  setAddField<K extends keyof Omit<AddDraft, 'saving' | 'error'>>(field: K, value: AddDraft[K]): void {
    this.patchAdd({ [field]: value, error: null })
  }

  /**
   * Submit the add form: parse the typed fields into the wire spec, write it
   * through the host, then re-read the roster — the new server appears with
   * its own lifecycle state (a server that cannot connect yet still shows up
   * while recovering).
   * @returns once the add settled and the page reflects it.
   */
  async submitAdd(): Promise<void> {
    const { add } = this.store.getSnapshot()
    if (add === null || add.saving) return
    if (draftBlocker(add, this.store.getSnapshot().rows) !== undefined) return
    this.patchAdd({ saving: true, error: null })
    try {
      const response = await this.api.mcp.add({ spec: specOf(add) })
      if (!response.result.ok) {
        this.patchAdd({ saving: false, error: response.result.error.message })
        return
      }
      this.set({ add: null })
      await this.load()
    } catch (error) {
      this.patchAdd({ saving: false, error: String(error) })
    }
  }

  /**
   * Open the remove gate over one server, or dismiss it with null.
   * @param name - the server to remove, or null to dismiss.
   */
  beginRemove(name: string | null): void {
    if (this.store.getSnapshot().removing) return
    this.set({ pendingRemove: name, removeAcknowledged: false, error: null })
  }

  /**
   * Toggle the remove gate's acknowledgement checkbox.
   * @param acknowledged - the checkbox state.
   */
  setRemoveAcknowledged(acknowledged: boolean): void {
    if (this.store.getSnapshot().removing) return
    this.set({ removeAcknowledged: acknowledged })
  }

  /**
   * Remove the server awaiting confirmation, then re-read the roster.
   * @returns once the remove settled and the page reflects it.
   */
  async remove(): Promise<void> {
    const { pendingRemove, removing } = this.store.getSnapshot()
    if (pendingRemove === null || removing) return
    this.set({ removing: true, error: null })
    try {
      const response = await this.api.mcp.remove({ serverName: pendingRemove })
      if (!response.result.ok) {
        this.set({ removing: false, pendingRemove: null, removeAcknowledged: false, error: response.result.error.message })
        return
      }
      this.set({ removing: false, pendingRemove: null, removeAcknowledged: false })
      await this.load()
    } catch (error) {
      this.set({ removing: false, pendingRemove: null, removeAcknowledged: false, error: String(error) })
    }
  }

  /**
   * Ask one reported server to start a manual reconnect, then re-read the
   * roster so the new state is visible. One reconnect runs at a time: the
   * roster re-read after the first one answers what a second press would ask.
   * @param name - the server to reconnect.
   * @returns once the reconnect settled and the page reflects it.
   */
  async reconnect(name: string): Promise<void> {
    if (this.store.getSnapshot().reconnecting !== null) return
    this.set({ reconnecting: name, error: null })
    try {
      const response = await this.api.mcp.reconnect({ serverName: name })
      if (!response.result.ok) {
        this.set({ reconnecting: null, error: response.result.error.message })
        return
      }
      this.set({ reconnecting: null })
      await this.load()
    } catch (error) {
      this.set({ reconnecting: null, error: String(error) })
    }
  }
}
