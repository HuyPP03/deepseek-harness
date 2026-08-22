/**
 * File inspector plugin, browser half: three registrations — FileInspector
 * occupies the conversation.details.file seat the details panel renders for a
 * file selection, FileBrowser occupies the conversation.details.files seat
 * for a browse selection (the session file list — the entry point for a file
 * no mutation tool announced), and FilesAction puts one Files button in the
 * session header. The seats' declarations belong to ui-conversation's
 * entries; activation order relative to them is unconstrained, so every
 * registration waits on its declaration through slots.inject. The byte read
 * is the runtime's file-bytes service (a hard dependency: the Code tab is
 * the seat's reason to exist), and the list is the connection's files.list
 * RPC (the same bounded walk the composer's `@` source fetches); the details
 * panel's open gesture comes from ui-conversation's `detailsPanel` service,
 * read at call time so apply order relative to it stays unconstrained.
 */
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext, FileBytesService } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation Context merge (the detailsPanel
// service face typed by its declaration) and the seats' SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { FileBrowser } from './FileBrowser.tsx'
import { FileInspector } from './FileInspector.tsx'
import { FilesAction } from './FilesAction.tsx'
import { en, zh, type FileInspectorKey } from './locales.ts'

export type { FileBrowserInjected, FileBrowserProps, FileInspectorInjected, FileInspectorProps } from './contract/slots.ts'
export type { FilesActionInjected, FilesActionProps } from './FilesAction.tsx'
export type { FileInspectorKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The file inspector's tab labels and state copy. */
    fileInspector: FileInspectorKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'fileInspector'

/**
 * Required services (cordis fiber inject): the slot registry (declaration
 * ledger), the file-bytes service the Code tab reads through, the connection
 * RPC the file list seat fetches through, and the locale plugin (dictionary
 * registration).
 */
export const inject = ['slots', 'fileBytes', 'connection', 'locale']

/**
 * Register the inspector, the file list seat, and the header Files action
 * once their declarations are on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-file-inspector: dictionaries')

  const fileBytes = ctx.get('fileBytes') as FileBytesService
  const files = (ctx.get('connection') as ConnectionHandle).api.files

  ctx.slots.inject('conversation.details.file', () => ctx.slots.register({
    name: 'conversation.details.file',
    locale: NS,
    inject: (sessionId: SessionId) => ({
      readFile: (path: string, signal?: AbortSignal) => fileBytes.read(sessionId, path, signal),
      fileUrl: (path: string) => fileBytes.url(sessionId, path),
    }),
  }, FileInspector))

  ctx.slots.inject('conversation.details.files', () => ctx.slots.register({
    name: 'conversation.details.files',
    locale: NS,
    inject: (sessionId: SessionId) => ({
      listFiles: (signal?: AbortSignal) => files.list({ sessionId }, signal).then((response) => {
        const { result } = response
        if (!result.ok) throw new Error(`files.list failed: ${result.error.code}`)
        return { rows: result.value.files, truncated: result.value.truncated }
      }),
      openFile: (path: string) => {
        ctx.get('detailsPanel')?.open(sessionId, { turnSeq: 0, filePath: path })
      },
    }),
  }, FileBrowser))

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'session-files',
    // After the subagent catalog (order 10) and the job list (order 20):
    // session lineage reads before session work.
    order: 30,
    locale: NS,
    inject: (sessionId: SessionId) => ({
      openBrowse: (dir: string) => {
        ctx.get('detailsPanel')?.open(sessionId, { turnSeq: 0, browse: dir })
      },
    }),
  }, FilesAction))
}
