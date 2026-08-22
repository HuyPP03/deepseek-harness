/**
 * Locale bundles for the MCP surfaces: the /mcp popup rows, the reconnect
 * gate, and the MCP settings section (list, reconnect/remove, add form).
 * Status words and row details read the host's wire vocabulary (English
 * states), while the surrounding copy follows the active Web locale.
 */

/** Locale keys these surfaces render. */
export type McpKey =
  | 'nav'
  | 'sectionIntro'
  | 'loading'
  | 'loadError'
  | 'retry'
  | 'noServers'
  | 'add'
  | 'addRowDetail'
  | 'statusConnecting'
  | 'statusConnected'
  | 'statusReconnecting'
  | 'statusDown'
  | 'toolsOne'
  | 'toolsMany'
  | 'noTools'
  | 'reconnect'
  | 'reconnecting'
  | 'reconnectTitle'
  | 'reconnectDescription'
  | 'reconnectAcknowledge'
  | 'reconnectCancel'
  | 'reconnectConfirm'
  | 'remove'
  | 'removeTitle'
  | 'removeDescription'
  | 'removeAcknowledge'
  | 'removeCancel'
  | 'removeConfirm'
  | 'removing'
  | 'managedOnly'
  | 'addTitle'
  | 'addIntro'
  | 'serverName'
  | 'serverNamePlaceholder'
  | 'nameRequired'
  | 'nameInvalid'
  | 'nameTaken'
  | 'transport'
  | 'stdio'
  | 'streamableHttp'
  | 'command'
  | 'commandPlaceholder'
  | 'commandRequired'
  | 'args'
  | 'argsPlaceholder'
  | 'env'
  | 'envPlaceholder'
  | 'cwd'
  | 'cwdPlaceholder'
  | 'url'
  | 'urlPlaceholder'
  | 'urlRequired'
  | 'urlInvalid'
  | 'headers'
  | 'headersPlaceholder'
  | 'timeout'
  | 'timeoutPlaceholder'
  | 'cancel'
  | 'create'
  | 'creating'

/** English copy. */
export const en: Record<McpKey, string> = {
  nav: 'MCP servers',
  sectionIntro:
    'External MCP servers this deployment connects to. Profile servers come from the deployment; '
    + 'servers you add here are saved for the next start as well.',
  loading: 'Loading MCP servers…',
  loadError: 'Could not load the MCP servers.',
  retry: 'Retry',
  noServers: 'No MCP servers are connected.',
  add: 'Add an MCP server…',
  addRowDetail: 'Open the MCP settings to register a new server',
  statusConnecting: 'connecting',
  statusConnected: 'connected',
  statusReconnecting: 'reconnecting',
  statusDown: 'disconnected',
  toolsOne: '1 tool',
  toolsMany: '{count} tools',
  noTools: 'no tools',
  reconnect: 'Reconnect',
  reconnecting: 'Reconnecting…',
  reconnectTitle: 'Reconnect “{name}”?',
  reconnectDescription:
    'The connection is dropped and re-established from scratch. '
    + 'Tool calls in flight on this server are interrupted.',
  reconnectAcknowledge: 'I understand in-flight tool calls on this server are interrupted',
  reconnectCancel: 'Back',
  reconnectConfirm: 'Reconnect now',
  remove: 'Remove',
  removeTitle: 'Remove “{name}”?',
  removeDescription:
    'The server definition is deleted and its tools unregistered. '
    + 'Running sessions that called its tools keep their own state.',
  removeAcknowledge: 'I understand the tools of this server are unregistered',
  removeCancel: 'Back',
  removeConfirm: 'Remove server',
  removing: 'Removing…',
  managedOnly: 'This server is declared by the deployment and cannot be removed from here.',
  addTitle: 'Add an MCP server',
  addIntro: 'Register an external MCP server. The name becomes the tool prefix and the settings key.',
  serverName: 'Server name',
  serverNamePlaceholder: 'letters, digits, - and _ (1–32)',
  nameRequired: 'A server name is required.',
  nameInvalid: 'Use 1–32 letters, digits, “-” or “_”.',
  nameTaken: 'A server with this name already exists.',
  transport: 'Transport',
  stdio: 'Local process (stdio)',
  streamableHttp: 'Streamable HTTP endpoint',
  command: 'Command',
  commandPlaceholder: 'the executable to spawn',
  commandRequired: 'The command is required for a stdio server.',
  args: 'Arguments',
  argsPlaceholder: 'one per line',
  env: 'Environment',
  envPlaceholder: 'KEY=value, one per line',
  cwd: 'Working directory',
  cwdPlaceholder: 'empty for the default',
  url: 'Endpoint URL',
  urlPlaceholder: 'https://example.com/mcp',
  urlRequired: 'The endpoint URL is required.',
  urlInvalid: 'The endpoint is not a valid URL.',
  headers: 'Headers',
  headersPlaceholder: 'Name: value, one per line',
  timeout: 'Tool call timeout (ms)',
  timeoutPlaceholder: '60000',
  cancel: 'Cancel',
  create: 'Add server',
  creating: 'Adding…',
}

