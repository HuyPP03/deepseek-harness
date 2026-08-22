// The inspector's node half: an inert apply that exists so the plugin appears
// in the host cordis.yml / Loader tree (the browser half ships via
// exports["./client"]).

import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('node half', () => {
  it('contributes no host behavior', () => {
    expect(() => { apply() }).not.toThrow()
  })
})
