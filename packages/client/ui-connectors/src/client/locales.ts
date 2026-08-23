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
  | 'remove'
  | 'custom.new.button'
  | 'custom.new.title'
  | 'custom.new.name' | 'custom.new.id' | 'custom.new.transport'
  | 'custom.new.transport.stdio' | 'custom.new.transport.http'
  | 'custom.new.command' | 'custom.new.args' | 'custom.new.url'
  | 'custom.new.tokenVar' | 'custom.new.tokenVarIsHeader'
  | 'custom.new.save' | 'custom.new.saving'

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
  remove: 'Remove',
  'custom.new.button': 'New connector',
  'custom.new.title': 'New custom connector',
  'custom.new.name': 'Name',
  'custom.new.id': 'Id (optional)',
  'custom.new.transport': 'Transport',
  'custom.new.transport.stdio': 'stdio (command)',
  'custom.new.transport.http': 'streamable-http (url)',
  'custom.new.command': 'Command',
  'custom.new.args': 'Args (comma-separated)',
  'custom.new.url': 'URL',
  'custom.new.tokenVar': 'Token variable (optional)',
  'custom.new.tokenVarIsHeader': 'Token is an HTTP header',
  'custom.new.save': 'Create',
  'custom.new.saving': 'Creating…',
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
  remove: 'Xóa',
  'custom.new.button': 'Kết nối mới',
  'custom.new.title': 'Kết nối tùy chỉnh mới',
  'custom.new.name': 'Tên',
  'custom.new.id': 'Id (tuỳ chọn)',
  'custom.new.transport': 'Transport',
  'custom.new.transport.stdio': 'stdio (lệnh)',
  'custom.new.transport.http': 'streamable-http (url)',
  'custom.new.command': 'Lệnh',
  'custom.new.args': 'Đối số (phân tách bằng dấu phẩy)',
  'custom.new.url': 'URL',
  'custom.new.tokenVar': 'Biến token (tuỳ chọn)',
  'custom.new.tokenVarIsHeader': 'Token là HTTP header',
  'custom.new.save': 'Tạo',
  'custom.new.saving': 'Đang tạo…',
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
  remove: '移除',
  'custom.new.button': '新建连接器',
  'custom.new.title': '新建自定义连接器',
  'custom.new.name': '名称',
  'custom.new.id': 'Id（可选）',
  'custom.new.transport': '传输',
  'custom.new.transport.stdio': 'stdio（命令）',
  'custom.new.transport.http': 'streamable-http（url）',
  'custom.new.command': '命令',
  'custom.new.args': '参数（逗号分隔）',
  'custom.new.url': 'URL',
  'custom.new.tokenVar': '令牌变量（可选）',
  'custom.new.tokenVarIsHeader': '令牌是 HTTP 头',
  'custom.new.save': '创建',
  'custom.new.saving': '正在创建…',
}
