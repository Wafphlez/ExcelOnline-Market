import { EXPORT_REGIONS, type ExportRegion } from './exportRegions'
import {
  ESI_EXPORT_PROGRESS_IDLE,
  type EsiExportProgressState,
} from './esiExportProgressTypes'

export type { EsiExportProgressState }

const BASE = '/__dev/export'

export const isDevExportServer = import.meta.env.DEV

export type ExportListItem = { name: string; size: number; mtime: string }

export async function downloadToExports(
  downloadUrl: string,
  fileName: string
): Promise<void> {
  if (!isDevExportServer) {
    throw new Error('Сохранение в папку exports доступно только в режиме разработки (npm run dev).')
  }
  const r = await fetch(`${BASE}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: downloadUrl, fileName }),
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
    throw new Error(err)
  }
}

export async function listExportFiles(): Promise<ExportListItem[]> {
  if (!isDevExportServer) return []
  const r = await fetch(`${BASE}/list`)
  if (!r.ok) return []
  const j = (await r.json()) as { files?: ExportListItem[] }
  return j.files ?? []
}

export function devExportFileUrl(fileName: string): string {
  return `${BASE}/file/${encodeURIComponent(fileName)}`
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
  return {
    lines: j.lines ?? [],
    progress: {
      ...ESI_EXPORT_PROGRESS_IDLE,
      ...(j.progress ?? {}),
    },
  }
}

/**
 * Собрать ликвидность с официального ESI (только `npm run dev`).
 * Пишет файл в `exports/` и возвращает метаданные.
 */
export async function buildEsiLiquidityToExports(opts: {
  regionId: number
  fileName?: string
  maxTypes?: number
  maxOrderPages?: number
  /** true — запрашивать все страницы ордеров, пока ESI не вернёт «нет страницы» */
  orderPagesUntilExhausted?: boolean
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
      maxTypes: opts.maxTypes,
      maxOrderPages: opts.maxOrderPages,
      orderPagesUntilExhausted: opts.orderPagesUntilExhausted === true,
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
  if (j.partial == null) j.partial = false
  return j
}

/** Селектор: все известные регионы + (опц.) кастом в будущем */
export { EXPORT_REGIONS, type ExportRegion }
