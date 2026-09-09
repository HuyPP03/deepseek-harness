import { describe, expect, it } from 'vitest'
import { Context } from '@open-harness/cordis'
import * as SlotsInvariant from '@open-harness/oh-client-ui-slots/invariant'
import InvariantRegistry from '@open-harness/oh-invariants'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(SlotsInvariant).await()).resolves.toBeDefined()
  })
})
