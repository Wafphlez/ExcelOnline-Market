import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInputWheelNudge } from '../hooks/useInputWheelNudge'
import type { ColumnFiltersState } from '@tanstack/react-table'
import { ArrowLeftRight, FolderOpen, RefreshCw, Trash2 } from 'lucide-react'
import { ExportBar } from '../components/ExportBar'
import { MarketTable } from '../components/MarketTable'
import { computeAllMetrics } from '../lib/computeMetrics'
import { computeEntryScore } from '../lib/entryScore'
import { DEFAULT_HIGH_PRICE_THRESHOLD_ISK } from '../lib/pricePenalty'
import { formatInteger } from '../lib/formatNumber'
import { mapRawRows } from '../lib/mapColumns'
import { parseMarketWorkbook } from '../lib/parseExcel'
import
  {
    loadFiltersFromDevFile,
    readInitialStateFromLocalStorage,
    saveFiltersToDevFile,
    writeFiltersToLocalStorage,
  } from '../lib/filterPersistence'
import
  {
    applyAllPresets,
    applyPreset,
    clearFilters,
    PRESET_ALL_ID,
    PRESETS,
  } from '../lib/presets'
import
  {
    getExportRegionLabel,
    LAST_EXPORT_REGION_EVENT,
    LS_LAST_EXPORT_REGION_ID,
    readLastExportRegionId,
    type LastExportRegionDetail,
  } from '../lib/lastExportRegionStorage'
import
  {
    deleteCachedExportWorkbook,
    EXPORT_CACHE_CLEARED_EVENT,
    getCachedExportWorkbook,
    listCachedExportWorkbooks,
    type ExportCacheMeta,
  } from '../lib/exportWorkbookCache'
import { EXPORT_REGIONS } from '../lib/exportRegions'
import
  {
    ESI_TRADE_HUB_SHORT_FILE_TOKEN,
    toSafeFileToken,
  } from '../lib/esiExportFileName'
import type { MarketRow } from '../types/market'

const LS_PRICE_MLN = 'excelMarket_highPriceMln'
const LS_LAST_EXPORT_FILE = 'excelMarket_lastExportFileName'
const LS_TRADING_LEFT_PANEL_WIDTH_PX = 'excelMarket_tradingLeftPanelWidthPx'
function detectRegionLabelFromExportFileName(fileName: string): string {
  const byReady = EXPORT_REGIONS.find((r) => r.fileName === fileName)
  if (byReady) return byReady.label
  for (const r of EXPORT_REGIONS) {
    const hubTok = ESI_TRADE_HUB_SHORT_FILE_TOKEN[r.esiRegionId]
    if (hubTok && fileName.startsWith(`eon-market-${hubTok}-`)) {
      return r.label
    }
  }
  const mEon = /eon-market-(\d+)-/i.exec(fileName)
  if (mEon) {
    const rid = Number(mEon[1])
    const byEsiId = EXPORT_REGIONS.find((r) => r.esiRegionId === rid)
    if (byEsiId) return byEsiId.label
    return `Region ${rid}`
  }
  for (const r of EXPORT_REGIONS) {
    const pref = `eon-market-${toSafeFileToken(r.label)}-`
    if (fileName.startsWith(pref)) return r.label
  }
  const mLegacy = /liquidity-esi-(\d+)-/i.exec(fileName)
  if (mLegacy) {
    const rid = Number(mLegacy[1])
    const byEsiId = EXPORT_REGIONS.find((r) => r.esiRegionId === rid)
    if (byEsiId) return byEsiId.label
    return `Region ${rid}`
  }
  for (const r of EXPORT_REGIONS) {
    const pref = `liquidity-esi-${toSafeFileToken(r.label)}-`
    if (fileName.startsWith(pref)) return r.label
  }
  return fileName
    .replace(/\.(xlsx|xls)$/i, '')
    .replace(/^(eon-market|liquidity-esi)-/i, '')
}

function marketRowJoinKey(row: MarketRow): string {
  if (
    row.typeId !== null &&
    Number.isFinite(row.typeId) &&
    row.typeId > 0
  ) {
    return `id:${Math.floor(row.typeId)}`
  }
  return `name:${row.name.trim().toLowerCase()}`
}

function buildCrossRegionRows(
  leftRows: MarketRow[],
  rightRows: MarketRow[]
): MarketRow[] {
  const rightByKey = new Map<string, MarketRow>()
  for (const r of rightRows) {
    const k = marketRowJoinKey(r)
    if (!rightByKey.has(k)) rightByKey.set(k, r)
  }
  const out: MarketRow[] = []
  for (const l of leftRows) {
    const k = marketRowJoinKey(l)
    const r = rightByKey.get(k)
    if (!r) continue
    if (!Number.isFinite(l.priceSell) || l.priceSell <= 0) continue
    if (!Number.isFinite(r.priceSell) || r.priceSell <= 0) continue
    out.push({
      typeId: l.typeId ?? r.typeId ?? null,
      type: l.type || r.type || '',
      name: l.name || r.name,
      // Ликвидность и «средняя» берём по целевому рынку (регион 2, куда продаём).
      dayVolume: r.dayVolume,
      dayTurnover: r.dayTurnover,
      packagedVolume: r.packagedVolume ?? l.packagedVolume ?? null,
      price: r.price,
      // Для межрегионального сравнения: обе стороны — sell из выбранных регионов.
      priceSell: l.priceSell,
      priceBuy: r.priceSell,
      margin: null,
      buyToSellRatio: null,
      spreadIsk: null,
      entryScore: null,
    })
  }
  return out
}

function computeCrossRegionMetrics(
  rows: MarketRow[],
  options: {
    highPriceThresholdIsk: number
    brokerFee: number
    salesTax: number
  }
): MarketRow[] {
  const { brokerFee, salesTax, highPriceThresholdIsk } = options
  return rows.map((r) => {
    const sourceSell = r.priceSell
    const targetSell = r.priceBuy
    let margin: number | null = null
    if (targetSell !== 0 && Number.isFinite(targetSell)) {
      const cost = sourceSell * (1 + brokerFee)
      const revenue = targetSell * (1 - salesTax - brokerFee)
      const m = (revenue - cost) / targetSell
      margin = Number.isFinite(m) ? m : null
    }

    let buyToSellRatio: number | null = null
    const denom = targetSell - sourceSell
    if (Math.abs(denom) > 1e-9) {
      const t = (r.price - sourceSell) / denom
      buyToSellRatio = Number.isFinite(t) ? t : null
    }

    const spreadIsk =
      Number.isFinite(sourceSell) && Number.isFinite(targetSell)
        ? targetSell - sourceSell
        : null

    const withCore: MarketRow = {
      ...r,
      margin,
      buyToSellRatio,
      spreadIsk,
      entryScore: null,
    }

    return {
      ...withCore,
      entryScore: computeEntryScore(withCore, { highPriceThresholdIsk }),
    }
  })
}

