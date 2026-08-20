/**
 * Human-facing `/search` command: a literal-text ripgrep search over the
 * session's project directory and its attached reference projects.
 *
 * The handler resolves the session's search roots from its own state (the
 * header's `cwd` plus the reference set `referencesOf` replays from the log),
 * runs the packaged ripgrep binary once through `ctx.subprocess`, and folds
 * the bounded match lines into the command result text as `path:line: text`.
 * The search never enters a model turn: it runs beside the agent and settles
 * like every other command through the `command/run`/`command/done` pair.
 *
 * @module @deepseek-ai/dsh-command-search
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { referencesOf } from '@deepseek-ai/dsh-workspace-references'
import { relative, sep } from 'node:path'

export const name = 'command-search'
export const inject = ['commands', 'subprocess']

/** The suffix appended when one folded match line is cut to the result budget. */
const LINE_MARKER = '… (line truncated)'
/** The no-argument result: the command takes one literal pattern. */
const USAGE = 'Usage: /search <literal text> — searches this session workspace and its reference projects'
/** The result when a session supplies neither a project directory nor reference projects. */
const NO_ROOTS = 'This session has no project directory and no reference projects to search.'

/** Total matches folded into the result text (ripgrep's per-file `-m` mirrors it). */
const MAX_MATCHES = 200
/** UTF-8 byte budget for the folded result text; the match count cap can stop it earlier. */
const MAX_RESULT_BYTES = 16 * 1024
/** Cap on ripgrep's retained raw stdout; overflow fails the search instead of parsing a partial stream. */
const RAW_STDOUT_MAX_BYTES = 256 * 1024
/** Diagnostic tail budget for ripgrep's stderr. */
const STDERR_MAX_BYTES = 64 * 1024
/** SIGTERM→SIGKILL escalation grace for the ripgrep process tree. */
const GRACE_MS = 3_000
/** Wall-clock bound on one search; the dispatching UI's cancellation fuses in. */
const TIMEOUT_MS = 30_000
/** The timeout's own cancellation code, recognized on the fused signal. */
const TIMEOUT_CODE = 'SEARCH_TIMEOUT'

let rgPathPromise: Promise<string> | undefined

/**
 * The packaged ripgrep binary path, resolved lazily once per process.
 *
 * `@vscode/ripgrep` resolves its platform package at module evaluation, so a
 * static import would turn a missing or corrupt platform package into a
 * failure of the whole Loader composition. Resolving at the call boundary
 * keeps that failure at the first search as a plain command error.
 *
 * @returns the packaged binary's absolute path; the memoized promise rejects
 *   when the platform package cannot be resolved.
 */
function resolveRgPath(): Promise<string> {
  rgPathPromise ??= import('@vscode/ripgrep').then(module => module.rgPath)
  return rgPathPromise
}

/**
 * One retained match: the file path exactly as ripgrep printed it, the 1-based
 * line number, and the line text (trailing newline already stripped).
 */
interface Match {
  readonly path: string
  readonly lineNumber: number
  readonly line: string
}

/**
 * Display form of one match path: absolute paths inside the search root become
 * root-relative; everything else (relative output, paths outside the root)
 * passes through unchanged.
 */
function displayPath(path: string, root: string): string {
  if (!path.startsWith('/')) return path
  const rel = relative(root, path)
  if (rel.length === 0) return '.'
  if (rel === '..' || rel.startsWith(`..${sep}`)) return path
  return rel
}

/**
 * Bound one folded match line to the result byte budget so a single oversized
 * line cannot break the complete-result budget. The cut keeps a whole UTF-8
 * sequence and appends the marker.
 *
 * @param line - the folded `path:line: text` line.
 * @param maxBytes - the complete-line byte budget.
 * @returns the line, unchanged when within the budget.
 */
