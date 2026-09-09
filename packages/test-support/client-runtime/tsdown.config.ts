import { clientLibrary } from '../../client/tsdown.client.ts'

export default clientLibrary(
  '@open-harness/oh-client-test-runtime',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
