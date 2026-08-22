// @vitest-environment jsdom
// DiffBlock: the unified hunk rows (path header, neutral context, removed,
// added), the same-file second-hunk gap separator, the 1-based gutters from
// the hunk's stamped start lines, the per-side syntax highlight, the intra-line
// stronger marks (and their INTRA_LINE_MAX skip), the `+A -R · N file(s)`
// footer and its singular/plural, the head/tail height cap and its expand
// control, the empty-diffs null render, and the copy control writing the
// prefixed diff text on both the accepted and the refused clipboard paths.
// writeClipboard's own return contract is pinned in terminal-block.spec.tsx
// (the shared return contract), so only its DOM consequence is asserted here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DEFAULT_DIFF_MAX_LINES, DiffBlock, INTRA_LINE_MAX, type DiffHunk } from '../src/index.ts'

afterEach(cleanup)

beforeEach(() => {
  vi.useRealTimers()
})

/** All rendered body rows (path/gap included), one entry per line. */
function bodyRowCount(container: HTMLElement): number {
  return container.querySelectorAll('[class*="_line_"]').length
}

/** Only the changed rows (add/del), reading the content cell so the sign and
 *  gutter chrome never pollute the text. */
function changeRows(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[class*="_del_"] [class*="_content_"], [class*="_add_"] [class*="_content_"]')]
    .map(row => row.textContent ?? '')
}

/** The body rows that are neither path, gap, nor a change row (context rows). */
function contextRows(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[class*="_line_"]')]
    .filter(row => !/_path_|_gap_|_del_|_add_/.test(row.className))
    .map(row => row.querySelector('[class*="_content_"]')?.textContent ?? '')
}

/** The rendered gutter numbers, in row order (an unnumbered row keeps its empty slot). */
function gutters(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[class*="_gutter_"]')].map(el => el.textContent ?? '')
}

/** The intra-line stronger marks, in row order. */
function strongMarks(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[class*="_strong"]')].map(el => el.textContent ?? '')
}

/** `count` numbered added lines as one hunk's newText. */
function added(count: number): string {
  return Array.from({ length: count }, (_v, i) => `line ${i + 1}`).join('\n')
}

