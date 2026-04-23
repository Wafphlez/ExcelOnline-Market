import { EXPORT_BY_ID, EXPORT_REGIONS } from './exportRegions'

/** Совпадает с историческим ключом в ExportBar. */
export const LS_LAST_EXPORT_REGION_ID = 'excelMarket_lastExportRegionId'

export const LAST_EXPORT_REGION_EVENT = 'excelmarket:last-export-region' as const

export type LastExportRegionDetail = { id: string }

export function readLastExportRegionId(): string {
  try {
    const v = localStorage.getItem(LS_LAST_EXPORT_REGION_ID)
    if (v && EXPORT_BY_ID[v]) return v
  } catch {
    /* ignore */
  }
  return EXPORT_REGIONS[0]?.id ?? ''
}

export function getExportRegionLabel(id: string): string {
  return EXPORT_BY_ID[id]?.label ?? id
}
