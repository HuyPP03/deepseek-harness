/**
 * The files domain's bounded read primitive: containment admission
 * (lexical + symlink + the root-itself edge), the bound cuts (byte, line,
 * and the combined corner where the line bound lands beyond the byte cut),
 * the binary sniff, and the OS-failure arms that a real filesystem only
 * reaches by race (realpath/lstat/createReadStream rejections). The
 * wire-level behavior (session refusal, working-set roots) is covered by
 * api-proxy-files.spec.ts over the assembled proxy.
 */

import { rmSync, writeFileSync } from 'node:fs'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { realpath, lstat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { FILE_READ_MAX_BYTES, FILE_READ_MAX_LINES, readSessionFile } from '../src/files-read.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    realpath: vi.fn(actual.realpath),
    lstat: vi.fn(actual.lstat),
  }
})
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    createReadStream: vi.fn(actual.createReadStream),
  }
})

function sysError(code: string): NodeJS.ErrnoException {
  const error = new Error(`fake ${code}`) as NodeJS.ErrnoException
  error.code = code
  return error
}

let tempDirs: string[] = []
function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  // The one-shot mocks (mockRejectedValueOnce / mockImplementationOnce)
  // exhaust themselves; the passthrough implementations stay in place.
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  tempDirs = []
})

describe('readSessionFile containment', () => {
  it('admits the root directory itself through the equality arm (and classifies it)', async () => {
    const dir = tempDir('dsh-files-read-root-')

    const outcome = await readSessionFile([dir], dir)

    expect(outcome).toEqual({ ok: false, code: 'file-is-directory' })
  })

  it('resolves a relative path against the process cwd and fails closed', async () => {
    const dir = tempDir('dsh-files-read-rel-')
    writeFileSync(join(dir, 'here.txt'), 'here\n')

    const outcome = await readSessionFile([dir], 'elsewhere.txt')

    expect(outcome).toEqual({ ok: false, code: 'file-path-escape' })
  })

  it('admits a file under a later root when the first does not contain it', async () => {
    const first = tempDir('dsh-files-read-first-')
    const second = tempDir('dsh-files-read-second-')
    const path = join(second, 'ref.txt')
    writeFileSync(path, 'ref\n')

    const outcome = await readSessionFile([first, second], path)

    expect(outcome).toMatchObject({ ok: true, read: { content: 'ref\n', lines: 1 } })
  })
})

describe('readSessionFile OS failure arms', () => {
  it('maps a realpath EACCES rejection to file-unreadable', async () => {
    const dir = tempDir('dsh-files-read-ea-')
    const path = join(dir, 'x.txt')
    writeFileSync(path, 'x\n')
    vi.mocked(realpath).mockRejectedValueOnce(sysError('EACCES'))

    const outcome = await readSessionFile([dir], path)

    expect(outcome).toEqual({ ok: false, code: 'file-unreadable' })
  })

  it('maps a realpath EPERM rejection to file-unreadable', async () => {
    const dir = tempDir('dsh-files-read-ep-')
    const path = join(dir, 'x.txt')
    writeFileSync(path, 'x\n')
    vi.mocked(realpath).mockRejectedValueOnce(sysError('EPERM'))

    const outcome = await readSessionFile([dir], path)

    expect(outcome).toEqual({ ok: false, code: 'file-unreadable' })
  })

  it('rethrows an unexpected realpath rejection', async () => {
    const dir = tempDir('dsh-files-read-ei-')
    const path = join(dir, 'x.txt')
    writeFileSync(path, 'x\n')
    vi.mocked(realpath).mockRejectedValueOnce(sysError('EIO'))

    await expect(readSessionFile([dir], path)).rejects.toMatchObject({ code: 'EIO' })
  })

  it('maps an lstat ENOENT race to file-not-found', async () => {
    const dir = tempDir('dsh-files-read-ln-')
    const path = join(dir, 'x.txt')
    writeFileSync(path, 'x\n')
    vi.mocked(lstat).mockRejectedValueOnce(sysError('ENOENT'))

    const outcome = await readSessionFile([dir], path)

    expect(outcome).toEqual({ ok: false, code: 'file-not-found' })
  })

  it('maps an lstat EACCES rejection to file-unreadable', async () => {
    const dir = tempDir('dsh-files-read-le-')
    const path = join(dir, 'x.txt')
    writeFileSync(path, 'x\n')
    vi.mocked(lstat).mockRejectedValueOnce(sysError('EACCES'))

    const outcome = await readSessionFile([dir], path)

    expect(outcome).toEqual({ ok: false, code: 'file-unreadable' })
  })

  it('maps a stream ENOENT race to file-not-found', async () => {
    const dir = tempDir('dsh-files-read-sn-')
    const path = join(dir, 'x.txt')
    writeFileSync(path, 'x\n')
    vi.mocked(createReadStream).mockImplementationOnce(() => {
      throw sysError('ENOENT')
    })

    const outcome = await readSessionFile([dir], path)

    expect(outcome).toEqual({ ok: false, code: 'file-not-found' })
  })

  it('maps a stream EACCES rejection to file-unreadable', async () => {
    const dir = tempDir('dsh-files-read-se-')
    const path = join(dir, 'x.txt')
    writeFileSync(path, 'x\n')
    vi.mocked(createReadStream).mockImplementationOnce(() => {
      throw sysError('EACCES')
    })

    const outcome = await readSessionFile([dir], path)

    expect(outcome).toEqual({ ok: false, code: 'file-unreadable' })
  })
})

