// Open Harness mark: a precision 3D-layered stack logo.
// Native 32x32 square, rendered 24x24 by default. Color rides currentColor.

import type { IconProps } from './icons/props.ts'

/**
 * Render the Open Harness brand mark with modern Layered Stack geometry.
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
      {/* Base Layer Plate */}
      <path
        d="M 24 14.5 V 21.5 C 24 24.54 21.54 27 18.5 27 H 10.5 C 7.46 27 5 24.54 5 21.5 V 13.5 C 5 10.46 7.46 8 10.5 8 H 17.5"
        stroke="currentColor"
        strokeWidth={3.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Upper Offset Stack Layer */}
      <path
        d="M 27 10.5 V 17.5 C 27 20.54 24.54 23 21.5 23 H 13.5 C 10.46 23 8 20.54 8 17.5 V 9.5 C 8 6.46 10.46 4 13.5 4 H 21.5 C 24.54 4 27 6.46 27 9.5 V 10.5 H 20"
        stroke="currentColor"
        strokeWidth={3.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
