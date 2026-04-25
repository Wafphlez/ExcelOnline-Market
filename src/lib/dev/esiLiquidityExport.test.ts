import { describe, expect, it } from 'vitest'
import { liquidityRowsToXlsxBuffer } from './esiLiquidityExport'
import { parseMarketWorkbook } from '../parseExcel'

describe('liquidityRowsToXlsxBuffer', () => {
  it('produces a workbook that parseExcel can read with expected columns', () => {
    const buf = liquidityRowsToXlsxBuffer([
      {
        name: 'Test Item',
        type: 'Ship',
        type_id: 34,
        day_volume: 10,
        day_turnover: 1.5,
        price: 100,
        price_sell: 102,
        price_bay: 99,
      },
    ])
    const ab = buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength
    ) as ArrayBuffer
    const { rows } = parseMarketWorkbook(ab)
    expect(rows.length).toBe(1)
    const r = rows[0] as Record<string, unknown>
    expect(String(r['name'] ?? r['Name'])).toBe('Test Item')
  })
})