/** Vietnamese dictionary, checked complete against the en key set. */
export const vi: Record<McpKey, string> = {
  nav: 'Máy chủ MCP',
  sectionIntro:
    'Các máy chủ MCP bên ngoài mà bộ triển khai này kết nối. Máy chủ Profile do bộ triển khai khai báo; '
    + 'máy chủ bạn thêm ở đây cũng được lưu cho lần khởi động tiếp theo.',
  loading: 'Đang tải máy chủ MCP…',
  loadError: 'Không tải được máy chủ MCP.',
  retry: 'Thử lại',
  noServers: 'Chưa có máy chủ MCP nào được kết nối.',
  add: 'Thêm máy chủ MCP…',
  addRowDetail: 'Mở cài đặt MCP để đăng ký máy chủ mới',
  statusConnecting: 'đang kết nối',
  statusConnected: 'đã kết nối',
  statusReconnecting: 'đang kết nối lại',
  statusDown: 'mất kết nối',
  toolsOne: '1 công cụ',
  toolsMany: '{count} công cụ',
  noTools: 'không có công cụ',
  reconnect: 'Kết nối lại',
  reconnecting: 'Đang kết nối lại…',
  reconnectTitle: 'Kết nối lại “{name}”?',
  reconnectDescription:
    'Kết nối sẽ bị ngắt và thiết lập lại từ đầu. '
    + 'Các lời gọi công cụ đang chạy trên máy chủ này sẽ bị gián đoạn.',
  reconnectAcknowledge: 'Tôi hiểu các lời gọi công cụ đang chạy trên máy chủ này sẽ bị gián đoạn',
  reconnectCancel: 'Quay lại',
  reconnectConfirm: 'Kết nối lại ngay',
  remove: 'Gỡ bỏ',
  removeTitle: 'Gỡ bỏ “{name}”?',
  removeDescription:
    'Định nghĩa máy chủ sẽ bị xóa và các công cụ của nó bị hủy đăng ký. '
    + 'Các phiên đang chạy đã gọi công cụ của nó sẽ giữ nguyên trạng thái của riêng mình.',
  removeAcknowledge: 'Tôi hiểu các công cụ của máy chủ này sẽ bị hủy đăng ký',
  removeCancel: 'Quay lại',
  removeConfirm: 'Gỡ bỏ máy chủ',
  removing: 'Đang gỡ bỏ…',
  managedOnly: 'Máy chủ này do bộ triển khai khai báo và không thể gỡ bỏ từ đây.',
  addTitle: 'Thêm máy chủ MCP',
  addIntro: 'Đăng ký một máy chủ MCP bên ngoài. Tên sẽ trở thành tiền tố công cụ và khóa cài đặt.',
  serverName: 'Tên máy chủ',
  serverNamePlaceholder: 'chữ cái, chữ số, - và _ (1–32)',
  nameRequired: 'Cần có tên máy chủ.',
  nameInvalid: 'Dùng 1–32 chữ cái, chữ số, “-” hoặc “_”.',
  nameTaken: 'Đã có máy chủ cùng tên.',
  transport: 'Phương thức truyền',
  stdio: 'Quá trình cục bộ (stdio)',
  streamableHttp: 'Điểm cuối Streamable HTTP',
  command: 'Lệnh',
  commandPlaceholder: 'chương trình thực thi cần khởi tạo',
  commandRequired: 'Lệnh là bắt buộc với máy chủ stdio.',
  args: 'Tham số',
  argsPlaceholder: 'mỗi dòng một',
  env: 'Biến môi trường',
  envPlaceholder: 'KEY=value, mỗi dòng một',
  cwd: 'Thư mục làm việc',
  cwdPlaceholder: 'để trống để dùng mặc định',
  url: 'URL điểm cuối',
  urlPlaceholder: 'https://example.com/mcp',
  urlRequired: 'Cần có URL điểm cuối.',
  urlInvalid: 'Điểm cuối không phải URL hợp lệ.',
  headers: 'Đầu yêu cầu',
  headersPlaceholder: 'Tên: giá trị, mỗi dòng một',
  timeout: 'Thời gian chờ lời gọi công cụ (ms)',
  timeoutPlaceholder: '60000',
  cancel: 'Hủy',
  create: 'Thêm máy chủ',
  creating: 'Đang thêm…',
}

