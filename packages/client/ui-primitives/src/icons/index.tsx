/**
 * Open Harness Modern Precision Stroke Icon Family.
 * Every glyph is crafted as a 1.5px currentColor line icon with smooth curves,
 * rounded caps/joins, precise proportions, and clean geometry.
 * All icons support standard IconProps ({ size, className }).
 */
import type { ReactNode } from 'react'
import type { IconProps } from './props.ts'

export type { IconProps } from './props.ts'

interface FrameProps {
  size: number
  /** `| undefined` for exactOptionalPropertyTypes: callers forward their own optional prop. */
  className?: string | undefined
  viewBox?: string
  width?: number
  children: ReactNode
}

/** The shared stroke frame: 1.5px currentColor stroke, round caps and joins. */
function Frame({ size, className, viewBox = '0 0 16 16', width, children }: FrameProps) {
  return (
    <svg
      width={width ?? size}
      height={size}
      className={className}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  )
}

/** The shared filled frame: currentColor fill, no stroke. */
function FillFrame({ size, className, viewBox = '0 0 16 16', children }: Omit<FrameProps, 'width'>) {
  return (
    <svg width={size} height={size} className={className} viewBox={viewBox} fill="none" xmlns="http://www.w3.org/2000/svg">
      {children}
    </svg>
  )
}

/** A modern chat bubble with a central plus sign (16px). */
export const IconNewChatOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M4 3.5h8A2 2 0 0 1 14 5.5v4a2 2 0 0 1-2 2H7.5L4.5 13.5v-2H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z" />
    <path d="M8 5.5v4M6 7.5h4" />
  </Frame>
)

/** Precision magnifying glass with 45-degree angled handle (16px). */
export const IconSearchOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="M10 10l3.25 3.25" />
  </Frame>
)

/** Globe icon with contoured meridians (14px). */
export const IconGlobeOutline14 = ({ size = 14, className }: IconProps) => (
  <Frame size={size} className={className} viewBox="0 0 14 14">
    <circle cx="7" cy="7" r="5" />
    <path d="M2 7h10M7 2c1.8 1.6 1.8 8.4 0 10M7 2c-1.8 1.6-1.8 8.4 0 10" />
  </Frame>
)

/** Precision 8-tooth gear for settings (14px). */
export const IconSettingsOutline14 = ({ size = 14, className }: IconProps) => (
  <Frame size={size} className={className} viewBox="0 0 14 14">
    <circle cx="7" cy="7" r="2.1" />
    <path d="M7 1.6v1.2M7 11.2v1.2M1.6 7h1.2M11.2 7h1.2M3.18 3.18l.85.85M9.97 9.97l.85.85M10.82 3.18l-.85.85M4.03 9.97l-.85.85" />
  </Frame>
)

/** Precision 8-tooth gear for settings (16px). */
export const IconSettingsOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <circle cx="8" cy="8" r="2.5" />
    <path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.76 3.76l1.06 1.06M11.18 11.18l1.06 1.06M12.24 3.76l-1.06 1.06M4.82 11.18l-1.06 1.06" />
  </Frame>
)

/** Sidebar panel layout toggle (16px). */
export const IconPanelLeftOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <rect x="2.5" y="3" width="11" height="10" rx="2" />
    <path d="M6 3v10" />
  </Frame>
)

/** Three horizontal action dots (16px). */
export const IconEllipsisOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <circle cx="3.5" cy="8" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12.5" cy="8" r="1.2" fill="currentColor" stroke="none" />
  </Frame>
)

/** Plus add sign (16px). */
export const IconPlusOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M8 3.5v9M3.5 8h9" />
  </Frame>
)

/** Success checkmark (16px). */
export const IconCheckOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M3.5 8.5L6.5 11.5L12.5 4.5" />
  </Frame>
)

/** Success checkmark (14px). */
export const IconCheckOutline14 = ({ size = 14, className }: IconProps) => (
  <Frame size={size} className={className} viewBox="0 0 14 14">
    <path d="M3 7.2L5.6 9.8L11 4.2" />
  </Frame>
)

