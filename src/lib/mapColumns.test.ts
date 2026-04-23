import { describe, expect, it } from 'vitest'
import { mapRawRow } from './mapColumns'

describe('mapRawRow', () => {
  it('maps bame and price_bay', () => {
    const m = mapRawRow({
      bame: 'Item A',
      day_volume: 5,
      day_turnover: 1,
      price: 100,
      price_sell: 120,
      price_bay: 100,
    })
    expect(m.ok).toBe(true)
    if (m.ok) {
      expect(m.value.typeId).toBeNull()
      expect(m.value.name).toBe('Item A')
      expect(m.value.priceBuy).toBe(100)
      expect(m.value.priceSell).toBe(120)
      expect(m.value.dayTurnover).toBe(1_000_000)
    }
  })
  it('accepts name instead of bame', () => {
    const m = mapRawRow({
      name: 'B',
      day_volume: 1,
      day_turnover: 1,
      price: 1,
      price_sell: 2,
      price_buy: 1,
    })
    expect(m.ok).toBe(true)
    if (m.ok) expect(m.value.dayTurnover).toBe(1_000_000)
  })
  it('fails on missing column', () => {
    const m = mapRawRow({ bame: 'X' } as Record<string, unknown>)
    expect(m.ok).toBe(false)
  })
  it('maps type_id to typeId', () => {
    const m = mapRawRow({
      bame: 'X',
      type_id: 34_567,
      day_volume: 1,
      day_turnover: 1,
      price: 1,
      price_sell: 2,
      price_bay: 1,
    })
    expect(m.ok).toBe(true)
    if (m.ok) expect(m.value.typeId).toBe(34_567)
  })
})
