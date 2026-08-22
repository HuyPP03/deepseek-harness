// Minimal ambient contract for mammoth's self-contained browser bundle (the
// npm package ships no types for that entry). Only the surface this package
// uses is declared; the bundle is a UMD build with everything inlined.

declare module 'mammoth/mammoth.browser.js' {
  /** One conversion diagnostic; warnings never block the preview. */
  export interface MammothMessage {
    type: 'error' | 'warning'
    message: string
  }

  /** A docx-to-HTML conversion result. */
  export interface MammothHtmlResult {
    /** The converted HTML (semantic tags only). */
    value: string
    /** Conversion diagnostics (unreadable parts and the like). */
    messages: MammothMessage[]
  }

  /**
   * Convert a docx document to HTML.
   * @param input - the document's bytes as an ArrayBuffer.
   * @returns the converted HTML plus its diagnostics.
   */
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<MammothHtmlResult>
}
