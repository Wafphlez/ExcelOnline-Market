import { useCallback, useEffect, useMemo, useState } from 'react'
import { useInputWheelNudge } from './hooks/useInputWheelNudge'
import type { ColumnFiltersState } from '@tanstack/react-table'
import { Download, FolderOpen, RefreshCw } from 'lucide-react'
import { ExportBar } from './components/ExportBar'
import { FileDropzone } from './components/FileDropzone'
import { MarketTable } from './components/MarketTable'
import { computeAllMetrics } from './lib/computeMetrics'
import { DEFAULT_HIGH_PRICE_THRESHOLD_ISK } from './lib/pricePenalty'
import { formatInteger } from './lib/formatNumber'
import { mapRawRows } from './lib/mapColumns'
import { parseMarketWorkbook } from './lib/parseExcel'
import
  {
    loadFiltersFromDevFile,
    readInitialStateFromLocalStorage,
    saveFiltersToDevFile,
    writeFiltersToLocalStorage,
  } from './lib/filterPersistence'
import
  {
    applyAllPresets,
    applyPreset,
    clearFilters,
    PRESET_ALL_ID,
    PRESETS,
  } from './lib/presets'
import
  {
    getExportRegionLabel,
    LAST_EXPORT_REGION_EVENT,
    LS_LAST_EXPORT_REGION_ID,
    readLastExportRegionId,
    type LastExportRegionDetail,
  } from './lib/lastExportRegionStorage'
import
  {
    devExportFileUrl,
    downloadToExports,
    isDevExportServer,
    listExportFiles,
    type ExportListItem,
  } from './lib/devExportApi'
import { EXPORT_REGIONS, type ExportRegion } from './lib/exportRegions'
import type { MarketRow } from './types/market'

const LS_PRICE_MLN = 'excelMarket_highPriceMln'
const LS_BROKER_PCT = 'excelMarket_brokerFeePct'
const LS_SALES_TAX_PCT = 'excelMarket_salesTaxPct'
const LS_LAST_EXPORT_FILE = 'excelMarket_lastExportFileName'

const DEFAULT_BROKER_FEE_PCT = 1.4
const DEFAULT_SALES_TAX_PCT = 4.2

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

function readStoredBrokerFeePct(): number
{
  try
  {
    const v = localStorage.getItem(LS_BROKER_PCT)
    if (v === null) return DEFAULT_BROKER_FEE_PCT
    const n = Number(String(v).replace(',', '.'))
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : DEFAULT_BROKER_FEE_PCT
  } catch
  {
    return DEFAULT_BROKER_FEE_PCT
  }
}

