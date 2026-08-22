/**
 * The common-namespace dictionary set. en is the source of truth for the
 * key set; vi and zh are checked complete against it — a missing or extra
 * key in either is a compile error.
 */
export { en } from './en.ts'
export type { CommonKey } from './en.ts'
export { vi } from './vi.ts'
export { zh } from './zh.ts'
