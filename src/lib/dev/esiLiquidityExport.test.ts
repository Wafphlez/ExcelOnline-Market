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
        packaged_volume: 2500,
        price: 100,
        price_sell: 102,
        price_bay: 99,
        top_sell_now: 102,
        top_buy_now: 99,
        top_sell_volume_now: 500,
        top_buy_volume_now: 300,
        orders_snapshot_at: '2026-01-01T00:00:00.000Z',
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