describe('DiffBlock structure', () => {
  it('renders a create as a path header and an added block (no removed side)', () => {
    const diffs: DiffHunk[] = [{ path: 'notes/new.txt', oldText: null, newText: 'hello\nworld' }]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(screen.getByText('notes/new.txt')).toBeTruthy()
    // No removed rows: both change lines are added.
    expect(changeRows(container)).toEqual(['hello', 'world'])
    expect(container.querySelectorAll('[class*="_del_"]').length).toBe(0)
    expect(container.querySelectorAll('[class*="_add_"]').length).toBe(2)
  })

  it('renders an edit as a removed row above its added pair', () => {
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: 'old', newText: 'new' }]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(container.querySelectorAll('[class*="_del_"]').length).toBe(1)
    expect(container.querySelectorAll('[class*="_add_"]').length).toBe(1)
    expect(changeRows(container)).toEqual(['old', 'new'])
  })

  it('renders no body rows for a create with empty content', () => {
    // The terminator rule's empty arm: an empty newText is zero lines, so the
    // body is the bare path header and the footer zero-counts.
    const diffs: DiffHunk[] = [{ path: 'n.txt', oldText: null, newText: '' }]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(container.querySelectorAll('[class*="_line_"]').length).toBe(1)
    expect(container.querySelectorAll('[class*="_del_"], [class*="_add_"]').length).toBe(0)
    expect(screen.getByText('└ +0 -0 · 1 file')).toBeTruthy()
  })

  it('renders a full deletion as removed rows with no added side', () => {
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: 'a\nb', newText: '', oldStart: 4, lang: 'ts' }]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(container.querySelectorAll('[class*="_del_"]').length).toBe(2)
    expect(container.querySelectorAll('[class*="_add_"]').length).toBe(0)
    expect(gutters(container)).toEqual(['4', '5'])
    expect(screen.getByText('└ +0 -2 · 1 file')).toBeTruthy()
  })

  it('keeps the lines around a change neutral context, counted out of the footer', () => {
    // A 3-line context hunk: the unchanged lines render as context rows (no
    // side class) and only the changed pair counts toward +A -R.
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: 'x\nold\ny', newText: 'x\nnew\ny' }]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(contextRows(container)).toEqual(['x', 'y'])
    expect(changeRows(container)).toEqual(['old', 'new'])
    expect(screen.getByText('└ +1 -1 · 1 file')).toBeTruthy()
  })

  it('falls to separate removed and added blocks when the sides are unbalanced', () => {
    // Three removed lines against one added line cannot pair: the removed block
    // renders first, the added block after, and all of it counts.
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: 'a\nb\nc', newText: 'x' }]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(container.querySelectorAll('[class*="_del_"]').length).toBe(3)
    expect(container.querySelectorAll('[class*="_add_"]').length).toBe(1)
    expect(contextRows(container)).toEqual([])
    expect(screen.getByText('└ +1 -3 · 1 file')).toBeTruthy()
  })

  it('renders a pure insertion between context lines as context + add + context', () => {
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: 'a\nc', newText: 'a\nb\nc' }]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(contextRows(container)).toEqual(['a', 'c'])
    expect(changeRows(container)).toEqual(['b'])
    expect(container.querySelectorAll('[class*="_del_"]').length).toBe(0)
    expect(screen.getByText('└ +1 -0 · 1 file')).toBeTruthy()
  })

  it('flushes a trailing removed block at the hunk end', () => {
    // File text carries its terminator newline: without it the shared first
    // line would not compare equal and no context row would render.
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: 'a\nb\n', newText: 'a\n' }]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(contextRows(container)).toEqual(['a'])
    expect(changeRows(container)).toEqual(['b'])
    expect(container.querySelectorAll('[class*="_del_"]').length).toBe(1)
    expect(container.querySelectorAll('[class*="_add_"]').length).toBe(0)
    expect(screen.getByText('└ +0 -1 · 1 file')).toBeTruthy()
  })

  it('opens a same-file second hunk with a gap instead of repeating the path', () => {
    const diffs: DiffHunk[] = [
      { path: 'a.ts', oldText: 'x', newText: 'y' },
      { path: 'a.ts', oldText: 'p', newText: 'q' },
    ]
    const { container } = render(<DiffBlock diffs={diffs} />)
    // One path header, one gap row.
    expect(container.querySelectorAll('[class*="_path_"]').length).toBe(1)
    expect(container.querySelectorAll('[class*="_gap_"]').length).toBe(1)
  })

  it('opens a new file with its own path header', () => {
    const diffs: DiffHunk[] = [
      { path: 'a.ts', oldText: 'x', newText: 'y' },
      { path: 'b.ts', oldText: 'p', newText: 'q' },
    ]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(container.querySelectorAll('[class*="_path_"]').length).toBe(2)
    expect(container.querySelectorAll('[class*="_gap_"]').length).toBe(0)
  })

  it('renders nothing for empty diffs', () => {
    const { container } = render(<DiffBlock diffs={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('treats a trailing newline as a terminator, not an extra blank line', () => {
    // A create whose newText ends in a newline is one added line, not two, and
    // the footer counts one — the phantom `+ ` empty line the naive split drew.
    const { container } = render(<DiffBlock diffs={[{ path: 'n.txt', oldText: null, newText: 'hello\n' }]} />)
    expect(changeRows(container)).toEqual(['hello'])
    expect(screen.getByText('└ +1 -0 · 1 file')).toBeTruthy()
  })

  it('renders a full deletion as removed-only with no phantom added line', () => {
    // newText '' is zero added lines: an empty string must contribute nothing.
    const { container } = render(<DiffBlock diffs={[{ path: 'gone.ts', oldText: 'a\nb', newText: '' }]} />)
    expect(container.querySelectorAll('[class*="_add_"]').length).toBe(0)
    expect(screen.getByText('└ +0 -2 · 1 file')).toBeTruthy()
  })

  it('keeps a genuine interior blank line', () => {
    const { container } = render(<DiffBlock diffs={[{ path: 'a.ts', oldText: null, newText: 'x\n\ny' }]} />)
    expect(container.querySelectorAll('[class*="_add_"]').length).toBe(3)
  })
})

describe('DiffBlock gutters', () => {
  it('numbers the body from the hunk start lines when stamped', () => {
    // Hunk at line 4: context (4), the removed row (5) above its added pair
    // (5), context (6) — the pair shares one line number on both sides.
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: 'x\nold\ny', newText: 'x\nnew\ny', oldStart: 4, newStart: 4 }]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(gutters(container)).toEqual(['4', '5', '5', '6'])
  })

  it('numbers a create from newStart with no removed side', () => {
    const diffs: DiffHunk[] = [{ path: 'n.txt', oldText: null, newText: 'a\nb', newStart: 7 }]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(gutters(container)).toEqual(['7', '8'])
  })

  it('keeps the gutter column when a side never stamped a start', () => {
    // Only oldStart: the added row has no number, but the column still holds so
    // the sign stays aligned with its neighbors — an empty slot, not a
    // collapse. Context rows number from the new-side cursor when stamped,
    // otherwise fall back to the old-side cursor (line 6 on the removed side).
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: 'x\nold\ny', newText: 'x\nnew\ny', oldStart: 4 }]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(gutters(container)).toEqual(['4', '5', '', '6'])
  })

  it('numbers an unbalanced adjacency from stamped starts on both sides', () => {
    // Three removed lines against one added line: the removed block numbers
    // from oldStart, the added block from newStart, and all four count.
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: 'a\nb\nc', newText: 'x', oldStart: 4, newStart: 4, lang: 'ts' }]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(gutters(container)).toEqual(['4', '5', '6', '4'])
    expect(screen.getByText('└ +1 -3 · 1 file')).toBeTruthy()
  })

  it('numbers a pure insertion from newStart with its context', () => {
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: 'a\nc', newText: 'a\nb\nc', newStart: 7, lang: 'ts' }]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(gutters(container)).toEqual(['7', '8', '9'])
    expect(screen.getByText('└ +1 -0 · 1 file')).toBeTruthy()
  })

  it('draws no gutter column when no hunk stamps a start', () => {
    const { container } = render(<DiffBlock diffs={[{ path: 'a.ts', oldText: 'old', newText: 'new' }]} />)
    expect(container.querySelectorAll('[class*="_gutter_"]').length).toBe(0)
  })
})

