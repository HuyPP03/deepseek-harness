/**
 * Human-facing `/simplify` and `/code-review` commands over agent steering
 * and one-shot subagent review.
 * @module @deepseek-ai/dsh-command-agent-actions
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'

export const name = 'command-agent-actions'
export const inject = ['commands', 'subagents']

/** Config: the one-shot subagent provider /code-review spawns on. */
export interface Config {
  /**
   * The `ctx.subagents` provider name /code-review starts its review
   * children on (default `spawn`). When the provider is not registered the
   * command degrades to steering the receiving agent instead.
   */
  provider?: string
}

const DEFAULT_PROVIDER = 'spawn'
const SIMPLIFY_USAGE = 'Usage: /simplify (no arguments)'
const REVIEW_USAGE = 'Usage: /code-review (no arguments)'
const REPORT_TRUNCATED_MARKER = '\n… review report truncated to fit the result budget'

/** The command composes its steering text; it never echoes the human's line. */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'command-agent-actions' }

/** Steer directive for /simplify: behavior-preserving simplification. */
const SIMPLIFY_DIRECTIVE =
  'Simplify the code touched in this session. Remove dead code and ' +
  'accidental duplication, merge overlapping logic, and align names and ' +
  'structure with the surrounding code. Preserve behavior exactly: no new ' +
  'features, no changed public interfaces, and no reformatting of files ' +
  'the session did not already change.'

/** Steer directive for the /code-review fallback: report only, no edits. */
const REVIEW_DIRECTIVE =
  'Review the code changed in this session. Check correctness, security, ' +
  'performance, and maintainability. Report your findings only: do not ' +
  'modify any file.'

/** The four report-only review facets, one one-shot child each. */
const REVIEW_FACETS = [
  { key: 'correctness', focus: 'correctness: logic errors, unhandled failure paths, races, and edge cases' },
  { key: 'security', focus: 'security: injection surfaces, secret handling, and trust-boundary mistakes' },
  { key: 'performance', focus: 'performance: unnecessary work, repeated scans, and scaling hazards' },
  { key: 'maintainability', focus: 'maintainability: duplication, unclear structure, and tests the change owes' },
] as const

/** Bound for the folded review report carried by the `command/done` record. */
const REVIEW_REPORT_MAX_BYTES = 32 * 1024
/** Bound for the file list quoted into each reviewer child's prompt. */
const MAX_REVIEW_FILES = 100

/**
 * Derive the files this session's log records as changed: every `tool/call`
 * event for the `edit` and `write` tools contributes its `file_path`.
 * @returns the paths in first-touched order, duplicates removed.
 */
function changedFilePaths(invocation: CommandInvocation): string[] {
  const paths: string[] = []
  for (const event of invocation.agent.session.events) {
    if (event.type !== 'tool/call') continue
    if (event.data.name !== 'edit' && event.data.name !== 'write') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(event.data.arguments) as unknown
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null) continue
    const filePath = (parsed as Record<string, unknown>).file_path
    if (typeof filePath === 'string' && filePath !== '' && !paths.includes(filePath)) paths.push(filePath)
  }
  return paths
}

/** One reviewer child's prompt: the facet focus plus the changed file list. */
function reviewPrompt(facet: (typeof REVIEW_FACETS)[number], paths: readonly string[]): string {
  const listed = paths.slice(0, MAX_REVIEW_FILES)
  const more = paths.length - listed.length
  const list = listed.map(path => `- ${path}`).join('\n')
  return (
    'You are one of four parallel reviewers of the code changed in another ' +
    'session\'s workspace. Review these changed files, reading whatever you ' +
    `need to understand them:\n${list}${more > 0 ? `\n(and ${more} more changed files)` : ''}\n\n` +
    `Review for ${facet.focus}.\n` +
    'Report findings only: cite file and line for each finding, and do not ' +
    'modify any file. If you find nothing in your facet, say so in one line.'
  )
}

/** Fold one settled review child into its report section. */
function facetSection(key: string, result: SubagentResult): string {
  const text = result.output
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
  const body = text === '' ? '(the reviewer produced no findings text)' : text
  return result.stopReason === 'completed'
    ? `## ${key}\n${body}`
    : `## ${key}\n(reviewer did not finish: ${result.stopReason})`
}

/**
 * Fit the report into its byte budget: the largest prefix whose UTF-8
 * encoding with the truncation marker still fits.
 */
function fitReport(report: string): string {
  const total = new TextEncoder().encode(report).length
  if (total <= REVIEW_REPORT_MAX_BYTES) return report
  const markerBytes = new TextEncoder().encode(REPORT_TRUNCATED_MARKER).length
  const budget = REVIEW_REPORT_MAX_BYTES - markerBytes
  let lo = 0
  let hi = report.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (new TextEncoder().encode(report.slice(0, mid)).length <= budget) lo = mid
    else hi = mid - 1
  }
  return report.slice(0, lo) + REPORT_TRUNCATED_MARKER
}

