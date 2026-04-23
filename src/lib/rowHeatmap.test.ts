import { describe, expect, it } from 'vitest'
import { marginPercentCellStyle, profitabilityRowBackground } from './rowHeatmap'

describe('profitabilityRowBackground', () => {
  it('is greener when margin and turnover are high', () => {
    const low = profitabilityRowBackground(
      0.05,
      1_000_000,
      10_000_000,
      1_000_000,
      500_000_000
    )
    const high = profitabilityRowBackground(
      0.5,
      10_000_000,
      10_000_000,
      1_000_000,
      500_000_000
    )
    expect(low).toMatch(/^rgba\(/)
    expect(high).toMatch(/^rgba\(/)
    expect(low).not.toBe(high)
  })
})

describe('marginPercentCellStyle', () => {
  it('goes from red to cyan by bands 0, 5, 10, 20 %', () => {
    const a = marginPercentCellStyle(0)
    const b = marginPercentCellStyle(0.05)
    const c = marginPercentCellStyle(0.1)
    const d = marginPercentCellStyle(0.2)
    const e = marginPercentCellStyle(0.35)
    expect(a.background).toMatch(/^rgba\(/)
    expect(a).not.toEqual(b)
    expect(b).not.toEqual(c)
    expect(c).not.toEqual(d)
    expect(d.background).toBe(e.background)
  })
  it('is transparent for null', () => {
    expect(marginPercentCellStyle(null).background).toBe('transparent')
  })
})
