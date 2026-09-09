/** Release family discovery, publish order, tag naming, and the bump judgements. */

import { describe, expect, it } from 'vitest'
import { releaseFamily, type ReleaseMember } from './families.ts'
import { compareVersions, nextVendorVersion, reachesPayload } from './bump.ts'

/**
 * A release member standing in for a manifest on disk.
 * @param directory - repository-relative package directory.
 * @param name - package name.
 * @param manifest - manifest fields the subject reads.
 * @returns The member.
 */
function member(directory: string, name: string, manifest: Record<string, unknown> = {}): ReleaseMember {
  return { directory, name, version: '0.0.1', manifest }
}

describe('release families', () => {
  it('names one tag for the whole oh family and one per vendored package', () => {
    const oh = releaseFamily('oh')
    const vendor = releaseFamily('vendor')
    const cli = member('apps/cli', 'oh')
    const cordis = { ...member('vendor/cordis', '@open-harness/cordis'), version: '4.0.1' }

    expect(oh.tagFor(cli)).toBe('oh-v0.0.1')
    expect(vendor.tagFor(cordis)).toBe('vendor-cordis-v4.0.1')
    // The prefix is constructed, not recovered from a tag: a version with a
    // hyphen would defeat any suffix-stripping.
    expect(vendor.tagPrefixFor({ ...cordis, version: '4.0.0-rc.7' })).toBe('vendor-cordis-v')
    expect(vendor.tagFor({ ...cordis, version: '4.0.0-rc.7' })).toBe('vendor-cordis-v4.0.0-rc.7')
  })

  it('rejects a family whose members disagree on the shared version', () => {
    const oh = releaseFamily('oh')
    const members = [member('apps/cli', 'oh'), { ...member('apps/web', '@open-harness/oh-web-frontend'), version: '0.0.2' }]

    expect(() => { oh.verifyVersions(members) }).toThrow(/must share one version/)
    expect(() => { oh.verifyVersions([members[0]!]) }).not.toThrow()
  })

  it('accepts independent vendored versions and rejects an unpublishable one', () => {
    const vendor = releaseFamily('vendor')
    const members = [
      { ...member('vendor/cordis', '@open-harness/cordis'), version: '4.0.1' },
      { ...member('vendor/cosmokit', '@open-harness/cosmokit'), version: '1.8.2' },
    ]

    expect(() => { vendor.verifyVersions(members) }).not.toThrow()
    expect(() => { vendor.verifyVersions([{ ...members[0]!, version: 'latest' }]) }).toThrow(/unpublishable version/)
  })

  it('publishes a dependency before its consumer, and orders ties by name', () => {
    const oh = releaseFamily('oh')
    const members = [
      member('packages/a/consumer', '@open-harness/oh-consumer', { dependencies: { '@open-harness/oh-library': 'workspace:^' } }),
      member('packages/a/library', '@open-harness/oh-library'),
      member('packages/a/zebra', '@open-harness/oh-zebra'),
    ]

    expect(oh.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@open-harness/oh-library',
      '@open-harness/oh-consumer',
      '@open-harness/oh-zebra',
    ])
  })

  it('reports a runtime dependency cycle instead of emitting an arbitrary order', () => {
    const oh = releaseFamily('oh')
    const members = [
      member('packages/a/left', '@open-harness/oh-left', { dependencies: { '@open-harness/oh-right': 'workspace:^' } }),
      member('packages/a/right', '@open-harness/oh-right', { dependencies: { '@open-harness/oh-left': 'workspace:^' } }),
    ]

    expect(() => { oh.publishOrder(members) }).toThrow(/dependency cycle/)
  })

  it('publishes a peer before its consumer', () => {
    const oh = releaseFamily('oh')
    const members = [
      member('packages/a/consumer', '@open-harness/oh-consumer', { peerDependencies: { '@open-harness/oh-zebra': 'workspace:^' } }),
      member('packages/a/zebra', '@open-harness/oh-zebra'),
    ]

    // Name order alone would place the consumer first; the peer edge moves it.
    expect(oh.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@open-harness/oh-zebra',
      '@open-harness/oh-consumer',
    ])
  })

  it('orders around a peer cycle rather than refusing to publish, and reports the edge it dropped', () => {
    const oh = releaseFamily('oh')
    const members = [
      member('packages/a/left', '@open-harness/oh-left', { peerDependencies: { '@open-harness/oh-right': 'workspace:^' } }),
      member('packages/a/right', '@open-harness/oh-right', { peerDependencies: { '@open-harness/oh-left': 'workspace:^' } }),
    ]

    // Sibling packages declare each other as peers, and npm treats an unmet peer
    // as a warning, so this pair has to publish rather than fail the release.
    const plan = oh.publishOrder(members)
    expect(plan.order.map(entry => entry.name)).toEqual([
      '@open-harness/oh-right',
      '@open-harness/oh-left',
    ])
    // One of the two edges has to give, and which one it is belongs in the log.
    expect(plan.droppedPeerEdges).toEqual([
      { consumer: '@open-harness/oh-right', peer: '@open-harness/oh-left' },
    ])
  })

  it('honours an install edge even when a peer cycle surrounds it', () => {
    const oh = releaseFamily('oh')
    const members = [
      member('packages/a/base', '@open-harness/oh-base', { peerDependencies: { '@open-harness/oh-consumer': 'workspace:^' } }),
      member('packages/a/consumer', '@open-harness/oh-consumer', {
        dependencies: { '@open-harness/oh-base': 'workspace:^' },
        peerDependencies: { '@open-harness/oh-base': 'workspace:^' },
      }),
    ]

    // The install edge is absolute: base publishes first, and the peer edge that
    // would reverse it is the one dropped.
    const plan = oh.publishOrder(members)
    expect(plan.order.map(entry => entry.name)).toEqual([
      '@open-harness/oh-base',
      '@open-harness/oh-consumer',
    ])
    expect(plan.droppedPeerEdges).toEqual([
      { consumer: '@open-harness/oh-base', peer: '@open-harness/oh-consumer' },
    ])
  })

  it('refuses an order that would publish a consumer before a dependency it installs', () => {
    const oh = releaseFamily('oh')
    const members = [
      member('packages/a/alpha', '@open-harness/oh-alpha', { peerDependencies: { '@open-harness/oh-bravo': 'workspace:^' } }),
      member('packages/a/bravo', '@open-harness/oh-bravo', { peerDependencies: { '@open-harness/oh-charlie': 'workspace:^' } }),
      member('packages/a/charlie', '@open-harness/oh-charlie', { dependencies: { '@open-harness/oh-alpha': 'workspace:^' } }),
    ]

    // A cycle of two peer edges closed by one install edge: dropping a peer edge
    // would order this, and the traversal drops the install edge instead. That
    // order would publish charlie before the alpha it installs, so it is refused
    // here rather than published.
    expect(() => { oh.publishOrder(members) }).toThrow(/no publish order honours @open-harness\/oh-charlie -> @open-harness\/oh-alpha/)
  })

  it('ignores devDependencies when ordering', () => {
    const oh = releaseFamily('oh')
    const members = [
      member('packages/a/alpha', '@open-harness/oh-alpha', { devDependencies: { '@open-harness/oh-zebra': 'workspace:^' } }),
      member('packages/a/zebra', '@open-harness/oh-zebra'),
    ]

    // A dev dependency is absent from the published package, so it must not move
    // the consumer behind it.
    expect(oh.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@open-harness/oh-alpha',
      '@open-harness/oh-zebra',
    ])
  })

  it('applies the harness payload policy to oh and keeps upstream payloads for vendored packages', () => {
    const oh = releaseFamily('oh')
    const vendor = releaseFamily('vendor')
    const harness = member('packages/a/library', '@open-harness/oh-library')
    const vendored = member('vendor/cordis', '@open-harness/cordis')

    expect(() => { oh.validatePayload(harness, ['package/lib/index.js', 'package/src/index.ts']) })
      .toThrow(/publishes source file/)
    expect(() => { vendor.validatePayload(vendored, ['package/lib/index.js', 'package/src/index.ts']) }).not.toThrow()
    expect(() => { vendor.validatePayload(vendored, []) }).toThrow(/empty tarball/)
  })

  it('drives the installed entry only for the family that publishes one', () => {
    expect(releaseFamily('oh').installedEntry).toEqual({ packageName: 'oh', binPath: 'lib/bin.js' })
    expect(releaseFamily('vendor').installedEntry).toBeUndefined()
  })

  it('rejects an unknown family identifier', () => {
    expect(() => { releaseFamily('native') }).toThrow(/unknown release family/)
  })
})

