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
import {
  LS_LAST_EXPORT_REGION_ID,
  LAST_EXPORT_REGION_EVENT,
  readLastExportRegionId,
} from '../lib/lastExportRegionStorage'

const LS_LAST_EXPORT_FILE = 'excelMarket_lastExportFileName'
const LS_ESI_MAX_PAGES = 'excelMarket_esiMaxOrderPages'
const LS_ESI_UNBOUNDED_ORDERS = 'excelMarket_esiOrderPagesUntilExhausted'

function readEsiMaxOrderPagesStr(): string {
  try {
    const v = localStorage.getItem(LS_ESI_MAX_PAGES)
    if (v && /^\d{1,3}$/.test(v)) return v
  } catch {
    /* ignore */
  }
  return '90'
}

function readEsiOrderPagesUntilExhausted(): boolean {
  try {
    return localStorage.getItem(LS_ESI_UNBOUNDED_ORDERS) === '1'
  } catch {
    return false
  }
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
  onLoadBuffer: (buf: ArrayBuffer) => void | Promise<void>
  disabled?: boolean
}

export function ExportBar({ onLoadBuffer, disabled }: ExportBarProps) {
  const regions = EXPORT_REGIONS
  const [selectedId, setSelectedId] = useState(() => {
    const id = readLastExportRegionId()
    return regions.some((r) => r.id === id) ? id : (regions[0]?.id ?? '')
  })
  const [files, setFiles] = useState<ExportListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [esiMaxPagesStr, setEsiMaxPagesStr] = useState(() =>
    readEsiMaxOrderPagesStr()
  )
  const [esiOrderPagesUntilExhausted, setEsiOrderPagesUntilExhausted] = useState(
    () => readEsiOrderPagesUntilExhausted()
  )
  const [selectedExportFile, setSelectedExportFile] = useState(
    readLastExportFileName
  )
  const [esiProgress, setEsiProgress] = useState<EsiExportProgressState>(() => ({
    ...ESI_EXPORT_PROGRESS_IDLE,
  }))
  const [esiExporting, setEsiExporting] = useState(false)
  const [esiSessionStartedAt, setEsiSessionStartedAt] = useState<number | null>(null)
  const [esiTypesPhaseAt, setEsiTypesPhaseAt] = useState<number | null>(null)
  const [esiTimerTick, setEsiTimerTick] = useState(0)

  const selected = regions.find((r) => r.id === selectedId) ?? regions[0]

  /** Только .xlsx/.xls из exports/, свежие сверху */
  const exportFilesSorted = useMemo(() => {
    return [...files]
      .filter((f) => /\.(xlsx|xls)$/i.test(f.name))
      .sort((a, b) => b.mtime.localeCompare(a.mtime) || a.name.localeCompare(b.name))
  }, [files])

  useEffect(() => {
    if (!esiExporting) return
    const id = window.setInterval(() => {
      setEsiTimerTick((n) => n + 1)
    }, 1000)
    return () => clearInterval(id)
  }, [esiExporting])

  useEffect(() => {
    if (esiProgress.phase === 'types' && esiTypesPhaseAt === null) {
      setEsiTypesPhaseAt(Date.now())
    }
  }, [esiProgress.phase, esiTypesPhaseAt])

  const esiElapsedSec = useMemo(() => {
    void esiTimerTick
    if (esiSessionStartedAt == null) return 0
    return (Date.now() - esiSessionStartedAt) / 1000
  }, [esiTimerTick, esiSessionStartedAt])

  const esiTypesPhaseElapsedSec = useMemo(() => {
    void esiTimerTick
    if (esiTypesPhaseAt == null) return null
    return (Date.now() - esiTypesPhaseAt) / 1000
  }, [esiTimerTick, esiTypesPhaseAt])

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
      if (selectedId) {
        localStorage.setItem(LS_LAST_EXPORT_REGION_ID, selectedId)
        window.dispatchEvent(
          new CustomEvent(LAST_EXPORT_REGION_EVENT, {
            detail: { id: selectedId },
          })
        )
      }
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

  useEffect(() => {
    try {
      localStorage.setItem(
        LS_ESI_UNBOUNDED_ORDERS,
        esiOrderPagesUntilExhausted ? '1' : '0'
      )
    } catch {
      /* ignore */
    }
  }, [esiOrderPagesUntilExhausted])

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
        await onLoadBuffer(buf)
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
    setEsiSessionStartedAt(Date.now())
    setEsiTypesPhaseAt(null)
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
    let maxOrderPages: number | undefined
    if (!esiOrderPagesUntilExhausted) {
      const mp = parseInt(esiMaxPagesStr.trim(), 10)
      maxOrderPages = Number.isFinite(mp) && mp >= 1 ? Math.min(200, mp) : 90
    }
    try {
      const fileName = `liquidity-esi-${selected.esiRegionId}.xlsx`
      const result = await buildEsiLiquidityToExports({
        regionId: selected.esiRegionId,
        fileName,
        orderPagesUntilExhausted: esiOrderPagesUntilExhausted,
        ...(maxOrderPages != null && { maxOrderPages }),
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
        await onLoadBuffer(buf)
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка ESI')
    } finally {
      window.clearInterval(logPoll)
      window.clearTimeout(logKick)
      void flushEsiLogsToConsole()
      setEsiProgress({ ...ESI_EXPORT_PROGRESS_IDLE })
      setEsiExporting(false)
      setEsiSessionStartedAt(null)
      setEsiTypesPhaseAt(null)
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
      await onLoadBuffer(buf)
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
          <div className="mb-3 min-w-0 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
            <div className="flex w-max min-w-full flex-nowrap items-stretch gap-2 sm:w-full sm:gap-3">
              <div className="w-44 shrink-0 sm:w-52">
                <div className="relative h-full min-h-full overflow-hidden rounded border border-eve-border/60 bg-eve-elevated/30 p-2.5 shadow-eve-inset">
                  <div
                    className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-eve-accent/40 to-transparent"
                    aria-hidden
                  />
                  <span className="mb-1.5 block font-eve text-[10px] font-semibold uppercase tracking-[0.12em] text-eve-gold/80">
                    Регион ESI
                  </span>
                  <select
                    className="w-full min-w-0 cursor-pointer rounded border border-eve-border/80 bg-eve-bg/90 py-2 pl-2.5 pr-9 text-sm font-medium text-eve-bright shadow-eve-inset focus:border-eve-accent/70 focus:outline-none focus:ring-2 focus:ring-eve-accent/25 disabled:cursor-not-allowed disabled:opacity-50"
                    value={selectedId}
                    onChange={(e) => setSelectedId(e.target.value)}
                    disabled={disabled}
                  >
                    {regions.map((r) => (
                      <option key={r.id} value={r.id} className="bg-eve-surface text-eve-text">
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="min-w-0 w-max max-w-full shrink-0">
                <div className="relative overflow-hidden rounded border border-eve-border/60 bg-eve-elevated/30 p-2.5 shadow-eve-inset">
                  <div
                    className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-eve-accent/40 to-transparent"
                    aria-hidden
                  />
                  <div className="flex min-w-0 w-max max-w-full items-stretch gap-2.5 sm:gap-3">
                    <label
                      className={`shrink-0 self-stretch ${
                        esiOrderPagesUntilExhausted ? 'opacity-50' : ''
                      }`}
                    >
                      <span className="mb-1 block font-eve text-[10px] font-semibold uppercase tracking-[0.12em] text-eve-gold/75">
                        Страниц
                      </span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={200}
                        value={esiMaxPagesStr}
                        onChange={(e) => setEsiMaxPagesStr(e.target.value)}
                        disabled={disabled || loading || esiOrderPagesUntilExhausted}
                        className="w-[4.5rem] rounded border border-eve-border/80 bg-eve-bg/90 px-2.5 py-1.5 text-sm tabular-nums text-eve-bright shadow-eve-inset focus:border-eve-accent/70 focus:outline-none focus:ring-2 focus:ring-eve-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </label>
                    <div
                      className={`group/mode w-fit min-w-0 shrink-0 self-stretch rounded border p-2 transition-all ${
                        esiOrderPagesUntilExhausted
                          ? 'border-eve-accent/45 bg-eve-accent-muted/20 shadow-[inset_0_0_0_1px_rgba(184,150,61,0.12)]'
                          : 'border-eve-border/55 bg-eve-bg/20 hover:border-eve-border/70'
                      } ${disabled || loading ? 'pointer-events-none opacity-50' : ''}`}
                    >
                      <label
                        className={`flex w-fit min-w-0 max-w-[min(11rem,100%)] flex-col ${
                          disabled || loading
                            ? 'cursor-not-allowed'
                            : 'cursor-pointer'
                        }`}
                      >
                        <span className="mb-0.5 block w-max font-eve text-[9px] font-semibold uppercase tracking-[0.12em] text-eve-gold/70">
                          Максимум
                        </span>
                        <div
                          className={`flex w-max min-w-0 max-w-full items-center gap-1.5 ${
                            esiOrderPagesUntilExhausted
                              ? 'justify-between'
                              : 'justify-end'
                          }`}
                        >
                          {esiOrderPagesUntilExhausted && (
                            <p className="min-w-0 max-w-[10.5rem] text-[8.5px] leading-snug text-eve-muted/90 sm:text-[9px]">
                              Все стр. до ответа ESI
                            </p>
                          )}
                          <div className="flex shrink-0 items-center self-center">
                            <input
                              type="checkbox"
                              className="peer sr-only"
                              checked={esiOrderPagesUntilExhausted}
                              onChange={(e) =>
                                setEsiOrderPagesUntilExhausted(e.target.checked)
                              }
                              disabled={disabled || loading}
                              aria-label="Максимум: запрашивать все страницы ордеров"
                            />
                            <div
                              className="flex h-5 w-10 flex-shrink-0 items-center justify-start rounded-full border border-eve-border/70 bg-eve-bg/80 p-px shadow-eve-inset transition peer-checked:justify-end peer-checked:border-eve-accent/55 peer-checked:bg-eve-accent-muted/30 peer-focus-visible:ring-2 peer-focus-visible:ring-eve-accent/35"
                              aria-hidden
                            >
                              <span
                                className="h-3.5 w-3.5 rounded-full border border-eve-border/40 bg-gradient-to-b from-eve-elevated to-eve-bg shadow-[0_1px_2px_rgba(0,0,0,0.5)] ring-1 ring-white/5 transition group-has-[:checked]/mode:border-eve-accent/70 group-has-[:checked]/mode:from-eve-highlight group-has-[:checked]/mode:shadow-[0_0_6px_rgba(184,150,61,0.35)]"
                              />
                            </div>
                          </div>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex min-w-0 flex-1 items-end justify-end gap-2">
                <button
                  type="button"
                  disabled={disabled || loading || !selected}
                  onClick={() => void onEsiBuildSelected()}
                  className="inline-flex min-h-[2.5rem] items-center justify-center gap-1.5 rounded border border-eve-accent/70 bg-eve-accent-muted px-4 py-2 text-xs font-semibold text-eve-accent shadow-eve-inset transition-colors hover:border-eve-accent hover:bg-eve-highlight focus:outline-none focus:ring-2 focus:ring-eve-accent/35 disabled:opacity-50"
                >
                  <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden />
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
                    className="inline-flex min-h-[2.5rem] items-center justify-center rounded border border-eve-danger/55 bg-eve-danger/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-eve-danger/95 shadow-eve-inset transition-colors hover:border-eve-danger/80 hover:bg-eve-danger/20"
                    title="Остановить и собрать xlsx из текущих данных"
                  >
                    Стоп → xlsx
                  </button>
                )}
              </div>
            </div>
          </div>
          {loading && esiExporting && (
            <div className="mt-3">
              <EsiExportProgressPanel
                progress={esiProgress}
                elapsedSec={esiElapsedSec}
                typesPhaseElapsedSec={esiTypesPhaseElapsedSec}
              />
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
