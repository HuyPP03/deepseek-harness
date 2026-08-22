/** VitePress configuration for the locally projected documentation site. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DefaultTheme, PageData } from 'vitepress'
import type { ViteDevServer } from 'vite'
import { withMermaid } from 'vitepress-plugin-mermaid'
import { landingLink, orderedPages, routeLink, sectionSpec, type DocsLocale, type DocsPage, type DocsSidebar } from '../docs.ts'
import { docsSourceFiles, projectDocs } from '../../scripts/project-doc-site.ts'

projectDocs()

function sidebar(locale: DocsLocale, collection: NonNullable<DocsPage['sidebar']>): DefaultTheme.SidebarItem[] {
  // `orderedPages` already sorts by section placement, so insertion order
  // carries the group order and each group keeps its pages in sequence.
  const groups = new Map<string, DocsPage[]>()
  for (const page of orderedPages(locale, collection)) {
    const entries = groups.get(page.section) ?? []
    entries.push(page)
    groups.set(page.section, entries)
  }
  return [...groups.entries()].map(([text, entries]) => {
    const { collapsed } = sectionSpec(locale, text)
    return {
      text,
      // A present `collapsed` is what makes the default theme render the
      // group as collapsible at all, so an open group must omit the key.
      ...(collapsed === undefined ? {} : { collapsed }),
      items: entries.map(page => ({ text: page.label, link: routeLink(page.route) })),
    }
  })
}

/** One module link shared between the navigation bar and the guide sidebar. */
interface GuideModuleLink {
  /** Label shown in the navigation bar and the guide sidebar. */
  label: string
  /** Sidebar collection the link opens. */
  collection: DocsSidebar
}

/**
 * Per-locale guide-module facts: the guide collection and the module links
 * appended to the guide sidebar.
 */
interface GuideModules {
  /** Guide sidebar collection for the locale. */
  guide: 'en-guide' | 'zh-guide' | 'vi-guide'
  /** Development module link. */
  develop: GuideModuleLink
  /** Reference module link. */
  reference: GuideModuleLink
}

/**
 * Guide-module facts keyed by locale, giving every module label and collection
 * one home shared by the navigation bar and the guide sidebar.
 */
const guideModules = {
  root: {
    guide: 'en-guide',
    develop: { label: 'Development', collection: 'en-develop' },
    reference: { label: 'Reference', collection: 'en-reference' },
  },
  zh: {
    guide: 'zh-guide',
    develop: { label: '开发', collection: 'zh-develop' },
    reference: { label: '参考', collection: 'zh-reference' },
  },
  vi: {
    guide: 'vi-guide',
    develop: { label: 'Phát triển', collection: 'vi-develop' },
    reference: { label: 'Tham khảo', collection: 'vi-reference' },
  },
} satisfies Record<DocsLocale, GuideModules>

/**
 * Guide sidebar with direct links into the first development and reference pages.
 *
 * @param locale - Route tree whose guide sidebar is being built.
 * @returns Guide groups followed by top-level links to the other documentation modules.
 */
function guideSidebar(locale: DocsLocale): DefaultTheme.SidebarItem[] {
  const { guide, develop, reference } = guideModules[locale]
  return [
    ...sidebar(locale, guide),
    ...[develop, reference].map(({ label, collection }) => ({
      text: label,
      link: landingLink(locale, collection),
    })),
  ]
}

/**
 * Navigation-bar items for the modules the guide sidebar links into, reading
 * their labels and collections from the shared per-locale record.
 *
 * @param locale - Route tree the navigation items belong to.
 * @returns The module items for the locale's navigation bar.
 */
function moduleNav(locale: DocsLocale): DefaultTheme.NavItem[] {
  const { develop, reference } = guideModules[locale]
  const routePrefix = locale === 'root' ? '' : locale === 'zh' ? '/zh' : '/vi'
  return [
    { text: develop.label, link: landingLink(locale, develop.collection), activeMatch: `^${routePrefix}/develop/` },
    { text: reference.label, link: landingLink(locale, reference.collection), activeMatch: `^${routePrefix}/reference/` },
  ]
}

function watchCanonicalDocs(server: ViteDevServer): void {
  const sources = docsSourceFiles()
  server.watcher.add(sources)
  server.watcher.on('change', (changed) => {
    if (!sources.includes(changed)) return
    projectDocs()
  })
}

function escapeVueInterpolation(html: string): string {
  return html.replaceAll('{{', '&#123;&#123;').replaceAll('}}', '&#125;&#125;')
}

/**
 * Resolve the GitHub edit URL for a projected page from its frontmatter.
 *
 * @param page Data of the rendered page, carrying the projector's `editSource` frontmatter.
 * @returns The canonical source file's GitHub edit URL.
 * @throws When the page carries no projector `editSource` frontmatter.
 */
