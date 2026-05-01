import type { ColumnFiltersState } from '@tanstack/react-table'
import type { NumberRange } from './filterFns'
import type { MarketRow } from '../types/market'

type FilterValue = string | NumberRange

export type FilterPreset = {
  id: string
  label: string
  /** Replaces or sets these column filters; omits unmentioned columns (caller merges or replaces) */
  buildFilters: () => { id: keyof MarketRow; value: FilterValue }[]
}

/** Базовый набор фильтров: все условия сразу (по умолчанию). */
export function defaultBaseFilters(): ColumnFiltersState {
  return [
    { id: 'dayVolume', value: { min: 20, max: null } },
    { id: 'margin', value: { min: 5, max: null } }, // % 
    { id: 'dayTurnover', value: { min: 1_000_000_000, max: null } },
    { id: 'buyToSellRatio', value: { min: 5, max: 95 } }, // % 0 = buy … 100 = sell
  ]
}

function mergeNumberRange(
  prev: NumberRange | undefined,
  next: NumberRange
): NumberRange {
  return {
    min: next.min ?? prev?.min ?? null,
    max: next.max ?? prev?.max ?? null,
  }
}

/**
 * «Средняя в спреде» — два пресета (мин/макс) сливаются в один диапазон.
 * Остальные колонки: последнее значение пресета заменяет фильтр по колонке.
 */
export function applyPreset(
  current: ColumnFiltersState,
  preset: FilterPreset
): ColumnFiltersState {
  const byId = new Map(current.map((c) => [c.id, c] as const))
  for (const f of preset.buildFilters()) {
    if (f.id === 'buyToSellRatio' && f.value && typeof f.value === 'object') {
      const prev = byId.get('buyToSellRatio')?.value as NumberRange | undefined
      byId.set('buyToSellRatio', {
        id: 'buyToSellRatio',
        value: mergeNumberRange(prev, f.value as NumberRange),
      })
    } else {
      byId.set(f.id, { id: String(f.id), value: f.value })
    }
  }
  return Array.from(byId.values())
}

/** Все отдельные пресеты подряд = совокупные условия (как `defaultBaseFilters`). */
export const PRESET_ALL_ID = 'all' as const

/**
 * Применить все PRESETS к пустой таблице фильтров (итог совпадает с `defaultBaseFilters()`).
 */
export function applyAllPresets(): ColumnFiltersState {
  let next: ColumnFiltersState = []
  for (const p of PRESETS) {
    next = applyPreset(next, p)
  }
  return next
}

export const PRESETS: FilterPreset[] = [
  {
    id: 'trades20',
    label: 'Сделок за сутки ≥ 20',
    buildFilters: () => [
      { id: 'dayVolume', value: { min: 20, max: null } },
    ],
  },
  {
    id: 'margin5',
    label: 'Маржа ≥ 5 %',
    buildFilters: () => [
      { id: 'margin', value: { min: 5, max: null } },
    ],
  },
  {
    id: 'turn1b',
    label: 'Оборот ≥ 1B',
    buildFilters: () => [
      { id: 'dayTurnover', value: { min: 1_000_000_000, max: null } },
    ],
  },
  {
    id: 'spreadPosMin',
    label: 'Мин. средняя в спреде ≥ 5 %',
    buildFilters: () => [
      { id: 'buyToSellRatio', value: { min: 5, max: null } },
    ],
  },
  {
    id: 'spreadPosMax',
    label: 'Макс. средняя в спреде ≤ 95 %',
    buildFilters: () => [
      { id: 'buyToSellRatio', value: { min: null, max: 95 } },
    ],
  },
]

export function clearFilters(): ColumnFiltersState {
  return []
}
