/** `deliverables` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'deliverables'

/** English dictionary (the key-set source of truth). */
export const en = {
  'produced.label': 'Produced',
  'produced.moreOne': '+ 1 file',
  'produced.more': '+ {count} files',
  'produced.open': 'Open {name}',
  'produced.showInFolder': 'Show in folder',
} satisfies Record<string, string>

/** Union of this namespace's dictionary keys. */
export type DeliverablesKey = keyof typeof en

/** Vietnamese dictionary, checked complete against the en key set. */
export const vi = {
  'produced.label': 'Đã tạo ra',
  'produced.moreOne': '+ 1 tệp',
  'produced.more': '+ {count} tệp',
  'produced.open': 'Mở {name}',
  'produced.showInFolder': 'Hiển thị trong thư mục',
} satisfies Record<DeliverablesKey, string>

/** Simplified Chinese dictionary, checked complete against the en key set. */
export const zh = {
  'produced.label': '产物',
  'produced.moreOne': '+ 1 个文件',
  'produced.more': '+ {count} 个文件',
  'produced.open': '打开 {name}',
  'produced.showInFolder': '在文件夹中显示',
} satisfies Record<DeliverablesKey, string>
