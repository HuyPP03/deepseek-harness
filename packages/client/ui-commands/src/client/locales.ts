/** `command` namespace dictionaries (the popupSelect shell's copy). */

/** English dictionary (the key-set source of truth). */
export const en = {
  'search.placeholder': 'Search…',
  'search.aria': 'Filter options',
  'status.loading': 'Loading options…',
  'status.applying': 'Applying…',
  'status.empty': 'No options',
  'overlay.aria': '/{command} options',
  'listbox.aria': '/{command} matches',
} satisfies Record<string, string>

/** The command namespace key union. */
export type CommandKey = keyof typeof en

/** Vietnamese dictionary, checked complete against the en key set. */
export const vi = {
  'search.placeholder': 'Tìm kiếm…',
  'search.aria': 'Lọc tùy chọn',
  'status.loading': 'Đang tải tùy chọn…',
  'status.applying': 'Đang áp dụng…',
  'status.empty': 'Không có tùy chọn nào',
  'overlay.aria': 'Tùy chọn /{command}',
  'listbox.aria': 'Các kết quả khớp /{command}',
} satisfies Record<CommandKey, string>

/** Simplified Chinese dictionary, checked complete against the en key set. */
export const zh = {
  'search.placeholder': '搜索…',
  'search.aria': '筛选选项',
  'status.loading': '正在加载选项…',
  'status.applying': '正在应用…',
  'status.empty': '无选项',
  'overlay.aria': '/{command} 选项',
  'listbox.aria': '/{command} 匹配项',
} satisfies Record<CommandKey, string>
