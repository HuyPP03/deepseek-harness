/** `sidebar` namespace dictionaries: shell controls (brand row, tabs, New button, fold toggle). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'session.new': '新会话',
  'session.new.label': '新建会话',
  'chat.new': '新聊天',
  'chat.new.label': '新建聊天',
  'tab.chats': '聊天',
  'tab.workspaces': '工作区',
  'tabs.label': '浏览标签',
  'toggle.open': '打开侧边栏',
  'toggle.collapse': '收起侧边栏',
} satisfies Record<string, string>

/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'session.new': 'New Session',
  'session.new.label': 'New session',
  'chat.new': 'New Chat',
  'chat.new.label': 'New chat',
  'tab.chats': 'Chats',
  'tab.workspaces': 'Workspaces',
  'tabs.label': 'Browse tabs',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
} satisfies Record<SidebarKey, string>
