/** File inspector copy: the tab labels and the loading / empty / error states. */

/** One dictionary key of the inspector namespace. */
export type FileInspectorKey =
  | 'tab.changes'
  | 'tab.code'
  | 'tab.preview'
  | 'changes.empty'
  | 'code.loading'
  | 'code.binary'
  | 'code.empty'
  | 'code.unreadable'
  | 'code.tooLarge'
  | 'preview.failed'

/** The Chinese dictionary (the product's default locale). */
export const zh: Record<FileInspectorKey, string> = {
  'tab.changes': '变更',
  'tab.code': '代码',
  'tab.preview': '预览',
  'changes.empty': '当前窗口内没有该文件的变更',
  'code.loading': '载入文件…',
  'code.binary': '二进制文件，无代码视图',
  'code.empty': '空文件',
  'code.unreadable': '文件不可读（权限或平台错误）',
  'code.tooLarge': '文件超过 25 MiB 边界，无法在检视器中显示',
  'preview.failed': '预览失败（文件无法解析）',
}

/** The English dictionary. */
export const en: Record<FileInspectorKey, string> = {
  'tab.changes': 'Changes',
  'tab.code': 'Code',
  'tab.preview': 'Preview',
  'changes.empty': 'No changes to this file in the current window',
  'code.loading': 'Loading file…',
  'code.binary': 'Binary file, no code view',
  'code.empty': 'Empty file',
  'code.unreadable': 'The file is not readable (permission or platform error)',
  'code.tooLarge': 'The file exceeds the 25 MiB bound and cannot be shown in the inspector',
  'preview.failed': 'The preview failed (the file could not be parsed)',
}
