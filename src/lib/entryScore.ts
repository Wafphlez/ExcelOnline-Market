import type { MarketRow } from '../types/market'
import { pricePenaltyFactor, DEFAULT_HIGH_PRICE_THRESHOLD_ISK } from './pricePenalty'

const MARGIN_PTS = 40
const LIQUIDITY_PTS = 30
const SPREAD_PTS = 30
/** «Топ» маржи: при доле 20 % и выше — полные баллы за маржу */
const MARGIN_CAP = 0.2

/**
 * «Референс» оборота в ISK: при таком суточном обороте ликвидность даёт almost LIQUIDITY_PTS.
 * (не из файла — абсолют)
 */
const TURNOVER_REF_ISK = 300_000_000

/**
 * «Референс» спреда в ISK на единицу: типично сильный абсолютный спред.
 */
const SPREAD_REF_ISK = 2_000_000

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

/**
 * 0..MARGIN_PTS по доле margin; null / ≤0 → 0
 */
function marginPoints(margin: number | null): number {
  if (margin === null || !Number.isFinite(margin) || margin <= 0) return 0
  return Math.min(
    MARGIN_PTS,
    (Math.min(margin, MARGIN_CAP) / MARGIN_CAP) * MARGIN_PTS
  )
}

/**
 * 0..LIQUIDITY_PTS: только при реальной активности (и объём, и деньги).
 * Без сделок или без оборота — 0, отдельно не нормируем к макс. файла.
 */
function liquidityPoints(dayVolume: number, dayTurnoverIsk: number): number {
  if (!Number.isFinite(dayVolume) || !Number.isFinite(dayTurnoverIsk)) return 0
  if (dayVolume <= 0 || dayTurnoverIsk <= 0) return 0
  // log10(1+T) / log10(1+T_ref) — плавно, реалистично для EVE-оборотов
  const num = Math.log10(1 + dayTurnoverIsk)
  const den = Math.log10(1 + TURNOVER_REF_ISK)
  return LIQUIDITY_PTS * clamp01(num / den)
}

/**
 * 0..SPREAD_PTS по абсолютному спреду; нет спреда / ≤0 — 0
 */
function spreadPoints(spreadIsk: number | null): number {
  if (spreadIsk === null || !Number.isFinite(spreadIsk) || spreadIsk <= 0) return 0
  const num = Math.log10(1 + spreadIsk)
  const den = Math.log10(1 + SPREAD_REF_ISK)
  return SPREAD_PTS * clamp01(num / den)
}

export type EntryScoreOptions = {
  /** Выше — коэф. threshold/price снижает именно **баллы за маржу** (для дорогих единиц) */
  highPriceThresholdIsk: number
}

/**
 * 0–100: маржа, ликвидность и спред по **абсолютным** шкалам.
 * Если за день 0 сделок или 0 оборота — ликвидность 0, итог снижается
 * (вход смотреть как спекулятивный/рискованный, не «топ сделка»).
 * Для `price` выше `highPriceThresholdIsk` вклад маржи умножается на `threshold/price`.
 */
export function computeEntryScore(
  r: MarketRow,
  options?: Partial<EntryScoreOptions>
): number {
  const th =
    options?.highPriceThresholdIsk ?? DEFAULT_HIGH_PRICE_THRESHOLD_ISK
  const f = pricePenaltyFactor(r.price, th)
  const m = marginPoints(r.margin) * f
  const l = liquidityPoints(r.dayVolume, r.dayTurnover)
  const s = spreadPoints(r.spreadIsk)

  let total = m + l + s

  const hasActivity = r.dayVolume > 0 && r.dayTurnover > 0
  if (!hasActivity) {
    // Нет смысла выдавать высокий балл «входа» при мёртвом рынке в строке
    total = m * 0.65 + s * 0.7
    total = Math.min(total, 48)
  }

  if (r.dayVolume > 0 && r.dayTurnover <= 0) {
    // Аномалия: есть объём, нет денег — гасим ликвидность
    total = Math.min(total, 35)
  }

  return Math.max(0, Math.min(100, Math.round(total)))
}
