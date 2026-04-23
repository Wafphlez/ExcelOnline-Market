import { useCallback, useEffect, useState } from 'react'
import { Download, FolderOpen, RefreshCw } from 'lucide-react'
import { EXPORT_REGIONS, type ExportRegion } from '../lib/exportRegions'
import {
  devExportFileUrl,
  downloadToExports,
  isDevExportServer,
  listExportFiles,
  type ExportListItem,
} from '../lib/devExportApi'

const LS_LAST_REGION = 'excelMarket_lastExportRegionId'

function readLastRegionId(): string {
  try {
    const v = localStorage.getItem(LS_LAST_REGION)
    if (v) return v
  } catch {
    /* ignore */
  }
  return EXPORT_REGIONS[0]?.id ?? ''
}

type ExportBarProps = {
  /** Загрузить разобранный workbook (как после выбора файла) */
  onLoadBuffer: (buf: ArrayBuffer, labelPrefix: string) => void | Promise<void>
  disabled?: boolean
}

export function ExportBar({ onLoadBuffer, disabled }: ExportBarProps) {
  const regions = EXPORT_REGIONS
  const [selectedId, setSelectedId] = useState(() => {
    const id = readLastRegionId()
    return regions.some((r) => r.id === id) ? id : (regions[0]?.id ?? '')
  })
  const [files, setFiles] = useState<ExportListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const selected = regions.find((r) => r.id === selectedId) ?? regions[0]

  const refreshList = useCallback(async () => {
    if (!isDevExportServer) {
      setFiles([])
      return
    }
    try {
      const list = await listExportFiles()
      setFiles(list)
    } catch {
      setFiles([])
    }
  }, [])

  useEffect(() => {
    void refreshList()
  }, [refreshList])

  useEffect(() => {
    try {
      if (selectedId) localStorage.setItem(LS_LAST_REGION, selectedId)
    } catch {
      /* ignore */
    }
  }, [selectedId])

  const onDownloadRegion = async (r: ExportRegion) => {
    setMsg(null)
    if (!isDevExportServer) {
      window.open(r.downloadUrl, '_blank', 'noopener,noreferrer')
      setMsg('В production откроется ссылка; в dev (npm run dev) файл пишется в папку exports/.')
      return
    }
    setLoading(true)
    try {
      await downloadToExports(r.downloadUrl, r.fileName)
      setMsg(`Сохранено: exports/${r.fileName}`)
      await refreshList()
      const u = devExportFileUrl(r.fileName)
      const res = await fetch(u)
      if (res.ok) {
        const buf = await res.arrayBuffer()
        await onLoadBuffer(buf, `exports/${r.fileName} · `)
        setMsg(`Открыт: ${r.label} (exports/${r.fileName})`)
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка скачивания')
    } finally {
      setLoading(false)
    }
  }

  const onOpenSelected = async () => {
    if (!selected) return
    setMsg(null)
    if (!isDevExportServer) {
      window.open(selected.downloadUrl, '_blank', 'noopener,noreferrer')
      return
    }
    setLoading(true)
    try {
      const u = devExportFileUrl(selected.fileName)
      const res = await fetch(u)
      if (!res.ok) {
        setMsg('Файл ещё не скачан — нажмите кнопку скачивания региона.')
        return
      }
      const buf = await res.arrayBuffer()
      await onLoadBuffer(buf, `exports/${selected.fileName} · `)
      setMsg(`Открыт: ${selected.label}`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка открытия')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mb-4 rounded border border-eve-border bg-eve-elevated/50 p-3">
      <div className="mb-2 text-xs font-medium text-eve-muted">Экспорты ликвидности (регионы)</div>
      <div className="flex flex-wrap items-center gap-2">
        {regions.map((r) => (
          <button
            key={r.id}
            type="button"
            disabled={disabled || loading}
            onClick={() => void onDownloadRegion(r)}
            className="inline-flex items-center gap-1 rounded border border-eve-border bg-eve-bg px-2.5 py-1.5 text-xs text-eve-text transition-colors hover:border-eve-accent hover:text-eve-accent disabled:opacity-50"
            title={
              isDevExportServer
                ? `Скачать в exports/${r.fileName} (перезаписать)`
                : 'Открыть ссылку в новой вкладке'
            }
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            {r.label}
          </button>
        ))}
        <div className="mx-1 hidden h-6 w-px bg-eve-border sm:block" aria-hidden />
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-eve-muted">
            <span>Экспорт для таблицы</span>
            <select
              className="rounded border border-eve-border bg-eve-bg px-2 py-1.5 text-xs text-eve-text focus:border-eve-accent focus:outline-none"
              value={selected?.id ?? ''}
              onChange={(e) => setSelectedId(e.target.value)}
              disabled={disabled}
            >
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} — {r.fileName}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={disabled || loading || !selected}
            onClick={() => void onOpenSelected()}
            className="inline-flex items-center gap-1 rounded border border-eve-accent/70 bg-eve-accent-muted px-2.5 py-1.5 text-xs text-eve-accent transition-colors hover:bg-eve-accent/20 disabled:opacity-50"
            title="Загрузить выбранный xlsx из папки exports/ (нужен npm run dev)"
          >
            <FolderOpen className="h-3.5 w-3.5" aria-hidden />
            Загрузить в таблицу
          </button>
          {isDevExportServer && (
            <button
              type="button"
              onClick={() => void refreshList()}
              className="inline-flex items-center gap-1 rounded border border-eve-border px-2 py-1.5 text-xs text-eve-muted hover:text-eve-text"
              title="Обновить список файлов в exports/"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {isDevExportServer && files.length > 0 && (
        <p className="mt-2 text-[11px] text-eve-muted/90">
          В <code className="text-eve-text/80">exports/</code>:{' '}
          {files.map((f) => (
            <span key={f.name} className="mr-2 inline tabular-nums">
              {f.name} ({Math.round(f.size / 1024)} KB)
            </span>
          ))}
        </p>
      )}
      {msg && <p className="mt-2 text-xs text-eve-muted">{msg}</p>}
      {!isDevExportServer && (
        <p className="mt-2 text-[11px] text-eve-muted/80">
          Запись в <code>exports/</code> и кнопка «Загрузить в таблицу» работают при{' '}
          <code>npm run dev</code>. В собранной версии ссылки открываются в браузере.
        </p>
      )}
    </div>
  )
}
