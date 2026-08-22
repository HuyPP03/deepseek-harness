// The preview parsers' behavior on real bytes: a committed minimal docx
// fixture through mammoth, and csv/xlsx through SheetJS (the xlsx fixture is
// generated in-test so no binary sheet artifact is committed).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import XLSX from 'xlsx'
import { docxToHtml, sheetToGrid } from '../src/client/preview.ts'

const DOCX_FIXTURE = fileURLToPath(new URL('./fixtures/hello.docx', import.meta.url))

describe('docxToHtml', () => {
  it('converts a docx file to its semantic HTML', async () => {
    const bytes = new Uint8Array(readFileSync(DOCX_FIXTURE))
    const html = await docxToHtml(bytes)
    expect(html).toContain('Hello Docx Preview')
    expect(html).not.toContain('<script')
  })
})

describe('sheetToGrid', () => {
  it('parses a csv file into a string grid', async () => {
    const bytes = new TextEncoder().encode('name,age\nAda,36\n')
    expect(await sheetToGrid(bytes)).toEqual([['name', 'age'], ['Ada', '36']])
  })

  it('parses an xlsx workbook into a string grid', async () => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['a', 1], [2, 'three']]), 'S')
    const bytes = new Uint8Array(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer)
    expect(await sheetToGrid(bytes)).toEqual([['a', '1'], ['2', 'three']])
  })

  it('returns no rows for a workbook without sheets', async () => {
    const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/empty.xlsx', import.meta.url))))
    expect(await sheetToGrid(bytes)).toEqual([])
  })
})
