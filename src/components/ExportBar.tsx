import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, FolderOpen, Globe, RefreshCw } from 'lucide-react'
import { EXPORT_REGIONS, type ExportRegion } from '../lib/exportRegions'
import {
  buildEsiLiquidityToExports,
  devExportFileUrl,
  downloadToExports,
  fetchEsiDevLogs,
  isDevExportServer,
  listExportFiles,
  postEsiExportStop,
  type ExportListItem,
} from '../lib/devExportApi'
import { EsiExportProgressPanel } from './EsiExportProgressPanel'
import {
  ESI_EXPORT_PROGRESS_IDLE,
  type EsiExportProgressState,
} from '../lib/esiExportProgressTypes'

const LS_LAST_REGION = 'excelMarket_lastExportRegionId'
const LS_LAST_EXPORT_FILE = 'excelMarket_lastExportFileName'
const LS_ESI_MAX_PAGES = 'excelMarket_esiMaxOrderPages'

function readEsiMaxOrderPagesStr(): string {
  try {
    const v = localStorage.getItem(LS_ESI_MAX_PAGES)
    if (v && /^\d{1,3}$/.test(v)) return v
  } catch {
    /* ignore */
  }
  return '90'
}

function readLastRegionId(): string {
  try {
    const v = localStorage.getItem(LS_LAST_REGION)
    if (v) return v
  } catch {
    /* ignore */
  }
  return EXPORT_REGIONS[0]?.id ?? ''
}

function readLastExportFileName(): string {
  try {
    const v = localStorage.getItem(LS_LAST_EXPORT_FILE)
    return v ?? ''
  } catch {
    return ''
  }
}

