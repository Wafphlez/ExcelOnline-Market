import { ESI_EXPORT_PROGRESS_IDLE } from './esiExportProgressTypes'
import type { EsiExportProgressState } from './esiExportProgressTypes'

export type { EsiExportProgressState } from './esiExportProgressTypes'

const BASE = '/__dev/export'

export const isDevExportServer = import.meta.env.DEV

export type ExportListItem = { name: string; size: number; mtime: string }
export type MarketLogLatestFile = {
  name: string
  size: number
  mtime: string
  birthtime?: string
}

export async function listExportFiles(): Promise<ExportListItem[]> {
  if (!isDevExportServer) return []
  const r = await fetch(`${BASE}/list`)
  if (!r.ok) return []
  const j = (await r.json()) as { files?: ExportListItem[] }
  return j.files ?? []
}

export function devExportFileUrl(fileName: string): string {
  return `${BASE}/file/${encodeURIComponent(fileName)}?v=${Date.now()}`
}

export function marketLogsStreamUrl(dirPath: string): string {
  const q = encodeURIComponent(dirPath)
  return `${BASE}/marketlogs/stream?dirPath=${q}`
}

export async function fetchLatestMarketLogFile(
  dirPath: string
): Promise<MarketLogLatestFile | null> {
  if (!isDevExportServer) return null
  const r = await fetch(`${BASE}/marketlogs/latest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dirPath }),
  })
  if (!r.ok) {
    const t = await r.text()
    let err = t
    try {
      const j = JSON.parse(t) as { error?: string }
      if (j.error) err = j.error
    } catch {
      /* ignore */
    }
    throw new Error(err || 'Не удалось прочитать market logs')
  }
  const j = (await r.json()) as { file?: MarketLogLatestFile | null }
  return j.file ?? null
}

export async function fetchMarketLogFileBuffer(
  dirPath: string,
  fileName: string
): Promise<ArrayBuffer> {
  if (!isDevExportServer) {
    throw new Error('Чтение market logs доступно только в режиме разработки (npm run dev).')
  }
  const r = await fetch(`${BASE}/marketlogs/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dirPath, fileName }),
  })
  if (!r.ok) {
    const t = await r.text()
    let err = t
    try {
      const j = JSON.parse(t) as { error?: string }
      if (j.error) err = j.error
    } catch {
      /* ignore */
    }
    throw new Error(err || 'Не удалось прочитать файл market logs')
  }
  return await r.arrayBuffer()
}

export type EsiLiquidityResult = {
  ok: true
  fileName: string
  bytes: number
  rowCount: number
  /** xlsx обрезан по кнопке «Принудительный стоп» */
  partial: boolean
}

/**
 * Запросить прерывание длинного ESI-экспорта: после текущего HTTP к ESI сервер
 * дособерёт xlsx по уже накопленным строкам.
 */
export async function postEsiExportStop(): Promise<void> {
  if (!isDevExportServer) {
    return
  }
  const r = await fetch(`${BASE}/esi-stop`, { method: 'POST' })
  if (!r.ok) {
    const t = await r.text()
    let err = t
    try {
      const j = JSON.parse(t) as { error?: string }
      if (j.error) err = j.error
    } catch {
      /* ignore */
    }
    throw new Error(err)
  }
}

/** Принудительно остановить ESI-экспорт без сборки xlsx. */
export async function postEsiExportForceStop(): Promise<void> {
  if (!isDevExportServer) {
    return
  }
  const r = await fetch(`${BASE}/esi-stop-force`, { method: 'POST' })
  if (!r.ok) {
    const t = await r.text()
    let err = t
    try {
      const j = JSON.parse(t) as { error?: string }
      if (j.error) err = j.error
    } catch {
      /* ignore */
    }
    throw new Error(err)
  }
}

/** Буфер серверных логов ESI-экспорта + прогресс (страницы ордеров / типы). */
export async function fetchEsiDevLogs(): Promise<{
  lines: string[]
  progress: EsiExportProgressState
}> {
  if (!isDevExportServer) {
    return { lines: [], progress: { ...ESI_EXPORT_PROGRESS_IDLE } }
  }
  const r = await fetch(`${BASE}/esi-logs`)
  if (!r.ok) {
    return { lines: [], progress: { ...ESI_EXPORT_PROGRESS_IDLE } }
  }
  const j = (await r.json()) as {
    lines?: string[]
    progress?: EsiExportProgressState
  }
  const progress = j.progress != null
    ? { ...ESI_EXPORT_PROGRESS_IDLE, ...j.progress }
    : { ...ESI_EXPORT_PROGRESS_IDLE }
  return {
    lines: j.lines ?? [],
    progress,
  }
}

/**
 * Собрать ликвидность с официального ESI (только `npm run dev`).
 * Пишет файл в `exports/` и возвращает метаданные.
 */
export async function buildEsiLiquidityToExports(opts: {
  regionId: number
  fileName?: string
  /** Окно истории рынка в днях (допустимо: 2, 7, 30). */
  historyDays?: 2 | 7 | 30
  /** true — добавить top-of-book snapshot колонки + orders_snapshot лист */
  includeOrderSnapshot?: boolean
  /** true — оставить только ордера торгового хаба (по location_id). */
  tradeHubOnly?: boolean
  /** location_id торгового хаба для фильтрации ордеров. */
  tradeHubLocationId?: number
}): Promise<EsiLiquidityResult> {
  if (!isDevExportServer) {
    throw new Error(
      'Выгрузка ESI доступна только в режиме разработки (npm run dev).'
    )
  }
  const r = await fetch(`${BASE}/esi-liquidity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      regionId: opts.regionId,
      fileName: opts.fileName,
      historyDays: opts.historyDays,
      includeOrderSnapshot: opts.includeOrderSnapshot === true,
      tradeHubOnly: opts.tradeHubOnly === true,
      tradeHubLocationId:
        typeof opts.tradeHubLocationId === 'number' && Number.isFinite(opts.tradeHubLocationId)
          ? Math.floor(opts.tradeHubLocationId)
          : undefined,
    }),
  })
  const t = await r.text()
  if (!r.ok) {
    let err = t
    try {
      const j = JSON.parse(t) as { error?: string }
      if (j.error) err = j.error
    } catch {
      /* ignore */
    }
    throw new Error(err)
  }
  const j = JSON.parse(t) as EsiLiquidityResult
  j.partial ??= false
  return j
}

/** Селектор: все известные регионы + (опц.) кастом в будущем */
export { EXPORT_REGIONS, type ExportRegion } from './exportRegions'
