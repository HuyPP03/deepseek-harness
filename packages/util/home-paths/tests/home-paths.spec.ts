import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_OH_HOME_DISPLAY,
  OH_HOME_DIR_NAME,
  canonicalizeWatchPath,
  defaultDshHome,
  dshHomeDisplay,
  ohHomePath,
  expandHomePath,
  resolveOhHome,
} from '@open-harness/oh-home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('dsh path helpers', () => {
  it('owns the shared default Open Harness home directory name', () => {
    expect(OH_HOME_DIR_NAME).toBe('.oh')
    expect(DEFAULT_OH_HOME_DISPLAY).toBe('~/.oh')
    expect(defaultDshHome()).toBe(join(homedir(), '.oh'))
  })

  it('expands tilde paths without changing non-tilde paths', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/.oh')).toBe(join(homedir(), '.oh'))
    expect(expandHomePath('~\\.oh')).toBe(join(homedir(), '.oh'))
    expect(expandHomePath('/tmp/.oh')).toBe('/tmp/.oh')
    expect(expandHomePath('~other/.oh')).toBe('~other/.oh')
  })

  it('resolves explicit path before OH_HOME and the default', () => {
    const envHome = join(homedir(), 'env-dsh')

    expect(resolveOhHome('/tmp/explicit-dsh', { OH_HOME: '~/env-dsh' })).toBe(resolve('/tmp/explicit-dsh'))
    expect(resolveOhHome(undefined, { OH_HOME: '~/env-dsh' })).toBe(envHome)
    expect(resolveOhHome(undefined, {})).toBe(defaultDshHome())
  })

  it('treats an empty or whitespace-only OH_HOME as unset', () => {
    expect(resolveOhHome(undefined, { OH_HOME: '' })).toBe(defaultDshHome())
    expect(resolveOhHome(undefined, { OH_HOME: '   ' })).toBe(defaultDshHome())
  })

  it('joins child segments onto the resolved OH_HOME', () => {
    vi.stubEnv('OH_HOME', '~/env-dsh')
    expect(ohHomePath()).toBe(join(homedir(), 'env-dsh'))
    expect(ohHomePath('storages', 'cache')).toBe(join(homedir(), 'env-dsh', 'storages', 'cache'))
  })

  it('labels a resolved home by whether it is the default root', () => {
    expect(dshHomeDisplay(resolve(defaultDshHome()))).toBe('~/.oh')
    expect(dshHomeDisplay('/some/other/root')).toBe('$OH_HOME')
  })

  it('canonicalizes a watcher ancestor while preserving a missing suffix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-watch-path-'))
    const target = join(root, 'target')
    const alias = join(root, 'alias')
    try {
      await mkdir(target)
      await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
      await expect(canonicalizeWatchPath(join(alias, 'later', 'config.yml'))).resolves.toBe(
        join(await realpath(target), 'later', 'config.yml'),
      )
      const file = join(root, 'file')
      await writeFile(file, 'not a directory')
      await expect(canonicalizeWatchPath(join(file, 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
