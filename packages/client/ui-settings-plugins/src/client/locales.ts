/** Locale bundles for the plugin configuration section and its plugin cards. */

/** Locale keys these surfaces render. */
export type PluginsSettingsLocaleKey =
  | 'nav' | 'title' | 'intro' | 'tabs' | 'configurableTab' | 'empty'
  | 'overridden' | 'reset' | 'readOnly' | 'expand' | 'collapse'
  | 'save' | 'saving' | 'discard' | 'unsaved' | 'saveFailed' | 'invalidNumber'
  | 'bashTitle' | 'bashDescription' | 'bashTimeoutMs' | 'bashTimeoutMsHint'
  | 'bashMaxOutputBytes' | 'bashMaxOutputBytesHint'
  | 'agentLoopTitle' | 'agentLoopDescription' | 'agentLoopMaxParallel' | 'agentLoopMaxParallelHint'
  | 'webSearchTitle' | 'webSearchDescription'
  | 'webSearchProvider' | 'webSearchProviderHint' | 'webSearchProviderInvalid'
  | 'webSearchBaseUrl' | 'webSearchBaseUrlHint'

/** English copy. */
export const en: Record<PluginsSettingsLocaleKey, string> = {
  nav: 'Plugins',
  title: 'Plugins',
  intro: 'Configure and inspect the plugins installed in this deployment.',
  tabs: 'Plugin views',
  configurableTab: 'Plugin configuration',
  empty: 'This deployment exposes no plugin settings.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  expand: 'Show settings',
  collapse: 'Hide settings',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  unsaved: 'Unsaved',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidNumber: 'Enter a number, or leave blank to use the default.',
  bashTitle: 'Shell',
  bashDescription: 'Limits every command the agent runs.',
  bashTimeoutMs: 'Command timeout (ms)',
  bashTimeoutMsHint: 'How long one command may run before it is terminated.',
  bashMaxOutputBytes: 'Output cap per stream (bytes)',
  bashMaxOutputBytesHint: 'Output beyond this spills to a temporary file rather than being lost.',
  agentLoopTitle: 'Agent loop',
  agentLoopDescription: 'How the agent dispatches tool calls.',
  agentLoopMaxParallel: 'Parallel tool calls',
  agentLoopMaxParallelHint: 'Upper bound on parallel-safe calls running at once within one step.',
  webSearchTitle: 'Web search',
  webSearchDescription: 'The keyless websift search provider.',
  webSearchProvider: 'Backend',
  webSearchProviderHint: 'ddgs searches DuckDuckGo; searxng uses the endpoint below.',
  webSearchProviderInvalid: 'Enter ddgs or searxng.',
  webSearchBaseUrl: 'Endpoint',
  webSearchBaseUrlHint: 'SearXNG endpoint base, used only by the searxng backend. Leave blank to keep the inherited value.',
}

/** Vietnamese copy. */
export const vi: Record<PluginsSettingsLocaleKey, string> = {
  nav: 'Plugin',
  title: 'Plugin',
  intro: 'Cấu hình và kiểm tra các plugin đã cài trong bộ triển khai này.',
  tabs: 'Góc nhìn plugin',
  configurableTab: 'Cấu hình plugin',
  empty: 'Bộ triển khai này không có cài đặt plugin nào.',
  overridden: 'Đã ghi đè',
  reset: 'Đặt lại mặc định',
  readOnly: 'Bộ triển khai này lưu cài đặt ở chế độ chỉ đọc.',
  expand: 'Hiển thị cài đặt',
  collapse: 'Ẩn cài đặt',
  save: 'Lưu',
  saving: 'Đang lưu…',
  discard: 'Hủy bỏ',
  unsaved: 'Chưa lưu',
  saveFailed: 'Bộ triển khai không chấp nhận các giá trị này; chúng được giữ lại để bạn chỉnh sửa.',
  invalidNumber: 'Nhập một số, hoặc để trống để dùng giá trị mặc định.',
  bashTitle: 'Shell',
  bashDescription: 'Đặt giới hạn cho mọi lệnh agent chạy.',
  bashTimeoutMs: 'Giới hạn thời gian lệnh (ms)',
  bashTimeoutMsHint: 'Một lệnh được phép chạy bao lâu trước khi bị kết thúc.',
  bashMaxOutputBytes: 'Giới hạn đầu ra mỗi luồng (byte)',
  bashMaxOutputBytesHint: 'Đầu ra vượt quá giới hạn này được đổ sang file tạm thay vì bị mất.',
  agentLoopTitle: 'Vòng lặp agent',
  agentLoopDescription: 'Cách agent điều phối các lần gọi công cụ.',
  agentLoopMaxParallel: 'Gọi công cụ song song',
  agentLoopMaxParallelHint: 'Giới hạn trên của các lần gọi an toàn song song chạy cùng lúc trong một bước.',
  webSearchTitle: 'Tìm kiếm web',
  webSearchDescription: 'Nhà cung cấp tìm kiếm websift không cần khóa.',
  webSearchProvider: 'Backend',
  webSearchProviderHint: 'ddgs tìm trên DuckDuckGo; searxng dùng điểm cuối bên dưới.',
  webSearchProviderInvalid: 'Nhập ddgs hoặc searxng.',
  webSearchBaseUrl: 'URL',
  webSearchBaseUrlHint: 'Điểm cuối SearXNG, chỉ backend searxng dùng. Để trống để giữ giá trị kế thừa.',
}

/** Simplified Chinese copy. */
export const zh: Record<PluginsSettingsLocaleKey, string> = {
  nav: '插件',
  title: '插件',
  intro: '配置和查看本部署已安装的插件。',
  tabs: '插件视图',
  configurableTab: '插件配置',
  empty: '本部署没有开放任何插件设置。',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  expand: '展开设置',
  collapse: '收起设置',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  unsaved: '未保存',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  invalidNumber: '请填数字；留空表示使用默认值。',
  bashTitle: '终端',
  bashDescription: '限制 agent 运行的每一条命令。',
  bashTimeoutMs: '命令超时（毫秒）',
  bashTimeoutMsHint: '单条命令允许运行多久，超时即终止。',
  bashMaxOutputBytes: '单流输出上限（字节）',
  bashMaxOutputBytesHint: '超出部分会转存到临时文件，而不是被丢弃。',
  agentLoopTitle: 'Agent 循环',
  agentLoopDescription: 'Agent 如何派发工具调用。',
  agentLoopMaxParallel: '并行工具调用数',
  agentLoopMaxParallelHint: '同一步内最多同时运行多少个可并行的调用。',
  webSearchTitle: '网页搜索',
  webSearchDescription: '无需密钥的 websift 搜索提供方。',
  webSearchProvider: '后端',
  webSearchProviderHint: 'ddgs 使用 DuckDuckGo 搜索；searxng 使用下方端点。',
  webSearchProviderInvalid: '请输入 ddgs 或 searxng。',
  webSearchBaseUrl: '接口地址',
  webSearchBaseUrlHint: 'SearXNG 端点基址，仅 searxng 后端使用。留空则保持继承值。',
}
