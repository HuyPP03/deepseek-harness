/** File inspector copy: the tab labels and the loading / empty / error states. */

/** One dictionary key of the inspector namespace. */
export type FileInspectorKey =
  | 'action.files'
  | 'tab.changes'
  | 'tab.code'
  | 'tab.preview'
  | 'changes.empty'
  | 'browser.filterPlaceholder'
  | 'browser.loading'
  | 'browser.empty'
  | 'browser.failed'
  | 'browser.truncated'
  | 'code.loading'
  | 'code.binary'
  | 'code.empty'
  | 'code.unreadable'
  | 'code.tooLarge'
  | 'preview.failed'

/** The Chinese dictionary (the product's default locale). */
export const zh: Record<FileInspectorKey, string> = {
  'action.files': '会话文件',
  'tab.changes': '变更',
  'tab.code': '代码',
  'tab.preview': '预览',
  'changes.empty': '当前窗口内没有该文件的变更',
  'browser.filterPlaceholder': '过滤文件…',
  'browser.loading': '载入文件列表…',
  'browser.empty': '此目录下没有可显示的文件',
  'browser.failed': '文件列表加载失败',
  'browser.truncated': '仅显示前 100 条（列表被截断）',
  'code.loading': '载入文件…',
  'code.binary': '二进制文件，无代码视图',
  'code.empty': '空文件',
  'code.unreadable': '文件不可读（权限或平台错误）',
  'code.tooLarge': '文件超过 25 MiB 边界，无法在检视器中显示',
  'preview.failed': '预览失败（文件无法解析）',
}

/** The English dictionary. */
export const en: Record<FileInspectorKey, string> = {
  'action.files': 'Session files',
  'tab.changes': 'Changes',
  'tab.code': 'Code',
  'tab.preview': 'Preview',
  'changes.empty': 'No changes to this file in the current window',
  'browser.filterPlaceholder': 'Filter files…',
  'browser.loading': 'Loading file list…',
  'browser.empty': 'No files to show in this directory',
  'browser.failed': 'The file list failed to load',
  'browser.truncated': 'Showing the first 100 rows (the list is truncated)',
  'code.loading': 'Loading file…',
  'code.binary': 'Binary file, no code view',
  'code.empty': 'Empty file',
  'code.unreadable': 'The file is not readable (permission or platform error)',
  'code.tooLarge': 'The file exceeds the 25 MiB bound and cannot be shown in the inspector',
  'preview.failed': 'The preview failed (the file could not be parsed)',
}
