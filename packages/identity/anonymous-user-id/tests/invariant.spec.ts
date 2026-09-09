import { describe, expect, it } from 'vitest'
import { Context } from '@open-harness/cordis'
import InvariantRegistry from '@open-harness/oh-invariants'
import * as UserIdInvariant from '@open-harness/oh-anonymous-user-id/invariant'

describe('invariant companion', () => {
  it('registers the package ownership with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(UserIdInvariant).await()).resolves.toBeDefined()
  })
})
