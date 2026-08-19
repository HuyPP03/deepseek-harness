/**
 * The files.list walk: bounded, deterministic, metadata-only enumeration of
 * a working-set tree. Bounds are the wire contract's protocol constants
 * (depth 8, 1000 entries); skip rules keep secrets, dependency trees, and
 * symlink loops out of the mention picker.
 */

import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FILES_MAX_ENTRIES, walkFiles, type FileWalkRoot } from '../src/files-walk.ts'

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
  mkdirSync(join(root, '.git'), { recursive: true })
  writeFileSync(join(root, '.git/config'), '')
  writeFileSync(join(root, '.env'), '')
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  writeFileSync(join(root, 'node_modules/deps.js'), '')
  mkdirSync(join(root, 'node_modules/.cache'), { recursive: true })
  writeFileSync(join(root, 'node_modules/.cache/x.js'), '')
  // Depth ladder: a file at each of depths 1..10 below the root (root = 0).
  let dir = root
  for (let depth = 1; depth <= 10; depth += 1) {
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
  it('lists regular files with absolute path, root-relative path, and root id', async () => {
    const { files } = await walkFiles(roots())
    const names = files.map(f => f.relative)
    expect(names).toContain('a.txt')
    expect(names).toContain('src/main.ts')
    expect(names).toContain('realdir/inside.txt')
    for (const file of files) {
      expect(file.path).toBe(join(root, file.relative))
      expect(file.root).toBe('workspace')
    }
  })

  it('skips dot entries, node_modules, and symlinks', async () => {
    const { files } = await walkFiles(roots())
    const names = files.map(f => f.relative)
    expect(names).not.toContain('.env')
    expect(names).not.toContain('.git/config')
    expect(names).not.toContain('node_modules/deps.js')
    expect(names).not.toContain('node_modules/.cache/x.js')
    expect(names).not.toContain('link.txt')
    expect(names).not.toContain('loopdir/inside.txt')
  })

  it('stops descending at the depth bound but still lists files at the bound', async () => {
    const { files } = await walkFiles(roots())
    const names = files.map(f => f.relative)
    expect(names).toContain('d/d/d/d/d/d/d/d/depth-8.txt')
    expect(names).not.toContain('d/d/d/d/d/d/d/d/d/depth-9.txt')
  })

  it('lists deterministically in name-sorted order per level', async () => {
    const { files } = await walkFiles(roots())
    const order = files.map(f => f.relative)
    expect(order.indexOf('a.txt')).toBeLessThan(order.indexOf('b.txt'))
    expect(order.indexOf('b.txt')).toBeLessThan(order.indexOf('src/main.ts'))
  })

  it('applies the entry bound across roots and reports truncation', async () => {
    const big = mkdtempSync(join(tmpdir(), 'dsh-files-walk-big-'))
    try {
      mkdirSync(join(big, 'many'), { recursive: true })
      for (let i = 0; i < FILES_MAX_ENTRIES + 5; i += 1) {
        writeFileSync(join(big, 'many', `f${String(i).padStart(5, '0')}.txt`), '')
      }
      const { files, truncated } = await walkFiles([{ dir: big, root: 'big' }])
      expect(files).toHaveLength(FILES_MAX_ENTRIES)
      expect(truncated).toBe(true)
      // The bound cut the level: the name-sorted tail is absent.
      expect(files.map(f => f.relative)).not.toContain('many/f01005.txt')
    } finally {
      rmSync(big, { recursive: true, force: true })
    }
  })

  it('stops the whole walk at the bound when the second root would overflow', async () => {
    const a = mkdtempSync(join(tmpdir(), 'dsh-files-walk-a-'))
    const b = mkdtempSync(join(tmpdir(), 'dsh-files-walk-b-'))
    try {
      for (let i = 0; i < FILES_MAX_ENTRIES; i += 1) writeFileSync(join(a, `a${String(i).padStart(5, '0')}.txt`), '')
      for (let i = 0; i < 10; i += 1) writeFileSync(join(b, `b${String(i).padStart(5, '0')}.txt`), '')
      const { files, truncated } = await walkFiles(
        [{ dir: a, root: 'a' }, { dir: b, root: 'b' }],
      )
      expect(files).toHaveLength(FILES_MAX_ENTRIES)
      expect(files.every(f => f.root === 'a')).toBe(true)
      expect(truncated).toBe(true)
    } finally {
      rmSync(a, { recursive: true, force: true })
      rmSync(b, { recursive: true, force: true })
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