describe('vendored version baseline', () => {
  it('drops an upstream prerelease segment and increments the patch', () => {
    expect(nextVendorVersion('4.0.0-rc.7', undefined)).toBe('4.0.1')
    expect(nextVendorVersion('1.0.0-rc.5', undefined)).toBe('1.0.1')
    expect(nextVendorVersion('1.8.1', undefined)).toBe('1.8.2')
  })

  it('increments from the last published version when a re-sync restored a lower one', () => {
    // Upstream moved rc.7 -> rc.8 after this repository published 4.0.1;
    // incrementing the manifest alone would name 4.0.1 a second time.
    expect(nextVendorVersion('4.0.0-rc.8', '4.0.1')).toBe('4.0.2')
    expect(nextVendorVersion('4.1.0', '4.0.1')).toBe('4.1.1')
  })

  it('appends a rehearsal prerelease without consuming its release numbers', () => {
    // A rehearsal burns 4.0.1-rc.1 and leaves 4.0.1 free, so the stable release
    // that follows takes those same numbers instead of skipping to 4.0.2.
    expect(nextVendorVersion('4.0.0-rc.7', undefined, 'rc.1')).toBe('4.0.1-rc.1')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1-rc.1', 'rc.2')).toBe('4.0.1-rc.2')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1-rc.1')).toBe('4.0.1')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1')).toBe('4.0.2')
  })
})

