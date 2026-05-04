import { describe, expect, it } from 'vitest'
import { computeEntryScore } from './entryScore'
import type { MarketRow } from '../types/market'

function row(partial: Partial<MarketRow>): MarketRow {
  return {
    typeId: null,
    type: '',
    name: 't',
    dayVolume: 1,
    dayTurnover: 1_000_000,
    packagedVolume: null,
    price: 100,
    priceSell: 100,
    priceBuy: 80,
    margin: 0.2,
    buyToSellRatio: 0.5,
    spreadIsk: 20,
    entryScore: null,
    ...partial,
  }
}

describe('computeEntryScore', () => {
  it('returns 0–100', () => {
    const s = computeEntryScore(
      row({ dayTurnover: 50_000_000, spreadIsk: 500_000 })
    )
    expect(s).toBeGreaterThanOrEqual(0)
    expect(s).toBeLessThanOrEqual(100)
  })
  it('is higher for better margin (absolute scale)', () => {
    const a = computeEntryScore(
      row({ margin: 0.05, dayTurnover: 100_000_000, spreadIsk: 1_000_000 })
    )
    const b = computeEntryScore(
      row({ margin: 0.25, dayTurnover: 100_000_000, spreadIsk: 1_000_000 })
    )
    expect(b).toBeGreaterThan(a)
  })
  it('caps when no activity (0 volume or 0 turnover)', () => {
    const active = computeEntryScore(
      row({
        dayVolume: 10,
        dayTurnover: 200_000_000,
        margin: 0.3,
        spreadIsk: 1_000_000,
      })
    )
    const noVol = computeEntryScore(
      row({
        dayVolume: 0,
        dayTurnover: 0,
        margin: 0.3,
        spreadIsk: 1_000_000,
      })
    )
    expect(noVol).toBeLessThan(active)
    expect(noVol).toBeLessThanOrEqual(48)
  })
  it('is low without real liquidity even if file had outliers', () => {
    const s = computeEntryScore(
      row({ dayVolume: 0, dayTurnover: 0, margin: 0.15, spreadIsk: 50_000 })
    )
    expect(s).toBeLessThan(50)
  })
})
