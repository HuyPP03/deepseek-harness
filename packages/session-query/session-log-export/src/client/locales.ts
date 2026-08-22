/** Locale namespace owned by Session export browser feedback. */
export const NS = 'session-log-download'

/** English Session export strings (the key-set source of truth). */
export const en = {
  'dialog.preparingTitle': 'Exporting Session',
  'dialog.preparingDescription': 'Preparing a ZIP containing this Session, its sub-Sessions, and attachments.',
  'dialog.successTitle': 'Session download started',
  'dialog.successDescription': 'The browser is downloading the Session ZIP.',
  'dialog.errorTitle': 'Session export failed',
  'dialog.close': 'Close',
  'dialog.commandFailed': 'Could not start the Session export.',
} satisfies Record<string, string>

/** Stable locale keys consumed by the shared modal. */
export type SessionLogDownloadKey = keyof typeof en

/** Vietnamese Session export strings, checked complete against the en key set. */
export const vi: Record<SessionLogDownloadKey, string> = {
  'dialog.preparingTitle': 'Đang xuất Session',
  'dialog.preparingDescription': 'Đang chuẩn bị tệp ZIP chứa Session hiện tại, các sub-Session và tệp đính kèm.',
  'dialog.successTitle': 'Tải xuống Session đã bắt đầu',
  'dialog.successDescription': 'Trình duyệt đang tải tệp ZIP của Session.',
  'dialog.errorTitle': 'Xuất Session thất bại',
  'dialog.close': 'Đóng',
  'dialog.commandFailed': 'Không thể bắt đầu xuất Session.',
}

/** Simplified-Chinese Session export strings, checked complete against the en key set. */
export const zh: Record<SessionLogDownloadKey, string> = {
  'dialog.preparingTitle': '正在导出 Session',
  'dialog.preparingDescription': '正在准备包含当前 Session、子 Session 和附件的 ZIP 文件。',
  'dialog.successTitle': 'Session 导出已开始下载',
  'dialog.successDescription': '浏览器正在下载 Session ZIP 文件。',
  'dialog.errorTitle': 'Session 导出失败',
  'dialog.close': '关闭',
  'dialog.commandFailed': '无法启动 Session 导出。',
}