describe('readSessionFile bound corners', () => {
  it('counts a trailing line without a newline', async () => {
    const dir = tempDir('dsh-files-read-tl-')
    const path = join(dir, 'short.txt')
    writeFileSync(path, 'abc')

    const outcome = await readSessionFile([dir], path)

    expect(outcome).toMatchObject({ ok: true, read: { content: 'abc', lines: 1, truncated: false, size: 3 } })
  })

  it('serves an empty file with zero lines and no truncation', async () => {
    const dir = tempDir('dsh-files-read-ef-')
    const path = join(dir, 'empty.txt')
    writeFileSync(path, '')

    const outcome = await readSessionFile([dir], path)

    expect(outcome).toMatchObject({ ok: true, read: { content: '', lines: 0, truncated: false, binary: false, size: 0 } })
  })

  it('keeps a byte-bound cut that lands exactly on a newline', async () => {
    const dir = tempDir('dsh-files-read-bn-')
    const path = join(dir, 'edge.txt')
    // The bound byte is a newline; the one byte past it is a partial line.
    writeFileSync(path, `${'a'.repeat(FILE_READ_MAX_BYTES - 1)}\nx`)

    const outcome = await readSessionFile([dir], path)

    expect(outcome).toMatchObject({ ok: true, read: { truncated: true, lines: 1 } })
    if (outcome.ok) {
      expect(outcome.read.content.length).toBe(FILE_READ_MAX_BYTES)
      expect(outcome.read.content.endsWith('\n')).toBe(true)
    }
  })

  it('drops a whole bound-sized line when it carries no newline at all', async () => {
    const dir = tempDir('dsh-files-read-ol-')
    const path = join(dir, 'oneline.txt')
    writeFileSync(path, 'a'.repeat(FILE_READ_MAX_BYTES + 1))

    const outcome = await readSessionFile([dir], path)

    expect(outcome).toMatchObject({ ok: true, read: { content: '', lines: 0, truncated: true, binary: false } })
  })

  it('keeps the byte cut when the line bound lands beyond it', async () => {
    const dir = tempDir('dsh-files-read-both-')
    const path = join(dir, 'both.txt')
    // A newline-free head pushes the 20000th newline past the byte cut.
    writeFileSync(path, `${'a'.repeat(FILE_READ_MAX_BYTES)}\n${'x\n'.repeat(FILE_READ_MAX_LINES - 1)}`)

    const outcome = await readSessionFile([dir], path)

    expect(outcome).toMatchObject({ ok: true, read: { content: '', lines: 0, truncated: true, binary: false } })
  })

  it('sniffs a NUL past the first chunk boundary (an 8 KiB-precise file)', async () => {
    const dir = tempDir('dsh-files-read-nl-')
    const path = join(dir, 'nul.bin')
    // No NUL in the first 8 KiB, a NUL at the sniff window's far edge.
    writeFileSync(path, Buffer.concat([Buffer.alloc(8 * 1024 - 1, 0x61), Buffer.from([0x00]), Buffer.from('tail')]))

    const outcome = await readSessionFile([dir], path)

    expect(outcome).toMatchObject({ ok: true, read: { binary: true, content: '', lines: 0 } })
  })
})