function readStoredSalesTaxPct(): number
{
  try
  {
    const v = localStorage.getItem(LS_SALES_TAX_PCT)
    if (v === null) return DEFAULT_SALES_TAX_PCT
    const n = Number(String(v).replace(',', '.'))
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : DEFAULT_SALES_TAX_PCT
  } catch
  {
    return DEFAULT_SALES_TAX_PCT
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

function App()
{
  const [fileRows, setFileRows] = useState<MarketRow[] | null>(null)
  const [priceThresholdMln, setPriceThresholdMln] = useState(readStoredPriceMln)
  const [brokerFeePct, setBrokerFeePct] = useState(readStoredBrokerFeePct)
  const [salesTaxPct, setSalesTaxPct] = useState(readStoredSalesTaxPct)
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
  const [localExportFiles, setLocalExportFiles] = useState<ExportListItem[]>([])
  const [localExportLoading, setLocalExportLoading] = useState(false)
  const [selectedLocalExportFile, setSelectedLocalExportFile] = useState(
    readLastExportFileName
  )

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
    const t = window.setTimeout(() =>
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
    return computeAllMetrics(fileRows, {
      highPriceThresholdIsk,
      brokerFee: brokerFeePct / 100,
      salesTax: salesTaxPct / 100,
    })
  }, [fileRows, highPriceThresholdIsk, brokerFeePct, salesTaxPct])
  const tableEmptyMessage = fileRows === null
    ? 'Нет данных: выберите файл для загрузки таблицы.'
    : 'Ни одна строка не подходит под фильтры'

  const localExportFilesSorted = useMemo(() =>
  {
    return [...localExportFiles]
      .filter((f) => /\.(xlsx|xls)$/i.test(f.name))
      .sort((a, b) => b.mtime.localeCompare(a.mtime) || a.name.localeCompare(b.name))
  }, [localExportFiles])

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
    window.addEventListener(LAST_EXPORT_REGION_EVENT, onCustom)
    window.addEventListener('storage', onStorage)
    return () =>
    {
      window.removeEventListener(LAST_EXPORT_REGION_EVENT, onCustom)
      window.removeEventListener('storage', onStorage)
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

  const onBrokerFeeChange = useCallback((n: number) =>
  {
    setBrokerFeePct(n)
    try
    {
      localStorage.setItem(LS_BROKER_PCT, String(n))
    } catch
    {
      /* ignore */
    }
  }, [])

  const onSalesTaxChange = useCallback((n: number) =>
  {
    setSalesTaxPct(n)
    try
    {
      localStorage.setItem(LS_SALES_TAX_PCT, String(n))
    } catch
    {
      /* ignore */
    }
  }, [])

  const refreshLocalExportFiles = useCallback(async () =>
  {
    if (!isDevExportServer)
    {
      setLocalExportFiles([])
      return
    }
    setLocalExportLoading(true)
    try
    {
      const list = await listExportFiles()
      setLocalExportFiles(list)
    } catch
    {
      setLocalExportFiles([])
    } finally
    {
      setLocalExportLoading(false)
    }
  }, [])

  const loadFromBuffer = useCallback(async (buf: ArrayBuffer) =>
  {
    setError(null)
    setLoading(true)
    try
    {
      const { rows: raw } = parseMarketWorkbook(buf)
      const mapped = mapRawRows(raw)
      if (!mapped.ok)
      {
        setError(
          `Не удалось прочитать строку ${ mapped.rowIndex + 1 }: не хватает колонок (${ mapped.error.column }).`
        )
        setFileRows(null)
        setCopiedNameKeys(new Set())
        return
      }
      setFileRows(mapped.rows)
      setCopiedNameKeys(new Set())
    } catch (e)
    {
      setError(e instanceof Error ? e.message : 'Ошибка чтения файла')
      setFileRows(null)
      setCopiedNameKeys(new Set())
    } finally
    {
      setLoading(false)
    }
  }, [])

  const onOpenSelectedLocalExportFile = useCallback(async () =>
  {
    if (!selectedLocalExportFile) return
    setError(null)
    setExportMsg(null)
    try
    {
      const u = devExportFileUrl(selectedLocalExportFile)
      const res = await fetch(u)
      if (!res.ok)
      {
        setExportMsg(
          'Файл не найден в exports/ — обновите список или скачайте выгрузку снова.'
        )
        return
      }
      const buf = await res.arrayBuffer()
      await loadFromBuffer(buf)
      setExportMsg(`Открыт: ${ selectedLocalExportFile }`)
    } catch (e)
    {
      setExportMsg(e instanceof Error ? e.message : 'Ошибка открытия')
    }
  }, [selectedLocalExportFile, loadFromBuffer])

  const onDownloadReadyExport = useCallback(
    async (region: ExportRegion) =>
    {
      setExportMsg(null)
      if (!isDevExportServer)
      {
        window.open(region.downloadUrl, '_blank', 'noopener,noreferrer')
        setExportMsg(
          'В production откроется ссылка; в dev (npm run dev) файл пишется в папку exports/.'
        )
        return
      }
      setLoading(true)
      try
      {
        await downloadToExports(region.downloadUrl, region.fileName)
        setSelectedLocalExportFile(region.fileName)
        await refreshLocalExportFiles()
        const u = devExportFileUrl(region.fileName)
        const res = await fetch(u)
        if (res.ok)
        {
          const buf = await res.arrayBuffer()
          await loadFromBuffer(buf)
          setExportMsg(`Открыт: ${ region.label } (exports/${ region.fileName })`)
        } else
        {
          setExportMsg(`Сохранено: exports/${ region.fileName }`)
        }
      } catch (e)
      {
        setExportMsg(e instanceof Error ? e.message : 'Ошибка скачивания')
      } finally
      {
        setLoading(false)
      }
    },
    [loadFromBuffer, refreshLocalExportFiles]
  )

  const onFile = useCallback(
    async (file: File) =>
    {
      const buf = await file.arrayBuffer()
      await loadFromBuffer(buf)
    },
    [loadFromBuffer]
  )

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
    if (!isDevExportServer) return
    void refreshLocalExportFiles()
  }, [refreshLocalExportFiles])

  useEffect(() =>
  {
    if (!isDevExportServer) return
    if (localExportFilesSorted.length === 0)
    {
      setSelectedLocalExportFile('')
      return
    }
    setSelectedLocalExportFile((prev) =>
    {
      if (prev && localExportFilesSorted.some((f) => f.name === prev))
      {
        return prev
      }
      return localExportFilesSorted[0]!.name
    })
  }, [localExportFilesSorted])

  useEffect(() =>
  {
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
  }, [selectedLocalExportFile])

  return (
    <div className="min-h-screen eve-ui-root text-white lg:h-screen lg:overflow-hidden">
      <div className="w-full px-4 py-6 lg:flex lg:h-full lg:flex-col">
        <header className="mb-0 shrink-0 text-center">
          <div
            className="eve-chrome-top mb-4 mx-auto max-w-md"
            aria-hidden
          />
          <h1 className="font-eve leading-none">
            <span className="inline-grid w-max min-w-0 max-w-full justify-items-stretch">
              <span className="text-left text-3xl font-bold uppercase tracking-[0.12em] sm:text-4xl sm:tracking-[0.14em]">
                <span className="eve-title-gold-shine">Excel Online</span>
              </span>
              <div className="mx-auto mt-0.5 w-[calc(100%-20px)] min-w-0 max-w-full sm:mt-1">
                <span className="sr-only">Market</span>
                <div
                  className="flex w-full min-w-0 items-baseline justify-between text-sm font-bold uppercase text-eve-bright/95 [text-shadow:0_0_12px_rgba(236,238,242,0.08)] sm:text-base"
                  aria-hidden="true"
                >
                  { 'Market'.split('').map((ch, i) => (
                    <span key={ i } className="inline-block leading-none">
                      { ch }
                    </span>
                  )) }
                </div>
              </div>
            </span>
          </h1>
          <p className="sr-only">{ tickerScreenReader }</p>
          <div
            className="relative mt-3 w-full overflow-hidden rounded-sm border border-eve-border/50 bg-eve-bg/55 shadow-eve-inset [background-image:repeating-linear-gradient(90deg,transparent,transparent_3px,rgba(42,49,66,0.12)_3px,transparent_4px)]"
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

        <div className="flex min-h-0 flex-1 flex-col gap-1 lg:flex-row lg:items-start lg:overflow-hidden">
          <aside className="mt-4 space-y-4 w-full lg:mt-0 lg:h-full lg:w-[25%] lg:min-w-[320px] lg:overflow-y-auto lg:pr-1">
            <div className="eve-panel p-1.5">
              <ExportBar
                onLoadBuffer={ loadFromBuffer }
                disabled={ loading }
                hideReadyExportsSection
                hideLocalFileOpenSection
                hideEsiSection
                brokerFeePct={ brokerFeePct }
                salesTaxPct={ salesTaxPct }
                highPriceThresholdIsk={ highPriceThresholdIsk }
                onBrokerFeeChange={ onBrokerFeeChange }
                onSalesTaxChange={ onSalesTaxChange }
                onMessageChange={ setExportMsg }
              />
            </div>
            <div className="eve-panel p-1.5">
              { (isDevExportServer || exportMsg) && (
                <>
                  <section className="@container mb-3 rounded border border-eve-border/55 bg-eve-bg/35 p-2.5 shadow-eve-inset">
                    <h3 className="eve-section-title mb-2">Источник таблицы</h3>
                    { isDevExportServer && (
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                        <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-eve-muted sm:max-w-md">
                          <span className="shrink-0">Файл</span>
                          <select
                            className="min-w-0 flex-1 rounded border border-eve-border/80 bg-eve-bg/80 py-1.5 pl-2 pr-8 text-xs text-white shadow-eve-inset focus:border-eve-accent/70 focus:outline-none"
                            value={ selectedLocalExportFile }
                            onChange={ (e) => setSelectedLocalExportFile(e.target.value) }
                            disabled={ loading || localExportLoading || localExportFilesSorted.length === 0 }
                          >
                            { localExportFilesSorted.length === 0 ? (
                              <option value="">— папка пуста —</option>
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
                            className="inline-flex h-8 w-8 items-center justify-center rounded border border-eve-border/80 text-eve-muted shadow-eve-inset hover:border-eve-muted/60 hover:text-eve-bright disabled:opacity-50"
                            title="Обновить список из exports/"
                          >
                            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
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
                            className="inline-flex items-center justify-center gap-1.5 rounded border border-eve-accent/70 bg-eve-accent-muted px-4 py-2 text-xs font-semibold text-eve-accent transition-colors hover:border-eve-accent hover:bg-eve-highlight focus:outline-none focus:ring-2 focus:ring-eve-accent/35 disabled:opacity-50"
                            title="Открыть в таблицу выбранный файл из exports/"
                          >
                            <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            Открыть
                          </button>
                        </div>
                        <div className="flex w-full items-center gap-2 text-xs text-eve-muted">
                          <div>
                            <FileDropzone
                              onFile={ onFile }
                              disabled={ loading || localExportLoading }
                              embedded
                            />
                          </div>
                          <span>Выбрать локальный файл .xlsx/.xls</span>
                        </div>
                      </div>
                    ) }
                  </section>

                  <section className="@container mb-3 rounded border border-eve-border/55 bg-eve-bg/35 p-2.5 shadow-eve-inset">
                    <h3 className="eve-section-title mb-2">Готовые выгрузки</h3>
                    <div className="flex flex-wrap gap-2">
                      { EXPORT_REGIONS.map((region) => (
                        <button
                          key={ region.id }
                          type="button"
                          disabled={ loading }
                          onClick={ () => void onDownloadReadyExport(region) }
                          className="inline-flex items-center gap-1.5 rounded border border-eve-border/90 bg-eve-bg/60 px-2.5 py-1.5 text-xs font-semibold text-eve-bright/90 shadow-eve-inset transition-colors hover:border-eve-accent/50 hover:text-eve-accent disabled:opacity-50"
                          title={
                            isDevExportServer
                              ? `Скачать в exports/${ region.fileName }`
                              : 'Открыть в новой вкладке'
                          }
                        >
                          <Download className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          { region.label }
                        </button>
                      )) }
                    </div>
                  </section>

                  <section className="@container mb-3 rounded border border-eve-border/55 bg-eve-bg/35 p-2.5 shadow-eve-inset">
                    <h3 className="eve-section-title mb-2">Собрать через ESI</h3>
                    <ExportBar
                      onLoadBuffer={ loadFromBuffer }
                      disabled={ loading }
                      hideReadyExportsSection
                      hideLocalFileOpenSection
                      hideMarketLogsSection
                      brokerFeePct={ brokerFeePct }
                      salesTaxPct={ salesTaxPct }
                      highPriceThresholdIsk={ highPriceThresholdIsk }
                      onBrokerFeeChange={ onBrokerFeeChange }
                      onSalesTaxChange={ onSalesTaxChange }
                      onMessageChange={ setExportMsg }
                    />
                  </section>
                  { exportMsg && (
                    <p className="my-2 rounded border border-eve-border/50 bg-eve-bg/50 px-2.5 py-1.5 text-xs text-eve-muted shadow-eve-inset">
                      { exportMsg }
                    </p>
                  ) }
                </>
              ) }
            </div>
          </aside>

          <main className="mt-4 w-full lg:mt-0 lg:flex lg:h-full lg:w-[75%] lg:flex-col lg:overflow-hidden lg:pl-1">
            { error && (
              <div
                className="eve-panel mb-4 border-eve-danger/50 bg-eve-elevated/80 px-3 py-2.5 text-sm text-eve-danger"
                role="alert"
              >
                { error }
              </div>
            ) }
            <div className="eve-panel p-1.5 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
              <div className="mb-2 flex flex-wrap items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={ (e) =>
                  {
                    onApplyAllPresets()
                    e.currentTarget.blur()
                  } }
                  className={ `rounded border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 focus-visible:ring-offset-1 focus-visible:ring-offset-eve-surface ${ isAllPresetsActive
                      ? 'border-eve-accent bg-eve-accent-muted text-eve-accent shadow-[inset_0_0_0_1px_rgba(184,150,61,0.2)]'
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
                      ? 'border-eve-accent bg-eve-accent-muted text-eve-accent shadow-[inset_0_0_0_1px_rgba(184,150,61,0.2)]'
                      : 'border-eve-border/80 text-eve-muted hover:border-eve-muted/50 hover:text-eve-bright'
                    }` }
                >
                  Сбросить фильтры
                </button>
              </div>
              <div className="mb-2 flex flex-wrap items-center justify-end gap-1.5 pb-2">
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
                        ? 'border-eve-accent bg-eve-accent-muted text-eve-accent shadow-[inset_0_0_0_1px_rgba(184,150,61,0.2)]'
                        : 'border-eve-border/80 text-eve-muted hover:border-eve-accent/40 hover:text-eve-bright'
                      }` }
                  >
                    { p.label }
                  </button>
                )) }
              </div>
          <div className="mb-2 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs text-eve-muted sm:flex-row sm:items-center">
              <span className="max-w-[20rem]">
                Дорогим товаром считать (влияет на выгодность)
              </span>
              <input
                ref={ setPriceInputEl }
                type="number"
                min={ 0.1 }
                step={ 1 }
                className="w-24 rounded border border-eve-border/80 bg-eve-bg/90 px-2 py-1.5 tabular-nums text-eve-bright shadow-eve-inset [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-eve-accent/70 focus:outline-none"
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
            </label>
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

export default App
