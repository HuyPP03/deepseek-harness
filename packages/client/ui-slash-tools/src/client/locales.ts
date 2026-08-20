/**
 * `slashTools` namespace dictionaries.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'command.clearDescription': '清空本会话：在同一工作区开一个新会话',
} satisfies Record<string, string>

/** The slash tools namespace key union. */
export type SlashToolsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'command.clearDescription': 'Clear this conversation: start a fresh one in the same workspace',
} satisfies Record<SlashToolsKey, string>

/** The locale namespace this plugin registers. */
export const NS = 'slashTools' as const
