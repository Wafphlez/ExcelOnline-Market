import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, FolderOpen, Globe, RefreshCw } from 'lucide-react'
import { useInputWheelNudge } from '../hooks/useInputWheelNudge'
import { EXPORT_REGIONS, type ExportRegion } from '../lib/exportRegions'
import {
  buildEsiLiquidityToExports,
  fetchLatestMarketLogFile,
  fetchMarketLogFileBuffer,
  marketLogsStreamUrl,
  devExportFileUrl,
  downloadToExports,
  fetchEsiDevLogs,
  isDevExportServer,
  listExportFiles,
  postEsiExportForceStop,
  postEsiExportStop,
  type ExportListItem,
} from '../lib/devExportApi'
import { marginPercentCellStyle } from '../lib/rowHeatmap'
import { formatIsk, formatPercent } from '../lib/formatNumber'
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
import {
  ESI_DEFAULT_MAX_TYPES,
  ESI_MAX_ORDER_PAGES_USER_CAP,
  ESI_MAX_TYPES_USER_CAP,
} from '../lib/esiOrderPageLimits'

const LS_LAST_EXPORT_FILE = 'excelMarket_lastExportFileName'
const LS_ESI_MAX_PAGES = 'excelMarket_esiMaxOrderPages'
const LS_ESI_MAX_TYPES = 'excelMarket_esiMaxTypes'
const LS_ENABLE_MARKET_EXPORT_LOGS = 'excelMarket_enableMarketExportLogs'

function readEsiMaxOrderPagesStr(): string {
  try {
    const v = localStorage.getItem(LS_ESI_MAX_PAGES)
    if (v && /^\d{1,4}$/.test(v)) return v
  } catch {
    /* ignore */
  }
  return '90'
}

function readEsiMaxTypesStr(): string {
  try {
    const v = localStorage.getItem(LS_ESI_MAX_TYPES)
    if (v && /^\d{1,5}$/.test(v)) {
      const n = parseInt(v, 10)
      if (n >= 1 && n <= ESI_MAX_TYPES_USER_CAP) return String(n)
    }
  } catch {
    /* ignore */
  }
  return String(ESI_DEFAULT_MAX_TYPES)
}

function readLastExportFileName(): string {
  try {
    const v = localStorage.getItem(LS_LAST_EXPORT_FILE)
    return v ?? ''
  } catch {
    return ''
  }
}

function readEnableMarketExportLogs(): boolean {
  try {
    const v =
      localStorage.getItem(LS_ENABLE_MARKET_EXPORT_LOGS) ??
      localStorage.getItem('excelMarket_showMarketExportLogs')
    if (v === '0') return false
    if (v === '1') return true
  } catch {
    /* ignore */
  }
  return true
}

type ExportBarProps = {
  onLoadBuffer: (buf: ArrayBuffer) => void | Promise<void>
  disabled?: boolean
  hideReadyExportsSection?: boolean
  hideLocalFileOpenSection?: boolean
  hideEsiSection?: boolean
  hideMarketLogsSection?: boolean
  brokerFeePct: number
  salesTaxPct: number
  highPriceThresholdIsk: number
  onBrokerFeeChange: (value: number) => void
  onSalesTaxChange: (value: number) => void
  brokerInputRef?: (el: HTMLInputElement | null) => void
  taxInputRef?: (el: HTMLInputElement | null) => void
  onMessageChange?: (message: string | null) => void
}

type MarketLogSummaryRow = {
  name: string
  margin: number | null
  profitIsk: number | null
  exportTime: string
  price: number
  typeId: number | null
}

const LS_MARKETLOGS_PATH = 'excelMarket_marketLogsPath'

function readMarketLogsPath(): string {
  try {
    return localStorage.getItem(LS_MARKETLOGS_PATH) ?? ''
  } catch {
    return ''
  }
}