describe('DiffBlock highlight', () => {
  it('highlights a known language on both sides through the shared shiki path', () => {
    const { container } = render(
      <DiffBlock diffs={[{ path: 'a.ts', oldText: 'const x = 1', newText: 'const x = 2', lang: 'ts' }]} />,
    )
    // Each side tokenizes its keyword run into a styled --shiki-* span.
    expect(container.querySelectorAll('[class*="_content_"] span[style]').length).toBeGreaterThan(1)
  })

  it('renders plain when the hunk carries no language hint', () => {
    const { container } = render(<DiffBlock diffs={[{ path: 'a.txt', oldText: 'const x = 1', newText: 'const x = 2' }]} />)
    expect(container.querySelectorAll('[class*="_content_"] span[style]').length).toBe(0)
  })

  it('highlights a created file from its newStart with the lang hint', () => {
    const { container } = render(
      <DiffBlock diffs={[{ path: 'n.ts', oldText: null, newText: 'const a = 1\nconst b = 2', newStart: 7, lang: 'ts' }]} />,
    )
    expect(gutters(container)).toEqual(['7', '8'])
    expect(container.querySelectorAll('[class*="_content_"] span[style]').length).toBeGreaterThan(1)
  })

  it('highlights context rows on both sides when the hunk carries a lang hint', () => {
    const { container } = render(
      <DiffBlock diffs={[{ path: 'a.ts', oldText: 'x\nconst a = 1\ny', newText: 'x\nconst a = 2\ny', lang: 'ts' }]} />,
    )
    // The context rows (`x`, `y`) tokenize through the same per-side pass as
    // the changed pair.
    expect(contextRows(container)).toEqual(['x', 'y'])
    expect(container.querySelectorAll('[class*="_content_"] span[style]').length).toBeGreaterThan(1)
  })
})

describe('DiffBlock intra-line marks', () => {
  it('marks the changed run on both sides of a modified line pair', () => {
    const { container } = render(
      <DiffBlock diffs={[{ path: 'a.ts', oldText: 'const x = 1', newText: 'const x = 2' }]} />,
    )
    expect(strongMarks(container)).toEqual(['1', '2'])
  })

  it('splits a token span so the mark keeps the token color around it', () => {
    // The changed word sits inside one string-literal token: the word-level
    // diff marks `world`/`World`, and the mark splits the shiki span so the
    // surrounding literal keeps its string color.
    const { container } = render(
      <DiffBlock
        diffs={[{ path: 'a.ts', oldText: 'const s = "hello world"', newText: 'const s = "hello World"', lang: 'ts' }]}
      />,
    )
    expect(strongMarks(container)).toEqual(['world', 'World'])
    expect(container.querySelectorAll('[class*="_content_"] span[style]').length).toBeGreaterThan(0)
  })

  it('marks the whole line when the pair shares no common run', () => {
    const { container } = render(<DiffBlock diffs={[{ path: 'a.ts', oldText: 'old', newText: 'new' }]} />)
    expect(strongMarks(container)).toEqual(['old', 'new'])
  })

  it('skips the intra-line mark on lines past INTRA_LINE_MAX', () => {
    const longOld = 'a'.repeat(INTRA_LINE_MAX) + '1'
    const longNew = 'a'.repeat(INTRA_LINE_MAX) + '2'
    const { container } = render(<DiffBlock diffs={[{ path: 'a.txt', oldText: longOld, newText: longNew }]} />)
    expect(strongMarks(container)).toEqual([])
    // The rows still render with the whole-line wash.
    expect(container.querySelectorAll('[class*="_del_"]').length).toBe(1)
    expect(container.querySelectorAll('[class*="_add_"]').length).toBe(1)
  })
})

