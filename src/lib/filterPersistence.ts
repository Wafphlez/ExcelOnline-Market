import type { ColumnFiltersState } from '@tanstack/react-table'
import { migrateColumnFiltersRatioToPercent } from './filterPercentMigration'
import { defaultBaseFilters, PRESETS } from './presets'

const LS_FILTERS = 'excelMarket_columnFilters_v2'
const LS_FILTERS_LEGACY = 'excelMarket_columnFilters'
const LS_PRESET = 'excelMarket_activePreset'

const API_BASE = '/__dev/filters'

export type PersistedTableUi = {
  /** 1 = доли 0..1 в margin/buyToSell; 2 = проценты */
  version: 1 | 2
  columnFilters: ColumnFiltersState
  activePreset: string | null
}

export const isDevFiltersFileApi = (): boolean => import.meta.env.DEV

function sanitizePresetId(id: string | null | undefined): string | null {
  if (id == null || id === '') return null
  return PRESETS.some((p) => p.id === id) ? id : null
}

function parseFiltersJson(raw: string): ColumnFiltersState | null {
  try {
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return null
    return v as ColumnFiltersState
  } catch {
    return null
  }
}

export function readFiltersFromLocalStorage(): ColumnFiltersState | null {
  try {
    const v2 = localStorage.getItem(LS_FILTERS)
    if (v2 != null) return parseFiltersJson(v2)
    const leg = localStorage.getItem(LS_FILTERS_LEGACY)
    if (leg == null) return null
    const parsed = parseFiltersJson(leg)
    if (!parsed) return null
    return migrateColumnFiltersRatioToPercent(parsed)
  } catch {
    return null
  }
}

export function readActivePresetFromLocalStorage(): string | null {
  try {
    const v = localStorage.getItem(LS_PRESET)
    return sanitizePresetId(v)
  } catch {
    return null
  }
}

export function writeFiltersToLocalStorage(
  columnFilters: ColumnFiltersState,
  activePreset: string | null
): void {
  try {
    localStorage.setItem(LS_FILTERS, JSON.stringify(columnFilters))
    if (activePreset) localStorage.setItem(LS_PRESET, activePreset)
    else localStorage.removeItem(LS_PRESET)
  } catch {
    /* ignore */
  }
}

export function readInitialStateFromLocalStorage(): {
  columnFilters: ColumnFiltersState
  activePreset: string | null
} {
  const cf = readFiltersFromLocalStorage()
  const ap = readActivePresetFromLocalStorage()
  if (cf) return { columnFilters: cf, activePreset: ap }
  return { columnFilters: defaultBaseFilters(), activePreset: null }
}

export async function loadFiltersFromDevFile(): Promise<PersistedTableUi | null> {
  if (!isDevFiltersFileApi()) return null
  try {
    const r = await fetch(`${API_BASE}/load`, { method: 'GET' })
    if (r.status === 404) return null
    if (!r.ok) return null
    const j = (await r.json()) as Partial<PersistedTableUi>
    if (j?.version !== 1 && j?.version !== 2) return null
    if (!Array.isArray(j.columnFilters)) return null
    const cf =
      j.version === 1
        ? migrateColumnFiltersRatioToPercent(
            j.columnFilters as ColumnFiltersState
          )
        : (j.columnFilters as ColumnFiltersState)
    return {
      version: 2,
      columnFilters: cf,
      activePreset: sanitizePresetId(j.activePreset),
    }
  } catch {
    return null
  }
}

export async function saveFiltersToDevFile(payload: PersistedTableUi): Promise<void> {
  if (!isDevFiltersFileApi()) return
  try {
    await fetch(`${API_BASE}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    /* ignore */
  }
}
