// Preview parsers: the docx and xlsx/csv seats decode the file's bytes in the
// browser. Each parser lazy-loads as its own chunk (dynamic import): a
// conversation that never opens an office document never fetches the parser.

/**
 * Convert a docx document to plain HTML for a sandboxed frame. Mammoth emits
 * only semantic tags (no scripts, no style payloads), so the frame's empty
 * sandbox stays sufficient.
 * @param bytes - the file's verbatim bytes.
 * @returns the converted HTML document body.
 */
export async function docxToHtml(bytes: Uint8Array): Promise<string> {
  const mammoth = await import('mammoth/mammoth.browser.js')
  // A fresh plain ArrayBuffer: the read view's backing buffer may be a
  // SharedArrayBuffer, which mammoth's contract does not accept.
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
  return result.value
}

/** One row of a parsed sheet: its cells, in order, as display strings. */
export type SheetRow = string[]

/**
 * Parse an xlsx or csv file's first sheet into a string grid.
 * @param bytes - the file's verbatim bytes.
 * @returns the first sheet's rows (SheetJS `header: 1`, values as strings);
 *   an empty array when the workbook holds no sheets.
 */
export async function sheetToGrid(bytes: Uint8Array): Promise<SheetRow[]> {
  const XLSX = await import('xlsx')
  const book = XLSX.read(bytes, { type: 'array' })
  const name = book.SheetNames[0]
  if (name === undefined) return []
  const sheet = book.Sheets[name]
  // SheetNames entries are derived from Sheets, so a listed name always resolves.
  /* v8 ignore next */
  if (sheet === undefined) return []
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as SheetRow[]
}
