import { useCallback, useEffect, useMemo, useState } from 'react'
import { Globe } from 'lucide-react'
import { FileDropzone } from './FileDropzone'
import { MarketLogTxtDropzone } from './MarketLogTxtDropzone'
import { EXPORT_REGIONS } from '../lib/exportRegions'
import {
  buildEsiLiquidityToExports,
  fetchLatestMarketLogFile,
  fetchMarketLogFileBuffer,
  marketLogsStreamUrl,
  fetchEsiDevLogs,
  isDevExportServer,
  postEsiExportForceStop,
  postEsiExportStop,
} from '../lib/devExportApi'
import { downloadXlsxBytes } from '../lib/downloadXlsx'
import { putCachedExportWorkbook } from '../lib/exportWorkbookCache'
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

const LS_LAST_EXPORT_FILE = 'excelMarket_lastExportFileName'
const LS_ESI_INCLUDE_ORDER_SNAPSHOT = 'excelMarket_esiIncludeOrderSnapshot'
const LS_ESI_TRADE_HUB_ONLY = 'excelMarket_esiTradeHubOnly'
const LS_ESI_HISTORY_DAYS = 'excelMarket_esiHistoryDays'
const LS_ENABLE_MARKET_EXPORT_LOGS = 'excelMarket_enableMarketExportLogs'

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

function readEsiIncludeOrderSnapshot(): boolean {
  try {
    return localStorage.getItem(LS_ESI_INCLUDE_ORDER_SNAPSHOT) === '1'
  } catch {
    return false
  }
}

function readEsiTradeHubOnly(): boolean {
  try {
    return localStorage.getItem(LS_ESI_TRADE_HUB_ONLY) === '1'
  } catch {
    return false
  }
}

function readEsiHistoryDays(): 2 | 7 | 30 {
  try {
    const v = localStorage.getItem(LS_ESI_HISTORY_DAYS)
    if (v === '2') return 2
    if (v === '7') return 7
  } catch {
    /* ignore */
  }
  return 30
}

type ExportBarProps = Readonly<{
  onLoadBuffer: (buf: ArrayBuffer) => void | Promise<void>
  onOpenedExportFile?: (fileName: string) => void
  disabled?: boolean
  hideLocalFileOpenSection?: boolean
  hideEsiSection?: boolean
  hideMarketLogsSection?: boolean
  /** Карточку ESI рисует родитель (TradingView) — без второй рамки `eve-panel`. */
  hideEsiOuterCard?: boolean
  /** Карточку локального Excel рисует родитель — без второй рамки и заголовка. */
  hideLocalOuterCard?: boolean
  brokerFeePct: number
  salesTaxPct: number
  highPriceThresholdIsk: number
  marketLogsPath: string
  onMessageChange?: (message: string | null) => void
}>

type MarketLogSummaryRow = {
  name: string
  margin: number | null
  profitIsk: number | null
  exportTime: string
  price: number
  typeId: number | null
}

const LS_MARKETLOGS_PATH = 'excelMarket_marketLogsPath'

export function readMarketLogsPath(): string {
  try {
    return localStorage.getItem(LS_MARKETLOGS_PATH) ?? ''
  } catch {
    return ''
  }
}

