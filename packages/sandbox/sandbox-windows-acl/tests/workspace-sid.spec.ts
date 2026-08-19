/**
 * Write-identity SID derivation tests: the per-workspace, per-private-temp,
 * and per-reference identities are deterministic (the same canonical path
 * always derives the same SID — the property the cross-session grant reuse
 * rests on), capability-shaped, distinct across paths, byte-sensitive (the
 * canonical path is the caller's contract; an alias spelling derives a
 * second identity, self-healing at the cost of one extra tree propagation),
 * and domain-separated so one capability kind can never be confused with
 * another on the same path.
 */

import { describe, expect, it } from 'vitest'

import { refWriteSid, tempWriteSid, workspaceWriteSid } from '../src/index.ts'

describe('workspaceWriteSid', () => {
  it('derives a stable capability-shaped SID per workspace path', () => {
    const first = workspaceWriteSid('C:\\Users\\agent\\repo')
    const second = workspaceWriteSid('C:\\Users\\agent\\repo')
    expect(first).toBe(second)
    expect(first).toMatch(/^S-1-4-\d+-\d+$/u)
  })

  it('derives distinct identities for distinct workspaces', () => {
    expect(workspaceWriteSid('C:\\Users\\agent\\repo-a')).not.toBe(workspaceWriteSid('C:\\Users\\agent\\repo-b'))
  })

  it('is byte-sensitive: the canonical path is the caller\'s contract (an alias spelling derives a second identity)', () => {
    expect(workspaceWriteSid('C:\\Repo')).not.toBe(workspaceWriteSid('c:\\repo'))
    expect(workspaceWriteSid('C:\\Repo\\')).not.toBe(workspaceWriteSid('C:\\Repo'))
  })
})

describe('tempWriteSid', () => {
  it('derives a stable domain-separated SID per private temp path', () => {
    const temp = tempWriteSid('C:\\Users\\agent\\AppData\\Local\\Temp\\dsh-abc123')
    expect(temp).toBe(tempWriteSid('C:\\Users\\agent\\AppData\\Local\\Temp\\dsh-abc123'))
    expect(temp).toMatch(/^S-1-4-\d+-\d+-1$/u)
    expect(temp).not.toBe(workspaceWriteSid('C:\\Users\\agent\\AppData\\Local\\Temp\\dsh-abc123'))
  })

  it('derives distinct capabilities for distinct private temp paths', () => {
    expect(tempWriteSid('C:\\Temp\\dsh-a')).not.toBe(tempWriteSid('C:\\Temp\\dsh-b'))
  })
})

describe('refWriteSid', () => {
  it('derives a stable domain-separated SID per reference path', () => {
    const ref = refWriteSid('C:\\Users\\agent\\ref-project')
    expect(ref).toBe(refWriteSid('C:\\Users\\agent\\ref-project'))
    expect(ref).toMatch(/^S-1-4-\d+-\d+-2$/u)
    expect(ref).not.toBe(workspaceWriteSid('C:\\Users\\agent\\ref-project'))
    expect(ref).not.toBe(tempWriteSid('C:\\Users\\agent\\ref-project'))
  })

  it('derives distinct capabilities for distinct reference paths', () => {
    expect(refWriteSid('C:\\Users\\agent\\ref-a')).not.toBe(refWriteSid('C:\\Users\\agent\\ref-b'))
  })

  it('is byte-sensitive like the other identities (the canonical path is the caller\'s contract)', () => {
    expect(refWriteSid('C:\\Repo')).not.toBe(refWriteSid('c:\\repo'))
    expect(refWriteSid('C:\\Repo\\')).not.toBe(refWriteSid('C:\\Repo'))
  })
})
