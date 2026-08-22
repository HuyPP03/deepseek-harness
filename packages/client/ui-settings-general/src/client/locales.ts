/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** English dictionary (the key-set source of truth). */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Close',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof en

/** Vietnamese dictionary, checked complete against the en key set. */
export const vi = {
  'trigger': 'Cài đặt',
  'title': 'Cài đặt',
  'close': 'Đóng',
  'openDocument': 'Mở tệp cấu hình',
  'openDocument.error': 'Không mở được tệp cấu hình',
  'general.nav': 'Chung',
} satisfies Record<SettingsKey, string>

/** Simplified Chinese dictionary, checked complete against the en key set. */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '关闭',
  'openDocument': '打开配置文件',
  'openDocument.error': '无法打开配置文件',
  'general.nav': '通用设置',
} satisfies Record<SettingsKey, string>
