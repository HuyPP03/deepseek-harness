/**
 * The files.list walk: bounded, deterministic, metadata-only enumeration of
 * a working-set tree. Bounds are the wire contract's protocol constants
 * (depth 8, 20000 scanned entries, 100 result rows); the noise rule keeps
 * dot-prefixed entries, the curated directory list (files-skip.json), and
 * symlink loops out of the mention picker. The optional query filters and
 * ranks host-side; a trailing-slash query prunes to the validated prefix
 * subtree and lists the prefix directory itself first.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FILES_MAX_RESULTS, walkFiles, type FileWalkRoot } from '../src/files-walk.ts'

let root: string

const roots = (): readonly FileWalkRoot[] => [{ dir: root, root: 'workspace' }]

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-files-walk-'))
  // A small deterministic tree plus the skip-rule fixtures.
  writeFileSync(join(root, 'a.txt'), '')
  writeFileSync(join(root, 'b.txt'), '')
  writeFileSync(join(root, 'README.md'), '')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src/main.ts'), '')
  writeFileSync(join(root, 'src/other.md'), '')
  mkdirSync(join(root, '.git'), { recursive: true })
  writeFileSync(join(root, '.git/config'), '')
  writeFileSync(join(root, '.env'), '')
  mkdirSync(join(root, '.config/notes'), { recursive: true })
  writeFileSync(join(root, '.config/notes/n.md'), '')
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  writeFileSync(join(root, 'node_modules/deps.js'), '')
  mkdirSync(join(root, 'node_modules/.cache'), { recursive: true })
  writeFileSync(join(root, 'node_modules/.cache/x.js'), '')
  // Curated-list fixtures (non-dot basenames from files-skip.json).
  mkdirSync(join(root, 'venv'), { recursive: true })
  writeFileSync(join(root, 'venv/site.py'), '')
  mkdirSync(join(root, 'target'), { recursive: true })
  writeFileSync(join(root, 'target/main.rs.o'), '')
  mkdirSync(join(root, 'dist'), { recursive: true })
  writeFileSync(join(root, 'dist/bundle.js'), '')
  // A directory whose basename contains 'src' without starting with it:
  // the substring tier of the directory trailing-slash match.
  mkdirSync(join(root, 'xsrcy'), { recursive: true })
  // Depth ladder: a directory 'd' at each of depths 1..9 below the root
  // (root = 0), with a file at each depth.
  let dir = root
  for (let depth = 1; depth <= 9; depth += 1) {
    dir = join(dir, 'd')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `depth-${String(depth)}.txt`), '')
  }
  // A symlinked directory (loop hazard) and a symlinked file.
  mkdirSync(join(root, 'realdir'), { recursive: true })
  writeFileSync(join(root, 'realdir/inside.txt'), '')
  symlinkSync(join(root, 'realdir'), join(root, 'loopdir'))
  symlinkSync(join(root, 'a.txt'), join(root, 'link.txt'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('walkFiles', () => {
  it('lists regular files and directories with absolute path, root-relative path, and root id', async () => {
    const { files } = await walkFiles(roots())
    const names = files.map(f => f.relative + (f.isDirectory ? '/' : ''))
    expect(names).toContain('a.txt')
    expect(names).toContain('src/')
    expect(names).toContain('src/main.ts')
    expect(names).toContain('realdir/')
    expect(names).toContain('realdir/inside.txt')
    for (const file of files) {
      expect(file.path).toBe(join(root, file.relative))
      expect(file.root).toBe('workspace')
    }
  })

  it('skips dot entries, the curated noise list, and symlinks', async () => {
    const { files } = await walkFiles(roots())
    const names = files.map(f => f.relative)
    expect(names).not.toContain('.env')
    expect(names).not.toContain('.git')
    expect(names).not.toContain('.git/config')
    expect(names).not.toContain('.config')
    expect(names).not.toContain('.config/notes/n.md')
    expect(names).not.toContain('node_modules')
    expect(names).not.toContain('node_modules/deps.js')
    expect(names).not.toContain('node_modules/.cache/x.js')
    expect(names).not.toContain('venv')
    expect(names).not.toContain('venv/site.py')
    expect(names).not.toContain('target')
    expect(names).not.toContain('target/main.rs.o')
    expect(names).not.toContain('dist')
    expect(names).not.toContain('dist/bundle.js')
    expect(names).not.toContain('link.txt')
    expect(names).not.toContain('loopdir')
    expect(names).not.toContain('loopdir/inside.txt')
  })

  it('stops descending at the depth bound but still lists directories at the bound', async () => {
    const { files } = await walkFiles(roots())
    const names = files.map(f => f.relative + (f.isDirectory ? '/' : ''))
    expect(names).toContain('d/d/d/d/d/d/d/d/')
    expect(names).toContain('d/d/d/d/d/d/d/d/depth-8.txt')
    expect(names).not.toContain('d/d/d/d/d/d/d/d/d/')
    expect(names).not.toContain('d/d/d/d/d/d/d/d/d/depth-9.txt')
  })

  it('lists deterministically in name-sorted order per level', async () => {
    const { files } = await walkFiles(roots())
    const order = files.map(f => f.relative)
    expect(order.indexOf('a.txt')).toBeLessThan(order.indexOf('b.txt'))
    expect(order.indexOf('b.txt')).toBeLessThan(order.indexOf('src/main.ts'))
  })

  it('caps the result at FILES_MAX_ROWS and stops the whole walk', async () => {
    const big = mkdtempSync(join(tmpdir(), 'dsh-files-walk-big-'))
    const a = mkdtempSync(join(tmpdir(), 'dsh-files-walk-a-'))
    const b = mkdtempSync(join(tmpdir(), 'dsh-files-walk-b-'))
    try {
      // Root 'big' alone overflows the result bound inside its one level.
      mkdirSync(join(big, 'many'), { recursive: true })
      for (let i = 0; i < FILES_MAX_RESULTS + 5; i += 1) {
        writeFileSync(join(big, 'many', `f${String(i).padStart(5, '0')}.txt`), '')
      }
      const { files, truncated } = await walkFiles([{ dir: big, root: 'big' }])
      expect(files).toHaveLength(FILES_MAX_RESULTS)
      // The scan bound was not hit: this is the result bound.
      expect(truncated).toBe(false)
      // The bound cut the level: the name-sorted tail is absent.
      expect(files.map(f => f.relative)).not.toContain('many/f00105.txt')
      // A second root that would overflow is never scanned.
      for (let i = 0; i < FILES_MAX_RESULTS; i += 1) {
        writeFileSync(join(a, `a${String(i).padStart(5, '0')}.txt`), '')
      }
      writeFileSync(join(b, 'only.txt'), '')
      const both = await walkFiles([{ dir: a, root: 'a' }, { dir: b, root: 'b' }])
      expect(both.files).toHaveLength(FILES_MAX_RESULTS)
      expect(both.files.every(f => f.root === 'a')).toBe(true)
      expect(both.truncated).toBe(false)
    } finally {
      rmSync(big, { recursive: true, force: true })
      rmSync(a, { recursive: true, force: true })
      rmSync(b, { recursive: true, force: true })
    }
  })

  it('reports truncation when the scan bound is hit', async () => {
    const big = mkdtempSync(join(tmpdir(), 'dsh-files-walk-scan-'))
    try {
      // 2001 directories x 10 files = 20010 scanned entries: over the
      // FILES_MAX_SCAN bound with a query that matches nothing, so no row is
      // pushed and the walk must stop at the bound with truncated true.
      for (let d = 0; d < 2001; d += 1) {
        const dir = join(big, `dir${String(d).padStart(4, '0')}`)
        mkdirSync(dir, { recursive: true })
        for (let f = 0; f < 10; f += 1) writeFileSync(join(dir, `f${String(f)}.txt`), '')
      }
      const { files, truncated } = await walkFiles([{ dir: big, root: 'big' }], undefined, 'zzz-none')
      expect(files).toEqual([])
      expect(truncated).toBe(true)
    } finally {
      rmSync(big, { recursive: true, force: true })
    }
  })

  it('treats a missing root as empty, not an error', async () => {
    const { files, truncated } = await walkFiles([
      { dir: join(root, 'no-such-dir'), root: 'gone' },
      ...roots(),
    ])
    expect(truncated).toBe(false)
    expect(files.some(f => f.root === 'gone')).toBe(false)
    expect(files.some(f => f.root === 'workspace')).toBe(true)
  })

  it('treats a root pointing at a file as empty, not an error', async () => {
    const { files } = await walkFiles([{ dir: join(root, 'a.txt'), root: 'file-root' }])
    expect(files).toEqual([])
  })

  it('skips a vanished subdirectory mid-walk', async () => {
    const volatile = mkdtempSync(join(tmpdir(), 'dsh-files-walk-volatile-'))
    try {
      mkdirSync(join(volatile, 'tempdir'), { recursive: true })
      writeFileSync(join(volatile, 'tempdir/gone.txt'), '')
      writeFileSync(join(volatile, 'kept.txt'), '')
      rmSync(join(volatile, 'tempdir'), { recursive: true })
      const { files, truncated } = await walkFiles([{ dir: volatile, root: 'volatile' }])
      expect(truncated).toBe(false)
      expect(files.map(f => f.relative)).toEqual(['kept.txt'])
    } finally {
      rmSync(volatile, { recursive: true, force: true })
    }
  })

  it('stops at an aborted signal and reports the partial result', async () => {
    const controller = new AbortController()
    controller.abort()
    const { files } = await walkFiles(roots(), controller.signal)
    expect(files).toEqual([])
  })

  it('lists nothing for an empty root', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'dsh-files-walk-empty-'))
    try {
      const { files, truncated } = await walkFiles([{ dir: empty, root: 'empty' }])
      expect(files).toEqual([])
      expect(truncated).toBe(false)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
})

describe('walkFiles query filtering', () => {
  it('matches a basename prefix case-insensitively', async () => {
    const { files } = await walkFiles(roots(), undefined, 'MAI')
    expect(files.map(f => f.relative)).toEqual(['src/main.ts'])
  })

  it('matches a path prefix for a mid-path query without pruning', async () => {
    const { files } = await walkFiles(roots(), undefined, 'src/other')
    expect(files.map(f => f.relative)).toEqual(['src/other.md'])
  })

  it('matches a substring anywhere in the relative path', async () => {
    const { files } = await walkFiles(roots(), undefined, 'epth-7')
    expect(files.map(f => f.relative)).toEqual(['d/d/d/d/d/d/d/depth-7.txt'])
  })

  it('matches directories through their trailing-slash form and ranks them', async () => {
    const { files } = await walkFiles(roots(), undefined, 'src')
    const names = files.map(f => f.relative + (f.isDirectory ? '/' : ''))
    expect(names[0]).toBe('src/')
    expect(names).toContain('src/main.ts')
    expect(names).toContain('src/other.md')
  })

  it('matches a directory through a substring of its trailing-slash form and ranks it below prefix matches', async () => {
    const { files } = await walkFiles(roots(), undefined, 'src')
    const names = files.map(f => f.relative + (f.isDirectory ? '/' : ''))
    expect(names).toContain('xsrcy/')
    expect(names.indexOf('xsrcy/')).toBeGreaterThan(names.indexOf('src/main.ts'))
  })

  it('ranks basename-prefix matches before path-prefix and substring matches', async () => {
    const { files } = await walkFiles(roots(), undefined, 'a.txt')
    expect(files.map(f => f.relative)[0]).toBe('a.txt')
  })

  it('returns nothing for a query with no match', async () => {
    const { files } = await walkFiles(roots(), undefined, 'zzz-not-there')
    expect(files).toEqual([])
  })

  it('prunes a trailing-slash query to the prefix subtree and lists the prefix first', async () => {
    const { files } = await walkFiles(roots(), undefined, 'src/')
    expect(files.map(f => f.relative + (f.isDirectory ? '/' : '')))
      .toEqual(['src/', 'src/main.ts', 'src/other.md'])
  })

  it('returns nothing for a trailing-slash query whose prefix directory is missing', async () => {
    const { files } = await walkFiles(roots(), undefined, 'nope/')
    expect(files).toEqual([])
  })

  it('returns nothing for an unsafe trailing-slash prefix', async () => {
    for (const query of ['/', '../', '/abs/', 'a/../', '//', '..\\']) {
      const { files } = await walkFiles(roots(), undefined, query)
      expect(files, query).toEqual([])
    }
  })

  it('trims surrounding whitespace from the query', async () => {
    const { files } = await walkFiles(roots(), undefined, '  b.txt ')
    expect(files.map(f => f.relative)).toEqual(['b.txt'])
  })

  it('treats a backslash query like a slash query (separator equivalence)', async () => {
    // Mid-path: the same match as the slash form.
    expect((await walkFiles(roots(), undefined, 'src\\other')).files.map(f => f.relative)).toEqual(['src/other.md'])
    // Trailing backslash: the same prune as the slash form.
    const { files } = await walkFiles(roots(), undefined, 'src\\')
    expect(files.map(f => f.relative + (f.isDirectory ? '/' : ''))).toEqual(['src/', 'src/main.ts', 'src/other.md'])
  })

  it('keeps the depth bound relative to the root under a prune', async () => {
    // The prefix sits at depth 7; the pruned walk may descend to depth 8
    // below the root and no further (not 8 below the prefix).
    const { files } = await walkFiles(roots(), undefined, 'd/d/d/d/d/d/d/')
    expect(files.map(f => f.relative + (f.isDirectory ? '/' : ''))).toEqual([
      'd/d/d/d/d/d/d/',
      'd/d/d/d/d/d/d/d/',
      'd/d/d/d/d/d/d/depth-7.txt',
      'd/d/d/d/d/d/d/d/depth-8.txt',
    ])
  })

  it('breaks key ties byte-wise and keeps equal relatives in walk order across roots', async () => {
    const a = mkdtempSync(join(tmpdir(), 'dsh-files-walk-key-a-'))
    const b = mkdtempSync(join(tmpdir(), 'dsh-files-walk-key-b-'))
    try {
      // Walk order emits the root files (aaaa.txt, cccc.txt) before the
      // subtree's b/bb.txt, so the ranked input is not key-sorted; the
      // second root repeats b/bb.txt so the sort meets an equal key.
      writeFileSync(join(a, 'aaaa.txt'), '')
      mkdirSync(join(a, 'b'))
      writeFileSync(join(a, 'b', 'bb.txt'), '')
      writeFileSync(join(a, 'cccc.txt'), '')
      // The same relative in a second root: an equal key the stable sort
      // keeps in walk order.
      mkdirSync(join(b, 'b'))
      writeFileSync(join(b, 'b', 'bb.txt'), '')
      const { files } = await walkFiles([{ dir: a, root: 'a' }, { dir: b, root: 'b' }], undefined, 't')
      expect(files.map(f => [f.root, f.relative])).toEqual([
        ['a', 'aaaa.txt'],
        ['a', 'b/bb.txt'],
        ['b', 'b/bb.txt'],
        ['a', 'cccc.txt'],
      ])
    } finally {
      rmSync(a, { recursive: true, force: true })
      rmSync(b, { recursive: true, force: true })
    }
  })

  it('ranks over the full scan: a better-ranked deep match survives a full walk-order head', async () => {
    const big = mkdtempSync(join(tmpdir(), 'dsh-files-walk-deep-'))
    try {
      // FILES_MAX_RESULTS+5 root-level substring-tier matches (walk order
      // emits them before any subtree), then a basename-prefix-tier match in
      // a subtree: with the result bound as a walk stop the deep match would
      // never be scanned and the result would lead with a weaker row.
      for (let i = 0; i < FILES_MAX_RESULTS + 5; i += 1) {
        writeFileSync(join(big, `a-x-${String(i).padStart(5, '0')}.txt`), '')
      }
      mkdirSync(join(big, 'deep'), { recursive: true })
      writeFileSync(join(big, 'deep/x.txt'), '')
      const { files, truncated } = await walkFiles([{ dir: big, root: 'big' }], undefined, 'x')
      expect(files).toHaveLength(FILES_MAX_RESULTS)
      expect(truncated).toBe(false)
      expect(files[0]?.relative).toBe('deep/x.txt')
    } finally {
      rmSync(big, { recursive: true, force: true })
    }
  })
})