/** Git branch tree structure (16px). */
export const IconBranchOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <circle cx="4.5" cy="4" r="1.5" />
    <circle cx="4.5" cy="12" r="1.5" />
    <circle cx="11.5" cy="6" r="1.5" />
    <path d="M4.5 5.5v5" />
    <path d="M4.5 8.5C4.5 6.8 6.5 6 10 6" />
  </Frame>
)

/** Downward chevron arrow (14px). */
export const IconChevronDownOutline14 = ({ size = 14, className }: IconProps) => (
  <Frame size={size} className={className} viewBox="0 0 14 14">
    <path d="M3.5 5.25L7 8.75l3.5-3.5" />
  </Frame>
)

/** Leftward chevron arrow (14px). */
export const IconChevronLeftOutline14 = ({ size = 14, className }: IconProps) => (
  <Frame size={size} className={className} viewBox="0 0 14 14">
    <path d="M8.75 3.5L5.25 7l3.5 3.5" />
  </Frame>
)

/** Rightward chevron arrow (14px). */
export const IconChevronRightOutline14 = ({ size = 14, className }: IconProps) => (
  <Frame size={size} className={className} viewBox="0 0 14 14">
    <path d="M5.25 3.5L8.75 7l-3.5 3.5" />
  </Frame>
)

/** Filled right triangle Play button (14px). */
export const IconTriangleRightFill14 = ({ size = 14, className }: IconProps) => (
  <FillFrame size={size} className={className} viewBox="0 0 14 14">
    <path fill="currentColor" d="M4.5 3.2a.6.6 0 0 0-.9.52v6.56a.6.6 0 0 0 .9.52l5.5-3.28a.6.6 0 0 0 0-1.04L4.5 3.2Z" />
  </FillFrame>
)

/** Upward chevron arrow (14px). */
export const IconChevronUpOutline14 = ({ size = 14, className }: IconProps) => (
  <Frame size={size} className={className} viewBox="0 0 14 14">
    <path d="M3.5 8.75L7 5.25l3.5 3.5" />
  </Frame>
)

/** Close cross sign (16px). */
export const IconCloseOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
  </Frame>
)

/** Filled close cross pill button (14px). */
export const IconCloseFill14 = ({ size = 14, className }: IconProps) => (
  <FillFrame size={size} className={className} viewBox="0 0 14 14">
    <path
      fill="currentColor"
      d="M7 1.4A5.6 5.6 0 1 0 12.6 7 5.6 5.6 0 0 0 7 1.4Zm2.1 7.7a.6.6 0 0 1-.85 0L7 7.85l-1.25 1.25a.6.6 0 0 1-.85-.85L6.15 7 4.9 5.75a.6.6 0 0 1 .85-.85L7 6.15l1.25-1.25a.6.6 0 0 1 .85.85L7.85 7l1.25 1.25a.6.6 0 0 1 0 .85Z"
    />
  </FillFrame>
)

/** Copy overlapping pages (16px). */
export const IconCopyOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.8" />
    <path d="M10.5 3.5H4A1.5 1.5 0 0 0 2.5 5v6.5" />
  </Frame>
)

/** Circular refresh arrow (16px). */
export const IconRefreshOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M12.8 7.5a4.8 4.8 0 1 1-1.4-3.4" />
    <path d="M13 2.5v3h-3" />
  </Frame>
)

/** Circular refresh arrow (14px). */
export const IconRefreshOutline14 = ({ size = 14, className }: IconProps) => (
  <Frame size={size} className={className} viewBox="0 0 14 14">
    <path d="M11.2 6.5a4.2 4.2 0 1 1-1.2-3" />
    <path d="M11.5 2v2.5H9" />
  </Frame>
)

/** Thumbs up outline (16px). */
export const IconLikeOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M2.5 9.5H5V14.5H3a.5.5 0 0 1-.5-.5v-4a.5.5 0 0 1 .5-.5Z" />
    <path d="M5 9.5L7.8 4.2a1.2 1.2 0 0 1 2.2.6v2.2h3.2a1.3 1.3 0 0 1 1.3 1.5l-1 5A1.5 1.5 0 0 1 12 14.5H5" />
  </Frame>
)