function editSourcePattern({ frontmatter }: PageData): string {
  const data: unknown = frontmatter
  const editSource: unknown = typeof data === 'object' && data !== null ? Reflect.get(data, 'editSource') : undefined
  if (typeof editSource !== 'string') throw new Error('Projected documentation page has no editSource frontmatter.')
  return `https://github.com/deepseek-ai/deepseek-harness/edit/master/${editSource}`
}

const sharedTheme: Pick<DefaultTheme.Config, 'search' | 'socialLinks' | 'editLink'> = {
  search: {
    provider: 'local',
    options: {
      locales: {
        zh: {
          translations: {
            button: {
              buttonText: '搜索文档',
              buttonAriaLabel: '搜索文档',
            },
            modal: {
              displayDetails: '显示详细列表',
              resetButtonTitle: '清除搜索',
              backButtonTitle: '关闭搜索',
              noResultsText: '未找到相关结果',
              footer: {
                selectText: '选择',
                selectKeyAriaLabel: '回车键',
                navigateText: '切换',
                navigateUpKeyAriaLabel: '上方向键',
                navigateDownKeyAriaLabel: '下方向键',
                closeText: '关闭',
                closeKeyAriaLabel: 'Esc 键',
              },
            },
          },
        },
        vi: {
          translations: {
            button: {
              buttonText: 'Tìm kiếm tài liệu',
              buttonAriaLabel: 'Tìm kiếm tài liệu',
            },
            modal: {
              displayDetails: 'Hiển thị danh sách chi tiết',
              resetButtonTitle: 'Xóa tìm kiếm',
              backButtonTitle: 'Đóng tìm kiếm',
              noResultsText: 'Không tìm thấy kết quả liên quan',
              footer: {
                selectText: 'Chọn',
                selectKeyAriaLabel: 'Phím Enter',
                navigateText: 'Chuyển',
                navigateUpKeyAriaLabel: 'Phím mũi tên lên',
                navigateDownKeyAriaLabel: 'Phím mũi tên xuống',
                closeText: 'Đóng',
                closeKeyAriaLabel: 'Phím Esc',
              },
            },
          },
        },
      },
    },
  },
  socialLinks: [
    { icon: 'github', link: 'https://github.com/deepseek-ai/deepseek-harness' },
  ],
  editLink: {
    pattern: editSourcePattern,
    text: 'Edit this page on GitHub',
  },
}

/** Site base path, carrying the leading and trailing slashes VitePress requires. */
const base = process.env.DOCS_BASE ?? '/'

/**
 * The DeepSeek wordmark, inlined so its `currentColor` fills follow the active
 * theme. An `<img>` would freeze the mark at the colors the file declares.
 */
const wordmark = readFileSync(resolve(import.meta.dirname, '../public/wordmark.svg'), 'utf8')
  .trim()
  .replace('<svg ', '<svg class="dsh-wordmark" ')

/**
 * Styles the default theme does not provide, carried inline because the site
 * runs the stock theme with no theme directory of its own.
 *
 * The navigation-bar lockup pairs with `siteTitle`. The scrollbar rules replace
 * the sidebar's platform bar, which reserves 15px of a 265px column and draws a
 * track the rest of the navigation has no border for; `scrollbarScript` supplies
 * the marker that reveals the thumb. Chrome drops `::-webkit-scrollbar` once
 * `scrollbar-width` is set to anything but `auto`, so the standard properties
 * stay behind a query only Firefox answers.
 */
const siteStyle = `
.dsh-lockup { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-wordmark { display: block; height: 22px; width: auto; color: var(--vp-c-text-1); }
.dsh-tag {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--vp-c-brand-soft);
  border-radius: 999px;
  padding: 1px 9px;
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  white-space: nowrap;
  color: var(--vp-c-brand-1);
}

.VPSidebar::-webkit-scrollbar { width: 6px; }
.VPSidebar::-webkit-scrollbar-track { background: transparent; }
.VPSidebar::-webkit-scrollbar-thumb {
  background-color: transparent;
  border-radius: 3px;
  transition: background-color 0.3s;
}
.VPSidebar[data-scrolling]::-webkit-scrollbar-thumb { background-color: var(--vp-c-text-3); }
@supports not selector(::-webkit-scrollbar) {
  .VPSidebar { scrollbar-width: thin; scrollbar-color: transparent transparent; }
  .VPSidebar[data-scrolling] { scrollbar-color: var(--vp-c-text-3) transparent; }
}
`

/**
 * Mark the sidebar while it scrolls, so its scrollbar rests invisible.
 *
 * A sized `::-webkit-scrollbar` opts the element out of the platform's
 * self-hiding overlay bar, leaving one painted at all times; nothing in CSS
 * reports that an element is scrolling. The listener captures instead of
 * bubbling because scroll events do not bubble, and marks a `data-` attribute
 * rather than a class because Vue rewrites `class` wholesale when it patches
 * the element.
 */
