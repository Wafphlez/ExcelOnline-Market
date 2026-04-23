import { describe, expect, it } from 'vitest'
import { computeAllMetrics, computeRowMetrics } from './computeMetrics'
import type { MarketRow } from '../types/market'

const noFees = { brokerFee: 0, salesTax: 0 }

const base: MarketRow = {
  typeId: null,
  name: 'x',
  dayVolume: 10,
  dayTurnover: 1_000_000,
  price: 100,
  priceSell: 110,
  priceBuy: 90,
  margin: null,
  buyToSellRatio: null,
  spreadIsk: null,
  entryScore: null,
}

describe('computeRowMetrics', () => {
  it('computes margin and spread', () => {
    const r = computeRowMetrics({ ...base }, noFees)
    expect(r.margin).toBeCloseTo((110 - 90) / 110)
    expect(r.spreadIsk).toBe(20)
  })
  it('computes buyToSell ratio mid', () => {
    const r = computeRowMetrics(
      {
        ...base,
        price: 100,
        priceSell: 110,
        priceBuy: 90,
      },
      noFees
    )
    expect(r.buyToSellRatio).toBeCloseTo(0.5)
  })
  it('yields null ratio when no spread', () => {
    const r = computeRowMetrics(
      { ...base, priceSell: 100, priceBuy: 100 },
      noFees
    )
    expect(r.buyToSellRatio).toBeNull()
  })
  it('applies broker on buy and broker+tax on sell to margin', () => {
    const fees = { brokerFee: 0.014, salesTax: 0.042 }
    const r = computeRowMetrics(
      {
        ...base,
        priceBuy: 100,
        priceSell: 120,
      },
      fees
    )
    const cost = 100 * 1.014
    const revenue = 120 * (1 - 0.042 - 0.014)
    expect(r.margin).toBeCloseTo((revenue - cost) / 120)
  })
})

describe('computeAllMetrics', () => {
  it('adds entryScore 0–100 for each row', () => {
    const r: MarketRow = {
      typeId: null,
      name: 'a',
      dayVolume: 1,
      dayTurnover: 2_000_000,
      price: 100,
      priceSell: 200,
      priceBuy: 100,
      margin: null,
      buyToSellRatio: null,
      spreadIsk: null,
      entryScore: null,
    }
    const out = computeAllMetrics(
      [r, { ...r, name: 'b', dayTurnover: 4_000_000 }],
      { brokerFee: 0, salesTax: 0, highPriceThresholdIsk: 500_000_000 }
    )
    expect(out[0].entryScore).toBeTypeOf('number')
    expect(out[0].entryScore).toBeGreaterThanOrEqual(0)
    expect(out[0].entryScore).toBeLessThanOrEqual(100)
  })
})