describe('version precedence', () => {
  it('ranks a release above the prerelease it follows', () => {
    // git --sort=v:refname disagrees, placing 4.0.1-rc.1 above 4.0.1, which is
    // why the newest published version is chosen here rather than by git.
    expect(compareVersions('4.0.1', '4.0.1-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.1', '4.0.1')).toBeLessThan(0)
  })

  it('compares numeric prerelease fields numerically', () => {
    expect(compareVersions('4.0.1-rc.10', '4.0.1-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.2', '4.0.1-rc.10')).toBeLessThan(0)
  })

  it('ranks a numeric field below an alphanumeric one, and a shorter list below a longer', () => {
    expect(compareVersions('4.0.1-1', '4.0.1-alpha')).toBeLessThan(0)
    expect(compareVersions('4.0.1-rc', '4.0.1-rc.1')).toBeLessThan(0)
    expect(compareVersions('4.0.2', '4.0.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.1', '4.0.1-rc.1')).toBe(0)
  })
})

describe('payload change judgement', () => {
  const sourceShipping = member('vendor/cosmokit', '@open-harness/cosmokit', {
    files: ['lib/index.js', 'lib/types/**/*.d.ts', 'src'],
  })
  const buildOutputOnly = member('vendor/cordis', '@open-harness/cordis', {
    files: ['lib/index.js', 'lib/types/**/*.d.ts', 'bin.js'],
  })

  it('counts the manifest and the files npm always publishes', () => {
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/package.json')).toBe(true)
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/README.md')).toBe(true)
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/src/index.ts')).toBe(true)
  })

  it('counts build inputs for a package whose payload is build output', () => {
    // cordis publishes lib/ only, and lib/ is not tracked: without this, a real
    // source change reads as "nothing changed" and the next publish fails on a
    // version whose bytes moved.
    expect(reachesPayload(buildOutputOnly, 'vendor/cordis/src/context.ts')).toBe(true)
    expect(reachesPayload(buildOutputOnly, 'vendor/cordis/tsconfig.json')).toBe(true)
  })

  it('ignores paths no tarball carries', () => {
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/tests/unit.spec.ts')).toBe(false)
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/CHANGELOG.md')).toBe(false)
    // The README pattern is deliberately loose: over-reporting a change costs one
    // unnecessary patch bump, while under-reporting fails the next publish on a
    // version whose bytes moved.
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/README.i18n.yaml')).toBe(true)
    expect(reachesPayload(member('packages/a/library', '@open-harness/oh-library', { files: ['lib/index.js'] }),
      'packages/a/library/tests/library.spec.ts')).toBe(false)
  })
})
