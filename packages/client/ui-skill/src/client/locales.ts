/** `skill` namespace dictionaries for the dedicated tool row. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'skill'

/** English dictionary (the key-set source of truth). */
export const en = {
  'row.running': 'Loading skill',
  'row.failed': 'Skill load failed',
  'row.stopped': 'Skill load stopped',
  'row.instructions': 'Instructions',
  'menu.userOnly': 'user-only',
} satisfies Record<string, string>

/** The skill namespace key union. */
export type SkillKey = keyof typeof en

/** Vietnamese dictionary, checked complete against the en key set. */
export const vi = {
  'row.running': 'Đang tải skill',
  'row.failed': 'Tải skill thất bại',
  'row.stopped': 'Tải skill bị dừng',
  'row.instructions': 'Hướng dẫn',
  'menu.userOnly': 'chỉ người dùng',
} satisfies Record<SkillKey, string>

/** Simplified Chinese dictionary, checked complete against the en key set. */
export const zh = {
  'row.running': '正在加载 skill',
  'row.failed': 'skill 加载失败',
  'row.stopped': 'skill 加载已中止',
  'row.instructions': '说明',
  'menu.userOnly': '仅用户',
} satisfies Record<SkillKey, string>
