import type { ColumnFiltersState } from '@tanstack/react-table'
import type { NumberRange } from './filterFns'

/**
 * Старые сохранения хранили margin и buyToSellRatio как доли 0..1; новый формат — проценты (0..100).
 */
function migrateNumberRangeRationToPercent(
  r: NumberRange,
  _col: 'margin' | 'buyToSellRatio'
): NumberRange {
  const c = (x: number | null): number | null => {
    if (x === null) return null
    if (x > 0 && x < 1) return x * 100
    if (x === 1) return 100
    return x
  }
  return { min: c(r.min), max: c(r.max) }
}

export function migrateColumnFiltersRatioToPercent(
  cf: ColumnFiltersState
): ColumnFiltersState {
  return cf.map((f) => {
    if (f.id !== 'margin' && f.id !== 'buyToSellRatio') return f
    if (!f.value || typeof f.value !== 'object') return f
    const o = f.value as NumberRange
    return {
      ...f,
      value: migrateNumberRangeRationToPercent(
        o,
        f.id as 'margin' | 'buyToSellRatio'
      ),
    }
  })
}