describe('DiffBlock footer', () => {
  it('counts added and removed lines and one file', () => {
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: 'a\nb', newText: 'c' }]
    render(<DiffBlock diffs={diffs} />)
    expect(screen.getByText('└ +1 -2 · 1 file')).toBeTruthy()
  })

  it('pluralizes the distinct-file count', () => {
    const diffs: DiffHunk[] = [
      { path: 'a.ts', oldText: null, newText: 'x' },
      { path: 'b.ts', oldText: null, newText: 'y' },
    ]
    render(<DiffBlock diffs={diffs} />)
    expect(screen.getByText('└ +2 -0 · 2 files')).toBeTruthy()
  })
})

describe('DiffBlock height cap', () => {
  it('shows head and tail with an expand control past the cap, then all lines expanded', () => {
    // One added line over the default cap forces the collapse.
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: null, newText: added(DEFAULT_DIFF_MAX_LINES) }]
    // The path header counts as a row, so a body of maxLines added lines plus
    // the header is one over the cap.
    const { container } = render(<DiffBlock diffs={diffs} />)
    const toggle = screen.getByRole('button', { name: /展开其余/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    // Collapsed shows fewer rows than the full body.
    const collapsedCount = bodyRowCount(container)
    expect(collapsedCount).toBeLessThan(DEFAULT_DIFF_MAX_LINES + 1)
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: '收起差异' }).getAttribute('aria-expanded')).toBe('true')
    expect(bodyRowCount(container)).toBeGreaterThan(collapsedCount)
  })

  it('shows no expand control at or under the cap', () => {
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: null, newText: added(4) }]
    render(<DiffBlock diffs={diffs} maxLines={16} />)
    expect(screen.queryByRole('button', { name: /展开其余|收起差异/ })).toBeNull()
  })
})

describe('DiffBlock copy', () => {
  it('copies the prefixed diff text and flips the label on success', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const diffs: DiffHunk[] = [
      { path: 'a.ts', oldText: 'old', newText: 'new' },
      { path: 'a.ts', oldText: 'p', newText: 'q' },
    ]
    render(<DiffBlock diffs={diffs} />)
    const copy = screen.getByRole('button', { name: '复制' })
    await act(async () => { fireEvent.click(copy) })
    // Path header, del/add prefixes, and the same-file gap all reach the clipboard.
    expect(writeText).toHaveBeenCalledWith('a.ts\n- old\n+ new\n⋯\n- p\n+ q')
    expect(screen.getByRole('button', { name: '复制成功' })).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByRole('button', { name: '复制' })).toBeTruthy()
  })

  it('copies context rows with a two-space prefix', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<DiffBlock diffs={[{ path: 'a.ts', oldText: 'x\nold\ny', newText: 'x\nnew\ny' }]} />)
    const copy = screen.getByRole('button', { name: '复制' })
    await act(async () => { fireEvent.click(copy) })
    expect(writeText).toHaveBeenCalledWith('a.ts\n  x\n- old\n+ new\n  y')
  })

  it('keeps the label on a refused clipboard write', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    render(<DiffBlock diffs={[{ path: 'a.ts', oldText: null, newText: 'x' }]} />)
    const copy = screen.getByRole('button', { name: '复制' })
    await act(async () => { fireEvent.click(copy) })
    expect(screen.getByRole('button', { name: '复制' })).toBeTruthy()
  })

  it('ignores a second click while the copied label is showing', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<DiffBlock diffs={[{ path: 'a.ts', oldText: null, newText: 'x' }]} />)
    const copy = screen.getByRole('button', { name: '复制' })
    await act(async () => { fireEvent.click(copy) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制成功' })) })
    expect(writeText).toHaveBeenCalledTimes(1)
  })
})