/** Thumbs up filled (16px). */
export const IconLikeFill16 = ({ size = 16, className }: IconProps) => (
  <FillFrame size={size} className={className}>
    <path fill="currentColor" d="M2.5 9.5H5V14.5H3a.5.5 0 0 1-.5-.5v-4a.5.5 0 0 1 .5-.5Z" />
    <path fill="currentColor" d="M5 9.5L7.8 4.2a1.2 1.2 0 0 1 2.2.6v2.2h3.2a1.3 1.3 0 0 1 1.3 1.5l-1 5A1.5 1.5 0 0 1 12 14.5H5" />
  </FillFrame>
)

/** Thumbs down outline (16px). */
export const IconDislikeOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M2.5 6.5H5V1.5H3a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 .5.5Z" />
    <path d="M5 6.5L7.8 11.8a1.2 1.2 0 0 0 2.2-.6V9h3.2a1.3 1.3 0 0 0 1.3-1.5l-1-5A1.5 1.5 0 0 0 12 1.5H5" />
  </Frame>
)

/** Thumbs down filled (16px). */
export const IconDislikeFill16 = ({ size = 16, className }: IconProps) => (
  <FillFrame size={size} className={className}>
    <path fill="currentColor" d="M2.5 6.5H5V1.5H3a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 .5.5Z" />
    <path fill="currentColor" d="M5 6.5L7.8 11.8a1.2 1.2 0 0 0 2.2-.6V9h3.2a1.3 1.3 0 0 0 1.3-1.5l-1-5A1.5 1.5 0 0 0 12 1.5H5" />
  </FillFrame>
)

/** Linked network share nodes (16px). */
export const IconShareOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <circle cx="12" cy="4" r="1.8" />
    <circle cx="4" cy="8" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <path d="M5.6 7.2l4.8-2.4M5.6 8.8l4.8 2.4" />
  </Frame>
)

/** Pencil edit mode (16px). */
export const IconEditOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M11.5 3.5a1.414 1.414 0 0 1 2 2L5.5 13.5H3.5v-2L11.5 3.5Z" />
    <path d="M9.5 5.5l2 2" />
  </Frame>
)

/** Declared thinking bulb (14px). */
export const IconThinkOutline14 = ({ size = 14, className }: IconProps) => (
  <Frame size={size} className={className} viewBox="0 0 14 14">
    <circle cx="7" cy="5.25" r="3.25" />
    <path d="M5.25 8.5v1.2a1.75 1.75 0 0 0 3.5 0V8.5M5.25 12h3.5" />
  </Frame>
)

/** Declared thinking bulb (16px). */
export const IconThinkOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <circle cx="8" cy="6" r="3.75" />
    <path d="M6 9.75V11a2 2 0 0 0 4 0V9.75M6 13.5h4" />
  </Frame>
)

/** Smart AI Agent head with antenna and friendly features (16px). */
export const IconAgentPresetOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <rect x="3.5" y="5" width="9" height="7.5" rx="2.2" />
    <path d="M8 5V3.25" />
    <circle cx="8" cy="2.5" r="0.75" fill="currentColor" stroke="none" />
    <circle cx="6.25" cy="7.75" r="0.8" fill="currentColor" stroke="none" />
    <circle cx="9.75" cy="7.75" r="0.8" fill="currentColor" stroke="none" />
    <path d="M6.5 10c.5.5 2.5.5 3 0" />
  </Frame>
)

/** Browser window chrome (16px). */
export const IconBrowseOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <rect x="2.5" y="3" width="11" height="10" rx="2" />
    <path d="M2.5 6.25h11" />
    <circle cx="4.5" cy="4.6" r="0.5" fill="currentColor" stroke="none" />
    <circle cx="6.2" cy="4.6" r="0.5" fill="currentColor" stroke="none" />
    <circle cx="7.9" cy="4.6" r="0.5" fill="currentColor" stroke="none" />
  </Frame>
)

