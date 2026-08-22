/**
 * Enforce the product copy language: no CJK in client product code outside
 * the locale dictionaries. The web GUI ships the English product copy; the
 * vi and zh tables live in the locale dictionaries (and the deliberate
 * wire-data fixtures below), and every other CJK character in a client
 * source file is a copy leak — a label that bypasses the locale chain.
 *
 * Scanned scope: every `.ts`/`.tsx`/`.css` file under `packages/client/<pkg>/src/`
 * (recursively) and every file under `apps/web/src/`. Tests are excluded
 * (specs may carry CJK fixtures and assert dictionary values verbatim).
 *
 * File allow-list (path -> reason):
 *   - packages/client/locale/src/**     shared en/vi/zh dictionaries and the
 *                                        locale self-labels
 *   - <pkg>/locales.ts                  namespace dictionaries
 *   - <pkg>/onboarding-copy.ts          the welcome-notice dictionaries
 *   - packages/client/connection/src/client/fixture.ts
 *                                       deliberate Chinese wire fixture
 *
 * Line allow-list (file + line pattern -> reason):
 *   - ui-user-questions QuestionComposer: the wire-data suffix regex must
 *     match the `推荐` marker persisted in question text.
 *
 * Run directly:
 *   pnpm exec tsx scripts/verify-product-copy.ts
 */

import { globSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')

/** CJK Unified Ideographs, Extension A, and Compatibility Ideographs. */
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/

interface FileAllow { pattern: RegExp; reason: string }
/** Whole files exempt from the scan (matched against repo-relative paths). */
const FILE_ALLOW: FileAllow[] = [
  { pattern: /^packages\/client\/locale\/src\//, reason: 'shared locale dictionaries and locale self-labels' },
  { pattern: /\/locales\.ts$/, reason: 'namespace locale dictionary' },
  { pattern: /\/onboarding-copy\.ts$/, reason: 'welcome-notice dictionaries' },
  { pattern: /^packages\/client\/connection\/src\/client\/fixture\.ts$/, reason: 'deliberate Chinese wire fixture' },
]

interface LineAllow { file: string; pattern: RegExp; reason: string }
/** Individual lines exempt from the scan (file + content pattern). */
const LINE_ALLOW: LineAllow[] = [
  {
    file: 'packages/client/ui-user-questions/src/client/QuestionComposer.tsx',
    pattern: /recommended\|\u63a8\u8350/,
    reason: 'wire-data suffix regex must match the persisted marker',
  },
]

interface Violation { file: string; line: number; text: string }

function toPosix(rel: string): string {
  return rel.split(sep).join('/')
}

function listFiles(): string[] {
  const out: string[] = []
  out.push(...globSync('packages/client/*/src/**/*.{ts,tsx,css}', { cwd: root }))
  out.push(...globSync('apps/web/src/**/*', { cwd: root }))
  return [...new Set(out.map(toPosix))].sort()
}

function fileAllowed(rel: string): string | undefined {
  for (const entry of FILE_ALLOW) {
    if (entry.pattern.test(rel)) return entry.reason
  }
  return undefined
}

function lineAllowed(rel: string, text: string): string | undefined {
  for (const entry of LINE_ALLOW) {
    if (entry.file === rel && entry.pattern.test(text)) return entry.reason
  }
  return undefined
}

const files = listFiles()
const violations: Violation[] = []
let scanned = 0
for (const rel of files) {
  if (fileAllowed(rel) !== undefined) continue
  scanned += 1
  const lines = readFileSync(join(root, rel), 'utf8').split('\n')
  lines.forEach((text, index) => {
    if (!CJK.test(text)) return
    if (lineAllowed(rel, text) !== undefined) return
    violations.push({ file: rel, line: index + 1, text: text.trim() })
  })
}

if (violations.length > 0) {
  console.error(`verify-product-copy: ${violations.length} CJK line(s) outside the locale dictionaries:`)
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.text.slice(0, 100)}`)
  }
  console.error('')
  console.error('Move user-facing copy into the locale dictionaries (or the wire-data fixtures), or add a narrow, justified allow-list entry above.')
  process.exit(1)
}
console.log(`verify-product-copy: OK (${scanned} files scanned)`)
