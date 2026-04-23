import { EXPORT_REGIONS, type ExportRegion } from './exportRegions'

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

/** Селектор: все известные регионы + (опц.) кастом в будущем */
export { EXPORT_REGIONS, type ExportRegion }
