// Open Harness mark: a square buckle — a bold rounded-square clamp with an
// open gap on the right side and a horizontal tongue seated in the opening.
// Native 32x32 square, rendered 24x24 by default. Color rides currentColor.

import type { IconProps } from './icons/props.ts'

/**
 * Render the Open Harness mark.
 * @param props.size - square edge in px (default 24).
 * @param props.className - extra class for layout placement.
 * @returns the mark svg (aria-hidden; pair with the wordmark text for accessibility).
 */
export function OpenMark({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M26 12L26 9Q26 6 23 6L9 6Q6 6 6 9L6 23Q6 26 9 26L23 26Q26 26 26 23L26 20"
        stroke="currentColor"
        strokeWidth={5}
        strokeLinecap="round"
      />
      <path
        d="M28.5 16H21.5"
        stroke="currentColor"
        strokeWidth={5}
        strokeLinecap="round"
      />
    </svg>
  )
}