/** Chain link (14px). */
export const IconLinkOutline14 = ({ size = 14, className }: IconProps) => (
  <Frame size={size} className={className} viewBox="0 0 14 14">
    <path d="M5.8 8.2l2.4-2.4" />
    <path d="M6.4 4.6L5.2 3.4a2 2 0 0 0-2.8 2.8l1.2 1.2" />
    <path d="M7.6 9.4l1.2 1.2a2 2 0 0 0 2.8-2.8l-1.2-1.2" />
  </Frame>
)

/** Chain link (16px). */
export const IconLinkOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M6.5 9.5l3-3" />
    <path d="M7.2 5.2L5.8 3.8a2.25 2.25 0 0 0-3.18 3.18l1.4 1.4" />
    <path d="M8.8 10.8l1.4 1.4a2.25 2.25 0 0 0 3.18-3.18l-1.4-1.4" />
  </Frame>
)

/** Angled external link arrow (14px box, size 8 default). */
export const IconRightUpOutline14 = ({ size = 8, className }: IconProps) => (
  <Frame size={size} className={className} viewBox="0 0 8 14">
    <path d="M1.5 11.5L6.5 2M2.5 2H6.5v4" />
  </Frame>
)

/** External link open-in-new box (16px). */
export const IconRightUpOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M9 3.5h3.5V7" />
    <path d="M12.5 3.5L6.5 9.5" />
    <path d="M11 12.5H4A1.5 1.5 0 0 1 2.5 11V4A1.5 1.5 0 0 1 4 2.5h3" />
  </Frame>
)

/** Magic wand with 4-pointed sparkle (16px). */
export const IconEnhanceOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M3.5 12.5L10.5 5.5" />
    <path d="M11.5 2.5l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5Z" fill="currentColor" stroke="none" />
  </Frame>
)

/** Modern rounded trash bin (16px). */
export const IconTrashOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M3.5 4.5h9" />
    <path d="M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" />
    <path d="M5 4.5l.5 8a1.5 1.5 0 0 0 1.5 1.5h2a1.5 1.5 0 0 0 1.5-1.5l.5-8" />
    <path d="M6.75 7v4.5M9.25 7v4.5" />
  </Frame>
)

/** Warning triangle (16px, 14 viewBox). */
export const IconWarningOutline16 = ({ size = 14, className }: IconProps) => (
  <Frame size={size} className={className} viewBox="0 0 14 14">
    <path d="M7 2.2L12.25 11.5H1.75L7 2.2Z" />
    <path d="M7 5.75v2.75" />
    <circle cx="7" cy="10" r="0.6" fill="currentColor" stroke="none" />
  </Frame>
)

/** User avatar portrait (16px). */
export const IconUserOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <circle cx="8" cy="5.25" r="2.75" />
    <path d="M3.5 13.5a4.5 4.5 0 0 1 9 0" />
  </Frame>
)

/** Paper plane send (16px). */
export const IconSendOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M13.5 2.5L2.5 7.5l4.5 1.5L8.5 13.5l5-11Z" />
    <path d="M7 9l6.5-6.5" />
  </Frame>
)

/** Paper plane send (14px). */
export const IconSendOutline14 = ({ size = 14, className }: IconProps) => (
  <Frame size={size} className={className} viewBox="0 0 14 14">
    <path d="M12 2L2 6.5l4 1.3L7.3 12 12 2Z" />
    <path d="M6 7.8L12 2" />
  </Frame>
)

/** Filled stop execution square (16px). */
export const IconStopFill16 = ({ size = 16, className }: IconProps) => (
  <FillFrame size={size} className={className}>
    <rect x="3.5" y="3.5" width="9" height="9" rx="2" fill="currentColor" />
  </FillFrame>
)

/** Paperclip file attachment (16px). */
export const IconPaperclipOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M9.5 5.5l-3.8 3.8a2 2 0 0 0 2.83 2.83l4.24-4.24a3.5 3.5 0 0 0-4.95-4.95L3.58 7.18a5 5 0 0 0 7.07 7.07l2.83-2.83" />
  </Frame>
)

/** Loading spinner arc (16px). */
export const IconLoadingOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M8 2.5A5.5 5.5 0 1 0 13.5 8" />
  </Frame>
)