function parseExportTime(birthtimeIso?: string, mtimeIso?: string): string {
  const source = birthtimeIso || mtimeIso
  if (!source) return '—'
  const d = new Date(source)
  if (!Number.isFinite(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

type ParsedMarketLog = {
  itemName: string
  bestSell: number | null
  bestBuy: number | null
  typeId: number | null
}

const EVE_TYCOON_MARKET_URL = 'https://evetycoon.com/market/'

function decodeMarketLogBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  const decoders = ['utf-8', 'utf-16le', 'utf-16be', 'windows-1251'] as const
  for (const enc of decoders) {
    try {
      const t = new TextDecoder(enc).decode(bytes)
      if (t && /price|bid/i.test(t.slice(0, 200))) return t
    } catch {
      /* try next */
    }
  }
  return new TextDecoder('utf-8').decode(bytes)
}

function parseItemNameFromMarketLogFile(fileName: string): string {
  const base = fileName.replace(/\.txt$/i, '')
  const parts = base.split('-')
  if (parts.length >= 3) {
    return parts.slice(1, -1).join('-').trim() || base
  }
  return base
}

function parseMarketLogText(fileName: string, text: string): ParsedMarketLog {
  const lines = text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
  if (lines.length < 2) {
    return {
      itemName: parseItemNameFromMarketLogFile(fileName),
      bestSell: null,
      bestBuy: null,
      typeId: null,
    }
  }
  const headerLine = lines[0]!
    .replace(/^\uFEFF/, '')
  const delimiter =
    headerLine.includes(';') && !headerLine.includes(',') ? ';' : ','
  const header = headerLine
    .split(delimiter)
    .map((x) => x.trim().toLowerCase())
  const priceIdx = header.indexOf('price')
  const bidIdx = header.indexOf('bid')
  const typeIdIdx = header.findIndex((h) =>
    h === 'typeid' ||
    h === 'type_id' ||
    h === 'type id' ||
    h === 'type'
  )
  if (priceIdx < 0 || bidIdx < 0) {
    return {
      itemName: parseItemNameFromMarketLogFile(fileName),
      bestSell: null,
      bestBuy: null,
      typeId: null,
    }
  }
  let bestSell: number | null = null
  let bestBuy: number | null = null
  let typeId: number | null = null
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(delimiter)
    if (cols.length <= Math.max(priceIdx, bidIdx)) continue
    if (typeIdIdx >= 0 && typeId === null && cols.length > typeIdIdx) {
      const maybeTypeId = Number(cols[typeIdIdx]?.trim())
      if (Number.isFinite(maybeTypeId) && maybeTypeId > 0) {
        typeId = Math.floor(maybeTypeId)
      }
    }
    const priceRaw = cols[priceIdx]?.trim().replace(',', '.')
    const bidRaw = cols[bidIdx]?.trim().toLowerCase()
    if (!priceRaw) continue
    const price = Number(priceRaw)
    if (!Number.isFinite(price) || price <= 0) continue
    const isBid = bidRaw === 'true' || bidRaw === '1' || bidRaw === 'yes'
    if (isBid) {
      if (bestBuy === null || price > bestBuy) bestBuy = price
    } else {
      if (bestSell === null || price < bestSell) bestSell = price
    }
  }
  return { itemName: parseItemNameFromMarketLogFile(fileName), bestSell, bestBuy, typeId }
}

export function ExportBar({
  onLoadBuffer,
  disabled,
  hideReadyExportsSection = false,
  hideLocalFileOpenSection = false,
  hideEsiSection = false,
  hideMarketLogsSection = false,
  brokerFeePct,
  salesTaxPct,
  highPriceThresholdIsk,
  onBrokerFeeChange,
  onSalesTaxChange,
  brokerInputRef,
  taxInputRef,
  onMessageChange,
}: ExportBarProps) {
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
  const [esiMaxTypesStr, setEsiMaxTypesStr] = useState(() =>
    readEsiMaxTypesStr()
  )
  const [selectedExportFile, setSelectedExportFile] = useState(
    readLastExportFileName
  )
  const [esiProgress, setEsiProgress] = useState<EsiExportProgressState>(() => ({
    ...ESI_EXPORT_PROGRESS_IDLE,
  }))
  const [esiExporting, setEsiExporting] = useState(false)
  const [esiStopRequestKind, setEsiStopRequestKind] = useState<'soft' | 'force' | null>(null)
  const [esiSessionStartedAt, setEsiSessionStartedAt] = useState<number | null>(null)
  const [esiTypesPhaseAt, setEsiTypesPhaseAt] = useState<number | null>(null)
  const [esiTimerTick, setEsiTimerTick] = useState(0)
  const [marketLogsPath, setMarketLogsPath] = useState(readMarketLogsPath)
  const [marketExportLogsEnabled, setMarketExportLogsEnabled] = useState(
    readEnableMarketExportLogs
  )
  const [marketLogRows, setMarketLogRows] = useState<MarketLogSummaryRow[]>([])
  const [marketLogInfo, setMarketLogInfo] = useState<string>('Папка не выбрана')
  const [brokerInputEl, setBrokerInputEl] = useState<HTMLInputElement | null>(null)
  const [taxInputEl, setTaxInputEl] = useState<HTMLInputElement | null>(null)

  const setBrokerInput = useCallback((el: HTMLInputElement | null) => {
    setBrokerInputEl(el)
    brokerInputRef?.(el)
  }, [brokerInputRef])

  const setTaxInput = useCallback((el: HTMLInputElement | null) => {
    setTaxInputEl(el)
    taxInputRef?.(el)
  }, [taxInputRef])

  useInputWheelNudge(brokerInputEl, {
    step: 0.01,
    bounds: { min: 0, max: 100 },
    getValue: () => brokerFeePct,
    onNudge: (next) => onBrokerFeeChange(Math.round(next * 100) / 100),
    enabled: !(disabled || !marketExportLogsEnabled),
  })

  useInputWheelNudge(taxInputEl, {
    step: 0.01,
    bounds: { min: 0, max: 100 },
    getValue: () => salesTaxPct,
    onNudge: (next) => onSalesTaxChange(Math.round(next * 100) / 100),
    enabled: !(disabled || !marketExportLogsEnabled),
  })

  useEffect(() => {
    onMessageChange?.(msg)
  }, [msg, onMessageChange])

  const selected = regions.find((r) => r.id === selectedId) ?? regions[0]
  const trimmedMarketLogsPath = marketLogsPath.trim()

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
    if (
      !Number.isFinite(n) ||
      n < 1 ||
      n > ESI_MAX_ORDER_PAGES_USER_CAP
    ) {
      return
    }
    try {
      localStorage.setItem(LS_ESI_MAX_PAGES, String(n))
    } catch {
      /* ignore */
    }
  }, [esiMaxPagesStr])

  useEffect(() => {
    const n = parseInt(esiMaxTypesStr, 10)
    if (
      !Number.isFinite(n) ||
      n < 1 ||
      n > ESI_MAX_TYPES_USER_CAP
    ) {
      return
    }
    try {
      localStorage.setItem(LS_ESI_MAX_TYPES, String(n))
    } catch {
      /* ignore */
    }
  }, [esiMaxTypesStr])

  useEffect(() => {
    try {
      if (trimmedMarketLogsPath) {
        localStorage.setItem(LS_MARKETLOGS_PATH, trimmedMarketLogsPath)
      } else {
        localStorage.removeItem(LS_MARKETLOGS_PATH)
      }
    } catch {
      /* ignore */
    }
  }, [trimmedMarketLogsPath])

  useEffect(() => {
    try {
      localStorage.setItem(
        LS_ENABLE_MARKET_EXPORT_LOGS,
        marketExportLogsEnabled ? '1' : '0'
      )
    } catch {
      /* ignore */
    }
  }, [marketExportLogsEnabled])

  useEffect(() => {
    if (!isDevExportServer) return
    if (!marketExportLogsEnabled) {
      setMarketLogInfo('Обработка market logs отключена')
      return
    }
    if (!trimmedMarketLogsPath) {
      setMarketLogRows([])
      setMarketLogInfo('Укажите путь к папке market logs')
      return
    }
    let cancelled = false
    let initialized = false
    let lastSeenKey = ''
    let pollingBusy = false

    const poll = async () => {
      if (pollingBusy) return
      pollingBusy = true
      try {
        const latest = await fetchLatestMarketLogFile(trimmedMarketLogsPath)
        if (cancelled) return
        if (!latest) {
          if (!initialized) {
            initialized = true
            lastSeenKey = ''
          }
          setMarketLogInfo('В папке пока нет .txt файлов market log')
          return
        }
        const key = `${latest.name}|${latest.mtime}|${latest.size}`
        if (!initialized) {
          initialized = true
          lastSeenKey = key
          setMarketLogInfo(`Ожидание новых файлов в папке… Последний: ${latest.name}`)
          return
        }
        if (key === lastSeenKey) return
        const buf = await fetchMarketLogFileBuffer(trimmedMarketLogsPath, latest.name)
        if (cancelled) return
        const text = decodeMarketLogBuffer(buf)
        const parsed = parseMarketLogText(latest.name, text)
        if (parsed.bestSell === null || parsed.bestBuy === null) {
          setMarketLogRows([])
          setMarketLogInfo(
            `Новый файл найден (${latest.name}), ожидаем завершения записи/разбора...`
          )
          return
        }
        const brokerFee = brokerFeePct / 100
        const salesTax = salesTaxPct / 100
        const cost = parsed.bestBuy * (1 + brokerFee)
        const revenue = parsed.bestSell * (1 - salesTax - brokerFee)
        const profitIsk = revenue - cost
        const margin =
          parsed.bestSell > 0 && Number.isFinite(parsed.bestSell)
            ? profitIsk / parsed.bestSell
            : null
        const exportTime = parseExportTime(latest.birthtime, latest.mtime)
        const summaryRows: MarketLogSummaryRow[] = [
          {
            name: parsed.itemName,
            margin: Number.isFinite(margin) ? margin : null,
            profitIsk: Number.isFinite(profitIsk) ? profitIsk : null,
            exportTime,
            price: parsed.bestSell,
            typeId: parsed.typeId,
          },
        ]
        lastSeenKey = key
        setMarketLogRows(summaryRows)
        setMarketLogInfo(`Новый файл обработан: ${latest.name}`)
      } catch (e) {
        if (cancelled) return
        setMarketLogRows([])
        setMarketLogInfo(e instanceof Error ? e.message : 'Ошибка чтения папки market logs')
      } finally {
        pollingBusy = false
      }
    }

    void poll()
    const streamUrl = marketLogsStreamUrl(trimmedMarketLogsPath)
    let source: EventSource | null = null
    try {
      source = new EventSource(streamUrl)
      source.onmessage = () => void poll()
      source.addEventListener('marketlog', () => void poll())
    } catch {
      source = null
    }
    // Редкий fallback на случай потери SSE или сетевых сбоев.
    const id = window.setInterval(() => void poll(), 5000)
    return () => {
      cancelled = true
      if (source) source.close()
      clearInterval(id)
    }
  }, [
    marketExportLogsEnabled,
    trimmedMarketLogsPath,
    brokerFeePct,
    salesTaxPct,
    highPriceThresholdIsk,
  ])

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
    setEsiStopRequestKind(null)
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
    const mp = parseInt(esiMaxPagesStr.trim(), 10)
    const maxOrderPages =
      Number.isFinite(mp) && mp >= 1
        ? Math.min(ESI_MAX_ORDER_PAGES_USER_CAP, Math.floor(mp))
        : 90
    const mt = parseInt(esiMaxTypesStr.trim(), 10)
    const maxTypes =
      Number.isFinite(mt) && mt >= 1
        ? Math.min(ESI_MAX_TYPES_USER_CAP, Math.floor(mt))
        : ESI_DEFAULT_MAX_TYPES
    try {
      const result = await buildEsiLiquidityToExports({
        regionId: selected.esiRegionId,
        orderPagesUntilExhausted: false,
        maxTypes,
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
      setEsiStopRequestKind(null)
      setEsiSessionStartedAt(null)
      setEsiTypesPhaseAt(null)
      setLoading(false)
    }
  }

  const requestSoftStop = async () => {
    if (esiStopRequestKind !== null) return
    try {
      setEsiStopRequestKind('soft')
      await postEsiExportStop()
      setMsg('Остановка запрошена: после текущего запроса ESI будет собран xlsx.')
    } catch (e) {
      setEsiStopRequestKind(null)
      setMsg(e instanceof Error ? e.message : 'Ошибка стоп')
    }
  }

  const requestForceStop = async () => {
    if (esiStopRequestKind !== null) return
    try {
      setEsiStopRequestKind('force')
      await postEsiExportForceStop()
      setMsg('Принудительная остановка запрошена: сборка будет прервана без xlsx.')
    } catch (e) {
      setEsiStopRequestKind(null)
      setMsg(e instanceof Error ? e.message : 'Ошибка stop-force')
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
      {!hideReadyExportsSection && (
        <section>
          <h3 className="eve-section-title mb-2">
            Готовые выгрузки по региону
          </h3>
          <p className="mb-3 text-[11px] leading-relaxed text-eve-muted/90">
            Сервис: ликвидность; в dev файлы пишутся в{' '}
            <code className="rounded bg-eve-bg/80 px-1 text-white">exports/</code>
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
      )}

      {!hideLocalFileOpenSection && (
        <section className="border-t border-eve-border/50 pt-4">
          <h3 className="eve-section-title mb-2">Открыть локальный файл</h3>
          <p className="mb-3 text-[11px] leading-relaxed text-eve-muted/90">
            Файлы из папки{' '}
            <code className="rounded bg-eve-bg/80 px-1 text-white">exports/</code>{' '}
            на диске проекта
          </p>
          {isDevExportServer ? (
            <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
              <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-eve-muted sm:max-w-md">
                <span className="shrink-0">Файл</span>
                <select
                  className="min-w-0 flex-1 rounded border border-eve-border/80 bg-eve-bg/80 py-1.5 pl-2 pr-8 text-xs text-white shadow-eve-inset focus:border-eve-accent/70 focus:outline-none"
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
      )}

      {!hideEsiSection && (
        <div>
          <div className="space-y-2 @[450px]:grid @[450px]:grid-cols-3 @[450px]:gap-2 @[450px]:space-y-0">
            <label className="flex flex-col gap-1 text-xs text-eve-muted">
              <span>Регион ESI</span>
              <select
                className="w-full rounded border border-eve-border/80 bg-eve-bg/80 py-1.5 pl-2 pr-8 text-xs text-white shadow-eve-inset focus:border-eve-accent/70 focus:outline-none"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                disabled={disabled || loading}
              >
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-eve-muted">
              <span>Типов</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={ESI_MAX_TYPES_USER_CAP}
                value={esiMaxTypesStr}
                onChange={(e) => setEsiMaxTypesStr(e.target.value)}
                disabled={disabled || loading}
                className="w-full rounded border border-eve-border/80 bg-eve-bg/80 px-2 py-1.5 text-xs tabular-nums text-white shadow-eve-inset [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-eve-accent/70 focus:outline-none"
                title={`Сколько типов попадёт в таблицу (1–${ESI_MAX_TYPES_USER_CAP}).`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-eve-muted">
              <span>Страниц</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={ESI_MAX_ORDER_PAGES_USER_CAP}
                value={esiMaxPagesStr}
                onChange={(e) => setEsiMaxPagesStr(e.target.value)}
                disabled={disabled || loading}
                className="w-full rounded border border-eve-border/80 bg-eve-bg/80 px-2 py-1.5 text-xs tabular-nums text-white shadow-eve-inset [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-eve-accent/70 focus:outline-none"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2 pt-1 @[450px]:col-span-3 @[450px]:justify-end">
              <button
                type="button"
                disabled={disabled || loading || !selected}
                onClick={() => void onEsiBuildSelected()}
                className="inline-flex items-center justify-center gap-1.5 rounded border border-eve-accent/70 bg-eve-accent-muted px-4 py-2 text-xs font-semibold text-eve-accent transition-colors hover:border-eve-accent hover:bg-eve-highlight focus:outline-none focus:ring-2 focus:ring-eve-accent/35 disabled:opacity-50"
              >
                <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Сформировать (ESI)
              </button>
              {loading && esiExporting && (
                <>
                  <button
                    type="button"
                    disabled={esiStopRequestKind !== null}
                    onClick={() => {
                      void requestSoftStop()
                    }}
                    className="inline-flex min-h-[2.5rem] items-center justify-center rounded border border-eve-danger/55 bg-eve-danger/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-eve-danger/95 shadow-eve-inset transition-colors hover:border-eve-danger/80 hover:bg-eve-danger/20 disabled:opacity-60"
                    title="Остановить и собрать xlsx из текущих данных"
                  >
                    {esiStopRequestKind === 'soft' ? 'Останавливаем…' : 'Стоп → xlsx'}
                  </button>
                  <button
                    type="button"
                    disabled={esiStopRequestKind !== null}
                    onClick={() => {
                      void requestForceStop()
                    }}
                    className="inline-flex min-h-[2.5rem] items-center justify-center rounded border border-eve-danger/75 bg-eve-danger/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-eve-danger shadow-eve-inset transition-colors hover:border-eve-danger hover:bg-eve-danger/30 disabled:opacity-60"
                    title="Остановить без сборки xlsx"
                  >
                    {esiStopRequestKind === 'force' ? 'Останавливаем…' : 'Стоп → принудительно'}
                  </button>
                </>
              )}
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
        </div>
      )}

      {!hideMarketLogsSection && (
        <section className="@container rounded border border-eve-border/50 bg-eve-bg/35 p-2.5 shadow-eve-inset">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h3 className="eve-section-title">Market export logs</h3>
          <label className="inline-flex items-center gap-2 text-xs text-eve-muted/95">
            <button
              type="button"
              role="switch"
              aria-checked={marketExportLogsEnabled}
              aria-label="Включить обработку market export logs"
              onClick={() => setMarketExportLogsEnabled((v) => !v)}
              className={`relative inline-flex h-5 w-9 items-center rounded-md border shadow-eve-inset transition-all duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-eve-accent/45 ${
                marketExportLogsEnabled
                  ? 'border-eve-accent/75 bg-eve-accent-muted text-eve-accent'
                  : 'border-eve-border/80 bg-eve-bg/80 text-eve-muted/90'
              }`}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-eve-accent/45 to-transparent"
              />
              <span
                className={`relative z-[1] inline-block h-3.5 w-3.5 transform rounded-sm border transition-transform duration-200 ease-out ${
                  marketExportLogsEnabled
                    ? 'translate-x-[1.125rem] border-eve-accent/80 bg-eve-accent shadow-[0_0_0_1px_rgba(184,150,61,0.25),0_1px_2px_rgba(0,0,0,0.35)]'
                    : 'translate-x-1 border-eve-border/90 bg-eve-elevated shadow-[0_1px_2px_rgba(0,0,0,0.35)]'
                }`}
              />
            </button>
          </label>
        </div>
        <div
          className={`space-y-2 transition-opacity ${
            marketExportLogsEnabled
              ? 'opacity-100'
              : 'pointer-events-none select-none opacity-45 saturate-50'
          }`}
          aria-disabled={!marketExportLogsEnabled}
        >
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-white">
          <div className="flex flex-wrap items-center gap-1.5 pr-3">
            <span className="italic text-eve-muted">Broker fee:</span>
            <input
              ref={setBrokerInput}
              type="number"
              min={0}
              max={100}
              step={0.01}
              className="w-20 min-w-0 rounded border border-eve-border/80 bg-eve-bg/80 px-1 py-0.5 text-xs tabular-nums text-white shadow-eve-inset placeholder:text-eve-muted/60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-eve-accent/70 focus:outline-none"
              value={brokerFeePct}
              onChange={(e) => {
                const n = Number(e.target.value.replace(',', '.'))
                if (!Number.isFinite(n) || n < 0 || n > 100) return
                onBrokerFeeChange(n)
              }}
              aria-label="Broker fee, процент"
              disabled={disabled || !marketExportLogsEnabled}
            />
            <span className="tabular-nums text-eve-muted">%</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-0 sm:mt-0 sm:pl-3">
            <span className="italic text-eve-muted">Sales tax:</span>
            <input
              ref={setTaxInput}
              type="number"
              min={0}
              max={100}
              step={0.01}
              className="w-20 min-w-0 rounded border border-eve-border/80 bg-eve-bg/80 px-1 py-0.5 text-xs tabular-nums text-white shadow-eve-inset placeholder:text-eve-muted/60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-eve-accent/70 focus:outline-none"
              value={salesTaxPct}
              onChange={(e) => {
                const n = Number(e.target.value.replace(',', '.'))
                if (!Number.isFinite(n) || n < 0 || n > 100) return
                onSalesTaxChange(n)
              }}
              aria-label="Sales tax, процент"
              disabled={disabled || !marketExportLogsEnabled}
            />
            <span className="tabular-nums text-eve-muted">%</span>
          </div>
        </div>
        <label className="mb-2 flex w-full items-center gap-2 text-xs text-eve-muted/95">
          <span className="shrink-0">Путь к папке market logs</span>
          <input
            type="text"
            value={marketLogsPath}
            onChange={(e) => setMarketLogsPath(e.target.value)}
            placeholder="Например: B:\\Documents\\EVE\\logs\\marketlogs"
            className="min-w-0 flex-1 rounded border border-eve-border/80 bg-eve-bg/90 px-2 py-1.5 text-xs text-eve-bright shadow-eve-inset focus:border-eve-accent/70 focus:outline-none"
            disabled={disabled || !isDevExportServer || !marketExportLogsEnabled}
          />
        </label>
        <p className="mb-2 text-[11px] text-eve-muted/85">{marketLogInfo}</p>
        <div className="space-y-2">
          {(marketLogRows.length > 0
            ? marketLogRows
            : [
                {
                  name: '',
                  margin: null,
                  profitIsk: null,
                  exportTime: '',
                  price: 0,
                  typeId: null,
                } as MarketLogSummaryRow,
              ]
          ).map((r, idx) => {
            const style = marginPercentCellStyle(
              r.margin,
              r.price,
              highPriceThresholdIsk
            )
            return (
              <article
                key={`${r.name || 'empty'}-${idx}`}
                className="rounded border border-eve-border/40 bg-eve-bg/40 p-2 shadow-eve-inset"
              >
                <div className="grid grid-cols-1 gap-2 text-xs @[450px]:grid-cols-4">
                  <div className="rounded border border-eve-border/30 bg-eve-elevated/35 px-2 py-1.5">
                    <p className="mb-0.5 text-[10px] uppercase tracking-wide text-eve-gold">
                      Item name
                    </p>
                    {r.name ? (
                      r.typeId ? (
                        <a
                          href={`${EVE_TYCOON_MARKET_URL}${r.typeId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-eve-bright/95 underline decoration-transparent underline-offset-2 transition-colors hover:text-eve-gold-bright hover:decoration-current"
                          title={`Открыть в EVE Tycoon: type ${r.typeId}`}
                        >
                          {r.name}
                        </a>
                      ) : (
                        <p className="text-eve-bright/95">{r.name}</p>
                      )
                    ) : (
                      <p className="text-eve-bright/95">—</p>
                    )}
                  </div>
                  <div className="rounded border border-eve-border/30 bg-eve-elevated/35 px-2 py-1.5">
                    <p className="mb-0.5 text-[10px] uppercase tracking-wide text-eve-gold">
                      Profit margin
                    </p>
                    <span
                      className="inline-block rounded px-1.5 py-0.5 font-tabular-nums"
                      style={style}
                    >
                      {r.margin === null ? '—' : formatPercent(r.margin)}
                    </span>
                  </div>
                  <div className="rounded border border-eve-border/30 bg-eve-elevated/35 px-2 py-1.5">
                    <p className="mb-0.5 text-[10px] uppercase tracking-wide text-eve-gold">
                      Profit, ISK
                    </p>
                    <p className="font-tabular-nums text-eve-bright/90">
                      {r.profitIsk === null ? '—' : formatIsk(r.profitIsk)}
                    </p>
                  </div>
                  <div className="rounded border border-eve-border/30 bg-eve-elevated/35 px-2 py-1.5">
                    <p className="mb-0.5 text-[10px] uppercase tracking-wide text-eve-gold">
                      Время экспорта
                    </p>
                    <p className="text-eve-muted/95">{r.exportTime || '—'}</p>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
        </div>
        </section>
      )}

      {!isDevExportServer && (
        <p className="text-[11px] leading-relaxed text-eve-muted/80">
          Запись в <code>exports/</code> и ESI — только в режиме{' '}
          <code className="text-white">npm run dev</code>. Ссылки скачивания откроются в
          браузере.
        </p>
      )}
    </div>
  )
}
