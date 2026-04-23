export type ExportRegion = {
  id: string
  label: string
  /** GET к liquidity Excel (только известные регионы) */
  downloadUrl: string
  /** Имя в `exports/`, перезапись при повторном скачивании */
  fileName: string
}

export const EXPORT_REGIONS: ExportRegion[] = [
  {
    id: 'the-forge',
    label: 'The Forge',
    fileName: 'liquidity-the-forge.xlsx',
    downloadUrl:
      'https://eve.atpstealer.com/logistics/liquidity/exel?region=The%20Forge',
  },
  {
    id: 'domain',
    label: 'Domain',
    fileName: 'liquidity-domain.xlsx',
    downloadUrl:
      'https://eve.atpstealer.com/logistics/liquidity/exel?region=Domain',
  },
]

export const EXPORT_BY_ID = Object.fromEntries(
  EXPORT_REGIONS.map((r) => [r.id, r])
) as Record<string, ExportRegion>
