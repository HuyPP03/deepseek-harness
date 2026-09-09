import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectOhPackageLicenses } from './verify-oh-package-licenses.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeManifest(root: string, file: string, manifest: Record<string, unknown>): void {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

function createWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'oh-package-licenses-'))
  roots.push(root)
  writeManifest(root, 'package.json', {
    name: 'open-harness',
    license: 'MIT',
    workspaces: ['apps/*', 'packages/*/*', 'vendor/*'],
  })
  return root
}

describe('Open Harness package license gate', () => {
  it('checks root, unhyphenated CLI, and oh-prefixed package names while ignoring other families', () => {
    const root = createWorkspace()
    writeManifest(root, 'apps/cli/package.json', { name: 'oh', license: 'MIT' })
    writeManifest(root, 'packages/core/agent/package.json', {
      name: '@open-harness/oh-agent',
      license: 'BSD-3-Clause',
    })
    writeManifest(root, 'vendor/cordis/package.json', {
      name: '@open-harness/cordis',
      license: 'BSD-3-Clause',
    })

    expect(inspectOhPackageLicenses(root)).toEqual({
      packageCount: 3,
      failures: [
        'packages/core/agent/package.json: @open-harness/oh-agent must declare "license": "MIT"; found "BSD-3-Clause".',
      ],
    })
  })

  it('rejects a missing license declaration', () => {
    const root = createWorkspace()
    writeManifest(root, 'packages/core/agent/package.json', { name: '@open-harness/oh-agent' })

    expect(inspectOhPackageLicenses(root).failures).toEqual([
      'packages/core/agent/package.json: @open-harness/oh-agent must declare "license": "MIT"; found undefined.',
    ])
  })
})
