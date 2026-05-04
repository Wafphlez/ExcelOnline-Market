import { EXPORT_REGIONS } from './exportRegions'

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

/**
 * Имя файла для ESI-выгрузки (как раньше на dev-сервере).
 */
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
  const fileRegionToken =
    opts.tradeHubOnly === true && regionMeta?.tradeHubName
      ? toSafeFileToken(regionMeta.tradeHubName)
      : toSafeFileToken(regionMeta?.label ?? String(regionId))
  return `liquidity-esi-${fileRegionToken}-${formatFileDateRu(new Date())}.xlsx`
}
