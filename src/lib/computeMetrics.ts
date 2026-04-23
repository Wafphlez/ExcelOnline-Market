import type { MarketRow } from '../types/market'
import { computeEntryScore, type EntryScoreOptions } from './entryScore'

const EPS = 1e-9

/** Доли (0.014 = 1,4 %): buy — +broker; sell − (sales tax + broker). */
export type FeeRatios = {
  brokerFee: number
  salesTax: number
}

/**
 * Себестоимость buy: bid × (1 + broker). Выручка sell: ask × (1 − sales tax − broker).
 * Маржа (доля) относительно list ask: (выручка − себестоимость) / ask.
 */
export function computeRowMetrics(r: MarketRow, fees: FeeRatios): MarketRow {
  const { price, priceBuy, priceSell } = r
  const { brokerFee: bf, salesTax: st } = fees

  let margin: number | null = null
  if (priceSell !== 0 && Number.isFinite(priceSell)) {
    const cost = priceBuy * (1 + bf)
    const revenue = priceSell * (1 - st - bf)
    const m = (revenue - cost) / priceSell
    margin = Number.isFinite(m) ? m : null
  }

  let buyToSellRatio: number | null = null
  const denom = priceSell - priceBuy
  if (Math.abs(denom) > EPS) {
    const t = (price - priceBuy) / denom
    buyToSellRatio = Number.isFinite(t) ? t : null
  }

  const spreadIsk =
    Number.isFinite(priceSell) && Number.isFinite(priceBuy)
      ? priceSell - priceBuy
      : null

  return {
    ...r,
    margin,
    buyToSellRatio,
    spreadIsk,
  }
}

export type ComputeMetricsOptions = Partial<EntryScoreOptions> & FeeRatios

export function computeAllMetrics(
  rows: MarketRow[],
  options: ComputeMetricsOptions
): MarketRow[] {
  const { brokerFee, salesTax, ...entryRest } = options
  const fees: FeeRatios = { brokerFee, salesTax }
  const withCore = rows.map((r) => computeRowMetrics(r, fees))
  if (withCore.length === 0) {
    return []
  }

  return withCore.map((r) => ({
    ...r,
    entryScore: computeEntryScore(r, entryRest),
  }))
}
