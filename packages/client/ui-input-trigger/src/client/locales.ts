/**
 * `slash.menu` namespace dictionaries: group titles keyed by source name
 * (the lookup chain returns the key itself, so an unknown source shows its
 * raw name), the pending row, and the listbox aria label.
 */

/** English dictionary (the key-set source of truth). */
export const en = {
  'command': 'Commands',
  'skill': 'Skills',
  'subagent': 'Subagents',
  'files': 'Files',
  'loading': 'Loading…',
  'suggestions.aria': 'Trigger suggestions',
} satisfies Record<string, string>

/** The slash.menu namespace key union. */
export type MenuKey = keyof typeof en

/** Vietnamese dictionary, checked complete against the en key set. */
export const vi = {
  'command': 'Lệnh',
  'skill': 'Skill',
  'subagent': 'Subagent',
  'files': 'Tệp',
  'loading': 'Đang tải…',
  'suggestions.aria': 'Gợi ý trigger',
} satisfies Record<MenuKey, string>

/** Simplified Chinese dictionary, checked complete against the en key set. */
export const zh = {
  'command': '命令',
  'skill': '技能',
  'subagent': '子智能体',
  'files': '文件',
  'loading': '正在加载…',
  'suggestions.aria': '触发候选建议',
} satisfies Record<MenuKey, string>
