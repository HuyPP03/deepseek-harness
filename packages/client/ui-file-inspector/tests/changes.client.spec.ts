// Pure derivations of the inspector's Changes tab: path matching against the
// session root, latest-card selection, sub-dispatch recursion, wire-view
// narrowing, and the extension-to-grammar map.

import { describe, expect, it } from 'vitest'
import type { ConversationNode, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { langForPath, latestFileDiffs, previewKindForPath, resolveDiffPath } from '../src/client/changes.ts'

// The view seats take untyped material: the malformed-payload tests pass wire
// shapes the host would not produce, and both seats share the diff-card shape.
const toolResult = (seq: number, callView: unknown, resultView: unknown, subCalls: ToolResultNode['subCalls'] = []): ToolResultNode => ({
  kind: 'tool-result', seq, time: seq * 1_000, callId: `c${seq}`,
  call: { name: 'write', argsRaw: '{}' }, callTime: seq * 1_000 - 500,
  content: [], isError: false,
  callView: callView as ToolResultNode['callView'],
  resultView: resultView as ToolResultNode['resultView'],
  subCalls,
})

const diffView = (card: 'diff', diffs: unknown) => ({ card, diffs })

describe('resolveDiffPath', () => {
  it('passes absolute posix and windows paths through', () => {
    expect(resolveDiffPath('/tmp/proj', '/abs/main.ts')).toBe('/abs/main.ts')
    expect(resolveDiffPath('C:\\proj', 'C:\\proj\\main.ts')).toBe('C:\\proj\\main.ts')
  })
  it('resolves relative paths against the workspace root', () => {
    expect(resolveDiffPath('/tmp/proj', 'src/main.ts')).toBe('/tmp/proj/src/main.ts')
    expect(resolveDiffPath('/tmp/proj/', 'main.ts')).toBe('/tmp/proj/main.ts')
  })
  it('fails closed with no root', () => {
    expect(resolveDiffPath(undefined, 'main.ts')).toBe('main.ts')
    expect(resolveDiffPath('', 'main.ts')).toBe('main.ts')
  })
})

describe('latestFileDiffs', () => {
  const SEL = '/tmp/proj/src/main.ts'

  it('returns null when the window holds no diff card', () => {
    const nodes: ConversationNode[] = [
      toolResult(1, null, null),
    ]
    expect(latestFileDiffs(nodes, SEL, '/tmp/proj')).toBeNull()
  })

  it('matches the latest settled card by resolving relative paths', () => {
    const nodes: ConversationNode[] = [
      toolResult(1, null, diffView('diff', [{ path: 'src/main.ts', oldText: 'a', newText: 'b' }])),
      toolResult(5, null, diffView('diff', [{ path: 'src/main.ts', oldText: 'b', newText: 'c', oldStart: 1, newStart: 1, lang: 'ts' }])),
    ]
    expect(latestFileDiffs(nodes, SEL, '/tmp/proj')).toEqual([
      { path: 'src/main.ts', oldText: 'b', newText: 'c', oldStart: 1, newStart: 1, lang: 'ts' },
    ])
  })

  it('keeps only the selected file\'s hunks of a multi-file card', () => {
    const nodes: ConversationNode[] = [
      toolResult(2, null, diffView('diff', [
        { path: 'src/other.ts', oldText: 'x', newText: 'y' },
        { path: SEL, oldText: 'a', newText: 'b' },
      ])),
    ]
    expect(latestFileDiffs(nodes, SEL, '/tmp/proj')).toEqual([{ path: SEL, oldText: 'a', newText: 'b' }])
  })

  it('recurses into sub-dispatch calls of any depth', () => {
    const inner: ToolResultNode = toolResult(9, null, diffView('diff', [{ path: SEL, oldText: 'a', newText: 'z' }]))
    const outer: ToolResultNode = toolResult(3, null, null, [inner])
    expect(latestFileDiffs([outer], SEL, '/tmp/proj')).toEqual([{ path: SEL, oldText: 'a', newText: 'z' }])
  })

  it('lets the result view replace the call view on a settled card', () => {
    const nodes: ConversationNode[] = [
      toolResult(4, diffView('diff', [{ path: SEL, oldText: 'a', newText: 'call-side' }]),
        diffView('diff', [{ path: SEL, oldText: 'a', newText: 'result-side' }])),
    ]
    expect(latestFileDiffs(nodes, SEL, '/tmp/proj')?.[0]?.newText).toBe('result-side')
  })

  it('falls back to the call view when the result view is generic', () => {
    const nodes: ConversationNode[] = [
      toolResult(6, diffView('diff', [{ path: SEL, oldText: 'a', newText: 'intended' }]), null),
    ]
    expect(latestFileDiffs(nodes, SEL, '/tmp/proj')?.[0]?.newText).toBe('intended')
  })

  it('ignores a diff card whose payload is malformed', () => {
    const nodes: ConversationNode[] = [
      toolResult(7, null, diffView('diff', 'not-an-array')),
      toolResult(8, null, diffView('diff', [{ path: 1, oldText: 'a', newText: 'b' }])),
      toolResult(9, null, diffView('diff', [])),
      toolResult(10, null, { card: 'diff', diffs: [{ path: SEL, oldText: 'a', newText: 'b', oldStart: 'x' }] }),
      toolResult(11, null, diffView('diff', [42])),
      toolResult(12, null, diffView('diff', [{ path: SEL, oldText: 42, newText: 'b' }])),
      toolResult(13, null, diffView('diff', [{ path: SEL, oldText: 'a', newText: 42 }])),
      toolResult(14, null, diffView('diff', [{ path: SEL, oldText: 'a', newText: 'b', newStart: 'x' }])),
      toolResult(15, null, diffView('diff', [{ path: SEL, oldText: 'a', newText: 'b', lang: 42 }])),
    ]
    expect(latestFileDiffs(nodes, SEL, '/tmp/proj')).toBeNull()
  })

  it('ignores a card whose hunks resolve to no other file', () => {
    const nodes: ConversationNode[] = [
      toolResult(3, null, diffView('diff', [{ path: 'src/other.ts', oldText: 'a', newText: 'b' }])),
    ]
    expect(latestFileDiffs(nodes, SEL, '/tmp/proj')).toBeNull()
  })

  it('prefers the newer card even when it appears earlier in the window', () => {
    const nodes: ConversationNode[] = [
      toolResult(9, null, diffView('diff', [{ path: SEL, oldText: 'a', newText: 'newer' }])),
      toolResult(5, null, diffView('diff', [{ path: SEL, oldText: 'a', newText: 'older' }])),
    ]
    expect(latestFileDiffs(nodes, SEL, '/tmp/proj')?.[0]?.newText).toBe('newer')
  })

  it('ignores an in-flight child call that carries no result view', () => {
    const running: ToolResultNode = {
      callId: 'c16', name: 'write', argsRaw: '{}', turn: 1, step: 1, time: 16_000,
      callView: null, subCalls: [],
    } as unknown as ToolResultNode
    const nodes: ConversationNode[] = [
      toolResult(16, null, diffView('diff', [{ path: SEL, oldText: 'a', newText: 'settled' }]), [running]),
    ]
    expect(latestFileDiffs(nodes, SEL, '/tmp/proj')?.[0]?.newText).toBe('settled')
  })

  it('does not count non-diff cards', () => {
    const nodes: ConversationNode[] = [
      { kind: 'user-message', seq: 1, time: 1_000, content: [{ type: 'text', text: 'hi' }] } as unknown as ConversationNode,
      toolResult(2, null, { card: 'json' }),
    ]
    expect(latestFileDiffs(nodes, SEL, '/tmp/proj')).toBeNull()
  })
})

describe('langForPath', () => {
  it('maps known extensions to shiki ids', () => {
    expect(langForPath('/p/main.ts')).toBe('ts')
    expect(langForPath('/p/main.mts')).toBe('ts')
    expect(langForPath('/p/main.cts')).toBe('ts')
    expect(langForPath('/p/App.tsx')).toBe('tsx')
    expect(langForPath('/p/Mod.GO')).toBe('go')
    expect(langForPath('/p/notes.md')).toBe('markdown')
    expect(langForPath('/p/a/b.c')).toBe('c')
    expect(langForPath('/p/style.css')).toBe('css')
    expect(langForPath('/p/app.js')).toBe('js')
    expect(langForPath('/p/app.mjs')).toBe('js')
    expect(langForPath('/p/app.cjs')).toBe('js')
    expect(langForPath('/p/App.jsx')).toBe('jsx')
    expect(langForPath('/p/main.py')).toBe('py')
    expect(langForPath('/p/main.rs')).toBe('rust')
    expect(langForPath('/p/main.rb')).toBe('ruby')
    expect(langForPath('/p/Main.java')).toBe('java')
    expect(langForPath('/p/Main.kt')).toBe('kt')
    expect(langForPath('/p/Main.swift')).toBe('swift')
    expect(langForPath('/p/main.cpp')).toBe('cpp')
    expect(langForPath('/p/main.cs')).toBe('cs')
    expect(langForPath('/p/run.sh')).toBe('sh')
    expect(langForPath('/p/run.bash')).toBe('sh')
    expect(langForPath('/p/run.zsh')).toBe('sh')
    expect(langForPath('/p/data.json')).toBe('json')
    expect(langForPath('/p/data.jsonc')).toBe('json')
    expect(langForPath('/p/cfg.yaml')).toBe('yaml')
    expect(langForPath('/p/cfg.yml')).toBe('yaml')
    expect(langForPath('/p/cfg.toml')).toBe('toml')
    expect(langForPath('/p/cfg.ini')).toBe('ini')
    expect(langForPath('/p/page.mdx')).toBe('mdx')
    expect(langForPath('/p/theme.scss')).toBe('scss')
    expect(langForPath('/p/theme.less')).toBe('less')
    expect(langForPath('/p/query.sql')).toBe('sql')
    expect(langForPath('/p/page.xml')).toBe('xml')
    expect(langForPath('/p/init.lua')).toBe('lua')
  })
  it('returns undefined without an extension', () => {
    expect(langForPath('/p/Makefile')).toBeUndefined()
    expect(langForPath('/p/trailing.')).toBeUndefined()
    expect(langForPath('/p/unknown.xyz')).toBeUndefined()
  })
})

describe('previewKindForPath', () => {
  it('maps previewable extensions to their seat kinds', () => {
    expect(previewKindForPath('/p/notes.md')).toBe('markdown')
    expect(previewKindForPath('/p/notes.MARKDOWN')).toBe('markdown')
    expect(previewKindForPath('/p/page.html')).toBe('html')
    expect(previewKindForPath('/p/page.HTM')).toBe('html')
    expect(previewKindForPath('/p/icon.svg')).toBe('svg')
    expect(previewKindForPath('/p/pix.png')).toBe('image')
    expect(previewKindForPath('/p/pix.jpg')).toBe('image')
    expect(previewKindForPath('/p/pix.webp')).toBe('image')
  })
  it('returns null for non-preview extensions', () => {
    expect(previewKindForPath('/p/main.ts')).toBeNull()
    expect(previewKindForPath('/p/text.txt')).toBeNull()
    expect(previewKindForPath('/p/Makefile')).toBeNull()
    expect(previewKindForPath('/p/trailing.')).toBeNull()
  })
})
