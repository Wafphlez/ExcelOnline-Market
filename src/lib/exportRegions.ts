export type ExportRegion = {
  id: string
  label: string
  /** GET к liquidity Excel (только известные регионы) */
  downloadUrl: string
  /** Имя в `exports/`, перезапись при повторном скачивании */
  fileName: string
  /** EVE `region_id` для выгрузки через ESI (dev) */
  esiRegionId: number
  /** Основная NPC-станция торгового хаба региона (location_id для фильтрации ордеров). */
  tradeHubLocationId: number
  /** Человекочитаемое имя торгового хаба (станции). */
  tradeHubName: string
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
    /** The Forge — 60003760 — Jita IV - Moon 4 - Caldari Navy Assembly Plant */
    tradeHubLocationId: 60003760,
    tradeHubName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
    downloadUrl:
      'https://eve.atpstealer.com/logistics/liquidity/exel?region=The%20Forge',
  },
  {
    id: 'domain',
    label: 'Domain',
    fileName: 'liquidity-domain.xlsx',
    esiRegionId: 10000043,
    /** Domain — 60008494 — Amarr VIII (Oris) - Emperor Family Academy */
    tradeHubLocationId: 60008494,
    tradeHubName: 'Amarr VIII (Oris) - Emperor Family Academy',
    downloadUrl:
      'https://eve.atpstealer.com/logistics/liquidity/exel?region=Domain',
  },
  {
    id: 'heimatar',
    label: 'Heimatar',
    fileName: 'liquidity-heimatar.xlsx',
    esiRegionId: 10000030,
    /** Heimatar — 60004588 — Rens VI - Moon 8 - Brutor Tribe Treasury */
    tradeHubLocationId: 60004588,
    tradeHubName: 'Rens VI - Moon 8 - Brutor Tribe Treasury',
    downloadUrl:
      'https://eve.atpstealer.com/logistics/liquidity/exel?region=Heimatar',
  },
  {
    id: 'sinq-laison',
    label: 'Sinq Laison',
    fileName: 'liquidity-sinq-laison.xlsx',
    esiRegionId: 10000032,
    /** Sinq Laison — 60011866 — Dodixie IX - Moon 20 - Federation Navy Assembly Plant */
    tradeHubLocationId: 60011866,
    tradeHubName: 'Dodixie IX - Moon 20 - Federation Navy Assembly Plant',
    downloadUrl:
      'https://eve.atpstealer.com/logistics/liquidity/exel?region=Sinq%20Laison',
  },
  {
    id: 'metropolis',
    label: 'Metropolis',
    fileName: 'liquidity-metropolis.xlsx',
    esiRegionId: 10000042,
    /** Metropolis — 60005686 — Hek VIII - Moon 12 - Boundless Creation Factory */
    tradeHubLocationId: 60005686,
    tradeHubName: 'Hek VIII - Moon 12 - Boundless Creation Factory',
    downloadUrl:
      'https://eve.atpstealer.com/logistics/liquidity/exel?region=Metropolis',
  },
]

export const EXPORT_BY_ID = Object.fromEntries(
  EXPORT_REGIONS.map((r) => [r.id, r])
) as Record<string, ExportRegion>
