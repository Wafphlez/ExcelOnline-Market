import { effectiveMarginForDisplay } from './pricePenalty'

/** Нормировка маржи для цвета строки: 20 %+ даёт полный вклад по марже */
const MARGIN_TOP = 0.2

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t)
}

function lerpRgb(
  t: number,
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

/** Края в процентах: 0 % → красный, 5 % → оранжевый, 10 % → зелёный, 20 %+ → голубой (margin — доля 0…1) */
const M_RED: [number, number, number] = [239, 68, 68]
const M_ORANGE: [number, number, number] = [249, 115, 22]
const M_GREEN: [number, number, number] = [34, 197, 94]
const M_CYAN: [number, number, number] = [34, 211, 238]

/**
 * Заливка по «эквивалентной» марже: при дорогой единице (см. порог) — бледнее, как в оценке входа.
 * Число в ячейке — по-прежнему фактическая маржа (передаётся отдельно).
 */
export function marginPercentCellStyle(
  margin: number | null,
  unitPriceIsk?: number,
  highPriceThresholdIsk?: number
): {
  background: string
  color: string
} {
  if (margin === null || !Number.isFinite(margin)) {
    return { background: 'transparent', color: 'inherit' }
  }
  const m =
    unitPriceIsk !== undefined && highPriceThresholdIsk !== undefined
      ? Math.max(
          0,
          effectiveMarginForDisplay(margin, unitPriceIsk, highPriceThresholdIsk) ??
            margin
        )
      : Math.max(0, margin)
  let rgb: [number, number, number]
  if (m <= 0.05) {
    const t = m / 0.05
    rgb = lerpRgb(t, M_RED, M_ORANGE)
  } else if (m <= 0.1) {
    const t = (m - 0.05) / 0.05
    rgb = lerpRgb(t, M_ORANGE, M_GREEN)
  } else if (m <= 0.2) {
    const t = (m - 0.1) / 0.1
    rgb = lerpRgb(t, M_GREEN, M_CYAN)
  } else {
    rgb = [...M_CYAN] as [number, number, number]
  }
  return {
    background: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.48)`,
    color: 'rgb(8, 9, 11)',
  }
}

/**
 * Красный → зелёный: половина веса от «эквивалентной» маржи (с учётом дорогой цены ед.),
 * половина — от оборота относительно максимума в текущем наборе.
 */
export function profitabilityRowBackground(
  margin: number | null,
  dayTurnoverIsk: number,
  maxDayTurnoverIsk: number,
  unitPriceIsk: number,
  highPriceThresholdIsk: number
): string {
  const em =
    margin === null || !Number.isFinite(margin)
      ? 0
      : Math.max(
          0,
          effectiveMarginForDisplay(
            margin,
            unitPriceIsk,
            highPriceThresholdIsk
          ) ?? 0
        )
  const marginPart = Math.max(0, Math.min(1, em / MARGIN_TOP))

  const tMax = Math.max(maxDayTurnoverIsk, 1)
  const turnPart = Math.max(0, Math.min(1, dayTurnoverIsk / tMax))

  const score = 0.5 * marginPart + 0.5 * turnPart

  const r0 = 112
  const g0 = 36
  const b0 = 32
  const r1 = 28
  const g1 = 88
  const b1 = 52
  const r = lerp(r0, r1, score)
  const g = lerp(g0, g1, score)
  const b = lerp(b0, b1, score)
  return `rgba(${r}, ${g}, ${b}, 0.55)`
}
