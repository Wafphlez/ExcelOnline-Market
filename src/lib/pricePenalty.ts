/**
 * Порог по умолчанию: при цене **за единицу** выше — «выгодность» (маржинальный вклад) снижается.
 * Имеет смысл для дорогих предметов, где тот же % даёт крупный капитал в сделке.
 */
export const DEFAULT_HIGH_PRICE_THRESHOLD_ISK = 500_000_000

/**
 * Множитель 0..1: 1 — цена не выше порога; &lt;1 — снижение, сильнее при очень большой цене.
 * Формула: при price &gt; threshold → threshold / price (например 500M/1B = 0,5)
 */
export function pricePenaltyFactor(
  unitPriceIsk: number,
  highPriceThresholdIsk: number
): number {
  if (!Number.isFinite(unitPriceIsk) || unitPriceIsk <= 0) return 1
  if (!Number.isFinite(highPriceThresholdIsk) || highPriceThresholdIsk <= 0) {
    return 1
  }
  if (unitPriceIsk <= highPriceThresholdIsk) return 1
  return Math.min(1, highPriceThresholdIsk / unitPriceIsk)
}

/**
 * Визуализация/оценка: «эквивалентная» маржа после штрафа за дорогую позицию.
 */
export function effectiveMarginForDisplay(
  margin: number | null,
  price: number,
  highPriceThresholdIsk: number
): number | null {
  if (margin === null || !Number.isFinite(margin)) return null
  if (!Number.isFinite(price) || price <= 0) return margin
  const f = pricePenaltyFactor(price, highPriceThresholdIsk)
  return margin * f
}