function boundLine(line: string, maxBytes: number): string {
  if (Buffer.byteLength(line, 'utf8') <= maxBytes) return line
  const budget = maxBytes - Buffer.byteLength(LINE_MARKER, 'utf8')
  let kept = ''
  for (const char of line) {
    const next = kept + char
    if (Buffer.byteLength(next, 'utf8') > budget) break
    kept = next
  }
  return `${kept}${LINE_MARKER}`
}

/**
 * Parse ripgrep's `path:line: text` stdout into matches. Lines without two
 * colons (binary notes, malformed output) are skipped rather than guessed.
 *
 * @param stdout - the complete raw stdout of one finished run.
 * @returns the parsed matches in ripgrep's output order.
 */
function parseMatches(stdout: string): Match[] {
  const matches: Match[] = []
  for (const raw of stdout.split('\n')) {
    if (raw === '') continue
    const first = raw.indexOf(':')
    const second = first === -1 ? -1 : raw.indexOf(':', first + 1)
    if (first === -1 || second === -1) continue
    const lineNumber = Number.parseInt(raw.slice(first + 1, second), 10)
    if (!Number.isSafeInteger(lineNumber) || lineNumber < 1) continue
    matches.push({ path: raw.slice(0, first), lineNumber, line: raw.slice(second + 1) })
  }
  return matches
}

/**
 * The search roots for one session, in order: the project directory (if any)
 * first, then every attached reference project.
 *
 * @param agent - the command's receiving agent.
 * @returns the absolute search roots, possibly empty.
 */
function searchRoots(agent: CommandInvocation['agent']): string[] {
  const roots: string[] = []
  const cwd = agent.session.header.cwd
  if (cwd !== undefined) roots.push(cwd)
  // A reference equal to the cwd is impossible by admission (a session cannot
  // reference itself), so rg's own duplicate-path handling is the only dedup.
  roots.push(...referencesOf(agent.session))
  return roots
}

/**
 * Run one bounded ripgrep search over the given roots and fold the complete
 * result into command result text.
 *
 * @param ctx - the plugin context; execution uses its `subprocess` service.
 * @param invocation - the command invocation (agent, input, cancellation).
 * @param pattern - the trimmed literal pattern.
 * @param roots - the absolute search roots.
 * @returns the folded command result.
 */