/** Download arrow into tray (16px). */
export const IconDownloadOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M8 2.5v7.5M4.5 7L8 10.5l3.5-3.5" />
    <path d="M3.5 13.5h9" />
  </Frame>
)

/** Play video/audio outline (16px). */
export const IconPlayOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M5 3.75l7 4.25-7 4.25V3.75Z" />
  </Frame>
)

/** Pause execution bars (16px). */
export const IconPauseOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M5.5 4.5v7M10.5 4.5v7" />
  </Frame>
)

/** Fullscreen corner brackets (16px). */
export const IconFullscreenOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M3 6V3.5A1 1 0 0 1 4 2.5h2.5M13 6V3.5A1 1 0 0 0 12 2.5H9.5M3 10v2.5A1 1 0 0 0 4 13.5h2.5M13 10v2.5A1 1 0 0 1 12 13.5H9.5" />
  </Frame>
)

/** Code brackets < /> (16px). */
export const IconCodeOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M5.5 4.5L2.5 8l3 3.5M10.5 4.5l3 3.5-3 3.5" />
  </Frame>
)

/** Plug icon (14px) — Cordis plugins and API-endpoint call rows. */
export const IconCordisPluginOutline14 = ({ size = 14, className }: IconProps) => (
  <Frame size={size} className={className} viewBox="0 0 14 14">
    <path d="M5.25 2v2.25M8.75 2v2.25" />
    <path d="M3.5 4.25h7V6.5a3.5 3.5 0 0 1-7 0V4.25Z" />
    <path d="M7 10v2" />
  </Frame>
)

/** Personalization sliders (16px). */
export const IconPersonalizationOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
    <circle cx="5.5" cy="4.5" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="10.5" cy="8" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="7" cy="11.5" r="1.3" fill="currentColor" stroke="none" />
  </Frame>
)

/** Add new project folder (16px). */
export const IconProjectAddOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M2.5 5.25A1.75 1.75 0 0 1 4.25 3.5h2.8l1.4 1.75h3.3A1.75 1.75 0 0 1 13.5 7v4.25A1.75 1.75 0 0 1 11.75 13h-7.5A1.75 1.75 0 0 1 2.5 11.25Z" />
    <path d="M8 7v4M6 9h4" />
  </Frame>
)

/** Open folder outline (16px). */
export const IconFolderOpenOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M2.5 12.5V5.25A1.75 1.75 0 0 1 4.25 3.5h2.8l1.4 1.75h4.8A1.75 1.75 0 0 1 15 7v.5" />
    <path d="M2.5 12.5L4.1 8h9.8l1.1 4.5a1 1 0 0 1-.97 1.25H3.5A1 1 0 0 1 2.5 12.5Z" />
  </Frame>
)

/** Open folder duotone (16px). */
export const IconFolderOpen16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M2.5 12.5V5.25A1.75 1.75 0 0 1 4.25 3.5h2.8l1.4 1.75h4.8A1.75 1.75 0 0 1 15 7v.5" fill="currentColor" fillOpacity="0.25" stroke="none" />
    <path d="M2.5 12.5V5.25A1.75 1.75 0 0 1 4.25 3.5h2.8l1.4 1.75h4.8A1.75 1.75 0 0 1 15 7v.5" />
    <path d="M2.5 12.5L4.1 8h9.8l1.1 4.5a1 1 0 0 1-.97 1.25H3.5A1 1 0 0 1 2.5 12.5Z" />
  </Frame>
)

/** Closed folder (16px). */
export const IconFolderClose16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M2.5 5.25A1.75 1.75 0 0 1 4.25 3.5h2.8l1.4 1.75h5.05A1.75 1.75 0 0 1 15.25 7v4.25a1.75 1.75 0 0 1-1.75 1.75H4.25A1.75 1.75 0 0 1 2.5 11.25Z" />
  </Frame>
)

/** Tree branch corner (10px). */
export const IconTreeCorner8x10 = ({ size = 10, className }: IconProps) => (
  <Frame size={size} className={className} viewBox="-0.5 0 8.5 10.5" width={(size * 8) / 10}>
    <path d="M0 0v7c0 1.7 1.3 3 3 3h5" />
  </Frame>
)