function asNumberRange(v: unknown): { min: number | null; max: number | null } | null
{
  if (!v || typeof v !== 'object') return null
  const maybe = v as { min?: unknown; max?: unknown }
  const min = maybe.min === null || typeof maybe.min === 'number' ? (maybe.min ?? null) : null
  const max = maybe.max === null || typeof maybe.max === 'number' ? (maybe.max ?? null) : null
  return { min, max }
}

function presetFilterMatches(
  columnFilters: ColumnFiltersState,
  id: keyof MarketRow,
  expected: unknown
): boolean
{
  const current = columnFilters.find((f) => f.id === id)
  if (!current) return false
  const expectedRange = asNumberRange(expected)
  if (!expectedRange) return Object.is(current.value, expected)
  const currentRange = asNumberRange(current.value)
  if (!currentRange) return false
  if (expectedRange.min !== null && currentRange.min !== expectedRange.min) return false
  if (expectedRange.max !== null && currentRange.max !== expectedRange.max) return false
  return true
}

function getActivePresetIds(columnFilters: ColumnFiltersState): string[]
{
  return PRESETS
    .filter((preset) =>
      preset.buildFilters().every((f) => presetFilterMatches(columnFilters, f.id, f.value))
    )
    .map((preset) => preset.id)
}

function buildFiltersFromPresetIds(ids: Set<string>): ColumnFiltersState
{
  let next: ColumnFiltersState = []
  for (const preset of PRESETS)
  {
    if (ids.has(preset.id))
    {
      next = applyPreset(next, preset)
    }
  }
  return next
}