async function executeSearch(
  ctx: Context,
  invocation: CommandInvocation,
  pattern: string,
  roots: readonly string[],
): Promise<CommandResult> {
  const agent = invocation.agent
  const root = agent.session.header.cwd ?? roots[0]
  /* v8 ignore next -- the caller resolves the roots and refuses the empty set before this call */
  if (root === undefined) throw new Error('command-search: search without a root is not callable')
  using d = deadline(invocation.signal, TIMEOUT_MS, TIMEOUT_CODE)
  // One try for both launch boundaries: a spawn-creation throw and a
  // `handle.done` rejection are the same caller-visible failure domain. An
  // abort that already won the race settles as cancelled; the registry's
  // executor independently records the abort on the command lifecycle.
  let handle: SubprocessHandle
  let outcome: SubprocessOutcome
  try {
    handle = ctx.subprocess.spawn({
      argv: [
        await resolveRgPath(),
        '--no-config',
        '--fixed-strings',
        '-H',
        '--line-number',
        '--max-count',
        String(MAX_MATCHES),
        '--',
        pattern,
        ...roots,
      ],
      cwd: root,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: RAW_STDOUT_MAX_BYTES },
        stderr: { maxBytes: STDERR_MAX_BYTES },
      },
      graceMs: GRACE_MS,
      signal: d.signal,
    })
    outcome = await handle.done
  } catch (error: unknown) {
    if (invocation.signal.aborted) return { kind: 'error', text: 'Search cancelled.' }
    return { kind: 'error', text: `Search could not start (ripgrep launch failed): ${String(error)}` }
  }
  if (invocation.signal.aborted) return { kind: 'error', text: 'Search cancelled.' }
  const stderr = handle.collected.stderr?.readFrom(0)
  // The deadline's kill is only the reason for a signal-killed outcome when the
  // deadline actually won the race; a completed run that outlives the timer
  // still reports its matches.
  const killedByTimeout =
    (outcome.signal !== null || outcome.exitCode === null) && timeoutOf(d.signal, TIMEOUT_CODE) !== undefined
  if (killedByTimeout) {
    return { kind: 'error', text: `Search timed out after ${TIMEOUT_MS / 1000}s.` }
  }
  if (outcome.signal !== null || outcome.exitCode === null) {
    const signalName = outcome.signal
    /* v8 ignore next -- the seam names the signal for every signal kill; a null-plus-null outcome is outside its contract */
    return { kind: 'error', text: `Search was killed by signal ${signalName ?? '(unknown)'}.` }
  }
  if (outcome.exitCode === 1) {
    return { kind: 'success', text: `No matches for "${pattern}".` }
  }
  if (outcome.exitCode !== 0) {
    const detail = stderr !== undefined && stderr.text !== '' ? `: ${stderr.text.trim()}` : ''
    return { kind: 'error', text: `Search failed (ripgrep exit ${outcome.exitCode})${detail}` }
  }
  const stdout = handle.collected.stdout?.readFrom(0)
  if (stdout === undefined) {
    return { kind: 'error', text: 'Search produced no output stream.' }
  }
  if (stdout.lossy) {
    return {
      kind: 'error',
      text: `Search produced more raw output than the ${RAW_STDOUT_MAX_BYTES}-byte cap retained; narrow the pattern or the roots.`,
    }
  }
  const matches = parseMatches(stdout.text).slice(0, MAX_MATCHES)
  if (matches.length === 0) {
    return { kind: 'success', text: `No matches for "${pattern}".` }
  }
  // One line alone must never break the complete-result budget: bound each
  // line to it before the total is known.
  const lines = matches.map(match =>
    boundLine(`${displayPath(match.path, root)}:${match.lineNumber}: ${match.line}`, MAX_RESULT_BYTES),
  )
  const foldedTo = (count: number): string => lines.slice(0, count).join('\n')
  if (Buffer.byteLength(foldedTo(matches.length), 'utf8') <= MAX_RESULT_BYTES) {
    return { kind: 'success', text: foldedTo(matches.length) }
  }
  // The byte budget can bind before the count cap on long lines: re-fold the
  // retained prefix until the budget holds, keeping at least one match.
  let count = matches.length
  while (count > 1 && Buffer.byteLength(foldedTo(count), 'utf8') > MAX_RESULT_BYTES) {
    count -= 1
  }
  return {
    kind: 'success',
    text: `${foldedTo(count)}\n… truncated to fit the result budget (showing ${count} of ${matches.length} matches)`,
  }
}

/**
 * Register `/search` for every composed human-command adapter.
 * @param ctx - context carrying the command registry and the subprocess service.
 */
export function apply(ctx: Context): void {
  const active = new Set<Promise<CommandResult>>()
  const handler = (invocation: CommandInvocation): Promise<CommandResult> => {
    const pattern = invocation.rawInput.trim()
    const roots = pattern === '' ? [] : searchRoots(invocation.agent)
    const operation = pattern === ''
      ? Promise.resolve<CommandResult>({ kind: 'error', text: USAGE })
      : roots.length === 0
        ? Promise.resolve<CommandResult>({ kind: 'error', text: NO_ROOTS })
        : executeSearch(ctx, invocation, pattern, roots)
    active.add(operation)
    const retire = (): void => { active.delete(operation) }
    // Both branches retire without rethrowing, so the derived observer promise
    // cannot become an unhandled mirror of an expected handler rejection.
    void operation.then(retire, retire)
    return operation
  }

  ctx.effect(function* () {
    // Yield drain before registration: composite teardown is LIFO, so no new
    // invocation can enter while already-started handler promises quiesce.
    yield async () => { await Promise.allSettled(active) }
    yield ctx.commands.register({
      name: 'search',
      description: 'Search this session workspace and its reference projects (literal text)',
      input: { hint: '<literal text>' },
      handler,
    })
  }, 'command-search lifecycle')
}
