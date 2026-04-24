import { useCallback, useEffect, useMemo, useState } from 'react'
import { useInputWheelNudge } from './hooks/useInputWheelNudge'
import type { ColumnFiltersState } from '@tanstack/react-table'
import { ExportBar } from './components/ExportBar'
import { FileDropzone } from './components/FileDropzone'
import { MarketTable } from './components/MarketTable'
import { computeAllMetrics } from './lib/computeMetrics'
import { DEFAULT_HIGH_PRICE_THRESHOLD_ISK } from './lib/pricePenalty'
import { formatInteger } from './lib/formatNumber'
import { mapRawRows } from './lib/mapColumns'
import { parseMarketWorkbook } from './lib/parseExcel'
import {
  loadFiltersFromDevFile,
  readInitialStateFromLocalStorage,
  saveFiltersToDevFile,
  writeFiltersToLocalStorage,
} from './lib/filterPersistence'
import {
  applyAllPresets,
  applyPreset,
  clearFilters,
  PRESET_ALL_ID,
  PRESETS,
} from './lib/presets'
import {
  getExportRegionLabel,
  LAST_EXPORT_REGION_EVENT,
  LS_LAST_EXPORT_REGION_ID,
  readLastExportRegionId,
  type LastExportRegionDetail,
} from './lib/lastExportRegionStorage'
import type { MarketRow } from './types/market'

const LS_PRICE_MLN = 'excelMarket_highPriceMln'
const LS_BROKER_PCT = 'excelMarket_brokerFeePct'
const LS_SALES_TAX_PCT = 'excelMarket_salesTaxPct'

const DEFAULT_BROKER_FEE_PCT = 1.4
const DEFAULT_SALES_TAX_PCT = 4.2

