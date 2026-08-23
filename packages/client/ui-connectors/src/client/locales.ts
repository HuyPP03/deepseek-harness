/** Locale bundles for the connectors sidebar region and its token dialog. */

/** Locale keys the region renders. */
export type ConnectorsKey =
  | 'loading' | 'error' | 'retry' | 'empty'
  | 'state.unconfigured' | 'state.needs-auth' | 'state.authorizing' | 'state.connecting'
  | 'state.connected' | 'state.reconnecting' | 'state.down' | 'state.error'
  | 'connect' | 'disconnect' | 'configure'
  | 'custom' | 'servers.one' | 'servers.many' | 'server.off'
  | 'rail.label'
  | 'back' | 'sessions.placeholder' | 'tools.available'
  | 'dialog.title' | 'dialog.tokenPlaceholder'
  | 'dialog.cancel' | 'dialog.save' | 'dialog.saving'

/** English dictionary (the key-set source of truth). */
export const en: Record<ConnectorsKey, string> = {
  loading: 'Loading connectors…',
  error: 'Could not load connectors.',
  retry: 'Retry',
  empty: 'No connectors are composed on this deployment.',
  'state.unconfigured': 'Unconfigured',
  'state.needs-auth': 'Needs auth',
  'state.authorizing': 'Authorizing',
  'state.connecting': 'Connecting',
  'state.connected': 'Connected',
  'state.reconnecting': 'Reconnecting',
  'state.down': 'Disconnected',
  'state.error': 'Error',
  connect: 'Connect',
  disconnect: 'Disconnect',
  configure: 'Configure',
  custom: 'Custom',
  'servers.one': '{count} server',
  'servers.many': '{count} servers',
  'server.off': 'not mounted',
  'rail.label': 'Connectors',
  back: 'Back',
  'sessions.placeholder': 'Sessions for this provider will appear here once a connector session is created.',
  'tools.available': 'Available tools',
  'dialog.title': 'Connect {name}',
  'dialog.tokenPlaceholder': 'Paste your token',
  'dialog.cancel': 'Cancel',
  'dialog.save': 'Save & connect',
  'dialog.saving': 'Saving…',
}

/** Vietnamese dictionary, checked complete against the en key set. */
export const vi: Record<ConnectorsKey, string> = {
  loading: 'Đang tải kết nối…',
  error: 'Không thể tải kết nối.',
  retry: 'Thử lại',
  empty: 'Bản triển khai này không có kết nối nào.',
  'state.unconfigured': 'Chưa cấu hình',
  'state.needs-auth': 'Cần xác thực',
  'state.authorizing': 'Đang cấp quyền',
  'state.connecting': 'Đang kết nối',
  'state.connected': 'Đã kết nối',
  'state.reconnecting': 'Đang kết nối lại',
  'state.down': 'Đã ngắt kết nối',
  'state.error': 'Lỗi',
  connect: 'Kết nối',
  disconnect: 'Ngắt kết nối',
  configure: 'Cấu hình',
  custom: 'Tùy chỉnh',
  'servers.one': '{count} máy chủ',
  'servers.many': '{count} máy chủ',
  'server.off': 'chưa bật',
  'rail.label': 'Kết nối',
  back: 'Quay lại',
  'sessions.placeholder': 'Các phiên của nhà cung cấp này sẽ hiển thị tại đây khi một phiên kết nối được tạo.',
  'tools.available': 'Công cụ khả dụng',
  'dialog.title': 'Kết nối {name}',
  'dialog.tokenPlaceholder': 'Dán token của bạn',
  'dialog.cancel': 'Hủy',
  'dialog.save': 'Lưu & kết nối',
  'dialog.saving': 'Đang lưu…',
}

/** Simplified Chinese dictionary, checked complete against the en key set. */
export const zh: Record<ConnectorsKey, string> = {
  loading: '正在加载连接器…',
  error: '无法加载连接器。',
  retry: '重试',
  empty: '此部署未配置任何连接器。',
  'state.unconfigured': '未配置',
  'state.needs-auth': '需要授权',
  'state.authorizing': '正在授权',
  'state.connecting': '正在连接',
  'state.connected': '已连接',
  'state.reconnecting': '正在重连',
  'state.down': '已断开',
  'state.error': '错误',
  connect: '连接',
  disconnect: '断开',
  configure: '配置',
  custom: '自定义',
  'servers.one': '{count} 个服务器',
  'servers.many': '{count} 个服务器',
  'server.off': '未挂载',
  'rail.label': '连接器',
  back: '返回',
  'sessions.placeholder': '此提供商的会话将在创建连接器会话后显示在此处。',
  'tools.available': '可用工具',
  'dialog.title': '连接 {name}',
  'dialog.tokenPlaceholder': '粘贴你的令牌',
  'dialog.cancel': '取消',
  'dialog.save': '保存并连接',
  'dialog.saving': '正在保存…',
}
