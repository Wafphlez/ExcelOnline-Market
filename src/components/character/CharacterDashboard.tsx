import
  {
    useCallback,
    useEffect,
    useMemo,
    useState,
    type CSSProperties,
    type ReactNode,
  } from 'react'
import
  {
    LogOut,
    RefreshCw,
    Shield,
    User,
  } from 'lucide-react'
import
  {
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
  } from 'recharts'
import { useCharacterDashboardData } from '../../hooks/useCharacterDashboardData'
import { characterPortraitUrl } from '../../lib/eve/constants'
import
  {
    isEveSsoConfigured,
    startEveSsoLogin,
    logoutEveSession,
  } from '../../lib/eve/eveSso'
import { getAccessToken, getRefreshToken } from '../../lib/eve/authStore'
import { fetchTypeNameMap } from '../../lib/eve/characterEsi'
import
  {
    aggregateMarketFeeDeltasFromJournalEstimated,
    aggregateTradeProfitByType,
    buildWalletJournalRefIdToTypeMap,
    buildWalletTransactionIdToTypeMap,
    DASHBOARD_RANGE_PRESETS,
    filterJournalInRange,
    filterTransactionsInRange,
    findDashboardRange,
    MS_DAY,
    oldestJournalTimeMs,
    tradeProfitCumulativeDailySeries,
    tradeProfitCumulativeHourlySeries,
    type DashboardRangeId,
    type TradeProfitByTypeMode,
    type TradeProfitHow,
    UNMATCHED_FEE_TYPE_ID,
  } from '../../lib/eve/capitalMetrics'
import
  {
    formatIsk,
    formatCompactKmb,
    formatInteger,
    formatIskMillionsShort,
  } from '../../lib/formatNumber'
import { dashboardTwinPanelHeightClass } from '../../lib/ui/dashboardTwinPanel'
import { ActiveMarketOrdersBlock } from './ActiveMarketOrdersBlock'
import { EveSsoLoginPanel } from './EveSsoLoginPanel'

type CharacterDashboardProps = Readonly<{
  /** Сообщение одноразово после callback SSO */
  bootMessage?: string | null
  onClearBootMessage?: () => void
}>

const CHART_COL = {
  grid: 'rgba(74, 88, 120, 0.35)',
  tick: 'rgba(195, 204, 214, 0.55)',
  /** Серая линия «динамика» (нетто за день) */
  dynamics: 'rgba(148, 155, 168, 0.92)',
  /** Горизонталь y = 0 */
  zeroLine: 'rgba(115, 125, 142, 0.75)',
  wallet: '#5fd4e8',
  net: '#b8963d',
  /** Ступень «итог на конец предыдущих UTC-суток» поверх почасовой кумуляции */
  dailyStep: 'rgba(118, 132, 158, 0.52)',
  buy: 'rgba(95, 212, 232, 0.85)',
  sell: 'rgba(184, 150, 61, 0.85)',
} as const

function floorUtcDayMsFromMs(ms: number): number
{
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function pickNiceStep(rawStep: number): number
{
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1
  const power = Math.floor(Math.log10(rawStep))
  const scale = 10 ** power
  const norm = rawStep / scale
  if (norm <= 1) return 1 * scale
  if (norm <= 2) return 2 * scale
  if (norm <= 2.5) return 2.5 * scale
  if (norm <= 5) return 5 * scale
  return 10 * scale
}

function buildNiceIntegerAxis(
  minValue: number,
  maxValue: number,
  targetTickCount = 5
): {
  domain: [ number, number ]
  ticks: number[]
}
{
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue))
  {
    return { domain: [ -1, 1 ], ticks: [ -1, 0, 1 ] }
  }
  const count = Math.max(3, Math.floor(targetTickCount))
  const span = maxValue - minValue
  const baseRawStep = span > 0 ? span / (count - 1) : Math.max(Math.abs(minValue), 1)
  const step = Math.max(1, pickNiceStep(baseRawStep))
  let niceMin = Math.floor(minValue / step) * step
  let niceMax = Math.ceil(maxValue / step) * step
  if (niceMin === niceMax)
  {
    niceMin -= step
    niceMax += step
  }
  const ticks: number[] = []
  for (let v = niceMin; v <= niceMax + step * 1e-9; v += step)
  {
    ticks.push(Math.round(v))
    if (ticks.length > 1000) break
  }
  if (ticks.length < 2)
  {
    return {
      domain: [ niceMin, niceMax ],
      ticks: [ Math.round(niceMin), Math.round(niceMax) ],
    }
  }
  return {
    domain: [ ticks[0] ?? Math.round(niceMin), ticks[ticks.length - 1] ?? Math.round(niceMax) ],
    ticks,
  }
}

function tradeProfitShareCellClass(profit: number): string
{
  if (profit > 0) return 'eve-green'
  if (profit < 0) return 'eve-red'
  return 'text-eve-muted/70'
}

function tradeProfitRgbVar(profit: number): string | null
{
  if (profit > 0) return 'var(--eve-green-rgb)'
  if (profit < 0) return 'var(--eve-red-rgb)'
  return null
}

function tradeProfitTableSumToneClass(sum: number): string
{
  if (sum > 0) return 'eve-green'
  if (sum < 0) return 'eve-red'
  return 'text-eve-muted'
}

