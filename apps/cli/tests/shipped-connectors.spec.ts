/**
 * The shipped connector catalog is a boot-time input: one malformed
 * manifest fails the whole profile, so the catalog is verified through a
 * real profile boot, not a parser unit. The web profile mounts the
 * `connectors` row from the base layer and patches in this app's shipped
 * catalog root; the test binds an OS-assigned port so it never contends
 * with a running instance.
 */

import { describe, expect, it } from 'vitest'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '../src/profile-boot.ts'

describe('shipped connector catalog', () => {
  it('boots in the web profile and lists every shipped connector', { timeout: 120_000 }, async () => {
    const { ctx, shutdown } = await runProfile({
      environment: loadLayeredEnv('dsh'),
      profile: 'web',
      patchFiles: [],
      args: ['--port', '0'],
    })
    try {
      const connectors = ctx.get('connectors')
      if (connectors === undefined) throw new Error('web profile did not compose the connectors service')
      const views = await connectors.list()
      expect(views.map(view => view.id)).toEqual(['atlas', 'github', 'google', 'm365', 'notion', 'slack'])
      for (const view of views) expect(view.state).toBe('unconfigured')
      // The wire view is secret-free: no server command or URL leaves the host.
      const wire = JSON.stringify(views)
      expect(wire).not.toContain('npx')
      expect(wire).not.toContain('gmailmcp.googleapis.com')
      expect(wire).not.toContain('mcp.atlassian.com')
    } finally {
      await shutdown.shutdown(0)
    }
  })
})
