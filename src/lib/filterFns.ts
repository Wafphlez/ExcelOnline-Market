import type { FilterFn } from '@tanstack/react-table'
import type { MarketRow } from '../types/market'

export type NumberRange = { min: number | null; max: number | null }

export const textFilter: FilterFn<MarketRow> = (row, columnId, filterValue) => {
  if (filterValue === undefined || filterValue === null) return true
  const q = String(filterValue).trim()
  if (q === '') return true
  const cell = String(row.getValue(columnId) ?? '').toLowerCase()
  return cell.includes(q.toLowerCase())
}

export const numberRangeFilter: FilterFn<MarketRow> = (
  row,
  columnId,
  filterValue
) => {
  if (!filterValue || typeof filterValue !== 'object') return true
  const { min, max } = filterValue as NumberRange
  if (min === null && max === null) return true
  const raw = row.getValue(columnId)
  if (raw === null || raw === undefined) return false
  const v = Number(raw)
  if (Number.isNaN(v) || !Number.isFinite(v)) return false
  if (min !== null && v < min) return false
  if (max !== null && v > max) return false
  return true
}

/**
 * min/max в фильтре заданы в **процентах** (0 = 0 %, 5 = 5 %), в строке — **доля** (0…1).
 */
export const ratioValueAsPercentRangeFilter: FilterFn<MarketRow> = (
  row,
  columnId,
  filterValue
) => {
  if (!filterValue || typeof filterValue !== 'object') return true
  const { min, max } = filterValue as NumberRange
  if (min === null && max === null) return true
  const raw = row.getValue(columnId)
  if (raw === null || raw === undefined) return false
  const v = Number(raw)
  if (Number.isNaN(v) || !Number.isFinite(v)) return false
  const p = v * 100
  if (min !== null && p < min) return false
  if (max !== null && p > max) return false
  return true
}