/** Sun theme light icon (16px). */
export const IconLightOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <circle cx="8" cy="8" r="3.25" />
    <path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.76 3.76l1.06 1.06M11.18 11.18l1.06 1.06M12.24 3.76l-1.06 1.06M4.82 11.18l-1.06 1.06" />
  </Frame>
)

/** Crescent moon theme dark icon (16px). */
export const IconDarkOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M13.5 9.75A5.75 5.75 0 1 1 6.25 2.5 4.5 4.5 0 0 0 13.5 9.75Z" />
  </Frame>
)

/** Desktop monitor system theme (16px). */
export const IconFollowsystemOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <rect x="2.5" y="3.5" width="11" height="7.5" rx="1.8" />
    <path d="M5.5 13.5h5M8 11v2.5" />
  </Frame>
)

/** Database cylinder (16px). */
export const IconDataOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <ellipse cx="8" cy="4.25" rx="5" ry="2" />
    <path d="M3 4.25v7.5c0 1.1 2.24 2 5 2s5-.9 5-2v-7.5" />
    <path d="M3 8c0 1.1 2.24 2 5 2s5-.9 5-2" />
  </Frame>
)

/** Queue list (14px). */
export const IconQueueOutline14 = ({ size = 14, className }: IconProps) => (
  <Frame size={size} className={className} viewBox="0 0 14 14">
    <path d="M2.5 3.5h9M2.5 7h9M2.5 10.5h5.5" />
  </Frame>
)

/** Checklist ticks (14px). */
export const IconChecklistOutline14 = ({ size = 14, className }: IconProps) => (
  <Frame size={size} className={className} viewBox="0 0 14 14">
    <path d="M5.5 3.5h6M5.5 7h6M5.5 10.5h4.5" />
    <path d="M2.25 3.25l.85.85 1.4-1.4M2.25 6.75l.85.85 1.4-1.4" />
  </Frame>
)

/** List with editing pen (16px). */
export const IconListPenOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M3 4.5h7.5M3 8.5h5M3 12.5h6" />
    <path d="M11.5 12.5l2.25-2.25a.9.9 0 0 0-1.27-1.27L10.23 11.23l-.48 2.02Z" />
  </Frame>
)

/** Concentric bullseye goal target (16px). */
export const IconGoalOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <circle cx="8" cy="8" r="5.75" />
    <circle cx="8" cy="8" r="3" />
    <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
  </Frame>
)

/** 4-pointed filled sparkle (16px). */
export const IconSparkle16 = ({ size = 16, className }: IconProps) => (
  <FillFrame size={size} className={className}>
    <path fill="currentColor" d="M8 2.2C8.6 5.4 10.6 7.4 13.8 8 10.6 8.6 8.6 10.6 8 13.8 7.4 10.6 5.4 8.6 2.2 8 5.4 7.4 7.4 5.4 8 2.2Z" />
  </FillFrame>
)

/** Inspect magnifying glass (12px on 16 box). */
export const IconInspectOutline12 = ({ size = 12, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    className={className}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden
  >
    <circle cx="7" cy="7" r="4.25" />
    <path d="M10 10l3.25 3.25" />
    <path d="M5.5 6.5L4.5 7.5l1 1M8.5 6.5l1 1-1 1" />
  </svg>
)

/** Energy lightning bolt for Agent skill (16px). */
export const IconSkillOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M9.25 2.25L3.75 9h4.5L7.75 13.75L13.25 7H8.75Z" />
  </Frame>
)

/** Question mark circle help icon (14px). */
export const IconQuestionOutline14 = ({ size = 14, className }: IconProps) => (
  <Frame size={size} className={className} viewBox="0 0 14 14">
    <circle cx="7" cy="7" r="5" />
    <path d="M5.5 5.25a1.5 1.5 0 0 1 2.9.5c0 1-1.4 1.25-1.4 2.25" />
    <circle cx="7" cy="9.8" r="0.6" fill="currentColor" stroke="none" />
  </Frame>
)

