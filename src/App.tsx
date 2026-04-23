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

  const onNameCopied = useCallback((key: string) => {
    setCopiedNameKeys((prev) => new Set([...prev, key]))
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

  const hint = useMemo(
    () => (
      <p className="text-xs leading-relaxed text-eve-muted">
        <strong className="text-eve-bright/95">Маржа, %</strong> — после broker
        (buy) и sales tax + broker (sell), к list ask.{' '}
        <strong className="text-eve-bright/95">Спред, ISK</strong> — ask
        − bid (без комиссий). <strong className="text-eve-bright/95">Оборот</strong> в файле в
        млн ISK, в таблице — полные ISK. Ячейка «Маржа» подсвечивается по величине
        маржи. «Средняя в спреде» — полоска buy→sell с центром в 0,5. «Выгодность
        входа» — шкала 0–100 % (полоска в ячейке) по абсолютным порогам (маржа,
        оборот, спред); при 0 сделок или 0 оборота балл занижен. Дорогая единица
        (цена выше порога, млн ISK) — меньше вклад маржи в оценку и бледнее фон
        ячейки маржи.
      </p>
    ),
    []
  )

  return (
    <div className="min-h-screen eve-ui-root text-eve-text">
      <div className="mx-auto max-w-[1600px] px-4 py-6">
        <header className="mb-6">
          <div className="eve-chrome-top mb-4 max-w-md" aria-hidden />
          <h1 className="font-eve text-xl font-bold uppercase tracking-[0.18em] text-eve-bright sm:text-2xl">
            Рынок — выгрузка
          </h1>
          <p className="eve-kicker mt-2 max-w-2xl leading-relaxed">
            New Eden · Excel с рынком · фильтры и сортировка по марже, спреду в
            ISK и обороту
          </p>
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
              <div className="flex flex-wrap items-center gap-0 text-xs text-eve-text">
                <div className="flex flex-wrap items-center gap-1.5 pr-3 sm:border-r sm:border-eve-border">
                  <span className="italic text-eve-muted">Broker fee:</span>
                  <input
                    ref={setBrokerInputEl}
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    className="w-20 rounded border border-eve-border/80 bg-eve-bg/90 px-2 py-1 tabular-nums text-eve-bright shadow-eve-inset focus:border-eve-accent/70 focus:outline-none"
                    value={brokerFeePct}
                    onChange={(e) => {
                      const n = Number(e.target.value.replace(',', '.'))
                      if (!Number.isFinite(n) || n < 0 || n > 100) return
                      setBrokerFeePct(n)
                      try {
                        localStorage.setItem(LS_BROKER_PCT, String(n))
                      } catch {
                        /* ignore */
                      }
                    }}
                    aria-label="Broker fee, процент"
                  />
                  <span className="tabular-nums text-eve-muted">%</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-0 sm:mt-0 sm:pl-3">
                  <span className="italic text-eve-muted">Sales tax:</span>
                  <input
                    ref={setTaxInputEl}
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    className="w-20 rounded border border-eve-border/80 bg-eve-bg/90 px-2 py-1 tabular-nums text-eve-bright shadow-eve-inset focus:border-eve-accent/70 focus:outline-none"
                    value={salesTaxPct}
                    onChange={(e) => {
                      const n = Number(e.target.value.replace(',', '.'))
                      if (!Number.isFinite(n) || n < 0 || n > 100) return
                      setSalesTaxPct(n)
                      try {
                        localStorage.setItem(LS_SALES_TAX_PCT, String(n))
                      } catch {
                        /* ignore */
                      }
                    }}
                    aria-label="Sales tax, процент"
                  />
                  <span className="tabular-nums text-eve-muted">%</span>
                </div>
                <p className="w-full pl-0 pt-1 text-[11px] text-eve-muted/90 sm:w-auto sm:pl-3 sm:pt-0">
                  Buy: bid × (1 + broker). Sell: ask × (1 − tax − broker). Маржа:
                  (выручка sell − цена buy) / ask
                </p>
              </div>
            </div>
            <div className="mb-2 mt-1">{hint}</div>
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
