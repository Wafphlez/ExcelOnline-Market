import type { ColumnId } from './columnLabels'

/**
 * Шаг колесика для фильтров min/max по колонке (доля, ISK, 0–1 и т.д.).
 */
export function getFilterColumnWheelStep(id: ColumnId): number {
  switch (id) {
    case 'margin':
      return 1 // целые проценты
    case 'buyToSellRatio':
      return 1 // процентов по оси 0…100
    case 'dayVolume':
    case 'typeId':
    case 'entryScore':
      return 1
    case 'packagedVolume':
      return 0.1
    case 'dayTurnover':
    case 'price':
    case 'priceBuy':
    case 'priceSell':
      return 1_000_000
    case 'spreadIsk':
      return 10_000
    default:
      return 1
  }
}

export function getFilterColumnWheelBounds(
  id: ColumnId
): { min?: number; max?: number } {
  switch (id) {
    case 'buyToSellRatio':
      return { min: 0, max: 100 } // % позиции в спреде
    case 'entryScore':
      return { min: 0, max: 100 }
    case 'typeId':
    case 'dayVolume':
    case 'packagedVolume':
    case 'dayTurnover':
    case 'price':
    case 'priceBuy':
    case 'priceSell':
    case 'spreadIsk':
      return { min: 0 }
    default:
      return {}
  }
}

function snapToStep(value: number, step: number): number {
  if (step <= 0 || !Number.isFinite(value)) return value
  const inv = 1 / step
  if (Number.isFinite(inv) && inv >= 1 && inv < 1e12) {
    const k = Math.round(inv)
    if (Math.abs(inv - k) < 1e-9 * Math.max(1, k)) {
      return Math.round(value * k) / k
    }
  }
  return Math.round(value / step) * step
}

/**
 * Сдвиг с привязкой к сетке step и (опц.) min/max.
 */
export function nudgeByWheel(
  current: number,
  direction: 1 | -1,
  step: number,
  bounds?: { min?: number; max?: number }
): number {
  let next = snapToStep(current + direction * step, step)
  if (bounds?.min !== undefined) next = Math.max(bounds.min, next)
  if (bounds?.max !== undefined) next = Math.min(bounds.max, next)
  return next
}