const scrollbarScript = `
(() => {
  let idle
  addEventListener('scroll', (event) => {
    const target = event.target
    if (!(target instanceof Element) || !target.classList.contains('VPSidebar')) return
    target.dataset.scrolling = ''
    clearTimeout(idle)
    idle = setTimeout(() => delete target.dataset.scrolling, 800)
  }, true)
})()
`

/**
 * Navigation-bar title: the DeepSeek wordmark and the release-stage tag.
 * VitePress renders `siteTitle` as HTML.
 *
 * @param previewTag - Localized release-stage label.
 * @returns Markup placed beside the navigation-bar home link.
 */
function siteTitle(previewTag: string): string {
  return `<span class="dsh-lockup">${wordmark}<span class="dsh-tag">${previewTag}</span></span>`
}

export default withMermaid({
  title: 'DeepSeek Harness',
  description: 'A plugin-based SDK for building agent harnesses',
  base,
  head: [
    // VitePress leaves head hrefs untouched, so the base belongs here explicitly.
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }],
    ['style', {}, siteStyle],
    ['script', {}, scrollbarScript],
  ],
  cleanUrls: true,
  srcDir: '.generated',
  cacheDir: '.cache',
  outDir: '.dist',
  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      themeConfig: {
        siteTitle: siteTitle('Preview'),
        nav: [
          { text: 'Guide', link: landingLink('root', guideModules.root.guide), activeMatch: '^/guide/' },
          ...moduleNav('root'),
        ],
        sidebar: {
          '/guide/': guideSidebar('root'),
          '/develop/': sidebar('root', 'en-develop'),
          '/reference/': sidebar('root', 'en-reference'),
        },
        outline: { label: 'On this page' },
        docFooter: { prev: 'Previous', next: 'Next' },
      },
    },
    zh: {
      label: '中文',
      lang: 'zh-CN',
      link: '/zh/',
      themeConfig: {
        siteTitle: siteTitle('技术预览'),
        nav: [
          { text: '入门', link: landingLink('zh', guideModules.zh.guide), activeMatch: '^/zh/guide/' },
          ...moduleNav('zh'),
        ],
        sidebar: {
          '/zh/guide/': guideSidebar('zh'),
          '/zh/develop/': sidebar('zh', 'zh-develop'),
          '/zh/reference/': sidebar('zh', 'zh-reference'),
        },
        editLink: {
          pattern: editSourcePattern,
          text: '在 GitHub 上编辑此页',
        },
        outline: { label: '本页目录' },
        docFooter: { prev: '上一篇', next: '下一篇' },
        darkModeSwitchLabel: '外观',
        lightModeSwitchTitle: '切换到浅色主题',
        darkModeSwitchTitle: '切换到深色主题',
        sidebarMenuLabel: '菜单',
        returnToTopLabel: '返回顶部',
        langMenuLabel: '切换语言',
        skipToContentLabel: '跳至内容',
      },
    },
    vi: {
      label: 'Tiếng Việt',
      lang: 'vi-VN',
      link: '/vi/',
      themeConfig: {
        siteTitle: siteTitle('Bản xem trước'),
        nav: [
          { text: 'Hướng dẫn', link: landingLink('vi', guideModules.vi.guide), activeMatch: '^/vi/guide/' },
          ...moduleNav('vi'),
        ],
        sidebar: {
          '/vi/guide/': guideSidebar('vi'),
          '/vi/develop/': sidebar('vi', 'vi-develop'),
          '/vi/reference/': sidebar('vi', 'vi-reference'),
        },
        editLink: {
          pattern: editSourcePattern,
          text: 'Sửa trang này trên GitHub',
        },
        outline: { label: 'Trên trang này' },
        docFooter: { prev: 'Trước', next: 'Tiếp theo' },
        darkModeSwitchLabel: 'Giao diện',
        lightModeSwitchTitle: 'Chuyển sang giao diện sáng',
        darkModeSwitchTitle: 'Chuyển sang giao diện tối',
        sidebarMenuLabel: 'Menu',
        returnToTopLabel: 'Lên đầu trang',
        langMenuLabel: 'Chọn ngôn ngữ',
        skipToContentLabel: 'Bỏ qua tới nội dung',
      },
    },
  },
  vite: {
    // `srcDir` puts the Vite root inside the disposable generated tree, whose
    // own `public/` no tracked asset can live in.
    publicDir: resolve(import.meta.dirname, '../public'),
    plugins: [
      {
        name: 'deepseek-harness-doc-projector',
        configureServer: watchCanonicalDocs,
      },
    ],
  },
  markdown: {
    config(md) {
      const renderText = md.renderer.rules.text
      const renderCode = md.renderer.rules.code_inline
      if (renderText === undefined || renderCode === undefined) {
        throw new Error('VitePress Markdown renderer is missing its text or inline-code rule.')
      }
      md.renderer.rules.text = (...args) => escapeVueInterpolation(renderText(...args))
      md.renderer.rules.code_inline = (...args) => escapeVueInterpolation(renderCode(...args))
    },
  },
  mermaid: {},
  themeConfig: sharedTheme,
})