export function persistMarketLogsPath(path: string): void {
  try {
    const trimmed = path.trim()
    if (trimmed) localStorage.setItem(LS_MARKETLOGS_PATH, trimmed)
    else localStorage.removeItem(LS_MARKETLOGS_PATH)
  } catch {
    /* ignore */
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

function formatMarketLogTimeNowRu(): string {
  return new Date().toLocaleString('ru-RU', {
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
  const headerLineRaw = lines[0]
  if (headerLineRaw == null) {
    return {
      itemName: parseItemNameFromMarketLogFile(fileName),
      bestSell: null,
      bestBuy: null,
      typeId: null,
    }
  }
  const headerLine = headerLineRaw.replace(/^\uFEFF/, '')
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
    const lineRow = lines[i]
    if (lineRow == null) continue
    const cols = lineRow.split(delimiter)
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
    } else if (bestSell === null || price < bestSell) {
      bestSell = price
    }
  }
  return { itemName: parseItemNameFromMarketLogFile(fileName), bestSell, bestBuy, typeId }
}

function buildMarketLogSummary(
  fileName: string,
  buf: ArrayBuffer,
  brokerFeePct: number,
  salesTaxPct: number,
  timeMode: 'disk' | 'local',
  diskTimes?: { birthtime?: string; mtime?: string }
): { rows: MarketLogSummaryRow[]; info: string } {
  const text = decodeMarketLogBuffer(buf)
  const parsed = parseMarketLogText(fileName, text)
  if (parsed.bestSell === null || parsed.bestBuy === null) {
    return {
      rows: [],
      info:
        timeMode === 'disk'
          ? `Новый файл (${fileName}): bid/ask ещё неполные — дождитесь завершения экспорта в EVE.`
          : 'Нет полных данных bid/ask (файл пустой, ещё пишется или не формат market export).',
    }
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
  const exportTime =
    timeMode === 'local'
      ? formatMarketLogTimeNowRu()
      : parseExportTime(diskTimes?.birthtime, diskTimes?.mtime)
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
  return {
    rows: summaryRows,
    info:
      timeMode === 'disk'
        ? `Новый файл обработан: ${fileName}`
        : `Обработан: ${fileName}`,
  }
}

function ToggleSwitch(
  { checked, label, disabled, onClick }: Readonly<{
    checked: boolean
    label: string
    disabled?: boolean
    onClick: () => void
  }>
): JSX.Element
{
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ checked }
      aria-label={ label }
      onClick={ onClick }
      disabled={ disabled }
      className={ `relative h-5 w-9 shrink-0 rounded-md border p-0.5 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 disabled:opacity-50 ${
        checked
          ? 'border-eve-accent/75 bg-eve-accent-muted'
          : 'border-eve-border/70 bg-eve-surface/40'
      }` }
    >
      <span
        aria-hidden
        className={ `pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-sm border shadow-[0_1px_2px_rgba(0,0,0,0.35)] transition-[left] duration-200 ease-out ${
          checked
            ? 'left-[18px] border-eve-accent/80 bg-eve-accent'
            : 'left-0.5 border-eve-border/80 bg-eve-elevated'
        }` }
      />
    </button>
  )
}

export function ExportBar({
  onLoadBuffer,
  onOpenedExportFile,
  disabled,
  hideLocalFileOpenSection = false,
  hideEsiSection = false,
  hideMarketLogsSection = false,
  hideEsiOuterCard = false,
  hideLocalOuterCard = false,
  brokerFeePct,
  salesTaxPct,
  highPriceThresholdIsk,
  marketLogsPath,
  onMessageChange,
}: ExportBarProps) {
  const regions = EXPORT_REGIONS
  const [selectedId, setSelectedId] = useState(() => {
    const id = readLastExportRegionId()
    return regions.some((r) => r.id === id) ? id : (regions[0]?.id ?? '')
  })
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [esiIncludeOrderSnapshot, setEsiIncludeOrderSnapshot] = useState(
    readEsiIncludeOrderSnapshot
  )
  const [esiTradeHubOnly, setEsiTradeHubOnly] = useState(readEsiTradeHubOnly)
  const [esiHistoryDays, setEsiHistoryDays] = useState<2 | 7 | 30>(readEsiHistoryDays)
  const [esiProgress, setEsiProgress] = useState<EsiExportProgressState>(() => ({
    ...ESI_EXPORT_PROGRESS_IDLE,
  }))
  const [esiExporting, setEsiExporting] = useState(false)
  const [esiStopRequestKind, setEsiStopRequestKind] = useState<'soft' | 'force' | null>(null)
  const [esiSessionStartedAt, setEsiSessionStartedAt] = useState<number | null>(null)
  const [esiTypesPhaseAt, setEsiTypesPhaseAt] = useState<number | null>(null)
  const [esiTimerTick, setEsiTimerTick] = useState(0)
  const [marketExportLogsEnabled, setMarketExportLogsEnabled] = useState(
    readEnableMarketExportLogs
  )
  const [marketLogRows, setMarketLogRows] = useState<MarketLogSummaryRow[]>([])
  const [marketLogInfo, setMarketLogInfo] = useState(() =>
    isDevExportServer
      ? 'Папка не выбрана'
      : 'Перетащите .txt или нажмите «Выбрать .txt».'
  )
  const [pickedExcelName, setPickedExcelName] = useState<string | null>(null)

  useEffect(() => {
    onMessageChange?.(msg)
  }, [msg, onMessageChange])

  const selected = regions.find((r) => r.id === selectedId) ?? regions[0]
  const trimmedMarketLogsPath = marketLogsPath.trim()
  const selectedHubName = selected?.tradeHubName ?? 'торгового хаба выбранного региона'

  useEffect(() => {
    if (!esiExporting) return
    const id = globalThis.setInterval(() => {
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
    if (esiSessionStartedAt == null) return 0
    return (Date.now() - esiSessionStartedAt) / 1000
  }, [esiTimerTick, esiSessionStartedAt])

  const esiTypesPhaseElapsedSec = useMemo(() => {
    if (esiTypesPhaseAt == null) return null
    return (Date.now() - esiTypesPhaseAt) / 1000
  }, [esiTimerTick, esiTypesPhaseAt])

  useEffect(() => {
    try {
      if (selectedId) {
        localStorage.setItem(LS_LAST_EXPORT_REGION_ID, selectedId)
        globalThis.dispatchEvent(
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
    try {
      localStorage.setItem(
        LS_ESI_INCLUDE_ORDER_SNAPSHOT,
        esiIncludeOrderSnapshot ? '1' : '0'
      )
    } catch {
      /* ignore */
    }
  }, [esiIncludeOrderSnapshot])

  useEffect(() => {
    try {
      localStorage.setItem(
        LS_ESI_TRADE_HUB_ONLY,
        esiTradeHubOnly ? '1' : '0'
      )
    } catch {
      /* ignore */
    }
  }, [esiTradeHubOnly])

  useEffect(() => {
    try {
      localStorage.setItem(LS_ESI_HISTORY_DAYS, String(esiHistoryDays))
    } catch {
      /* ignore */
    }
  }, [esiHistoryDays])

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
    if (hideMarketLogsSection || !isDevExportServer) return
    if (!marketExportLogsEnabled) {
      setMarketLogInfo('Обработка market logs отключена')
      return
    }
    if (!trimmedMarketLogsPath) {
      setMarketLogRows([])
      setMarketLogInfo('Укажите путь к папке market logs в настройках')
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
        }
        if (key === lastSeenKey) return
        const buf = await fetchMarketLogFileBuffer(trimmedMarketLogsPath, latest.name)
        if (cancelled) return
        const { rows, info } = buildMarketLogSummary(
          latest.name,
          buf,
          brokerFeePct,
          salesTaxPct,
          'disk',
          { birthtime: latest.birthtime, mtime: latest.mtime }
        )
        setMarketLogRows(rows)
        setMarketLogInfo(info)
        if (rows.length > 0) {
          lastSeenKey = key
        }
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
    return () => {
      cancelled = true
      if (source) source.close()
    }
  }, [hideMarketLogsSection, marketExportLogsEnabled, trimmedMarketLogsPath, brokerFeePct, salesTaxPct])

  const onMarketLogTxtFile = useCallback(
    async (file: File) => {
      if (!marketExportLogsEnabled) return
      try {
        const buf = await file.arrayBuffer()
        const { rows, info } = buildMarketLogSummary(
          file.name,
          buf,
          brokerFeePct,
          salesTaxPct,
          'local'
        )
        setMarketLogRows(rows)
        setMarketLogInfo(info)
      } catch (e) {
        setMarketLogRows([])
        setMarketLogInfo(e instanceof Error ? e.message : 'Ошибка чтения файла')
      }
    },
    [marketExportLogsEnabled, brokerFeePct, salesTaxPct]
  )

  const onEsiBuildSelected = async () => {
    if (!selected) return
    setMsg(null)
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
    const logPoll = globalThis.setInterval(() => void flushEsiLogsToConsole(), 500)
    const logKick = globalThis.setTimeout(() => void flushEsiLogsToConsole(), 100)
    try {
      const result = await buildEsiLiquidityToExports({
        regionId: selected.esiRegionId,
        historyDays: esiHistoryDays,
        includeOrderSnapshot: esiIncludeOrderSnapshot,
        tradeHubOnly: esiTradeHubOnly,
        tradeHubLocationId: selected.tradeHubLocationId,
      })
      const u8 = result.buffer
      const tableAb = u8.buffer.slice(
        u8.byteOffset,
        u8.byteOffset + u8.byteLength
      ) as ArrayBuffer
      let cachedInBrowser = false
      let cacheError: string | null = null
      try {
        await putCachedExportWorkbook(result.fileName, tableAb)
        cachedInBrowser = true
      } catch (cacheErr) {
        cacheError =
          cacheErr instanceof Error
            ? cacheErr.message
            : 'Не удалось записать файл в кеш браузера.'
      }
      await onLoadBuffer(tableAb)
      downloadXlsxBytes(result.buffer, result.fileName)
      const cacheNote = cachedInBrowser
        ? ', сохранён в кеш браузера'
        : `. ${cacheError ?? 'В кеш браузера записать не удалось'}`
      setMsg(
        `ESI: ${result.rowCount} позиций → «${result.fileName}» скачан и открыт в таблице${
          result.partial ? ' (частично, принудительный стоп)' : ''
        }${cacheNote}`
      )
      onOpenedExportFile?.(result.fileName)
      try {
        localStorage.setItem(LS_LAST_EXPORT_FILE, result.fileName)
      } catch {
        /* ignore */
      }
    } catch (e) {
      if (e instanceof Error && /ESI:\s*stop-force/i.test(e.message)) {
        setMsg('Принудительная остановка выполнена: выгрузка прервана без сборки xlsx.')
      } else {
        setMsg(e instanceof Error ? e.message : 'Ошибка ESI')
      }
    } finally {
      globalThis.clearInterval(logPoll)
      globalThis.clearTimeout(logKick)
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

  const onLocalExcelFile = useCallback(
    async (file: File) => {
      setPickedExcelName(file.name)
      const buf = await file.arrayBuffer()
      try {
        await putCachedExportWorkbook(file.name, buf)
        onOpenedExportFile?.(file.name)
        setMsg(`В кеше браузера: ${file.name}`)
      } catch (e) {
        setMsg(
          e instanceof Error ? e.message : 'Не удалось записать файл в кеш браузера.'
        )
      }
      await onLoadBuffer(buf)
    },
    [onLoadBuffer, onOpenedExportFile]
  )

  return (
    <>
      {!hideLocalFileOpenSection && (
        <section className={ hideLocalOuterCard ? '@container contents' : '@container eve-panel p-2.5' }>
          { !hideLocalOuterCard && (
            <h3 className="eve-section-title mb-2">Локальный Excel</h3>
          ) }
          <p className="mb-2 text-[11px] leading-relaxed text-eve-muted/90">
            Перетащите файл сюда или нажмите «Выбрать .xlsx». Файл останется в кеше браузера — его можно снова открыть в списке выгрузок.
          </p>
          <FileDropzone
            onFile={(f) => void onLocalExcelFile(f)}
            disabled={disabled || loading}
            fileName={pickedExcelName}
          />
        </section>
      )}

      {!hideEsiSection && (
        <section
          className={
            hideEsiOuterCard ? 'contents' : '@container eve-panel p-2.5'
          }
        >
          <div className="space-y-2 @[450px]:grid @[450px]:grid-cols-3 @[450px]:gap-2 @[450px]:space-y-0">
            <label className="flex flex-col gap-1 text-xs text-eve-muted">
              <span>Регион ESI</span>
              <select
                className="w-full rounded-md border border-eve-border/75 bg-eve-surface/65 py-1.5 pl-2 pr-8 text-xs text-white shadow-glass-subtle focus:border-eve-accent/70 focus:outline-none"
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
              <span>History (дней)</span>
              <select
                className="w-full rounded-md border border-eve-border/75 bg-eve-surface/65 py-1.5 pl-2 pr-8 text-xs text-white shadow-glass-subtle focus:border-eve-accent/70 focus:outline-none"
                value={String(esiHistoryDays)}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === '2') setEsiHistoryDays(2)
                  else if (v === '7') setEsiHistoryDays(7)
                  else setEsiHistoryDays(30)
                }}
                disabled={disabled || loading}
              >
                <option value="30">30</option>
                <option value="7">7</option>
                <option value="2">2</option>
              </select>
            </label>
            <div className="@[450px]:col-span-3 glass-subtle flex items-center justify-between gap-3 px-2 py-1.5 text-xs">
              <div className="min-w-0">
                <p className="font-semibold text-eve-bright/95">
                  Выгрузить актуальные ордера
                </p>
                <p className="text-[10px] text-eve-muted/90">
                  Добавляет top-of-book snapshot и лист orders_snapshot
                </p>
              </div>
              <ToggleSwitch
                checked={ esiIncludeOrderSnapshot }
                label="Выгружать актуальные ордера в snapshot"
                disabled={ disabled || loading }
                onClick={ () => setEsiIncludeOrderSnapshot((v) => !v) }
              />
            </div>
            <div className="@[450px]:col-span-3 glass-subtle flex items-center justify-between gap-3 px-2 py-1.5 text-xs">
              <div className="min-w-0">
                <p className="font-semibold text-eve-bright/95">
                  Выгрузить только торговый хаб
                </p>
                <p className="text-[10px] text-eve-muted/90">
                  {`Фильтр по ${selectedHubName}`}
                </p>
              </div>
              <ToggleSwitch
                checked={ esiTradeHubOnly }
                label="Выгружать только ордера торгового хаба"
                disabled={ disabled || loading }
                onClick={ () => setEsiTradeHubOnly((v) => !v) }
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1 @[450px]:col-span-3 @[450px]:justify-end">
              <button
                type="button"
                disabled={disabled || loading || !selected}
                onClick={() => void onEsiBuildSelected()}
                className="inline-flex items-center justify-center gap-1.5 rounded-md border border-eve-accent/70 bg-eve-accent-muted px-4 py-2 text-xs font-semibold text-eve-accent transition-colors hover:border-eve-accent hover:bg-eve-highlight focus:outline-none focus:ring-2 focus:ring-eve-accent/35 disabled:opacity-50"
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
                includeSnapshotProgress={esiIncludeOrderSnapshot}
              />
            </div>
          )}
        </section>
      )}

      {!hideMarketLogsSection && (
        <section className="@container eve-panel p-2.5">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h3 className="eve-section-title">Market export logs</h3>
          <div className="inline-flex items-center">
            <ToggleSwitch
              checked={ marketExportLogsEnabled }
              label="Включить обработку market export logs"
              onClick={ () => setMarketExportLogsEnabled((v) => !v) }
            />
          </div>
        </div>
        {!marketExportLogsEnabled && (
          <p className="mb-2 text-[11px] text-eve-muted/85">
            Работа с файлами экспортов отключена.
          </p>
        )}
        {marketExportLogsEnabled && (
        <div className="space-y-2">
        {!isDevExportServer && (
          <div className="mb-2">
            <MarketLogTxtDropzone
              onFile={(f) => void onMarketLogTxtFile(f)}
              disabled={disabled}
            />
          </div>
        )}
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
                className="glass-subtle p-2"
              >
                <div className="grid grid-cols-1 gap-2 text-xs @[450px]:grid-cols-4">
                  <div className="glass-subtle px-2 py-1.5">
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
                  <div className="glass-subtle px-2 py-1.5">
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
                  <div className="glass-subtle px-2 py-1.5">
                    <p className="mb-0.5 text-[10px] uppercase tracking-wide text-eve-gold">
                      Profit, ISK
                    </p>
                    <p className="font-tabular-nums text-eve-bright/90">
                      {r.profitIsk === null ? '—' : formatIsk(r.profitIsk)}
                    </p>
                  </div>
                  <div className="glass-subtle px-2 py-1.5">
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
        )}
        </section>
      )}
    </>
  )
}
