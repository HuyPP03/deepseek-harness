/**
 * `slashTools` namespace dictionaries.
 */

/** English dictionary (the key-set source of truth). */
export const en = {
  'command.clearDescription': 'Clear this conversation: start a fresh one in the same workspace',
  'command.helpDescription': 'List the slash commands available in this session',
} satisfies Record<string, string>

/** The slash tools namespace key union. */
export type SlashToolsKey = keyof typeof en

/** Vietnamese dictionary, checked complete against the en key set. */
export const vi = {
  'command.clearDescription': 'Xóa cuộc trò chuyện này: bắt đầu một cuộc trò chuyện mới trong cùng workspace',
  'command.helpDescription': 'Liệt kê các lệnh slash có sẵn trong session này',
} satisfies Record<SlashToolsKey, string>

/** Simplified Chinese dictionary, checked complete against the en key set. */
export const zh = {
  'command.clearDescription': '清空本会话：在同一工作区开一个新会话',
  'command.helpDescription': '列出本会话可用的斜杠命令',
} satisfies Record<SlashToolsKey, string>

/** The locale namespace this plugin registers. */
export const NS = 'slashTools' as const
