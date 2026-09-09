// Open Harness mark: an open ring — a bold arc with a 70-degree gap at the
// top-right and a terminal dot just outside the opening. Native 32x32 square,
// rendered 24x24 by default. Color rides currentColor.

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
        d="M26.34 14.18A10.5 10.5 0 1 1 17.82 5.66"
        stroke="currentColor"
        strokeWidth={5}
        strokeLinecap="round"
      />
      <circle cx="26.61" cy="5.39" r="2.6" fill="currentColor" />
    </svg>
  )
}
