export type ExportRegion = {
  id: string
  label: string
  /** GET к liquidity Excel (только известные регионы) */
  downloadUrl: string
  /** Имя в `exports/`, перезапись при повторном скачивании */
  fileName: string
  /** EVE `region_id` для выгрузки через ESI (dev) */
  esiRegionId: number
}

/**
 * Крупные торговые хабы (по умолчанию): The Forge, Domain, Heimatar, Sinq Laison, Metropolis.
 */
export const EXPORT_REGIONS: ExportRegion[] = [
  {
    id: 'the-forge',
    label: 'The Forge',
    fileName: 'liquidity-the-forge.xlsx',
    esiRegionId: 10000002,
    downloadUrl:
      'https://eve.atpstealer.com/logistics/liquidity/exel?region=The%20Forge',
  },
  {
    id: 'domain',
    label: 'Domain',
    fileName: 'liquidity-domain.xlsx',
    esiRegionId: 10000043,
    downloadUrl:
      'https://eve.atpstealer.com/logistics/liquidity/exel?region=Domain',
  },
  {
    id: 'heimatar',
    label: 'Heimatar',
    fileName: 'liquidity-heimatar.xlsx',
    esiRegionId: 10000030,
    downloadUrl:
      'https://eve.atpstealer.com/logistics/liquidity/exel?region=Heimatar',
  },
  {
    id: 'sinq-laison',
    label: 'Sinq Laison',
    fileName: 'liquidity-sinq-laison.xlsx',
    esiRegionId: 10000032,
    downloadUrl:
      'https://eve.atpstealer.com/logistics/liquidity/exel?region=Sinq%20Laison',
  },
  {
    id: 'metropolis',
    label: 'Metropolis',
    fileName: 'liquidity-metropolis.xlsx',
    esiRegionId: 10000042,
    downloadUrl:
      'https://eve.atpstealer.com/logistics/liquidity/exel?region=Metropolis',
  },
]

export const EXPORT_BY_ID = Object.fromEntries(
  EXPORT_REGIONS.map((r) => [r.id, r])
) as Record<string, ExportRegion>