function readStoredPriceMln(): number {
  try {
    const v = localStorage.getItem(LS_PRICE_MLN)
    if (v === null) return DEFAULT_HIGH_PRICE_THRESHOLD_ISK / 1_000_000
    const n = Number(String(v).replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_HIGH_PRICE_THRESHOLD_ISK / 1_000_000
  } catch {
    return DEFAULT_HIGH_PRICE_THRESHOLD_ISK / 1_000_000
  }
}

function readStoredBrokerFeePct(): number {
  try {
    const v = localStorage.getItem(LS_BROKER_PCT)
    if (v === null) return DEFAULT_BROKER_FEE_PCT
    const n = Number(String(v).replace(',', '.'))
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : DEFAULT_BROKER_FEE_PCT
  } catch {
    return DEFAULT_BROKER_FEE_PCT
  }
}

function readStoredSalesTaxPct(): number {
  try {
    const v = localStorage.getItem(LS_SALES_TAX_PCT)
    if (v === null) return DEFAULT_SALES_TAX_PCT
    const n = Number(String(v).replace(',', '.'))
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : DEFAULT_SALES_TAX_PCT
  } catch {
    return DEFAULT_SALES_TAX_PCT
  }
}

function App() {
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
  const [brokerInputEl, setBrokerInputEl] = useState<HTMLInputElement | null>(null)
  const [taxInputEl, setTaxInputEl] = useState<HTMLInputElement | null>(null)

  const highPriceThresholdIsk = priceThresholdMln * 1_000_000

  useInputWheelNudge(priceInputEl, {
    step: 1,
    bounds: { min: 0.1, max: 1_000_000 },
    getValue: () => priceThresholdMln,
    onNudge: (n) => {
      const v = Math.max(0.1, n)
      setPriceThresholdMln(v)
      try {
        localStorage.setItem(LS_PRICE_MLN, String(v))
      } catch {
        /* ignore */
      }
    },
  })
  useInputWheelNudge(brokerInputEl, {
    step: 0.01,
    bounds: { min: 0, max: 100 },
    getValue: () => brokerFeePct,
    onNudge: (n) => {
      setBrokerFeePct(n)
      try {
        localStorage.setItem(LS_BROKER_PCT, String(n))
      } catch {
        /* ignore */
      }
    },
  })
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (import.meta.env.DEV) {
        const fromFile = await loadFiltersFromDevFile()
        if (!cancelled && fromFile) {
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
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!filtersPersistReady) return
    const t = window.setTimeout(() => {
      writeFiltersToLocalStorage(columnFilters, activePreset)
      void saveFiltersToDevFile({
        version: 2,
        columnFilters,
        activePreset,
      })
    }, 400)
    return () => clearTimeout(t)
  }, [columnFilters, activePreset, filtersPersistReady])

  useInputWheelNudge(taxInputEl, {
    step: 0.01,
    bounds: { min: 0, max: 100 },
    getValue: () => salesTaxPct,
    onNudge: (n) => {
      setSalesTaxPct(n)
      try {
        localStorage.setItem(LS_SALES_TAX_PCT, String(n))
      } catch {
        /* ignore */
      }
    },
  })

  const rows = useMemo((): MarketRow[] | null => {
    if (fileRows === null) return null
    if (fileRows.length === 0) return []
    return computeAllMetrics(fileRows, {
      highPriceThresholdIsk,
      brokerFee: brokerFeePct / 100,
      salesTax: salesTaxPct / 100,
    })
  }, [fileRows, highPriceThresholdIsk, brokerFeePct, salesTaxPct])

  const [tickerRegionId, setTickerRegionId] = useState(() =>
    readLastExportRegionId()
  )
  useEffect(() => {
    const onCustom = (e: Event) => {
      const id = (e as CustomEvent<LastExportRegionDetail>).detail?.id
      if (id) setTickerRegionId(id)
    }
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === LS_LAST_EXPORT_REGION_ID) {
        setTickerRegionId(readLastExportRegionId())
      }
    }
    window.addEventListener(LAST_EXPORT_REGION_EVENT, onCustom)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(LAST_EXPORT_REGION_EVENT, onCustom)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const regionTickerUpper = useMemo(
    () => getExportRegionLabel(tickerRegionId).toUpperCase(),
    [tickerRegionId]
  )

  const { tableTicker, tableTitle } = useMemo(() => {
    if (loading) {
      return { tableTicker: '…', tableTitle: 'Идёт загрузка или разбор файла' }
    }
    if (fileRows === null) {
      return { tableTicker: '—', tableTitle: 'Таблица: файл не загружен' }
    }
    if (fileRows.length === 0) {
      return { tableTicker: '0', tableTitle: 'Таблица: 0 строк' }
    }
    return {
      tableTicker: String(fileRows.length),
      tableTitle: `Строк в таблице: ${fileRows.length}`,
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
      `${brokerFeePct.toLocaleString('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 0 })}%·${salesTaxPct.toLocaleString('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 0 })}%`,
    [brokerFeePct, salesTaxPct]
  )

  const tickerScreenReader = useMemo(
    () =>
      `Excel Online Market. ${tableTitle}. Регион ESI: ${getExportRegionLabel(
        tickerRegionId
      )}. Порог дорогой единицы больше ${priceMlnForTicker} млн ISK. Broker ${brokerFeePct}%, налог ${salesTaxPct}%. ` +
        'Фильтры и сортировка по марже, спреду в ISK и обороту.',
    [
      tableTitle,
      tickerRegionId,
      priceMlnForTicker,
      brokerFeePct,
      salesTaxPct,
    ]
  )

  const onNameCopied = useCallback((key: string) => {
    setCopiedNameKeys((prev) => new Set([...prev, key]))
  }, [])

  const onBrokerFeeChange = useCallback((n: number) => {
    setBrokerFeePct(n)
    try {
      localStorage.setItem(LS_BROKER_PCT, String(n))
    } catch {
      /* ignore */
    }
  }, [])

  const onSalesTaxChange = useCallback((n: number) => {
    setSalesTaxPct(n)
    try {
      localStorage.setItem(LS_SALES_TAX_PCT, String(n))
    } catch {
      /* ignore */
    }
  }, [])

  const loadFromBuffer = useCallback(async (buf: ArrayBuffer) => {
    setError(null)
    setLoading(true)
    try {
      const { rows: raw } = parseMarketWorkbook(buf)
      const mapped = mapRawRows(raw)
      if (!mapped.ok) {
        setError(
          `Не удалось прочитать строку ${mapped.rowIndex + 1}: не хватает колонок (${mapped.error.column}).`
        )
        setFileRows(null)
        setCopiedNameKeys(new Set())
        return
      }
      setFileRows(mapped.rows)
      setCopiedNameKeys(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка чтения файла')
      setFileRows(null)
      setCopiedNameKeys(new Set())
    } finally {
      setLoading(false)
    }
  }, [])

  const onFile = useCallback(
    async (file: File) => {
      const buf = await file.arrayBuffer()
      await loadFromBuffer(buf)
    },
    [loadFromBuffer]
  )

  const onPreset = useCallback((id: string) => {
    const p = PRESETS.find((x) => x.id === id)
    if (!p) return
    setActivePreset(id)
    setColumnFilters((prev) => applyPreset(prev, p))
  }, [])

  const onApplyAllPresets = useCallback(() => {
    setActivePreset(PRESET_ALL_ID)
    setColumnFilters(applyAllPresets())
  }, [])

  const onResetFilters = useCallback(() => {
    setActivePreset(null)
    setColumnFilters(clearFilters())
  }, [])

  return (
    <div className="min-h-screen eve-ui-root text-eve-text">
      <div className="mx-auto max-w-[1600px] px-4 py-6">
        <header className="mb-6 text-center">
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
                  {'Market'.split('').map((ch, i) => (
                    <span key={i} className="inline-block leading-none">
                      {ch}
                    </span>
                  ))}
                </div>
              </div>
            </span>
          </h1>
          <p className="sr-only">{tickerScreenReader}</p>
          <div
            className="relative mt-3 mx-auto w-full max-w-4xl overflow-hidden rounded-sm border border-eve-border/50 bg-eve-bg/55 shadow-eve-inset [background-image:repeating-linear-gradient(90deg,transparent,transparent_3px,rgba(42,49,66,0.12)_3px,transparent_4px)]"
            aria-hidden
          >
            <div className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-gradient-to-b from-eve-cyan/75 via-eve-accent/40 to-eve-cyan/50" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-0.5 bg-gradient-to-b from-eve-cyan/30 via-eve-accent/25 to-eve-cyan/30 opacity-40" />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-eve-cyan/30 via-eve-accent/55 to-eve-cyan/30" />
            <div className="overflow-x-auto overscroll-x-contain">
              <p className="font-eve flex min-h-[2.5rem] min-w-min items-center justify-center gap-x-1.5 px-3 py-2 text-center text-[9px] font-semibold leading-snug text-eve-bright/95 [word-spacing:0.12em] [letter-spacing:0.08em] [text-shadow:0_0_8px_rgba(236,238,242,0.04)] sm:gap-x-2 sm:px-4 sm:py-1.5 sm:text-[10px] sm:whitespace-nowrap sm:[word-spacing:0.2em] sm:[letter-spacing:0.1em]">
                <span className="shrink-0 text-eve-muted/55" aria-hidden>
                  ◆
                </span>
                <span
                  className={`shrink-0 font-tabular-nums ${
                    loading
                      ? 'text-eve-accent/90'
                      : fileRows === null
                        ? 'text-eve-muted/55'
                        : 'text-eve-cyan/95'
                  }`}
                  title={tableTitle}
                >
                  {tableTicker}
                </span>
                <span className="shrink-0 text-eve-muted/45" aria-hidden>
                  |
                </span>
                <span
                  className="shrink-0 text-eve-gold-bright/90"
                  title={`Регион ESI-выгрузки: ${getExportRegionLabel(tickerRegionId)}`}
                >
                  {regionTickerUpper}
                </span>
                <span className="shrink-0 text-eve-muted/45" aria-hidden>
                  |
                </span>
                <span
                  className="shrink-0 text-eve-cyan/95"
                  title="Порог «дорогой» единицы (млн ISK)"
                >
                  &gt;{priceMlnForTicker}M
                </span>
                <span className="shrink-0 text-eve-muted/45" aria-hidden>
                  |
                </span>
                <span
                  className="shrink-0 text-eve-cyan/90"
                  title="Broker (buy) и sales tax, %"
                >
                  {feeTicker}
                </span>
                {import.meta.env.DEV ? (
                  <>
                    <span className="shrink-0 text-eve-muted/45" aria-hidden>
                      |
                    </span>
                    <span className="shrink-0 text-eve-muted/70" title="Режим разработки">
                      DEV
                    </span>
                  </>
                ) : null}
                <span className="shrink-0 text-eve-muted/45" aria-hidden>
                  |
                </span>
                <span className="shrink-0 text-eve-bright/95">New Eden</span>
                <span className="shrink-0 text-eve-muted/45" aria-hidden>
                  |
                </span>
                <span className="shrink-0 text-eve-gold-bright/90">Excel с рынком</span>
                <span className="shrink-0 text-eve-muted/45" aria-hidden>
                  |
                </span>
                <span className="shrink-0 sm:max-w-none">
                  <span className="text-eve-bright/88">
                    Фильтры и сортировка по <span className="text-eve-cyan/95">марже</span>,{' '}
                    <span className="text-eve-cyan/95">спреду</span> в ISK и{' '}
                    <span className="text-eve-cyan/95">обороту</span>
                  </span>
                </span>
                <span className="shrink-0 text-eve-muted/55" aria-hidden>
                  ◆
                </span>
              </p>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-eve-border/30" />
          </div>
        </header>

        <div className="eve-panel mb-4 overflow-hidden">
          <div className="divide-y divide-eve-border/50">
            <div className="p-3 sm:p-4">
              <h2 className="eve-section-title mb-3">Локальный Excel</h2>
              <FileDropzone
                onFile={onFile}
                disabled={loading}
                embedded
              />
            </div>
            <div className="p-3 sm:p-4">
              <ExportBar
                onLoadBuffer={loadFromBuffer}
                disabled={loading}
                brokerFeePct={brokerFeePct}
                salesTaxPct={salesTaxPct}
                highPriceThresholdIsk={highPriceThresholdIsk}
                onBrokerFeeChange={onBrokerFeeChange}
                onSalesTaxChange={onSalesTaxChange}
                brokerInputRef={setBrokerInputEl}
                taxInputRef={setTaxInputEl}
                onMessageChange={setExportMsg}
              />
            </div>
          </div>
        </div>

        {error && (
          <div
            className="eve-panel mt-4 border-eve-danger/50 bg-eve-elevated/80 px-3 py-2.5 text-sm text-eve-danger"
            role="alert"
          >
            {error}
          </div>
        )}

        {rows !== null && (
          <>
            {exportMsg && (
              <p className="mb-3 rounded border border-eve-border/50 bg-eve-bg/50 px-2.5 py-1.5 text-xs text-eve-muted shadow-eve-inset">
                {exportMsg}
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-end gap-1.5 border-b border-eve-accent/20 pb-3">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={(e) => {
                      onPreset(p.id)
                      e.currentTarget.blur()
                    }}
                    className={`rounded border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 focus-visible:ring-offset-1 focus-visible:ring-offset-eve-surface ${
                      activePreset === p.id
                        ? 'border-eve-accent bg-eve-accent-muted text-eve-accent shadow-[inset_0_0_0_1px_rgba(184,150,61,0.2)]'
                        : 'border-eve-border/80 text-eve-muted hover:border-eve-accent/40 hover:text-eve-bright'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={(e) => {
                    onApplyAllPresets()
                    e.currentTarget.blur()
                  }}
                  className={`rounded border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 focus-visible:ring-offset-1 focus-visible:ring-offset-eve-surface ${
                    activePreset === PRESET_ALL_ID
                      ? 'border-eve-accent bg-eve-accent-muted text-eve-accent shadow-[inset_0_0_0_1px_rgba(184,150,61,0.2)]'
                      : 'border-eve-border/80 text-eve-muted hover:border-eve-accent/40 hover:text-eve-bright'
                  }`}
                >
                  Применить все
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    onResetFilters()
                    e.currentTarget.blur()
                  }}
                  className="rounded border border-eve-border/80 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-eve-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 focus-visible:ring-offset-1 focus-visible:ring-offset-eve-surface hover:border-eve-muted/50 hover:text-eve-bright"
                >
                  Сбросить фильтры
                </button>
            </div>
            <div className="mb-2 mt-3 flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs text-eve-muted sm:flex-row sm:items-center">
                <span className="max-w-[20rem]">
                  Порог цены 1 ед. (млн ISK): выше — снижается выгодность
                  (маржа в оценке и цвет ячейки маржи)
                </span>
                <input
                  ref={setPriceInputEl}
                  type="number"
                  min={0.1}
                  step={1}
                  className="w-24 rounded border border-eve-border/80 bg-eve-bg/90 px-2 py-1.5 tabular-nums text-eve-bright shadow-eve-inset focus:border-eve-accent/70 focus:outline-none"
                  value={priceThresholdMln}
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(',', '.'))
                    if (!Number.isFinite(n) || n < 0.1) return
                    setPriceThresholdMln(n)
                    try {
                      localStorage.setItem(LS_PRICE_MLN, String(n))
                    } catch {
                      /* ignore */
                    }
                  }}
                />
                <span className="tabular-nums text-eve-muted/90" title="В ISK">
                  = {formatInteger(highPriceThresholdIsk)} ISK
                </span>
              </label>
            </div>
            <div className="eve-panel p-1.5">
              <MarketTable
                data={rows}
                columnFilters={columnFilters}
                onColumnFiltersChange={setColumnFilters}
                highPriceThresholdIsk={highPriceThresholdIsk}
                copiedNameKeys={copiedNameKeys}
                onNameCopied={onNameCopied}
              />
            </div>
          </>
        )}

        {rows === null && !error && !loading && (
          <p className="mt-4 text-center text-sm text-eve-muted/90">
            Пока нет данных. Выберите выгрузку (например liq_*.xlsx) или
            загрузите локальный файл.
          </p>
        )}

        {loading && (
          <p className="mt-4 text-center text-sm font-semibold uppercase tracking-wider text-eve-accent/90">
            Загрузка…
          </p>
        )}
      </div>
    </div>
  )
}

export default App
