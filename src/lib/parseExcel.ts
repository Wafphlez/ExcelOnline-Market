import * as XLSX from 'xlsx'

export type ParseResult = {
  sheetName: string
  rows: Record<string, unknown>[]
}

export function parseMarketWorkbook(buffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buffer, { type: 'array' })
  if (!wb.SheetNames.length) {
    throw new Error('В книге нет листов')
  }
  const sheetName = wb.SheetNames[0]
  const sheet = wb.Sheets[sheetName]
  if (!sheet) {
    throw new Error('Не удалось прочитать лист')
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
  })
  return { sheetName, rows }
}
