import { EXPORT_REGIONS } from './exportRegions'

/**
 * Короткий токен в имени файла для режима «только торговый хаб»
 * (`eon-market-{token}-{ДД.ММ.ГГГГ}.xlsx`).
 */
export const ESI_TRADE_HUB_SHORT_FILE_TOKEN: Record<number, string> = {
  10000002: 'Jita-IV-Moon-4',
  10000043: 'Amarr-VIII-Oris',
  10000030: 'Rens-VI-Moon-8',
  10000032: 'Dodixie-IX-Moon-20',
  10000042: 'Hek-VIII-Moon-12',
}

/** Дата для суффикса имени файла выгрузки (ДД.ММ.ГГГГ). */
export function formatFileDateRu(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = String(d.getFullYear())
  return `${dd}.${mm}.${yyyy}`
}

/** Только [a-zA-Z0-9._-] — совместимо с безопасным именем файла. */
export function toSafeFileToken(v: string): string {
  const cleaned = v
    .trim()
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'region'
}

export function isSafeEsiExportFileName(name: string): boolean {
  return /^[a-zA-Z0-9._-]+\.xlsx$/.test(name) && !name.includes('..')
}

/** Имя файла для ESI-выгрузки: `eon-market-{токен}-{ДД.ММ.ГГГГ}.xlsx`. */
export function defaultEsiLiquidityFileName(
  regionId: number,
  opts: {
    tradeHubOnly?: boolean
    /** Явное имя от пользователя (валидация снаружи). */
    fileName?: string
  }
): string {
  if (
    typeof opts.fileName === 'string' &&
    isSafeEsiExportFileName(opts.fileName)
  ) {
    return opts.fileName
  }
  const regionMeta = EXPORT_REGIONS.find((x) => x.esiRegionId === regionId)
  let fileRegionToken: string
  if (opts.tradeHubOnly === true && regionMeta?.tradeHubName) {
    fileRegionToken =
      ESI_TRADE_HUB_SHORT_FILE_TOKEN[regionId] ??
      toSafeFileToken(regionMeta.tradeHubName)
  } else {
    fileRegionToken = toSafeFileToken(regionMeta?.label ?? String(regionId))
  }
  return `eon-market-${fileRegionToken}-${formatFileDateRu(new Date())}.xlsx`
}