/**
 * Execute one argument-free /simplify: steer the receiving agent with the
 * simplification directive. An idle agent starts a turn; a running agent
 * consumes the steering at its next step boundary.
 */
function executeSimplify(invocation: CommandInvocation): CommandResult {
  invocation.agent.steer(createUserMessage({
    content: [{ type: 'text', text: SIMPLIFY_DIRECTIVE }],
    source: PLUGIN_SOURCE,
  }))
  return { kind: 'success', text: 'Simplification queued for this session.' }
}

/**
 * Execute one argument-free /code-review: four one-shot reviewer children in
 * parallel on the configured provider, or one steering message to the
 * receiving agent when the provider is not registered. Report-only: no
 * result text instructs edits.
 */
async function executeReview(
  ctx: Context,
  invocation: CommandInvocation,
  providerName: string,
): Promise<CommandResult> {
  const paths = changedFilePaths(invocation)
  if (paths.length === 0) {
    return { kind: 'success', text: 'No code changes were found in this session to review.' }
  }
  const provider = ctx.subagents.getProvider(providerName)
  if (provider === undefined) {
    invocation.agent.steer(createUserMessage({
      content: [{ type: 'text', text: REVIEW_DIRECTIVE }],
      source: PLUGIN_SOURCE,
    }))
    return {
      kind: 'success',
      text: `Subagent provider "${providerName}" is not available in this deployment; the review was queued on this agent instead.`,
    }
  }

  const starts = REVIEW_FACETS.map(facet => ctx.subagents.start(providerName, {
    label: `code-review ${facet.key}`,
    prompt: [{ type: 'text', text: reviewPrompt(facet, paths) }],
    parent: invocation.agent,
    signal: invocation.signal,
  }).then(run => ({ facet, run })))
  const settled = await Promise.allSettled(starts)
  const facets: { facet: (typeof REVIEW_FACETS)[number]; run: SubagentRun }[] = []
  const failures: string[] = []
  settled.forEach((entry, index) => {
    const facet = REVIEW_FACETS[index]
    /* v8 ignore next -- settled maps 1:1 onto REVIEW_FACETS, so index is always in range. */
    if (facet === undefined) return
    if (entry.status === 'fulfilled') facets.push(entry.value)
    else failures.push(`${facet.key}: ${String(entry.reason)}`)
  })
  try {
    if (facets.length === 0) throw new Error(failures.join('; '))
    const results = await Promise.all(facets.map(facet => facet.run.result))
    const sections = results.map((result, index) => {
      const facet = facets[index]
      /* v8 ignore next -- results map 1:1 onto facets from the all() above. */
      if (facet === undefined) throw new Error(`review result without facet ${index}`)
      return facetSection(facet.facet.key, result)
    })
    if (failures.length > 0) sections.push(`## failed facets\n${failures.join('\n')}`)
    const report = `Code review of ${paths.length} changed file${paths.length === 1 ? '' : 's'} (report-only):\n\n${sections.join('\n\n')}`
    return { kind: 'success', text: fitReport(report) }
  } finally {
    await Promise.allSettled(facets.map(facet => facet.run.dispose()))
  }
}

/**
 * Register /simplify and /code-review for every composed human-command
 * adapter.
 * @param ctx - context carrying the command registry and the subagent service.
 * @param config - the /code-review provider selection (default `spawn`).
 */
export function apply(ctx: Context, config: Config = {}): void {
  const providerName = config.provider ?? DEFAULT_PROVIDER
  const active = new Set<Promise<CommandResult>>()
  /* jscpd:ignore-start */
  const wrap = (usage: string, run: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>) =>
    (invocation: CommandInvocation): Promise<CommandResult> => {
      if (invocation.rawInput.trim().length > 0) return Promise.resolve({ kind: 'error', text: usage })
      const operation = Promise.resolve(run(invocation))
      active.add(operation)
      const retire = (): void => { active.delete(operation) }
      // Both branches retire without rethrowing, so the derived observer
      // promise cannot become an unhandled mirror of an expected rejection.
      void operation.then(retire, retire)
      return operation
    }

  ctx.effect(function* () {
    // Yield drain before registration: composite teardown is LIFO, so no new
    // invocation can enter while already-started handler promises quiesce.
    yield async () => { await Promise.allSettled(active) }
    yield ctx.commands.register({
      name: 'simplify',
      description: 'Ask the agent to simplify the code touched in this session',
      handler: wrap(SIMPLIFY_USAGE, executeSimplify),
    })
    yield ctx.commands.register({
      name: 'code-review',
      description: 'Review the code changed in this session with four parallel reviewers (report only)',
      handler: wrap(REVIEW_USAGE, invocation => executeReview(ctx, invocation, providerName)),
    })
  }, 'command-agent-actions lifecycle')
  /* jscpd:ignore-end */
}
