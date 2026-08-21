/**
 * File inspector plugin, browser half: one registration — FileInspector
 * occupies the conversation.details.file seat the details panel renders for
 * a file selection. The seat's declaration belongs to ui-conversation's
 * 'details' entry; activation order relative to it is unconstrained, so the
 * registration waits on the declaration through slots.inject. The byte read
 * is the runtime's file-bytes service (a hard dependency: the Code tab is
 * the seat's reason to exist), closed over into a plain callback — the
 * component never sees ctx.
 */
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext, FileBytesService } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the seat's declaration).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { FileInspector } from './FileInspector.tsx'
import { en, zh, type FileInspectorKey } from './locales.ts'

export type { FileInspectorInjected, FileInspectorProps } from './contract/slots.ts'
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
 * ledger), the file-bytes service the Code tab reads through, and the locale
 * plugin (dictionary registration).
 */
export const inject = ['slots', 'fileBytes', 'locale']

/**
 * Register the inspector once the seat's declaration is on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-file-inspector: dictionaries')

  const fileBytes = ctx.get('fileBytes') as FileBytesService
  ctx.slots.inject('conversation.details.file', () => ctx.slots.register({
    name: 'conversation.details.file',
    locale: NS,
    inject: (sessionId: SessionId) => ({
      readFile: (path: string, signal?: AbortSignal) => fileBytes.read(sessionId, path, signal),
    }),
  }, FileInspector))
}