/** 中文文案。 */
export const zh: Record<McpKey, string> = {
  nav: 'MCP 服务器',
  sectionIntro: '本部署连接的外部 MCP 服务器。Profile 服务器由部署声明；在这里添加的服务器会保存并在下次启动时加载。',
  loading: '正在加载 MCP 服务器…',
  loadError: '无法加载 MCP 服务器。',
  retry: '重试',
  noServers: '当前没有已连接的 MCP 服务器。',
  add: '添加 MCP 服务器…',
  addRowDetail: '打开 MCP 设置以注册新的服务器',
  statusConnecting: '连接中',
  statusConnected: '已连接',
  statusReconnecting: '重连中',
  statusDown: '已断开',
  toolsOne: '1 个工具',
  toolsMany: '{count} 个工具',
  noTools: '无工具',
  reconnect: '重新连接',
  reconnecting: '正在重连…',
  reconnectTitle: '重新连接“{name}”？',
  reconnectDescription: '连接会被断开并从零重建。该服务器上正在执行的工具调用会被中断。',
  reconnectAcknowledge: '我了解该服务器上正在执行的工具调用会被中断',
  reconnectCancel: '返回',
  reconnectConfirm: '立即重连',
  remove: '移除',
  removeTitle: '移除“{name}”？',
  removeDescription: '服务器定义将被删除，其注册的工具会被注销。已运行会话中调用过其工具的状态保持不变。',
  removeAcknowledge: '我了解该服务器注册的工具会被注销',
  removeCancel: '返回',
  removeConfirm: '移除服务器',
  removing: '正在移除…',
  managedOnly: '该服务器由部署声明，无法在此处移除。',
  addTitle: '添加 MCP 服务器',
  addIntro: '注册一个外部 MCP 服务器。名称将成为工具前缀和设置键。',
  serverName: '服务器名称',
  serverNamePlaceholder: '字母、数字、- 和 _（1–32 位）',
  nameRequired: '请填写服务器名称。',
  nameInvalid: '请使用 1–32 位字母、数字、“-”或“_”。',
  nameTaken: '已存在同名服务器。',
  transport: '传输方式',
  stdio: '本地进程（stdio）',
  streamableHttp: 'Streamable HTTP 端点',
  command: '命令',
  commandPlaceholder: '要启动的可执行程序',
  commandRequired: 'stdio 服务器需要命令。',
  args: '参数',
  argsPlaceholder: '每行一个',
  env: '环境变量',
  envPlaceholder: 'KEY=value，每行一个',
  cwd: '工作目录',
  cwdPlaceholder: '留空使用默认',
  url: '端点 URL',
  urlPlaceholder: 'https://example.com/mcp',
  urlRequired: '请填写端点 URL。',
  urlInvalid: '端点不是有效的 URL。',
  headers: '请求头',
  headersPlaceholder: '名称: 值，每行一个',
  timeout: '工具调用超时（毫秒）',
  timeoutPlaceholder: '60000',
  cancel: '取消',
  create: '添加服务器',
  creating: '正在添加…',
}