type ExportBarProps = {
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
  const [esiMaxPagesStr, setEsiMaxPagesStr] = useState(() =>
    readEsiMaxOrderPagesStr()
  )
  const [selectedExportFile, setSelectedExportFile] = useState(
    readLastExportFileName
  )
  const [esiProgress, setEsiProgress] = useState<EsiExportProgressState>(() => ({
    ...ESI_EXPORT_PROGRESS_IDLE,
  }))
  const [esiExporting, setEsiExporting] = useState(false)

  const selected = regions.find((r) => r.id === selectedId) ?? regions[0]

  /** Только .xlsx/.xls из exports/, свежие сверху */
  const exportFilesSorted = useMemo(() => {
    return [...files]
      .filter((f) => /\.(xlsx|xls)$/i.test(f.name))
      .sort((a, b) => b.mtime.localeCompare(a.mtime) || a.name.localeCompare(b.name))
  }, [files])

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

  useEffect(() => {
    if (!isDevExportServer) return
    if (exportFilesSorted.length === 0) {
      setSelectedExportFile('')
      return
    }
    setSelectedExportFile((prev) => {
      if (prev && exportFilesSorted.some((f) => f.name === prev)) {
        return prev
      }
      return exportFilesSorted[0]!.name
    })
  }, [exportFilesSorted, isDevExportServer])

  useEffect(() => {
    try {
      if (selectedExportFile) {
        localStorage.setItem(LS_LAST_EXPORT_FILE, selectedExportFile)
      } else {
        localStorage.removeItem(LS_LAST_EXPORT_FILE)
      }
    } catch {
      /* ignore */
    }
  }, [selectedExportFile])

  useEffect(() => {
    const n = parseInt(esiMaxPagesStr, 10)
    if (!Number.isFinite(n) || n < 1 || n > 200) return
    try {
      localStorage.setItem(LS_ESI_MAX_PAGES, String(n))
    } catch {
      /* ignore */
    }
  }, [esiMaxPagesStr])

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
      setSelectedExportFile(r.fileName)
      try {
        localStorage.setItem(LS_LAST_EXPORT_FILE, r.fileName)
      } catch {
        /* ignore */
      }
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

  const onEsiBuildSelected = async () => {
    if (!selected) return
    setMsg(null)
    if (!isDevExportServer) {
      setMsg('Выгрузка через ESI только в dev (npm run dev).')
      return
    }
    setLoading(true)
    setEsiExporting(true)
    setEsiProgress({ ...ESI_EXPORT_PROGRESS_IDLE })
    let lastLogIndex = 0
    const flushEsiLogsToConsole = async () => {
      try {
        const { lines, progress } = await fetchEsiDevLogs()
        setEsiProgress(progress)
        for (let i = lastLogIndex; i < lines.length; i++) {
          const line = lines[i]
          if (line) console.log(line)
        }
        lastLogIndex = lines.length
      } catch {
        /* ignore */
      }
    }
    const logPoll = window.setInterval(() => void flushEsiLogsToConsole(), 500)
    const logKick = window.setTimeout(() => void flushEsiLogsToConsole(), 100)
    let maxOrderPages = 90
    const mp = parseInt(esiMaxPagesStr.trim(), 10)
    if (Number.isFinite(mp) && mp >= 1) {
      maxOrderPages = Math.min(200, mp)
    }
    try {
      const fileName = `liquidity-esi-${selected.esiRegionId}.xlsx`
      const result = await buildEsiLiquidityToExports({
        regionId: selected.esiRegionId,
        fileName,
        maxOrderPages,
      })
      setMsg(
        `ESI: ${result.rowCount} позиций → exports/${result.fileName}${
          result.partial ? ' (частично, принудительный стоп)' : ''
        }`
      )
      await refreshList()
      setSelectedExportFile(result.fileName)
      try {
        localStorage.setItem(LS_LAST_EXPORT_FILE, result.fileName)
      } catch {
        /* ignore */
      }
      const u = devExportFileUrl(result.fileName)
      const res = await fetch(u)
      if (res.ok) {
        const buf = await res.arrayBuffer()
        await onLoadBuffer(buf, `exports/${result.fileName} · ESI · `)
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка ESI')
    } finally {
      window.clearInterval(logPoll)
      window.clearTimeout(logKick)
      void flushEsiLogsToConsole()
      setEsiProgress({ ...ESI_EXPORT_PROGRESS_IDLE })
      setEsiExporting(false)
      setLoading(false)
    }
  }

  const onOpenLocalExportFile = async () => {
    if (!selectedExportFile) return
    setMsg(null)
    if (!isDevExportServer) {
      return
    }
    setLoading(true)
    try {
      const u = devExportFileUrl(selectedExportFile)
      const res = await fetch(u)
      if (!res.ok) {
        setMsg(
          'Файл не найден в exports/ — обновите список или скачайте выгрузку снова.'
        )
        return
      }
      const buf = await res.arrayBuffer()
      await onLoadBuffer(buf, `exports/${selectedExportFile} · `)
      setMsg(`Открыт: ${selectedExportFile}`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка открытия')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <section>
        <h3 className="eve-section-title mb-2">
          Готовые выгрузки по региону
        </h3>
        <p className="mb-3 text-[11px] leading-relaxed text-eve-muted/90">
          Сервис: ликвидность; в dev файлы пишутся в{' '}
          <code className="rounded bg-eve-bg/80 px-1 text-eve-text/85">exports/</code>
        </p>
        <div className="flex flex-wrap gap-2">
          {regions.map((r) => (
            <button
              key={r.id}
              type="button"
              disabled={disabled || loading}
              onClick={() => void onDownloadRegion(r)}
              className="inline-flex items-center gap-1.5 rounded border border-eve-border/90 bg-eve-bg/60 px-2.5 py-1.5 text-xs font-semibold text-eve-bright/90 shadow-eve-inset transition-colors hover:border-eve-accent/50 hover:text-eve-accent disabled:opacity-50"
              title={
                isDevExportServer
                  ? `Скачать в exports/${r.fileName}`
                  : 'Открыть в новой вкладке'
              }
            >
              <Download className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {r.label}
            </button>
          ))}
        </div>
      </section>

      <section className="border-t border-eve-border/50 pt-4">
        <h3 className="eve-section-title mb-2">Открыть локальный файл</h3>
        <p className="mb-3 text-[11px] leading-relaxed text-eve-muted/90">
          Файлы из папки{' '}
          <code className="rounded bg-eve-bg/80 px-1 text-eve-text/85">exports/</code>{' '}
          на диске проекта
        </p>
        {isDevExportServer ? (
          <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
            <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-eve-muted sm:max-w-md">
              <span className="shrink-0">Файл</span>
              <select
                className="min-w-0 flex-1 rounded border border-eve-border/80 bg-eve-bg/80 py-1.5 pl-2 pr-8 text-xs text-eve-text shadow-eve-inset focus:border-eve-accent/70 focus:outline-none"
                value={selectedExportFile}
                onChange={(e) => setSelectedExportFile(e.target.value)}
                disabled={disabled || exportFilesSorted.length === 0}
              >
                {exportFilesSorted.length === 0 ? (
                  <option value="">— папка пуста —</option>
                ) : (
                  exportFilesSorted.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name} ({Math.round(f.size / 1024)} KB)
                    </option>
                  ))
                )}
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={
                  disabled ||
                  loading ||
                  exportFilesSorted.length === 0 ||
                  !selectedExportFile
                }
                onClick={() => void onOpenLocalExportFile()}
                className="inline-flex items-center justify-center gap-1.5 rounded border border-eve-accent/70 bg-eve-accent-muted px-4 py-2 text-xs font-semibold text-eve-accent transition-colors hover:border-eve-accent hover:bg-eve-highlight focus:outline-none focus:ring-2 focus:ring-eve-accent/35 disabled:opacity-50"
                title="Открыть в таблицу выбранный файл из exports/"
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Открыть
              </button>
              <button
                type="button"
                onClick={() => void refreshList()}
                className="inline-flex items-center justify-center rounded border border-eve-border/80 p-1.5 text-eve-muted shadow-eve-inset hover:border-eve-muted/60 hover:text-eve-bright"
                title="Обновить список из exports/"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
        ) : (
          <p className="text-[11px] leading-relaxed text-eve-muted/85">
            Список <code>exports/</code> и чтение с диска проекта работают только
            в режиме разработчика. В production используйте кнопки выгрузок
            выше (ссылки) или перетаскивание файла в блоке «Локальный Excel».
          </p>
        )}
      </section>

      {isDevExportServer && (
        <section className="eve-panel rounded p-3">
          <h3 className="eve-section-title mb-2">Собрать через ESI</h3>
          <p className="mb-3 text-[11px] text-eve-muted/85">
            Официальный ESI, долго. Экспорт в{' '}
            <code className="text-eve-text/80">exports/</code>, затем в таблицу.
          </p>
          <div className="mb-3 flex min-w-0 max-w-sm flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
            <span className="shrink-0 text-[11px] text-eve-muted">Регион ESI</span>
            <select
              className="min-w-0 flex-1 rounded border border-eve-border/80 bg-eve-bg/80 py-1.5 pl-2 pr-8 text-xs text-eve-text shadow-eve-inset focus:border-eve-accent/70 focus:outline-none"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              disabled={disabled}
            >
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-0.5 text-[11px] text-eve-muted">
              <span>Стр. ордеров (sell + buy)</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={200}
                value={esiMaxPagesStr}
                onChange={(e) => setEsiMaxPagesStr(e.target.value)}
                disabled={disabled || loading}
                className="w-16 rounded border border-eve-border/80 bg-eve-bg/80 px-2 py-1.5 text-xs tabular-nums text-eve-text shadow-eve-inset focus:border-eve-accent/70 focus:outline-none disabled:opacity-50"
              />
            </label>
            <button
              type="button"
              disabled={disabled || loading || !selected}
              onClick={() => void onEsiBuildSelected()}
              className="inline-flex items-center gap-1.5 rounded border border-eve-border/90 bg-eve-bg/50 px-3 py-1.5 text-xs font-semibold text-eve-bright/90 shadow-eve-inset transition-colors hover:border-eve-accent/45 hover:text-eve-accent disabled:opacity-50"
            >
              <Globe className="h-3.5 w-3.5" aria-hidden />
              Сформировать (ESI)
            </button>
            {loading && esiExporting && (
              <button
                type="button"
                onClick={() => {
                  void postEsiExportStop().catch((e) =>
                    setMsg(e instanceof Error ? e.message : 'Ошибка стоп')
                  )
                }}
                className="rounded border border-eve-danger/50 bg-eve-danger/10 px-2.5 py-1.5 text-[11px] font-semibold text-eve-danger/95 hover:border-eve-danger/70"
                title="Остановить и собрать xlsx из текущих данных"
              >
                Стоп → xlsx
              </button>
            )}
          </div>
          {loading && esiExporting && (
            <div className="mt-3">
              <EsiExportProgressPanel progress={esiProgress} />
            </div>
          )}
        </section>
      )}

      {msg && (
        <p className="rounded border border-eve-border/50 bg-eve-bg/50 px-2.5 py-1.5 text-xs text-eve-muted shadow-eve-inset">
          {msg}
        </p>
      )}

      {!isDevExportServer && (
        <p className="text-[11px] leading-relaxed text-eve-muted/80">
          Запись в <code>exports/</code> и ESI — только в режиме{' '}
          <code className="text-eve-text/70">npm run dev</code>. Ссылки скачивания откроются в
          браузере.
        </p>
      )}
    </div>
  )
}