/** Archive storage box (20px). */
export const IconArchiveOutline20 = ({ size = 20, className }: IconProps) => (
  <Frame size={size} className={className} viewBox="0 0 20 20">
    <rect x="3" y="4.5" width="14" height="4.5" rx="1.5" />
    <path d="M4.5 9v6.5A1.5 1.5 0 0 0 6 17h8a1.5 1.5 0 0 0 1.5-1.5V9" />
    <path d="M8.5 12h3" />
  </Frame>
)

/** Dashboard Hero Chat bubble (18px). */
export const IconChatDashboardHero18 = ({ size = 18, className }: IconProps) => (
  <Frame size={size} className={className} viewBox="0 0 18 18">
    <path d="M4 3.75h10A2 2 0 0 1 16 5.75v5a2 2 0 0 1-2 2H9.25L5.5 15.5v-2.75H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z" />
    <path d="M5.75 6.75h6.5M5.75 9.5h4" />
  </Frame>
)

/** Dashboard Hero Folder (18px). */
export const IconWorkspaceDashboardHero18 = ({ size = 18, className }: IconProps) => (
  <Frame size={size} className={className} viewBox="0 0 18 18">
    <path d="M2.75 5.5A1.75 1.75 0 0 1 4.5 3.75h3.5l1.75 2.25h3.75A1.75 1.75 0 0 1 15.25 7.75v5.5a1.75 1.75 0 0 1-1.75 1.75H4.5a1.75 1.75 0 0 1-1.75-1.75Z" />
  </Frame>
)

/** Dashboard Hero Plug (18px). */
export const IconConnectorsDashboardHero18 = ({ size = 18, className }: IconProps) => (
  <Frame size={size} className={className} viewBox="0 0 18 18">
    <path d="M6.75 3.5V2M11.25 3.5V2" />
    <rect x="4.5" y="3.5" width="9" height="7" rx="2" />
    <path d="M9 10.5v3.5" />
  </Frame>
)

/** Bar chart stats (16px). */
export const IconStatsChartOutline16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M2.5 13.5h11" />
    <path d="M4.5 13.5V8.5M8 13.5V4.5M11.5 13.5V7" />
  </Frame>
)

/** Custom Robot Subagent inside frame (16px). */
export const IconSubagentCustom16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
    <circle cx="6.25" cy="6.75" r="0.8" fill="currentColor" stroke="none" />
    <circle cx="9.75" cy="6.75" r="0.8" fill="currentColor" stroke="none" />
    <path d="M6 10c.5.5 3.5.5 4 0" />
  </Frame>
)

/** Folder file type icon (16px). */
export const IconFileTypeFolder16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M2.5 5.25A1.75 1.75 0 0 1 4.25 3.5h2.8l1.4 1.75h4.8A1.75 1.75 0 0 1 15 7v4.25a1.75 1.75 0 0 1-1.75 1.75H4.25A1.75 1.75 0 0 1 2.5 11.25Z" />
  </Frame>
)

/** Code file type icon (16px). */
export const IconFileTypeCode16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M5.5 5.5L3 8l2.5 2.5" />
    <path d="M10.5 5.5L13 8l-2.5 2.5" />
    <path d="M9.25 4L6.75 12" />
  </Frame>
)

/** Markdown file type icon (16px). */
export const IconFileTypeMarkdown16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M3 11.5V4.5h2.5L7.5 8l2-3.5H12v7" />
  </Frame>
)

/** JSON file type icon (16px). */
export const IconFileTypeJson16 = ({ size = 16, className }: IconProps) => (
  <Frame size={size} className={className}>
    <path d="M5.5 4C4.25 4 4.25 5.5 4.25 7c0 1.5 0 1.5-1.25 1.5 1.25 0 1.25 0 1.25 1.5 0 1.5 0 2 1.25 2" />
    <path d="M10.5 4c1.25 0 1.25 1.5 1.25 3 0 1.5 0 1.5 1.25 1.5-1.25 0-1.25 0-1.25 1.5 0 1.5 0 2-1.25 2" />
  </Frame>
)
