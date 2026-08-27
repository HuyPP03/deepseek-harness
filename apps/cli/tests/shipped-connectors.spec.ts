/**
 * The shipped connector catalog is a boot-time input: one malformed
 * manifest fails the whole profile, so the catalog is verified through a
 * real profile boot, not a parser unit. The web profile mounts the
 * `connectors` row from the base layer and patches in this app's shipped
 * catalog root; the test binds an OS-assigned port so it never contends
 * with a running instance. `$DSH_HOME` is pointed at a temp home before
 * boot: the roster asserts every row is unconfigured, which an ambient
 * developer home (with configured connectors and their mounted servers)
 * would break.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { healProfilesModuleFallback, loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '../src/profile-boot.ts'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const INSTALL_ANCHOR = join(REPO_ROOT, 'apps/cli/package.json')

let home: string | undefined
let previousHome: string | undefined

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-shipped-connectors-'))
  previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  healProfilesModuleFallback(INSTALL_ANCHOR, home)
})

afterEach(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  if (home !== undefined) await rm(home, { recursive: true, force: true })
  home = undefined
  previousHome = undefined
})

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
      expect(views.map(view => view.id)).toEqual(['atlas', 'figma', 'github', 'google', 'm365', 'notion', 'slack'])
      for (const view of views) expect(view.state).toBe('unconfigured')
      // The token methods expose their reference names (public manifest data);
      // the multi-reference slack pair is the live case for the per-ref dialog.
      const slack = views.find(view => view.id === 'slack')
      expect(slack?.auth).toEqual([{
        mode: 'token', configured: false,
        howTo: 'Create a Slack app with bot token scopes for the channels you want to read and post, invite it to those channels, then copy the bot token and your workspace Team ID from the Slack API console.',
        credentialRefs: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
      }])
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
