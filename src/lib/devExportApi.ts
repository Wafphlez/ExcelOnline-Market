import {
  buildEsiLiquidityXlsx,
  clearEsiDevLogs,
  getEsiDevLogLines,
  getEsiExportProgressState,
  requestEsiExportForceStop,
  requestEsiExportStop,
} from './dev/esiLiquidityExport'
import { defaultEsiLiquidityFileName } from './esiExportFileName'
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
  /** Готовый файл для скачивания и открытия в таблице */
  buffer: Uint8Array
}

/**
 * Запросить прерывание длинного ESI-экспорта: после текущего HTTP к ESI сервер
 * дособерёт xlsx по уже накопленным строкам.
 */
export async function postEsiExportStop(): Promise<void> {
  requestEsiExportStop()
}

/** Принудительно остановить ESI-экспорт без сборки xlsx. */
export async function postEsiExportForceStop(): Promise<void> {
  requestEsiExportForceStop()
}

/** Логи и прогресс ESI-экспорта (в памяти процесса клиента). */
export async function fetchEsiDevLogs(): Promise<{
  lines: string[]
  progress: EsiExportProgressState
}> {
  const { lines } = getEsiDevLogLines()
  const progress = {
    ...ESI_EXPORT_PROGRESS_IDLE,
    ...getEsiExportProgressState(),
  }
  return { lines, progress }
}

/**
 * Собрать ликвидность с официального ESI в браузере (GitHub Pages и dev).
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
  clearEsiDevLogs()
  const historyDays =
    opts.historyDays === 2 || opts.historyDays === 7 || opts.historyDays === 30
      ? opts.historyDays
      : 30
  const { buffer, rowCount, partial } = await buildEsiLiquidityXlsx(opts.regionId, {
    historyDays,
    includeOrderSnapshot: opts.includeOrderSnapshot === true,
    tradeHubOnly: opts.tradeHubOnly === true,
    tradeHubLocationId:
      typeof opts.tradeHubLocationId === 'number' && Number.isFinite(opts.tradeHubLocationId)
        ? Math.floor(opts.tradeHubLocationId)
        : undefined,
  })
  const fileName = defaultEsiLiquidityFileName(opts.regionId, {
    tradeHubOnly: opts.tradeHubOnly,
    fileName: opts.fileName,
  })
  return {
    ok: true,
    fileName,
    bytes: buffer.byteLength,
    rowCount,
    partial,
    buffer,
  }
}

/** Селектор: все известные регионы + (опц.) кастом в будущем */
export { EXPORT_REGIONS, type ExportRegion } from './exportRegions'