function readStoredPriceMln(): number
{
  try
  {
    const v = localStorage.getItem(LS_PRICE_MLN)
    if (v === null) return DEFAULT_HIGH_PRICE_THRESHOLD_ISK / 1_000_000
    const n = Number(String(v).replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_HIGH_PRICE_THRESHOLD_ISK / 1_000_000
  } catch
  {
    return DEFAULT_HIGH_PRICE_THRESHOLD_ISK / 1_000_000
  }
}

function readLastExportFileName(): string
{
  try
  {
    const v = localStorage.getItem(LS_LAST_EXPORT_FILE)
    return v ?? ''
  } catch
  {
    return ''
  }
}

function readLeftPanelWidthPx(): number
{
  try
  {
    const v = localStorage.getItem(LS_TRADING_LEFT_PANEL_WIDTH_PX)
    const n = Number(v)
    if (Number.isFinite(n) && n >= 260 && n <= 900) return Math.floor(n)
  } catch
  {
    /* ignore */
  }
  return 360
}

export function TradingView(
  { brokerFeePct, salesTaxPct, marketLogsPath }: Readonly<{
    brokerFeePct: number
    salesTaxPct: number
    marketLogsPath: string
  }>
)
{
  const [fileRows, setFileRows] = useState<MarketRow[] | null>(null)
  const [priceThresholdMln, setPriceThresholdMln] = useState(readStoredPriceMln)
  const [error, setError] = useState<string | null>(null)
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(() =>
    readInitialStateFromLocalStorage().columnFilters
  )
  const [activePreset, setActivePreset] = useState<string | null>(() =>
    readInitialStateFromLocalStorage().activePreset
  )
  const [filtersPersistReady, setFiltersPersistReady] = useState(false)
  const [copiedNameKeys, setCopiedNameKeys] = useState<Set<string>>(
    () => new Set()
  )
  const [priceInputEl, setPriceInputEl] = useState<HTMLInputElement | null>(null)
  const [localExportFiles, setLocalExportFiles] = useState<ExportCacheMeta[]>([])
  const [localExportLoading, setLocalExportLoading] = useState(false)
  const [exportListReady, setExportListReady] = useState(false)
  const [sourceTab, setSourceTab] = useState<'excel' | 'esi'>('esi')
  const [tradeTab, setTradeTab] = useState<'single' | 'cross'>('single')
  const [selectedLocalExportFile, setSelectedLocalExportFile] = useState(
    readLastExportFileName
  )
  const [compareLeftFile, setCompareLeftFile] = useState('')
  const [compareRightFile, setCompareRightFile] = useState('')
  const [compareLeftRowsCache, setCompareLeftRowsCache] = useState<MarketRow[] | null>(null)
  const [compareRightRowsCache, setCompareRightRowsCache] = useState<MarketRow[] | null>(null)
  const [compareAppliedFiles, setCompareAppliedFiles] = useState<{
    leftFile: string
    rightFile: string
  } | null>(null)
  const [isCrossRegionMode, setIsCrossRegionMode] = useState(false)
  const [priceSellHeader, setPriceSellHeader] = useState<string | null>(null)
  const [priceBuyHeader, setPriceBuyHeader] = useState<string | null>(null)
  const [leftPanelWidthPx, setLeftPanelWidthPx] = useState(readLeftPanelWidthPx)
  const splitRootRef = useRef<HTMLDivElement | null>(null)
  const isResizingLeftPanelRef = useRef(false)
  const resizeStartXRef = useRef(0)
  const resizeStartWidthRef = useRef(0)

  const highPriceThresholdIsk = priceThresholdMln * 1_000_000

  useInputWheelNudge(priceInputEl, {
    step: 1,
    bounds: { min: 0.1, max: 1_000_000 },
    getValue: () => priceThresholdMln,
    onNudge: (n) =>
    {
      const v = Math.max(0.1, n)
      setPriceThresholdMln(v)
      try
      {
        localStorage.setItem(LS_PRICE_MLN, String(v))
      } catch
      {
        /* ignore */
      }
    },
  })
  useEffect(() =>
  {
    let cancelled = false
    void (async () =>
    {
      if (import.meta.env.DEV)
      {
        const fromFile = await loadFiltersFromDevFile()
        if (!cancelled && fromFile)
        {
          setColumnFilters(fromFile.columnFilters)
          setActivePreset(fromFile.activePreset)
          writeFiltersToLocalStorage(
            fromFile.columnFilters,
            fromFile.activePreset
          )
        }
      }
      if (!cancelled) setFiltersPersistReady(true)
    })()
    return () =>
    {
      cancelled = true
    }
  }, [])

  useEffect(() =>
  {
    if (!filtersPersistReady) return
    const t = globalThis.setTimeout(() =>
    {
      writeFiltersToLocalStorage(columnFilters, activePreset)
      void saveFiltersToDevFile({
        version: 2,
        columnFilters,
        activePreset,
      })
    }, 400)
    return () => clearTimeout(t)
  }, [columnFilters, activePreset, filtersPersistReady])


  const rows = useMemo((): MarketRow[] | null =>
  {
    if (fileRows === null) return null
    if (fileRows.length === 0) return []
    const metricsOptions = {
      highPriceThresholdIsk,
      brokerFee: brokerFeePct / 100,
      salesTax: salesTaxPct / 100,
    }
    if (isCrossRegionMode) {
      return computeCrossRegionMetrics(fileRows, metricsOptions)
    }
    return computeAllMetrics(fileRows, metricsOptions)
  }, [fileRows, highPriceThresholdIsk, brokerFeePct, salesTaxPct, isCrossRegionMode])
  const tableEmptyMessage = fileRows === null
    ? 'Нет данных: выберите файл для загрузки таблицы.'
    : 'Ни одна строка не подходит под фильтры'

  const localExportFilesSorted = useMemo(() =>
  {
    return [...localExportFiles]
      .filter((f) => /\.(xlsx|xls)$/i.test(f.name))
      .sort((a, b) => b.mtime.localeCompare(a.mtime) || a.name.localeCompare(b.name))
  }, [localExportFiles])
  const exportListEmptyLabel = '— кеш пуст —'
  const compareLeftRegionLabel = useMemo(
    () => (compareLeftFile ? detectRegionLabelFromExportFileName(compareLeftFile) : '—'),
    [compareLeftFile]
  )
  const compareRightRegionLabel = useMemo(
    () => (compareRightFile ? detectRegionLabelFromExportFileName(compareRightFile) : '—'),
    [compareRightFile]
  )

  const [tickerRegionId, setTickerRegionId] = useState(() =>
    readLastExportRegionId()
  )
  useEffect(() =>
  {
    const onCustom = (e: Event) =>
    {
      const id = (e as CustomEvent<LastExportRegionDetail>).detail?.id
      if (id) setTickerRegionId(id)
    }
    const onStorage = (ev: StorageEvent) =>
    {
      if (ev.key === LS_LAST_EXPORT_REGION_ID)
      {
        setTickerRegionId(readLastExportRegionId())
      }
    }
    globalThis.addEventListener(LAST_EXPORT_REGION_EVENT, onCustom)
    globalThis.addEventListener('storage', onStorage)
    return () =>
    {
      globalThis.removeEventListener(LAST_EXPORT_REGION_EVENT, onCustom)
      globalThis.removeEventListener('storage', onStorage)
    }
  }, [])

  const regionTickerUpper = useMemo(
    () => getExportRegionLabel(tickerRegionId).toUpperCase(),
    [tickerRegionId]
  )

  const { tableTicker, tableTitle } = useMemo(() =>
  {
    if (loading)
    {
      return { tableTicker: '…', tableTitle: 'Идёт загрузка или разбор файла' }
    }
    if (fileRows === null)
    {
      return { tableTicker: '—', tableTitle: 'Таблица: файл не загружен' }
    }
    if (fileRows.length === 0)
    {
      return { tableTicker: '0', tableTitle: 'Таблица: 0 строк' }
    }
    return {
      tableTicker: String(fileRows.length),
      tableTitle: `Строк в таблице: ${ fileRows.length }`,
    }
  }, [loading, fileRows])

  const priceMlnForTicker = useMemo(
    () =>
      priceThresholdMln.toLocaleString('ru-RU', {
        maximumFractionDigits: 1,
        minimumFractionDigits: 0,
      }),
    [priceThresholdMln]
  )

  const feeTicker = useMemo(
    () =>
      `${ brokerFeePct.toLocaleString('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 0 }) }%·${ salesTaxPct.toLocaleString('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 0 }) }%`,
    [brokerFeePct, salesTaxPct]
  )

  const activePresetTicker = useMemo(() =>
  {
    if (!activePreset || activePreset === PRESET_ALL_ID) return 'ALL'
    const preset = PRESETS.find((p) => p.id === activePreset)
    return preset?.label.toUpperCase() ?? activePreset.toUpperCase()
  }, [activePreset])

  const filtersTicker = useMemo(() => String(columnFilters.length), [columnFilters.length])
  const activePresetIds = useMemo(() => getActivePresetIds(columnFilters), [columnFilters])
  const activePresetIdsSet = useMemo(() => new Set(activePresetIds), [activePresetIds])
  const isAllPresetsActive = activePresetIds.length === PRESETS.length
  const isNoPresetsActive = activePresetIds.length === 0

  const tickerScreenReader = useMemo(
    () =>
      `Excel Online Market. ${ tableTitle }. Регион ESI: ${ getExportRegionLabel(
        tickerRegionId
      ) }. Порог дорогой единицы больше ${ priceMlnForTicker } млн ISK. Broker ${ brokerFeePct }%, налог ${ salesTaxPct }%. ` +
      `Пресет: ${ activePresetTicker }. Активных фильтров: ${ filtersTicker }.`,
    [
      tableTitle,
      tickerRegionId,
      priceMlnForTicker,
      brokerFeePct,
      salesTaxPct,
      activePresetTicker,
      filtersTicker,
    ]
  )

  const onNameCopied = useCallback((key: string) =>
  {
    setCopiedNameKeys((prev) => new Set([...prev, key]))
  }, [])

  const refreshLocalExportFiles = useCallback(async () =>
  {
    setLocalExportLoading(true)
    try
    {
      const list = await listCachedExportWorkbooks()
      setLocalExportFiles(list)
    } catch
    {
      setLocalExportFiles([])
      setExportMsg('Не удалось прочитать кеш выгрузок в браузере.')
    } finally
    {
      setLocalExportLoading(false)
      setExportListReady(true)
    }
  }, [])

  const readNamedExportBuffer = useCallback(async (fileName: string): Promise<ArrayBuffer> =>
  {
    const buf = await getCachedExportWorkbook(fileName)
    if (!buf)
    {
      throw new Error(
        `«${ fileName }» нет в кеше браузера — импортируйте файл или соберите ESI ещё раз.`
      )
    }
    return buf
  }, [])

  const mapRowsFromBuffer = useCallback((buf: ArrayBuffer): MarketRow[] =>
  {
    const { rows: raw } = parseMarketWorkbook(buf)
    const mapped = mapRawRows(raw)
    if (!mapped.ok)
    {
      throw new Error(
        `Не удалось прочитать строку ${ mapped.rowIndex + 1 }: не хватает колонок (${ mapped.error.column }).`
      )
    }
    return mapped.rows
  }, [])

  const applyCrossRegionComparison = useCallback((
    leftRows: MarketRow[],
    rightRows: MarketRow[],
    leftFile: string,
    rightFile: string
  ) =>
  {
    const merged = buildCrossRegionRows(leftRows, rightRows)
    const fromLabel = detectRegionLabelFromExportFileName(leftFile)
    const toLabel = detectRegionLabelFromExportFileName(rightFile)
    setFileRows(merged)
    setIsCrossRegionMode(true)
    setCopiedNameKeys(new Set())
    setPriceSellHeader(`Sell ${ fromLabel }, ISK`)
    setPriceBuyHeader(`Sell ${ toLabel }, ISK`)
    setExportMsg(
      merged.length > 0
        ? `Сравнение регионов (${ fromLabel } → ${ toLabel }): совпавших позиций ${ merged.length }.`
        : `Сравнение регионов (${ fromLabel } → ${ toLabel }): совпадений не найдено.`
    )
  }, [])

  const loadFromBuffer = useCallback(async (buf: ArrayBuffer) =>
  {
    setError(null)
    setLoading(true)
    try
    {
      const rows = mapRowsFromBuffer(buf)
      setFileRows(rows)
      setIsCrossRegionMode(false)
      setCompareLeftRowsCache(null)
      setCompareRightRowsCache(null)
      setCompareAppliedFiles(null)
      setPriceSellHeader(null)
      setPriceBuyHeader(null)
      setCopiedNameKeys(new Set())
    } catch (e)
    {
      setError(e instanceof Error ? e.message : 'Ошибка чтения файла')
      setFileRows(null)
      setIsCrossRegionMode(false)
      setCopiedNameKeys(new Set())
    } finally
    {
      setLoading(false)
    }
  }, [mapRowsFromBuffer])

  const onApplyCrossRegionFiles = useCallback(async () =>
  {
    if (!compareLeftFile || !compareRightFile) return
    if (compareLeftFile === compareRightFile)
    {
      setExportMsg('Выберите два разных файла для сравнения регионов.')
      return
    }
    setError(null)
    setExportMsg(null)
    setLoading(true)
    try
    {
      const [leftBuf, rightBuf] = await Promise.all([
        readNamedExportBuffer(compareLeftFile),
        readNamedExportBuffer(compareRightFile),
      ])
      const [leftRows, rightRows] = [
        mapRowsFromBuffer(leftBuf),
        mapRowsFromBuffer(rightBuf),
      ]
      setCompareLeftRowsCache(leftRows)
      setCompareRightRowsCache(rightRows)
      setCompareAppliedFiles({
        leftFile: compareLeftFile,
        rightFile: compareRightFile,
      })
      applyCrossRegionComparison(
        leftRows,
        rightRows,
        compareLeftFile,
        compareRightFile
      )
    } catch (e)
    {
      setExportMsg(e instanceof Error ? e.message : 'Ошибка сравнения файлов регионов')
    } finally
    {
      setLoading(false)
    }
  }, [
    compareLeftFile,
    compareRightFile,
    mapRowsFromBuffer,
    applyCrossRegionComparison,
    readNamedExportBuffer,
  ])

  const onSwapCompareFiles = useCallback(() =>
  {
    if (!compareLeftFile || !compareRightFile) return
    const nextLeft = compareRightFile
    const nextRight = compareLeftFile
    setCompareLeftFile(nextLeft)
    setCompareRightFile(nextRight)
    if (
      compareAppliedFiles &&
      compareLeftRowsCache &&
      compareRightRowsCache &&
      compareAppliedFiles.leftFile === compareLeftFile &&
      compareAppliedFiles.rightFile === compareRightFile
    )
    {
      setCompareLeftRowsCache(compareRightRowsCache)
      setCompareRightRowsCache(compareLeftRowsCache)
      setCompareAppliedFiles({
        leftFile: nextLeft,
        rightFile: nextRight,
      })
      applyCrossRegionComparison(
        compareRightRowsCache,
        compareLeftRowsCache,
        nextLeft,
        nextRight
      )
    }
  }, [
    compareLeftFile,
    compareRightFile,
    compareAppliedFiles,
    compareLeftRowsCache,
    compareRightRowsCache,
    applyCrossRegionComparison,
  ])

  const onOpenSelectedLocalExportFile = useCallback(async () =>
  {
    if (!selectedLocalExportFile) return
    setError(null)
    setExportMsg(null)
    try
    {
      const buf = await readNamedExportBuffer(selectedLocalExportFile)
      await loadFromBuffer(buf)
      setExportMsg(`Открыт: ${ selectedLocalExportFile }`)
    } catch (e)
    {
      setExportMsg(e instanceof Error ? e.message : 'Ошибка открытия')
    }
  }, [selectedLocalExportFile, loadFromBuffer, readNamedExportBuffer])

  const onDeleteCachedExportFile = useCallback(async () =>
  {
    if (!selectedLocalExportFile) return
    setExportMsg(null)
    try
    {
      await deleteCachedExportWorkbook(selectedLocalExportFile)
      setExportMsg(`Удалён из кеша: ${ selectedLocalExportFile }`)
      await refreshLocalExportFiles()
    } catch (e)
    {
      setExportMsg(e instanceof Error ? e.message : 'Не удалось удалить файл из кеша')
    }
  }, [selectedLocalExportFile, refreshLocalExportFiles])

  const onExportBarOpenedFile = useCallback((fileName: string) =>
  {
    setSelectedLocalExportFile(fileName)
    void refreshLocalExportFiles()
  }, [refreshLocalExportFiles])

  const onPreset = useCallback((id: string) =>
  {
    setColumnFilters((prev) =>
    {
      const nextIds = new Set(getActivePresetIds(prev))
      if (nextIds.has(id)) nextIds.delete(id)
      else nextIds.add(id)
      return buildFiltersFromPresetIds(nextIds)
    })
    setActivePreset(() =>
    {
      const nextIds = new Set(activePresetIds)
      if (nextIds.has(id)) nextIds.delete(id)
      else nextIds.add(id)
      if (nextIds.size === PRESETS.length) return PRESET_ALL_ID
      if (nextIds.size === 1) return Array.from(nextIds)[0] ?? null
      return null
    })
  }, [activePresetIds])

  const onApplyAllPresets = useCallback(() =>
  {
    setActivePreset(PRESET_ALL_ID)
    setColumnFilters(applyAllPresets())
  }, [])

  const onResetFilters = useCallback(() =>
  {
    setActivePreset(null)
    setColumnFilters(clearFilters())
  }, [])

  useEffect(() =>
  {
    void refreshLocalExportFiles()
  }, [refreshLocalExportFiles])

  useEffect(() =>
  {
    const onCleared = () =>
    {
      void refreshLocalExportFiles()
    }
    globalThis.addEventListener(EXPORT_CACHE_CLEARED_EVENT, onCleared)
    return () => globalThis.removeEventListener(EXPORT_CACHE_CLEARED_EVENT, onCleared)
  }, [refreshLocalExportFiles])

  useEffect(() =>
  {
    if (!exportListReady) return
    if (localExportFilesSorted.length === 0)
    {
      setSelectedLocalExportFile('')
      return
    }
    setSelectedLocalExportFile((prev) =>
    {
      if (prev === '') {
        return localExportFilesSorted[0]?.name ?? ''
      }
      if (localExportFilesSorted.some((f) => f.name === prev)) {
        return prev
      }
      return localExportFilesSorted[0]?.name ?? ''
    })
  }, [exportListReady, localExportFilesSorted])

  useEffect(() =>
  {
    if (!exportListReady) return
    if (localExportFilesSorted.length === 0)
    {
      setCompareLeftFile('')
      setCompareRightFile('')
      return
    }
    const resolveKept = (prev: string): string =>
    {
      if (prev !== '' && localExportFilesSorted.some((f) => f.name === prev)) return prev
      return ''
    }
    setCompareLeftFile((prev) =>
    {
      return resolveKept(prev) || localExportFilesSorted[0]?.name || ''
    })
    setCompareRightFile((prev) =>
    {
      const left = resolveKept(compareLeftFile) || localExportFilesSorted[0]?.name || ''
      const keptRight = resolveKept(prev)
      if (keptRight && keptRight !== left) return keptRight
      return localExportFilesSorted.find((f) => f.name !== left)?.name ?? left
    })
  }, [exportListReady, localExportFilesSorted, compareLeftFile])

  useEffect(() =>
  {
    if (!exportListReady) return
    try
    {
      if (selectedLocalExportFile)
      {
        localStorage.setItem(LS_LAST_EXPORT_FILE, selectedLocalExportFile)
      } else
      {
        localStorage.removeItem(LS_LAST_EXPORT_FILE)
      }
    } catch
    {
      /* ignore */
    }
  }, [exportListReady, selectedLocalExportFile])

  useEffect(() =>
  {
    try
    {
      localStorage.setItem(
        LS_TRADING_LEFT_PANEL_WIDTH_PX,
        String(Math.round(leftPanelWidthPx))
      )
    } catch
    {
      /* ignore */
    }
  }, [leftPanelWidthPx])

  useEffect(() =>
  {
    const onMouseMove = (e: MouseEvent) =>
    {
      if (!isResizingLeftPanelRef.current) return
      const rootWidth = splitRootRef.current?.clientWidth ?? globalThis.innerWidth
      const minWidth = 260
      const maxWidth = Math.max(minWidth + 60, rootWidth - 420)
      const next = resizeStartWidthRef.current + (e.clientX - resizeStartXRef.current)
      const clamped = Math.max(minWidth, Math.min(maxWidth, Math.round(next)))
      setLeftPanelWidthPx(clamped)
    }
    const onMouseUp = () =>
    {
      if (!isResizingLeftPanelRef.current) return
      isResizingLeftPanelRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    globalThis.addEventListener('mousemove', onMouseMove)
    globalThis.addEventListener('mouseup', onMouseUp)
    return () =>
    {
      globalThis.removeEventListener('mousemove', onMouseMove)
      globalThis.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  const startLeftPanelResize = useCallback((e: React.MouseEvent<HTMLElement>) =>
  {
    if (globalThis.innerWidth < 1024) return
    isResizingLeftPanelRef.current = true
    resizeStartXRef.current = e.clientX
    resizeStartWidthRef.current = leftPanelWidthPx
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
  }, [leftPanelWidthPx])

  return (
    <div className="flex min-h-0 flex-1 flex-col text-white lg:min-h-0 lg:overflow-hidden">
      <div className="w-full px-4 pb-6 pt-1 lg:flex lg:h-full lg:flex-col">
        <header className="mb-0 shrink-0 text-center">
          <p className="sr-only">{ tickerScreenReader }</p>
          <div
            className="relative mt-1 mb-2 w-full overflow-hidden rounded-md border border-eve-border/55 bg-eve-surface/55 shadow-glass-subtle sm:mb-3 [background-image:repeating-linear-gradient(90deg,transparent,transparent_3px,rgba(71,91,125,0.14)_3px,transparent_4px)]"
            aria-hidden
          >
            <div className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-gradient-to-b from-eve-cyan/75 via-eve-accent/40 to-eve-cyan/50" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-0.5 bg-gradient-to-b from-eve-cyan/30 via-eve-accent/25 to-eve-cyan/30 opacity-40" />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-eve-cyan/30 via-eve-accent/55 to-eve-cyan/30" />
            <div className="overflow-x-auto overscroll-x-contain">
              <p className="font-eve flex min-h-[1.9rem] min-w-min items-center justify-center gap-x-1.5 px-3 py-1 text-center text-[8px] font-semibold leading-snug text-eve-bright/95 [word-spacing:0.12em] [letter-spacing:0.08em] [text-shadow:0_0_8px_rgba(236,238,242,0.04)] sm:gap-x-2 sm:px-4 sm:py-1 sm:text-[9px] sm:whitespace-nowrap sm:[word-spacing:0.2em] sm:[letter-spacing:0.1em]">
                <span className="shrink-0 text-eve-muted/55" aria-hidden>
                  ◆
                </span>
                <span
                  className={ `shrink-0 font-tabular-nums ${ loading
                      ? 'text-eve-accent/90'
                      : fileRows === null
                        ? 'text-eve-muted/55'
                        : 'text-eve-cyan/95'
                    }` }
                  title={ tableTitle }
                >
                  { tableTicker }
                </span>
                <span className="shrink-0 text-eve-muted/45" aria-hidden>
                  |
                </span>
                <span
                  className="shrink-0 text-eve-gold-bright/90"
                  title={ `Регион ESI-выгрузки: ${ getExportRegionLabel(tickerRegionId) }` }
                >
                  { regionTickerUpper }
                </span>
                <span className="shrink-0 text-eve-muted/45" aria-hidden>
                  |
                </span>
                <span
                  className="shrink-0 text-eve-cyan/95"
                  title="Порог «дорогой» единицы (млн ISK)"
                >
                  &gt;{ priceMlnForTicker }M
                </span>
                <span className="shrink-0 text-eve-muted/45" aria-hidden>
                  |
                </span>
                <span
                  className="shrink-0 text-eve-cyan/90"
                  title="Broker (buy) и sales tax, %"
                >
                  { feeTicker }
                </span>
                { import.meta.env.DEV ? (
                  <>
                    <span className="shrink-0 text-eve-muted/45" aria-hidden>
                      |
                    </span>
                    <span className="shrink-0 text-eve-muted/70" title="Режим разработки">
                      DEV
                    </span>
                  </>
                ) : null }
                <span className="shrink-0 text-eve-muted/45" aria-hidden>
                  |
                </span>
                <span className="shrink-0 text-eve-bright/95">New Eden</span>
                <span className="shrink-0 text-eve-muted/45" aria-hidden>
                  |
                </span>
                <span className="shrink-0 text-eve-gold-bright/90" title="Активный пресет">
                  PRESET { activePresetTicker }
                </span>
                <span className="shrink-0 text-eve-muted/45" aria-hidden>
                  |
                </span>
                <span className="shrink-0 text-eve-bright/88" title="Количество активных фильтров">
                  FILTERS { filtersTicker }
                </span>
                <span className="shrink-0 text-eve-muted/55" aria-hidden>
                  ◆
                </span>
              </p>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-eve-border/30" />
          </div>
        </header>

        <div
          ref={splitRootRef}
          className="flex min-h-0 flex-1 flex-col gap-1 lg:flex-row lg:overflow-hidden"
        >
          <aside
            className="mt-4 w-full space-y-4 lg:mt-0 lg:h-full lg:w-[min(100%,var(--trading-left-panel))] lg:shrink-0 lg:overflow-y-auto lg:pr-1"
            style={{ ['--trading-left-panel' as string]: `${ leftPanelWidthPx }px` }}
          >
            <section className="@container eve-panel p-2.5">
              <div className="mb-3 grid grid-cols-2 gap-1" role="tablist" aria-label="Источник выгрузки">
                <button
                  type="button"
                  role="tab"
                  id="source-tab-esi"
                  aria-controls="source-panel-esi"
                  aria-selected={ sourceTab === 'esi' }
                  onClick={ () => setSourceTab('esi') }
                  className={ `rounded-md border px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 ${
                    sourceTab === 'esi'
                      ? 'border-eve-accent bg-eve-accent-muted text-eve-accent'
                      : 'border-eve-border/80 bg-eve-surface/45 text-eve-muted hover:border-eve-accent/45 hover:text-eve-bright'
                  }` }
                >
                  Новая выгрузка ESI
                </button>
                <button
                  type="button"
                  role="tab"
                  id="source-tab-excel"
                  aria-controls="source-panel-excel"
                  aria-selected={ sourceTab === 'excel' }
                  onClick={ () => setSourceTab('excel') }
                  className={ `rounded-md border px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 ${
                    sourceTab === 'excel'
                      ? 'border-eve-accent bg-eve-accent-muted text-eve-accent'
                      : 'border-eve-border/80 bg-eve-surface/45 text-eve-muted hover:border-eve-accent/45 hover:text-eve-bright'
                  }` }
                >
                  Локальный Excel
                </button>
              </div>
              <div
                role="tabpanel"
                id="source-panel-esi"
                aria-labelledby="source-tab-esi"
                hidden={ sourceTab !== 'esi' }
              >
                <ExportBar
                  onLoadBuffer={ loadFromBuffer }
                  onOpenedExportFile={ onExportBarOpenedFile }
                  disabled={ loading }
                  hideLocalFileOpenSection
                  hideMarketLogsSection
                  hideEsiOuterCard
                  brokerFeePct={ brokerFeePct }
                  salesTaxPct={ salesTaxPct }
                  highPriceThresholdIsk={ highPriceThresholdIsk }
                  marketLogsPath={ marketLogsPath }
                  onMessageChange={ setExportMsg }
                />
              </div>
              <div
                role="tabpanel"
                id="source-panel-excel"
                aria-labelledby="source-tab-excel"
                hidden={ sourceTab !== 'excel' }
              >
                <ExportBar
                  onLoadBuffer={ loadFromBuffer }
                  onOpenedExportFile={ onExportBarOpenedFile }
                  disabled={ loading }
                  hideEsiSection
                  hideMarketLogsSection
                  hideLocalOuterCard
                  brokerFeePct={ brokerFeePct }
                  salesTaxPct={ salesTaxPct }
                  highPriceThresholdIsk={ highPriceThresholdIsk }
                  marketLogsPath={ marketLogsPath }
                  onMessageChange={ setExportMsg }
                />
              </div>
              { exportMsg && (
                <p className="glass-subtle mt-2 px-2.5 py-1.5 text-xs text-eve-muted">
                  { exportMsg }
                </p>
              ) }
            </section>
            <section className="@container eve-panel p-2.5">
              <h3 className="eve-section-title mb-3">Торговля</h3>
              <div className="mb-3 grid grid-cols-2 gap-1" role="tablist" aria-label="Режим торговли">
                <button
                  type="button"
                  role="tab"
                  id="trade-tab-single"
                  aria-controls="trade-panel-single"
                  aria-selected={ tradeTab === 'single' }
                  onClick={ () => setTradeTab('single') }
                  className={ `rounded-md border px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 ${
                    tradeTab === 'single'
                      ? 'border-eve-accent bg-eve-accent-muted text-eve-accent'
                      : 'border-eve-border/80 bg-eve-surface/45 text-eve-muted hover:border-eve-accent/45 hover:text-eve-bright'
                  }` }
                >
                  В одном регионе
                </button>
                <button
                  type="button"
                  role="tab"
                  id="trade-tab-cross"
                  aria-controls="trade-panel-cross"
                  aria-selected={ tradeTab === 'cross' }
                  onClick={ () => setTradeTab('cross') }
                  className={ `rounded-md border px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 ${
                    tradeTab === 'cross'
                      ? 'border-eve-accent bg-eve-accent-muted text-eve-accent'
                      : 'border-eve-border/80 bg-eve-surface/45 text-eve-muted hover:border-eve-accent/45 hover:text-eve-bright'
                  }` }
                >
                  Между регионами
                </button>
              </div>
              <div
                role="tabpanel"
                id="trade-panel-single"
                aria-labelledby="trade-tab-single"
                hidden={ tradeTab !== 'single' }
              >
                    <p className="mb-2 text-[10px] leading-snug text-eve-muted/90">
                      Для работы с уже готовыми выгрузками сформируйте новую выгрузку ESI. Она сохранится в кеш сайта
                    </p>
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                        <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-eve-muted sm:max-w-md">
                          <span className="shrink-0">Файл</span>
                          <select
                            className="min-w-0 flex-1 rounded-md border border-eve-border/75 bg-eve-surface/65 py-1.5 pl-2 pr-8 text-xs text-white shadow-glass-subtle focus:border-eve-accent/70 focus:outline-none"
                            value={ selectedLocalExportFile }
                            onChange={ (e) => setSelectedLocalExportFile(e.target.value) }
                            disabled={ loading || localExportLoading || localExportFilesSorted.length === 0 }
                          >
                            { localExportFilesSorted.length === 0 ? (
                              <option value="">{ exportListEmptyLabel }</option>
                            ) : (
                              localExportFilesSorted.map((f) => (
                                <option key={ f.name } value={ f.name }>
                                  { f.name } ({ Math.round(f.size / 1024) } KB)
                                </option>
                              ))
                            ) }
                          </select>
                        </label>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={ () => void refreshLocalExportFiles() }
                            disabled={ loading || localExportLoading }
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-eve-border/75 bg-eve-surface/60 text-eve-muted shadow-glass-subtle hover:border-eve-muted/60 hover:text-eve-bright disabled:opacity-50"
                            title="Обновить список из кеша браузера"
                          >
                            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                          </button>
                          <button
                            type="button"
                            disabled={
                              loading ||
                              localExportLoading ||
                              !selectedLocalExportFile
                            }
                            onClick={ () => void onDeleteCachedExportFile() }
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-eve-border/75 bg-eve-surface/60 text-eve-muted shadow-glass-subtle hover:border-eve-danger/55 hover:text-eve-danger disabled:opacity-50"
                            title="Удалить выбранный файл из кеша браузера"
                            aria-label="Удалить выбранный файл из кеша браузера"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </button>
                          <button
                            type="button"
                            disabled={
                              loading ||
                              localExportLoading ||
                              localExportFilesSorted.length === 0 ||
                              !selectedLocalExportFile
                            }
                            onClick={ () => void onOpenSelectedLocalExportFile() }
                            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-eve-accent/70 bg-eve-accent-muted px-4 py-2 text-xs font-semibold text-eve-accent transition-colors hover:border-eve-accent hover:bg-eve-highlight focus:outline-none focus:ring-2 focus:ring-eve-accent/35 disabled:opacity-50"
                            title="Открыть в таблицу выбранный файл из кеша браузера"
                          >
                            <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            Открыть
                          </button>
                        </div>
                      </div>
              </div>
              <div
                role="tabpanel"
                id="trade-panel-cross"
                aria-labelledby="trade-tab-cross"
                hidden={ tradeTab !== 'cross' }
              >
                      <p className="mb-2 text-[10px] leading-snug text-eve-muted/90">
                        Регион 1 — откуда везём товар, регион 2 — рынок продажи.
                        Оба файла из кеша браузера.
                      </p>
                      <div className="flex flex-col gap-2.5">
                        <label className="flex min-w-0 items-center gap-2 text-xs text-eve-muted">
                          <span className="shrink-0">Регион 1</span>
                          <select
                            className="min-w-0 flex-1 rounded-md border border-eve-border/70 bg-eve-surface/35 py-1.5 pl-2 pr-8 text-xs text-white shadow-glass-subtle focus:border-eve-accent/70 focus:outline-none"
                            value={ compareLeftFile }
                            onChange={ (e) => setCompareLeftFile(e.target.value) }
                            disabled={ loading || localExportLoading || localExportFilesSorted.length === 0 }
                          >
                            { localExportFilesSorted.length === 0 ? (
                              <option value="">{ exportListEmptyLabel }</option>
                            ) : (
                              localExportFilesSorted.map((f) => (
                                <option key={ `cmp-left-${ f.name }` } value={ f.name }>
                                  { f.name }
                                </option>
                              ))
                            ) }
                          </select>
                        </label>
                        <label className="flex min-w-0 items-center gap-2 text-xs text-eve-muted">
                          <span className="shrink-0">Регион 2</span>
                          <select
                            className="min-w-0 flex-1 rounded-md border border-eve-border/70 bg-eve-surface/35 py-1.5 pl-2 pr-8 text-xs text-white shadow-glass-subtle focus:border-eve-accent/70 focus:outline-none"
                            value={ compareRightFile }
                            onChange={ (e) => setCompareRightFile(e.target.value) }
                            disabled={ loading || localExportLoading || localExportFilesSorted.length === 0 }
                          >
                            { localExportFilesSorted.length === 0 ? (
                              <option value="">{ exportListEmptyLabel }</option>
                            ) : (
                              localExportFilesSorted.map((f) => (
                                <option key={ `cmp-right-${ f.name }` } value={ f.name }>
                                  { f.name }
                                </option>
                              ))
                            ) }
                          </select>
                        </label>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1">
                            <div
                            className="inline-flex min-h-[2.125rem] min-w-0 items-center truncate rounded-md border border-eve-border/55 bg-eve-surface/55 px-2 text-xs font-semibold text-eve-gold"
                              title="Выбранные регионы сравнения"
                            >
                              { compareLeftRegionLabel } → { compareRightRegionLabel }
                            </div>
                            <button
                              type="button"
                              onClick={ onSwapCompareFiles }
                              disabled={ loading || localExportLoading }
                              className="inline-flex items-center justify-center rounded-md border border-eve-border/75 bg-eve-surface/58 p-1.5 text-eve-bright/95 shadow-glass-subtle transition-colors hover:border-eve-accent/50 hover:text-eve-accent disabled:opacity-50"
                              title="Поменять регионы местами"
                              aria-label="Поменять выбранные регионы местами"
                            >
                              <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
                            </button>
                          </div>
                          <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={ () => void onApplyCrossRegionFiles() }
                            disabled={
                              loading ||
                              localExportLoading ||
                              !compareLeftFile ||
                              !compareRightFile ||
                              compareLeftFile === compareRightFile
                            }
                            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-eve-accent/70 bg-eve-accent-muted px-4 py-2 text-xs font-semibold text-eve-accent transition-colors hover:border-eve-accent hover:bg-eve-highlight focus:outline-none focus:ring-2 focus:ring-eve-accent/35 disabled:opacity-50"
                          >
                            Применить сравнение
                          </button>
                          </div>
                        </div>
                      </div>
              </div>
            </section>
            <ExportBar
              onLoadBuffer={ loadFromBuffer }
              disabled={ loading }
              hideLocalFileOpenSection
              hideEsiSection
              brokerFeePct={ brokerFeePct }
              salesTaxPct={ salesTaxPct }
              highPriceThresholdIsk={ highPriceThresholdIsk }
              marketLogsPath={ marketLogsPath }
            />
          </aside>

          <button
            type="button"
            className="left-panel-resize-handle hidden lg:block lg:h-full lg:w-1 lg:shrink-0 lg:cursor-ew-resize lg:rounded-none lg:border-0 lg:bg-eve-border/70 lg:p-0 lg:transition-colors hover:lg:bg-eve-accent/65"
            onMouseDown={startLeftPanelResize}
            aria-label="Изменить ширину левой панели"
            title="Потяните, чтобы изменить ширину левой панели"
          />

          <main className="mt-4 w-full lg:mt-0 lg:flex lg:min-h-0 lg:min-w-0 lg:flex-1 lg:flex-col lg:overflow-hidden lg:pl-1">
            { error && (
              <div
                className="eve-panel mb-4 border-eve-danger/50 bg-eve-elevated/70 px-3 py-2.5 text-sm text-eve-danger"
                role="alert"
              >
                { error }
              </div>
            ) }
            <div className="eve-panel p-1.5 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
              <div className="mb-2 flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center justify-start gap-1.5">
                  <span className="eve-kicker mr-1 shrink-0">Быстрые фильтры</span>
                  { PRESETS.map((p) => (
                    <button
                      key={ p.id }
                      type="button"
                      onClick={ (e) =>
                      {
                        onPreset(p.id)
                        e.currentTarget.blur()
                      } }
                      className={ `rounded border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 focus-visible:ring-offset-1 focus-visible:ring-offset-eve-surface ${ activePresetIdsSet.has(p.id)
                          ? 'border-eve-accent bg-eve-accent-muted text-eve-accent glow-kpi'
                          : 'border-eve-border/80 text-eve-muted hover:border-eve-accent/40 hover:text-eve-bright'
                        }` }
                    >
                      { p.label }
                    </button>
                  )) }
                </div>
                <div className="flex flex-wrap items-center justify-start gap-1.5">
                  <button
                    type="button"
                    onClick={ (e) =>
                    {
                      onApplyAllPresets()
                      e.currentTarget.blur()
                    } }
                    className={ `rounded border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 focus-visible:ring-offset-1 focus-visible:ring-offset-eve-surface ${ isAllPresetsActive
                        ? 'border-eve-accent bg-eve-accent-muted text-eve-accent glow-kpi'
                        : 'border-eve-border/80 text-eve-muted hover:border-eve-accent/40 hover:text-eve-bright'
                      }` }
                  >
                    Применить все
                  </button>
                  <button
                    type="button"
                    onClick={ (e) =>
                    {
                      onResetFilters()
                      e.currentTarget.blur()
                    } }
                    className={ `rounded border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 focus-visible:ring-offset-1 focus-visible:ring-offset-eve-surface ${ isNoPresetsActive
                        ? 'border-eve-accent bg-eve-accent-muted text-eve-accent glow-kpi'
                        : 'border-eve-border/80 text-eve-muted hover:border-eve-muted/50 hover:text-eve-bright'
                      }` }
                  >
                    Сбросить фильтры
                  </button>
                </div>
                <div className="flex flex-wrap items-center justify-start gap-x-3 gap-y-1.5">
                  <label className="flex min-w-0 flex-col gap-1 text-xs text-eve-muted sm:flex-row sm:flex-wrap sm:items-center">
                    <span className="max-w-[22rem] shrink-0">
                      Дорогим товаром считать (влияет на выгодность)
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <input
                        ref={ setPriceInputEl }
                        type="number"
                        min={ 0.1 }
                        step={ 1 }
                        className="w-24 rounded-md border border-eve-border/75 bg-eve-surface/65 px-2 py-1.5 tabular-nums text-eve-bright shadow-glass-subtle [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-eve-accent/70 focus:outline-none"
                        value={ priceThresholdMln }
                        onChange={ (e) =>
                        {
                          const n = Number(e.target.value.replace(',', '.'))
                          if (!Number.isFinite(n) || n < 0.1) return
                          setPriceThresholdMln(n)
                          try
                          {
                            localStorage.setItem(LS_PRICE_MLN, String(n))
                          } catch
                          {
                            /* ignore */
                          }
                        } }
                      />
                      <span className="tabular-nums text-eve-muted/90" title="В ISK">
                        = { formatInteger(highPriceThresholdIsk) } ISK
                      </span>
                    </span>
                  </label>
                </div>
              </div>
              <div className="lg:min-h-0 lg:flex-1">
            <MarketTable
              data={ rows ?? [] }
              columnFilters={ columnFilters }
              onColumnFiltersChange={ setColumnFilters }
              emptyMessage={ tableEmptyMessage }
              highPriceThresholdIsk={ highPriceThresholdIsk }
              copiedNameKeys={ copiedNameKeys }
              onNameCopied={ onNameCopied }
              priceSellHeader={ priceSellHeader }
              priceBuyHeader={ priceBuyHeader }
            />
          </div>
            </div>
          </main>
        </div>

        { loading && (
          <p className="mt-4 text-center text-sm font-semibold uppercase tracking-wider text-eve-accent/90">
            Загрузка…
          </p>
        ) }
      </div>
    </div>
  )
}

export default TradingView