function TradeProfitLineTooltipContent(
  { active, payload, label }: Readonly<{
    active?: boolean
    payload?: readonly { payload?: Record<string, unknown> }[]
    label?: unknown
  }>
): JSX.Element | null
{
  if (!active || payload == null || payload.length === 0) return null
  const row = payload[0]?.payload as
    | {
      tMs?: number
      cumulativeProfit?: number
      profitUtcDay?: number
    }
    | undefined
  if (row == null) return null
  let ms: number
  if (typeof label === 'number' && Number.isFinite(label))
  {
    ms = label
  } else if (typeof row.tMs === 'number')
  {
    ms = row.tMs
  } else
  {
    ms = Number.NaN
  }
  if (!Number.isFinite(ms)) return null
  const cum = row.cumulativeProfit
  const dayP = row.profitUtcDay
  return (
    <div
      className="rounded border px-2.5 py-2 text-[11px] text-eve-bright"
      style={ {
        background: 'rgba(16, 20, 28, 0.96)',
        borderColor: 'rgba(123, 142, 176, 0.45)',
      } }
    >
      <div className="mb-1.5 text-eve-muted">
        { new Date(ms).toLocaleString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'UTC',
        }) }{ ' ' }
        UTC
      </div>
      { typeof cum === 'number' && (
        <div className="tabular-nums">
          <span className="text-eve-muted">Накопленная:{ ' ' }</span>
          <span className="font-medium text-eve-bright">{ formatIsk(cum) } ISK</span>
        </div>
      ) }
      { typeof dayP === 'number' && (
        <div className="mt-1 tabular-nums">
          <span className="text-eve-muted">За сутки (UTC):{ ' ' }</span>
          <span className="font-medium text-eve-bright">{ formatIsk(dayP) } ISK</span>
        </div>
      ) }
    </div>
  )
}

function TabButton(
  { active, children, onClick }: Readonly<{
    active: boolean
    children: ReactNode
    onClick: () => void
  }>
): JSX.Element
{
  return (
    <button
      type="button"
      onClick={ onClick }
      className={ `rounded-md border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 ${
        active
          ? 'border-eve-accent bg-eve-accent-muted text-eve-accent glow-kpi'
          : 'border-eve-border/80 bg-eve-surface/45 text-eve-muted hover:border-eve-accent/40 hover:text-eve-bright'
      }` }
    >
      { children }
    </button>
  )
}

