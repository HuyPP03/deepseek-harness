// The capped-block expand/collapse button shared by the content blocks
// (Terminal/Search/Diff/Read). Each block renders the same control with its
// own module class and its own resolved labels; the toggle is the one place
// the four blocks agree, so it lives here instead of four copies.
import type { ReactNode } from 'react'

/** The four collapse/expand fields the toggle needs from a block's labels. */
export interface ExpandCollapseLabels {
  /** Collapse-toggle aria label while expanded. */
  collapseAria: string
  /** Expand-toggle aria label while capped, given the hidden line count. */
  expandAria: (hidden: number) => string
  /** Collapse-toggle text while expanded. */
  collapse: string
  /** Expand-toggle text while capped, given the hidden line count. */
  expand: (hidden: number) => string
}

export interface ExpandCollapseToggleProps {
  /** Hidden lines behind the cap; 0 renders nothing. */
  hidden: number
  /** Whether the block is currently expanded. */
  expanded: boolean
  /** The owning block's expand-button class. */
  className?: string | undefined
  /** The block's resolved labels (structured against {@link ExpandCollapseLabels}). */
  labels: ExpandCollapseLabels
  /** Toggles the expansion. */
  onToggle: () => void
}

/**
 * The capped-block expand/collapse button: renders while lines are hidden and
 * reads its copy from the owning block's labels.
 * @param props - the hidden count, expansion state, class, labels, and toggle.
 * @returns the button, or null when nothing is hidden.
 */
export function ExpandCollapseToggle({ hidden, expanded, className, labels, onToggle }: ExpandCollapseToggleProps): ReactNode {
  if (hidden <= 0) return null
  return (
    <button
      type="button"
      className={className}
      aria-expanded={expanded}
      aria-label={expanded ? labels.collapseAria : labels.expandAria(hidden)}
      onClick={onToggle}
    >
      {expanded ? labels.collapse : labels.expand(hidden)}
    </button>
  )
}