export function CharacterDashboard(
  { bootMessage, onClearBootMessage }: CharacterDashboardProps
): JSX.Element
{
  const
    {
      state,
      refresh,
      refreshActiveMarketOrders,
      activeMarketOrdersRefreshing,
    } = useCharacterDashboardData(true)
  const [rangeId, setRangeId] = useState<DashboardRangeId>('d30')
  const [tradeProfitMode, setTradeProfitMode] =
    useState<TradeProfitByTypeMode>('roundtrip')
  const [tradeProfitHow, setTradeProfitHow] = useState<TradeProfitHow>('fifo')
  const [tradeProfitTypeQuery, setTradeProfitTypeQuery] = useState('')
  const [typeLabels, setTypeLabels] = useState<Map<number, string> | null>(null)
  const [loginErr, setLoginErr] = useState<string | null>(null)
  const ssoOk =
    isEveSsoConfigured() &&
    (getRefreshToken() != null || getAccessToken() != null)

  const period = useMemo(() =>
  {
    if (state.status !== 'ready') return null
    const now = Date.now()
    if (rangeId === 'all')
    {
      return {
        id: 'all' as const,
        label: 'Вся ESI-выгрузка',
        fromMs: 0,
        toMs: now,
        durationMs: now,
      }
    }
    const preset = findDashboardRange(rangeId)
    if (!preset) return null
    return {
      ...preset,
      fromMs: now - preset.durationMs,
      toMs: now,
    }
  }, [state, rangeId])

  /** Сколько типов в таблице «торговая прибыль» (после сортировки по прибыли; хвост с убытками). */
  const TRADE_PROFIT_TOP_N = 200

  const tradeFeeDeltas = useMemo(() =>
  {
    if (state.status !== 'ready' || !period) return null
    const journalR = filterJournalInRange(
      state.data.journal,
      period.fromMs,
      period.toMs
    )
    const tx = filterTransactionsInRange(
      state.data.transactions,
      period.fromMs,
      period.toMs
    )
    return aggregateMarketFeeDeltasFromJournalEstimated(
      journalR,
      buildWalletTransactionIdToTypeMap(state.data.transactions),
      buildWalletJournalRefIdToTypeMap(state.data.transactions),
      tx
    )
  }, [state, period])

  /** Сумма торговой прибыли по всем типам за период (как график; без лимита топ-N в таблице). */
  const tradeProfitTotalAllTypesInRange = useMemo(() =>
  {
    if (state.status !== 'ready' || !period) return null
    const tx = filterTransactionsInRange(
      state.data.transactions,
      period.fromMs,
      period.toMs
    )
    const rows = aggregateTradeProfitByType(
      tx,
      Number.POSITIVE_INFINITY,
      tradeProfitMode,
      tradeProfitHow,
      tradeFeeDeltas
    )
    return rows.reduce((s, r) => s + r.profit, 0)
  }, [state, period, tradeProfitMode, tradeProfitHow, tradeFeeDeltas])

  const tradeProfitInRange = useMemo(() =>
  {
    if (state.status !== 'ready' || !period) return []
    const tx = filterTransactionsInRange(
      state.data.transactions,
      period.fromMs,
      period.toMs
    )
    return aggregateTradeProfitByType(
      tx,
      TRADE_PROFIT_TOP_N,
      tradeProfitMode,
      tradeProfitHow,
      tradeFeeDeltas
    )
  }, [state, period, tradeProfitMode, tradeProfitHow, tradeFeeDeltas])

  /** Кумулятив по часам UTC: та же FIFO/брутто и режимы, что таблица «по типам». */
  const tradeProfitByTypeCumulativeSeries = useMemo(() =>
  {
    if (state.status !== 'ready' || !period) return []
    return tradeProfitCumulativeHourlySeries(
      state.data.transactions,
      state.data.journal,
      period.fromMs,
      period.toMs,
      tradeProfitMode,
      tradeProfitHow,
      buildWalletTransactionIdToTypeMap(state.data.transactions),
      buildWalletJournalRefIdToTypeMap(state.data.transactions),
    )
  }, [state, period, tradeProfitMode, tradeProfitHow])

  /** Кумулятив по календарным суткам UTC (для ступени и «прибыль за сутки» в тултипе). */
  const tradeProfitDailySeries = useMemo(() =>
  {
    if (state.status !== 'ready' || !period) return []
    return tradeProfitCumulativeDailySeries(
      state.data.transactions,
      state.data.journal,
      period.fromMs,
      period.toMs,
      tradeProfitMode,
      tradeProfitHow,
      buildWalletTransactionIdToTypeMap(state.data.transactions),
      buildWalletJournalRefIdToTypeMap(state.data.transactions),
    )
  }, [state, period, tradeProfitMode, tradeProfitHow])

  /** Почасовые точки + unix-ms; плюс дневная прибыль UTC и ступень «итог текущих UTC-суток». */
  const tradeProfitChartData = useMemo(() =>
  {
    const hourly = tradeProfitByTypeCumulativeSeries
    if (hourly.length === 0) return []

    const dailySorted = tradeProfitDailySeries
      .map((p) =>
      {
        const parts = p.day.split('-')
        if (parts.length !== 3) return null
        const y = Number(parts[0])
        const mo = Number(parts[1])
        const d = Number(parts[2])
        if ([ y, mo, d ].every((n) => Number.isFinite(n)))
        {
          return { dayMs: Date.UTC(y, mo - 1, d), cum: p.cumulativeProfit }
        }
        return null
      })
      .filter((x): x is { dayMs: number; cum: number } => x != null)
      .sort((a, b) => a.dayMs - b.dayMs)

    const profitByDayMs = new Map<number, number>()
    const endCumByDayMs = new Map<number, number>()
    for (let i = 0; i < dailySorted.length; i++)
    {
      const cur = dailySorted[i]
      const prevRow = i > 0 ? dailySorted[i - 1] : undefined
      if (cur == null) continue
      const prevCum = prevRow?.cum ?? 0
      profitByDayMs.set(cur.dayMs, cur.cum - prevCum)
      endCumByDayMs.set(cur.dayMs, cur.cum)
    }

    return hourly.map((p) =>
    {
      const tMs = new Date(p.t).getTime()
      const dayMs = Number.isFinite(tMs) ? floorUtcDayMsFromMs(tMs) : 0
      return {
        ...p,
        tMs: Number.isFinite(tMs) ? tMs : 0,
        profitUtcDay: profitByDayMs.get(dayMs) ?? 0,
        dailyOverlayStep: endCumByDayMs.get(dayMs) ?? 0,
      }
    })
  }, [tradeProfitByTypeCumulativeSeries, tradeProfitDailySeries])

  const tradeProfitByTypeChartYAxis = useMemo((): {
    domain: [ number, number ]
    ticks: number[]
  } =>
  {
    const s = tradeProfitChartData
    if (s.length === 0) return { domain: [ -1, 1 ], ticks: [ -1, 0, 1 ] }
    const vals = s.flatMap((d) => [ d.cumulativeProfit, d.dailyOverlayStep ])
    const dMin = Math.min(0, ...vals)
    const dMax = Math.max(0, ...vals)
    return buildNiceIntegerAxis(dMin, dMax, 9)
  }, [tradeProfitChartData])

  const tradeProfitChartUtcMidnightTicks = useMemo((): number[] | undefined =>
  {
    const s = tradeProfitChartData
    if (s.length === 0) return undefined
    const first = s[0]
    const last = s[s.length - 1]
    if (first == null || last == null) return undefined
    const lo = first.tMs
    const hi = last.tMs
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return undefined
    const floorDay = (ms: number) =>
    {
      const d = new Date(ms)
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    }
    const startDay = floorDay(lo)
    const endDay = floorDay(hi)
    const ticks: number[] = []
    for (let m = startDay; m <= endDay; m += MS_DAY)
    {
      if (m >= lo && m <= hi) ticks.push(m)
    }
    return ticks.length > 0 ? ticks : undefined
  }, [tradeProfitChartData])

  const tradeProfitXAxisExtras = useMemo(
    () =>
      tradeProfitChartUtcMidnightTicks != null && tradeProfitChartUtcMidnightTicks.length > 0
        ? { ticks: tradeProfitChartUtcMidnightTicks }
        : {},
    [tradeProfitChartUtcMidnightTicks]
  )

  const journalCoverageHint = useMemo(() =>
  {
    if (state.status !== 'ready' || !period) return null
    if (period.fromMs === 0) return null
    const oldest = oldestJournalTimeMs(state.data.journal)
    if (oldest == null) return null
    if (period.fromMs < oldest)
    {
      return `В выгрузке журнала самая ранняя дата: ${ new Date(
        oldest
      ).toLocaleString('ru-RU') }.`
    }
    return null
  }, [state, period])

  const transactionsInRange = useMemo(() =>
  {
    if (state.status !== 'ready' || !period) return []
    return filterTransactionsInRange(
      state.data.transactions,
      period.fromMs,
      period.toMs
    )
  }, [state, period])

  useEffect(() =>
  {
    if (state.status !== 'ready') return
    const ids = tradeProfitInRange
      .map((t) => t.type_id)
      .filter((id) => id > 0)
    const ac = new AbortController()
    void (async () =>
    {
      const m = await fetchTypeNameMap(ids, ac.signal)
      if (!ac.signal.aborted) setTypeLabels(m)
    })()
    return () => ac.abort()
  }, [state, tradeProfitInRange])

  const onLogin = useCallback(() =>
  {
    setLoginErr(null)
    void (async () =>
    {
      try
      {
        await startEveSsoLogin()
      } catch (e)
      {
        setLoginErr(e instanceof Error ? e.message : 'Ошибка SSO')
      }
    })()
  }, [])

  const onLogout = useCallback(() =>
  {
    logoutEveSession()
    setTypeLabels(null)
    refresh()
  }, [refresh])

  const tradeProfitWithNames = useMemo(() =>
  {
    if (state.status !== 'ready') return []
    return tradeProfitInRange.map((t) => ({
      ...t,
      name: t.type_id === UNMATCHED_FEE_TYPE_ID
        ? 'Прочие комиссии (журнал)'
        : (typeLabels?.get(t.type_id) ?? `#${ t.type_id }`),
    }))
  }, [state, typeLabels, tradeProfitInRange])

  const tradeProfitTableRows = useMemo(() =>
  {
    const q = tradeProfitTypeQuery.trim().toLowerCase()
    if (q === '') return tradeProfitWithNames
    return tradeProfitWithNames.filter((r) =>
      r.name.toLowerCase().includes(q)
      || String(r.type_id).includes(q)
    )
  }, [tradeProfitWithNames, tradeProfitTypeQuery])

  /** Сумма |прибыль| по витрине; знаменатель для доли со знаком. */
  const tradeProfitAbsSum = useMemo(
    () => tradeProfitTableRows.reduce(
      (s, r) => s + Math.abs(r.profit),
      0
    ),
    [tradeProfitTableRows]
  )

  const tradeProfitTableProfitSum = useMemo(
    () => tradeProfitTableRows.reduce((s, r) => s + r.profit, 0),
    [tradeProfitTableRows]
  )

  const tradeProfitNetSharePct = useMemo(
    () =>
      tradeProfitAbsSum > 0
        ? (100 * tradeProfitTableProfitSum) / tradeProfitAbsSum
        : null,
    [tradeProfitAbsSum, tradeProfitTableProfitSum]
  )

  const iskFormatter = (v: number) => `${ formatIsk(v) } ISK`

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto text-white">
      <div className="w-full max-w-full px-2 py-4 sm:px-4">
        <div className="eve-panel w-full max-w-full p-1.5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="eve-section-title flex items-center gap-2">
              <User className="h-4 w-4 text-eve-accent" aria-hidden />
              Персонаж и торговля
            </h2>
            <div className="flex flex-wrap items-center gap-1.5">
              { ssoOk ? (
                <TabButton
                  active
                  onClick={ onLogout }
                >
                  <span className="inline-flex items-center gap-1">
                    <LogOut className="h-3.5 w-3.5" />
                    Выйти (EVE SSO)
                  </span>
                </TabButton>
              ) : null }
              <button
                type="button"
                onClick={ () => refresh() }
                disabled={ state.status === 'loading' }
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-eve-border/70 bg-eve-surface/35 text-eve-muted shadow-glass-subtle transition-colors hover:border-eve-accent/50 hover:text-eve-accent disabled:opacity-50"
                title="Обновить данные ESI"
              >
                <RefreshCw
                  className={ `h-3.5 w-3.5 ${ state.status === 'loading' ? 'animate-spin' : '' }` }
                />
              </button>
            </div>
          </div>

          { loginErr && (
            <p className="mb-3 rounded-md border border-eve-danger/45 bg-eve-elevated/35 px-3 py-2 text-sm text-eve-danger/95" role="alert">
              { loginErr }
            </p>
          ) }

          { !isEveSsoConfigured() && (
            <p className="mb-3 rounded-md border border-eve-danger/45 bg-eve-elevated/35 px-3 py-2 text-sm text-eve-danger/95">
              Укажите{ ' ' }
              <code className="text-eve-bright/90">VITE_EVE_SSO_CLIENT_ID</code>
              { ' ' }в .env (приложение CCP) и, при необходимости,{ ' ' }
              <code className="text-eve-bright/90">VITE_EVE_SSO_REDIRECT_URI</code>
              { ' ' }. Redirect URI в CCP должен совпадать с адресом приложения (тот же origin + path).
            </p>
          ) }

          { !ssoOk && (
            <div className="mb-3">
              <EveSsoLoginPanel
                onLogin={ onLogin }
                disabled={ !isEveSsoConfigured() }
              />
            </div>
          ) }

          { bootMessage && (
            <p className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded border border-eve-accent/40 bg-eve-accent-muted/20 px-3 py-2 text-xs text-eve-bright/95">
              { bootMessage }
              { onClearBootMessage && (
                <button
                  type="button"
                  className="shrink-0 text-eve-muted underline hover:text-eve-bright"
                  onClick={ onClearBootMessage }
                >
                  Скрыть
                </button>
              ) }
            </p>
          ) }

          { state.status === 'unauthorized' && (
            <p className="text-sm text-eve-muted">{ state.message }</p>
          ) }
          { state.status === 'error' && (
            <p className="text-sm text-eve-danger" role="alert">
              { state.message }
            </p>
          ) }
          { state.status === 'loading' && (
            <p className="text-sm font-semibold uppercase tracking-wider text-eve-accent/90">
              Загрузка ESI…
            </p>
          ) }

          { state.status === 'ready' && (
            <div className="w-full min-w-0 max-w-full space-y-4">
              <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
                <div className="glass-subtle p-3">
                  <div className="flex items-start gap-3">
                    <img
                      src={ characterPortraitUrl(state.data.characterId, 128) }
                      width={ 72 }
                      height={ 72 }
                      alt=""
                      className="shrink-0 rounded border border-eve-border/60"
                    />
                    <div className="min-w-0">
                      <p className="text-lg font-bold text-eve-bright/95 [text-shadow:0_0_8px_rgba(236,238,242,0.04)]">
                        { state.data.character.name }
                      </p>
                      { state.data.corporation && (
                        <p
                          className="mt-0.5 text-xs text-eve-muted"
                          title={ state.data.corporation.name }
                        >
                          <span className="font-semibold text-eve-gold/90">[{ state.data.corporation.ticker }]</span>
                          { ' ' }
                          { state.data.corporation.name }
                        </p>
                      ) }
                    </div>
                  </div>
                </div>
                <div className="glass-subtle p-3">
                  <p className="eve-kicker text-[10px]">Net worth (оценка)</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-eve-gold-bright">
                    { iskFormatter(state.data.netWorth) }
                  </p>
                </div>
                <div className="glass-subtle p-3">
                  <p className="eve-kicker text-[10px]">Кошелёк (ISK)</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-eve-cyan/95">
                    { iskFormatter(state.data.wallet) }
                  </p>
                </div>
                <div className="glass-subtle p-3">
                  <p className="eve-kicker text-[10px]">Активы (оценка)</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-eve-accent/95">
                    { iskFormatter(state.data.assetsValue) }
                  </p>
                </div>
                <div className="glass-subtle p-3">
                  <p className="eve-kicker text-[10px]">Эскроу (buy-ордера)</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-eve-amber-200/90">
                    { iskFormatter(state.data.marketEscrowIsk) }
                  </p>
                </div>
                <div className="glass-subtle p-3">
                  <p className="eve-kicker text-[10px]">PLEX в ассетах ESI (оценка)</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-eve-bright/95">
                    { iskFormatter(state.data.plexValueInAssetsIsk) }
                  </p>
                </div>
              </div>

              <div className="glass-subtle p-2.5">
                <p className="eve-kicker mb-2 text-[10px]">Период анализа</p>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  { DASHBOARD_RANGE_PRESETS.map((p) => (
                    <TabButton
                      key={ p.id }
                      active={ rangeId === p.id }
                      onClick={ () => setRangeId(p.id) }
                    >
                      { p.label }
                    </TabButton>
                  )) }
                </div>
                <div className="text-xs text-eve-bright/90">
                  <span className="text-eve-muted">
                    Торговая прибыль по типам за период «{ period?.label ?? '—' }» (
                    { tradeProfitMode === 'roundtrip' ? 'Купля–продажа' : 'Все типы' }
                    { ', ' }
                    { tradeProfitHow === 'fifo' ? 'FIFO' : 'Брутто' }
                    ; сумма по всем типам):
                  </span>
                  { ' ' }
                  <span className="tabular-nums font-semibold text-eve-cyan/95">
                    { tradeProfitTotalAllTypesInRange == null
                      ? '—'
                      : iskFormatter(tradeProfitTotalAllTypesInRange) }
                  </span>
                </div>
                { journalCoverageHint && (
                  <p className="mt-2 text-[10px] leading-snug text-eve-gold/85">
                    { journalCoverageHint }
                  </p>
                ) }
              </div>

              <div className="w-full min-w-0">
                <div className="@container glass-subtle min-w-0 p-2.5">
                  <h3 className="eve-section-title mb-2 leading-snug">
                    Торговая прибыль по типам{ ' ' }
                    <span className="block text-xs font-normal normal-case tracking-normal text-eve-muted/90 sm:inline sm:ml-1.5">
                      (линейный)
                    </span>
                  </h3>
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <TabButton
                      active={ tradeProfitMode === 'roundtrip' }
                      onClick={ () => setTradeProfitMode('roundtrip') }
                    >
                      Купля–продажа
                    </TabButton>
                    <TabButton
                      active={ tradeProfitMode === 'all' }
                      onClick={ () => setTradeProfitMode('all') }
                    >
                      Все типы
                    </TabButton>
                    <span className="mx-0.5 text-eve-border/80" aria-hidden>
                      |
                    </span>
                    <TabButton
                      active={ tradeProfitHow === 'fifo' }
                      onClick={ () => setTradeProfitHow('fifo') }
                    >
                      FIFO
                    </TabButton>
                    <TabButton
                      active={ tradeProfitHow === 'gross' }
                      onClick={ () => setTradeProfitHow('gross') }
                    >
                      Брутто
                    </TabButton>
                  </div>
                  { tradeProfitByTypeCumulativeSeries.length > 0 ? (
                    <div className="mb-2 h-[240px] w-full min-w-0 sm:h-[280px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={ tradeProfitChartData }
                          margin={ { top: 8, right: 8, left: 4, bottom: 0 } }
                        >
                          <CartesianGrid
                            stroke={ CHART_COL.grid }
                            strokeDasharray="3 3"
                          />
                          <XAxis
                            dataKey="tMs"
                            type="number"
                            scale="time"
                            domain={ [ 'dataMin', 'dataMax' ] }
                            interval={ 0 }
                            { ...tradeProfitXAxisExtras }
                            tick={ { fontSize: 8, fill: CHART_COL.tick } }
                            tickFormatter={ (ms: number) =>
                            {
                              if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
                              const d = new Date(ms)
                              return d.toLocaleString('ru-RU', {
                                day: '2-digit',
                                month: '2-digit',
                                timeZone: 'UTC',
                              })
                            } }
                          />
                          <YAxis
                            domain={ tradeProfitByTypeChartYAxis.domain }
                            ticks={ tradeProfitByTypeChartYAxis.ticks }
                            interval={ 0 }
                            tick={ { fontSize: 9, fill: CHART_COL.tick } }
                            tickFormatter={ (n) => formatCompactKmb(n as number) }
                            width={ 64 }
                          />
                          <Tooltip content={ TradeProfitLineTooltipContent } />
                          <Legend />
                          <ReferenceLine
                            y={ 0 }
                            stroke={ CHART_COL.zeroLine }
                            strokeWidth={ 1.25 }
                          />
                          <Line
                            type="monotone"
                            dataKey="cumulativeProfit"
                            name="По часам (накопл.), ISK"
                            stroke={ CHART_COL.net }
                            strokeWidth={ 2.25 }
                            dot={ false }
                            activeDot={ { r: 3 } }
                          />
                          <Line
                            type="stepAfter"
                            dataKey="dailyOverlayStep"
                            name="Сутки UTC (ступень с начала дня)"
                            stroke={ CHART_COL.dailyStep }
                            strokeWidth={ 1.65 }
                            dot={ false }
                            activeDot={ { r: 2.5 } }
                            isAnimationActive={ false }
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p className="mb-2 text-sm text-eve-muted">
                      В выбранном периоде нет сделок и маркет-комиссий в журнале — график прибыли по типам пуст.
                    </p>
                  ) }
                  <p className="text-[9px] text-eve-muted/75">
                    Накопление по часам (UTC) в той же методике, что таблица; вторая линия — ступень «итог на конец текущих
                    UTC-суток», перенесённый на начало этих же суток UTC. В подсказке — накопленная прибыль и прибыль за календарные сутки UTC. На графике учтены все
                    типы, в таблице — до{ ' ' }
                    { TRADE_PROFIT_TOP_N } строк по прибыли.
                  </p>
                </div>
              </div>

              <div className="flex w-full min-w-0 max-w-full flex-col gap-4">
                <div className="grid w-full min-w-0 grid-cols-1 items-stretch gap-3 lg:grid-cols-2">
                  <div className="flex w-full min-w-0">
                    <ActiveMarketOrdersBlock
                      data={ state.data.activeMarketOrders }
                      errorMessage={ state.data.activeMarketOrdersError }
                      onRefresh={ refreshActiveMarketOrders }
                      refreshing={ activeMarketOrdersRefreshing }
                    />
                  </div>
                  <div
                    className={ `@container glass-subtle flex w-full min-w-0 flex-col p-2.5 ${ dashboardTwinPanelHeightClass } min-h-0` }
                  >
                  <h3 className="eve-section-title mb-2 shrink-0 leading-snug">
                    Торговая прибыль по типам{ ' ' }
                    <span className="block text-xs font-normal normal-case tracking-normal text-eve-muted/90 sm:inline sm:ml-1.5">
                      (таблица)
                    </span>
                  </h3>
                  <p className="mb-2 shrink-0 text-[9px] leading-snug text-eve-muted/80">
                    Параметры{ ' ' }
                    <span className="whitespace-nowrap">Купля–продажа</span>
                    { ' ' }/ Все типы и FIFO / Брутто — те же, что у{ ' ' }
                    <span className="whitespace-nowrap">линейного графика</span>
                    { ' ' }выше.
                  </p>
                  <p className="mb-2 shrink-0 text-[9px] leading-snug text-eve-muted/80">
                    Сверка с чужой таблицей: часто совпадает по{ ' ' }
                    <span className="whitespace-nowrap">периоду</span> и
                    { ' ' }
                    <span className="whitespace-nowrap">«брутто»</span>
                    { ' ' }или отдельному отчёту в игре; 1:1 не гарантируется (ESI обрезает историю,
                    исходы и налоги везде разные).
                  </p>
                  <div className="mb-2 shrink-0">
                    <label className="flex items-center gap-2 text-[10px] text-eve-muted">
                      <span className="shrink-0">Поиск типа</span>
                      <input
                        type="text"
                        value={ tradeProfitTypeQuery }
                        onChange={ (e) => setTradeProfitTypeQuery(e.target.value) }
                        placeholder="Название или ID"
                        className="w-full rounded-md border border-eve-border/70 bg-eve-surface/35 px-2 py-1.5 text-[11px] text-eve-bright shadow-glass-subtle placeholder:text-eve-muted/60 focus:border-eve-accent/60 focus:outline-none"
                      />
                    </label>
                  </div>
                  { tradeProfitTableRows.length > 0 ? (
                    <div className="min-h-0 flex-1 overflow-auto rounded border border-eve-border/40">
                      <table className="w-full min-w-0 text-left text-[11px] text-eve-bright/90">
                        <thead className="sticky top-0 z-10 bg-eve-elevated/95 text-eve-muted shadow-[0_1px_0_0_rgba(74,88,120,0.35)]">
                          <tr>
                            <th className="px-2 py-1.5 pr-1 font-semibold">Тип</th>
                            <th
                              className="min-w-[6.5rem] px-1 py-1.5 font-semibold"
                              title="100×прибыль/Σ|прибыль| по витрине; со знаком"
                            >
                              Доля приб.
                            </th>
                            <th className="w-[1%] px-1 py-1.5 text-right font-semibold whitespace-nowrap" title="Только sell">
                              Продано, шт.
                            </th>
                            <th className="w-[1%] px-2 py-1.5 pl-1 text-right font-semibold">Прибыль</th>
                          </tr>
                        </thead>
                        <tbody>
                          { tradeProfitTableRows.map((r, i) =>
                          {
                            const profitShare = tradeProfitAbsSum > 0
                              ? (r.profit / tradeProfitAbsSum) * 100
                              : 0
                            const shareBarW = tradeProfitAbsSum > 0
                              ? (Math.abs(r.profit) / tradeProfitAbsSum) * 100
                              : 0
                            const shareAbs = Math.abs(profitShare)
                            const shareText = (() =>
                            {
                              if (tradeProfitAbsSum <= 0) return '—'
                              if (r.profit === 0) return '0%'
                              const a = shareAbs
                              const neg = profitShare < 0
                              if (a < 0.005) return (neg ? '−' : '') + '<0.01%'
                              let s: string
                              if (a < 0.1) s = a.toFixed(2)
                              else if (a < 10) s = a.toFixed(1)
                              else s = a.toFixed(0)
                              return neg ? `−${ s }%` : `${ s }%`
                            })()
                            const stripe
                              = i % 2 === 0
                                ? 'bg-eve-bg/15'
                                : ''
                            const shareTitle = tradeProfitAbsSum > 0
                              ? `${ profitShare.toFixed(1) }% (100×прибыль/Σ|прибыль|), Σ|приб.|=${ formatIsk(
                                tradeProfitAbsSum
                              ) } ISK`
                              : '—'
                            const w = Math.min(100, shareBarW)
                            const rgbVar = tradeProfitRgbVar(r.profit)
                            const barPart
                              = rgbVar != null && w > 0.001
                                ? `linear-gradient(to right, rgb(${ rgbVar } / var(--trade-profit-bar-alpha)) 0%, rgb(${ rgbVar } / var(--trade-profit-bar-alpha)) ${ w }%, transparent ${ w }%)`
                                : 'linear-gradient(to right, transparent 0%, transparent 100%)'
                            const veilPart
                              = 'linear-gradient(to right, rgb(18 22 31 / calc(0.75 * var(--trade-profit-veil-a))) 0%, rgb(18 22 31 / calc(0.75 * var(--trade-profit-veil-a))) 100%)'
                            const rowBgStyle: CSSProperties = {
                              ...({
                                '--trade-profit-base-alpha': 0.26,
                                '--trade-profit-hover-alpha': 0.48,
                              } as CSSProperties),
                              backgroundImage: `${ barPart }, ${ veilPart }`,
                            }
                            return (
                            <tr
                              key={ r.type_id }
                              className={ `trade-profit-data-row border-t border-eve-border/25 ${
                                i === 0 ? 'border-t-0' : ''
                              } ${ stripe }` }
                              style={ rowBgStyle }
                              title={ shareTitle }
                            >
                              <td
                                className="max-w-[9rem] truncate border-b border-eve-border/50 px-2 py-1.5 pr-1 font-medium text-eve-cyan/95"
                                title={ r.name }
                              >
                                { r.name }
                              </td>
                              <td
                                className="border-b border-eve-border/50 px-1 py-1.5 pr-2 align-middle"
                                title={ shareTitle }
                              >
                                <span
                                  className={ `tabular-nums text-[9px] ${ tradeProfitShareCellClass(r.profit) }` }
                                >
                                  { shareText }
                                </span>
                              </td>
                              <td className="border-b border-eve-border/50 px-1 py-1.5 text-right font-tabular-nums text-eve-bright/95">
                                { formatInteger(r.quantitySold) }
                              </td>
                              <td
                                className={ `border-b border-eve-border/50 px-2 py-1.5 pl-1 text-right font-semibold font-tabular-nums ${
                                  r.profit >= 0
                                    ? 'eve-green'
                                    : 'eve-red'
                                }` }
                              >
                                { formatIskMillionsShort(r.profit) }
                              </td>
                            </tr>
                            )
                          }) }
                        </tbody>
                        <tfoot className="sticky bottom-0 z-10 border-t-2 border-eve-border/40 bg-eve-elevated/95 text-eve-bright/95 shadow-[0_-1px_0_0_rgba(74,88,120,0.35)]">
                          <tr>
                            <th
                              scope="row"
                              className="bg-eve-elevated/95 px-2 py-1.5 pr-1 text-left font-semibold"
                            >
                              Итого ({ tradeProfitTableRows.length }{ ' ' }
                              { tradeProfitTableRows.length === 1
                                ? 'тип'
                                : 'типов' } в витрине)
                            </th>
                            <td className="bg-eve-elevated/95 px-1 py-1.5 pr-2">
                              { tradeProfitNetSharePct == null ? (
                                <span className="text-eve-muted" title="Нет величин">
                                  —
                                </span>
                              ) : (
                                <span
                                  className={ `tabular-nums text-[9px] font-semibold ${ tradeProfitTableSumToneClass(tradeProfitTableProfitSum) }` }
                                  title="100×итог.приб./Σ|прибыль| по витрине (сальдо в доле)"
                                >
                                  { tradeProfitNetSharePct >= 0 ? '' : '−' }
                                  { (Math.abs(
                                    tradeProfitNetSharePct
                                  )).toFixed(0) }%
                                </span>
                              ) }
                            </td>
                            <td className="bg-eve-elevated/95 px-1 py-1.5 text-right text-eve-muted" title="Суммировать шт. по разным типам бессмысленно">
                              —
                            </td>
                            <td
                              className={ `bg-eve-elevated/95 px-2 py-1.5 pl-1 text-right font-semibold tabular-nums ${
                                tradeProfitTableProfitSum >= 0 ? 'eve-green' : 'eve-red'
                              }` }
                            >
                              { formatIskMillionsShort(tradeProfitTableProfitSum) }
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  ) : (
                    <div className="flex min-h-0 flex-1 items-start">
                      <p className="text-sm text-eve-muted">
                        { tradeProfitWithNames.length === 0
                          ? 'Нет сделок за период (или в режиме «Купля–продажа» нет пар buy+sell по типу).'
                          : 'По вашему фильтру типы не найдены.' }
                      </p>
                    </div>
                  ) }
                  </div>
                </div>

                <div className="@container glass-subtle w-full min-w-0 p-2.5">
                <h3 className="eve-section-title mb-2 flex items-center gap-2">
                  <Shield className="h-4 w-4 text-eve-muted" aria-hidden />
                  Транзакции
                </h3>
                { transactionsInRange.length === 0 ? (
                  <p className="text-sm text-eve-muted">В выбранном периоде нет сделок.</p>
                ) : (
                <div className="max-h-[320px] overflow-auto rounded border border-eve-border/40">
                  <table className="w-full min-w-[640px] text-left text-[11px] text-eve-bright/90">
                    <thead className="sticky top-0 bg-eve-elevated/95 text-eve-muted">
                      <tr>
                        <th className="px-2 py-1.5 font-semibold">Дата</th>
                        <th className="px-2 py-1.5 font-semibold">Тип</th>
                        <th className="px-2 py-1.5 text-right font-semibold">Кол-во</th>
                        <th className="px-2 py-1.5 text-right font-semibold">Цена</th>
                        <th className="px-2 py-1.5 text-right font-semibold">ISK</th>
                        <th className="px-2 py-1.5 font-semibold">Сторона</th>
                      </tr>
                    </thead>
                    <tbody>
                      { transactionsInRange
                        .slice()
                        .sort(
                          (a, b) =>
                            new Date(b.date).getTime() - new Date(a.date).getTime()
                        )
                        .slice(0, 80)
                        .map((tr) => (
                          <tr
                            key={ tr.transaction_id }
                            className="border-t border-eve-border/30 odd:bg-eve-bg/20"
                          >
                            <td className="px-2 py-1 font-mono tabular-nums text-eve-muted/95">
                              { tr.date.replace('T', ' ').slice(0, 19) }
                            </td>
                            <td className="px-2 py-1">
                              { typeLabels?.get(tr.type_id) ?? `#${ tr.type_id }` }
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              { formatInteger(tr.quantity) }
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              { formatIsk(tr.unit_price) }
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums text-eve-gold/90">
                              { formatIsk(tr.unit_price * tr.quantity) }
                            </td>
                            <td className="px-2 py-1">
                              { tr.is_buy ? (
                                <span className="text-eve-cyan/90">Buy</span>
                              ) : (
                                <span className="text-eve-gold/90">Sell</span>
                              ) }
                            </td>
                          </tr>
                        )) }
                    </tbody>
                  </table>
                </div>
                ) }
                </div>
              </div>
            </div>
          ) }
        </div>
      </div>
    </div>
  )
}

export default CharacterDashboard
