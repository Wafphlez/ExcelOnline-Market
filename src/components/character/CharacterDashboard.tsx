import
  {
    useCallback,
    useEffect,
    useMemo,
    useState,
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
    Bar,
    BarChart,
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
    aggregateMarketFeesByDay,
    aggregateTradeProfitByType,
    aggregateTradesByDay,
    buildWalletJournalRefIdToTypeMap,
    buildWalletTransactionIdToTypeMap,
    DASHBOARD_RANGE_PRESETS,
    filterJournalInRange,
    filterNetWorthSeriesFrom,
    filterTransactionsInRange,
    findDashboardRange,
    MS_DAY,
    oldestJournalTimeMs,
    sumJournalInRange,
    type DashboardRangeId,
    type TradeProfitByTypeMode,
    type TradeProfitHow,
    UNMATCHED_FEE_TYPE_ID,
  } from '../../lib/eve/capitalMetrics'
import
  {
    formatIsk,
    formatInteger,
    formatIskMillionsShort,
  } from '../../lib/formatNumber'
import { ActiveMarketOrdersBlock } from './ActiveMarketOrdersBlock'
import { EveSsoLoginPanel } from './EveSsoLoginPanel'

type CharacterDashboardProps = {
  /** Сообщение одноразово после callback SSO */
  bootMessage?: string | null
  onClearBootMessage?: () => void
}

const CHART_COL = {
  grid: 'rgba(74, 88, 120, 0.35)',
  tick: 'rgba(195, 204, 214, 0.55)',
  /** Серая линия «динамика» (нетто за день) */
  dynamics: 'rgba(148, 155, 168, 0.92)',
  /** Горизонталь y = 0 */
  zeroLine: 'rgba(115, 125, 142, 0.75)',
  wallet: '#5fd4e8',
  net: '#b8963d',
  buy: 'rgba(95, 212, 232, 0.85)',
  sell: 'rgba(184, 150, 61, 0.85)',
} as const

function TabButton(
  { active, children, onClick }: {
    active: boolean
    children: ReactNode
    onClick: () => void
  }
): JSX.Element
{
  return (
    <button
      type="button"
      onClick={ onClick }
      className={ `rounded border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-eve-accent/45 ${
        active
          ? 'border-eve-accent bg-eve-accent-muted text-eve-accent shadow-[inset_0_0_0_1px_rgba(184,150,61,0.2)]'
          : 'border-eve-border/80 text-eve-muted hover:border-eve-accent/40 hover:text-eve-bright'
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

  const walletDeltaJournal = useMemo(() =>
  {
    if (state.status !== 'ready' || !period) return null
    return sumJournalInRange(
      state.data.journal,
      period.fromMs,
      period.toMs
    )
  }, [state, period])

  const tradeByDayInRange = useMemo(() =>
  {
    if (state.status !== 'ready' || !period) return []
    const tx = filterTransactionsInRange(
      state.data.transactions,
      period.fromMs,
      period.toMs
    )
    return aggregateTradesByDay(tx)
  }, [state, period])

  /**
   * Рыночные транзакции за скользящие 30 дней: ровно 30 точек (дата UTC)
   * — для линейного графика с нулевыми днями без сделок.
   */
  const transactionsLast30DaysSeries = useMemo(() =>
  {
    if (state.status !== 'ready') return []
    const toMs = Date.now()
    const fromMs = toMs - 30 * MS_DAY
    const tx = filterTransactionsInRange(
      state.data.transactions,
      fromMs,
      toMs
    )
    const agg = aggregateTradesByDay(tx)
    const byDay = new Map(agg.map((d) => [d.day, d]))
    const rows: { day: string; netIsk: number }[] = []
    for (let i = 29; i >= 0; i--)
    {
      const d = new Date(toMs - i * MS_DAY)
      const key = d.toISOString().slice(0, 10)
      const r = byDay.get(key)
      const sell = r?.sellIsk ?? 0
      const buy = r?.buyIsk ?? 0
      rows.push({
        day: key,
        netIsk: sell - buy,
      })
    }
    return rows
  }, [state])

  /** Включает 0, чтобы ноль и линия сетки на 0 не «выпадали» из диапазона. */
  const transactionsLast30DaysYDomain = useMemo((): [ number, number ] =>
  {
    const s = transactionsLast30DaysSeries
    if (s.length === 0) return [ -1, 1 ]
    const vals = s.map((d) => d.netIsk)
    let dMin = Math.min(0, ...vals)
    let dMax = Math.max(0, ...vals)
    if (dMin === dMax)
    {
      if (dMin === 0) return [ -1, 1 ]
      const pad = Math.max(Math.abs(dMin) * 0.05, 1e-6)
      return [ dMin - pad, dMax + pad ]
    }
    const spread = dMax - dMin
    const pad = Math.max(spread * 0.04, spread * 0.0001)
    return [ dMin - pad, dMax + pad ]
  }, [ transactionsLast30DaysSeries ])

  const tradeNetSeries = useMemo(() =>
  {
    if (state.status !== 'ready' || !period) return []
    const feesByDay = aggregateMarketFeesByDay(
      filterJournalInRange(state.data.journal, period.fromMs, period.toMs)
    )
    const dayRows = new Map<string, { sellIncome: number; buyExpense: number; feeDelta: number }>()
    for (const d of tradeByDayInRange)
    {
      dayRows.set(d.day, {
        sellIncome: d.sellIsk,
        buyExpense: d.buyIsk,
        feeDelta: feesByDay.get(d.day) ?? 0,
      })
    }
    for (const [day, feeDelta] of feesByDay)
    {
      if (dayRows.has(day)) continue
      dayRows.set(day, {
        sellIncome: 0,
        buyExpense: 0,
        feeDelta,
      })
    }

    let cumulativeNet = 0
    return [...dayRows.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, d]) =>
    {
      const netProfit = d.sellIncome - d.buyExpense + d.feeDelta
      cumulativeNet += netProfit
      return {
        day,
        sellIncome: d.sellIncome,
        buyExpense: d.buyExpense,
        feeDelta: d.feeDelta,
        netProfit,
        cumulativeNet,
      }
    })
  }, [state, period, tradeByDayInRange])

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

  /** Точки net worth в выбранном периоде (журнал кошелька + оценка активов на «сейчас»). */
  const netWorthInPeriodSeries = useMemo(() =>
  {
    if (state.status !== 'ready' || !period) return []
    const s = state.data.netWorthSeries
    if (s.length === 0) return []
    return filterNetWorthSeriesFrom(s, period.fromMs)
  }, [state, period])

  const netWorthChartYDomain = useMemo((): [ number, number ] =>
  {
    const s = netWorthInPeriodSeries
    if (s.length === 0) return [ 0, 1 ]
    const vals = s.map((p) => p.netWorth)
    const dMin = Math.min(...vals)
    const dMax = Math.max(...vals)
    if (dMin === dMax)
    {
      const pad = Math.max(Math.abs(dMin) * 0.02, 1e6)
      return [ dMin - pad, dMax + pad ]
    }
    const spread = dMax - dMin
    const pad = Math.max(spread * 0.04, spread * 0.0001)
    return [ dMin - pad, dMax + pad ]
  }, [netWorthInPeriodSeries])

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
      ).toLocaleString('ru-RU') }. Для длинных периодов дельта и графики учитывают только доступные записи ESI.`
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

  /** Сумма |прибыль| по витрине; знаменатель для доли со знаком. */
  const tradeProfitAbsSum = useMemo(
    () => tradeProfitWithNames.reduce(
      (s, r) => s + Math.abs(r.profit),
      0
    ),
    [tradeProfitWithNames]
  )

  const tradeProfitTableProfitSum = useMemo(
    () => tradeProfitWithNames.reduce((s, r) => s + r.profit, 0),
    [tradeProfitWithNames]
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
                className="inline-flex h-8 w-8 items-center justify-center rounded border border-eve-border/80 text-eve-muted shadow-eve-inset transition-colors hover:border-eve-accent/50 hover:text-eve-accent disabled:opacity-50"
                title="Обновить данные ESI"
              >
                <RefreshCw
                  className={ `h-3.5 w-3.5 ${ state.status === 'loading' ? 'animate-spin' : '' }` }
                />
              </button>
            </div>
          </div>

          { loginErr && (
            <p className="mb-3 rounded border border-eve-danger/50 bg-eve-elevated/60 px-3 py-2 text-sm text-eve-danger/95" role="alert">
              { loginErr }
            </p>
          ) }

          { !isEveSsoConfigured() && (
            <p className="mb-3 rounded border border-eve-danger/50 bg-eve-elevated/60 px-3 py-2 text-sm text-eve-danger/95">
              Укажите <code className="text-eve-bright/90">VITE_EVE_SSO_CLIENT_ID</code>
              { ' ' }в .env (приложение CCP) и, при необходимости,{' '}
              <code className="text-eve-bright/90">VITE_EVE_SSO_REDIRECT_URI</code>
              . Redirect URI в CCP должен совпадать с адресом приложения (тот же origin + path).
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
                <div className="rounded border border-eve-border/50 bg-eve-bg/40 p-3 shadow-eve-inset">
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
                <div className="rounded border border-eve-border/50 bg-eve-bg/40 p-3 shadow-eve-inset">
                  <p className="eve-kicker text-[10px]">Net worth (оценка)</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-eve-gold-bright">
                    { iskFormatter(state.data.netWorth) }
                  </p>
                </div>
                <div className="rounded border border-eve-border/50 bg-eve-bg/40 p-3 shadow-eve-inset">
                  <p className="eve-kicker text-[10px]">Кошелёк (ISK)</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-eve-cyan/95">
                    { iskFormatter(state.data.wallet) }
                  </p>
                </div>
                <div className="rounded border border-eve-border/50 bg-eve-bg/40 p-3 shadow-eve-inset">
                  <p className="eve-kicker text-[10px]">Активы (оценка)</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-eve-accent/95">
                    { iskFormatter(state.data.assetsValue) }
                  </p>
                </div>
                <div className="rounded border border-eve-border/50 bg-eve-bg/40 p-3 shadow-eve-inset">
                  <p className="eve-kicker text-[10px]">Эскроу (buy-ордера)</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-eve-amber-200/90">
                    { iskFormatter(state.data.marketEscrowIsk) }
                  </p>
                </div>
                <div className="rounded border border-eve-border/50 bg-eve-bg/40 p-3 shadow-eve-inset">
                  <p className="eve-kicker text-[10px]">PLEX в ассетах ESI (оценка)</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-eve-bright/95">
                    { iskFormatter(state.data.plexValueInAssetsIsk) }
                  </p>
                </div>
              </div>

              <div className="rounded border border-eve-border/45 bg-eve-bg/35 p-2.5 shadow-eve-inset">
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
                    Сумма проводок журнала за период «{ period?.label ?? '—' }» (все
                    { ' ' }
                    <code className="text-eve-bright/80">amount</code>
                    { ' ' }за интервал):
                  </span>
                  { ' ' }
                  <span className="tabular-nums font-semibold text-eve-cyan/95">
                    { walletDeltaJournal == null
                      ? '—'
                      : iskFormatter(walletDeltaJournal) }
                  </span>
                </div>
                { journalCoverageHint && (
                  <p className="mt-2 text-[10px] leading-snug text-eve-gold/85">
                    { journalCoverageHint }
                  </p>
                ) }
              </div>

              <div className="@container w-full min-w-0 rounded border border-eve-border/55 bg-eve-bg/35 p-2.5 shadow-eve-inset">
                <h3 className="eve-section-title mb-2">Динамика капитализации</h3>
                { netWorthInPeriodSeries.length > 0 ? (
                  <div className="h-[240px] w-full min-w-0 sm:h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={ netWorthInPeriodSeries }
                        margin={ { top: 8, right: 8, left: 4, bottom: 0 } }
                      >
                        <CartesianGrid
                          stroke={ CHART_COL.grid }
                          strokeDasharray="3 3"
                        />
                        <XAxis
                          dataKey="time"
                          tick={ { fontSize: 8, fill: CHART_COL.tick } }
                          tickFormatter={ (t: string) =>
                          {
                            const d = new Date(t)
                            if (!Number.isFinite(d.getTime())) return t
                            return d.toLocaleDateString('ru-RU', {
                              day: '2-digit',
                              month: '2-digit',
                            })
                          } }
                          minTickGap={ 16 }
                        />
                        <YAxis
                          domain={ netWorthChartYDomain }
                          tick={ { fontSize: 9, fill: CHART_COL.tick } }
                          tickFormatter={ (n) => formatInteger(n as number) }
                          width={ 56 }
                        />
                        <Tooltip
                          contentStyle={ {
                            background: 'rgba(16, 20, 28, 0.96)',
                            border: '1px solid rgba(123, 142, 176, 0.45)',
                            fontSize: 11,
                          } }
                          labelFormatter={ (t) =>
                            new Date(t).toLocaleString('ru-RU', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          }
                          formatter={ (v: number) =>
                            [ iskFormatter(v), 'Капитализация' ]
                          }
                        />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="netWorth"
                          name="Net worth (ISK)"
                          stroke={ CHART_COL.net }
                          strokeWidth={ 2.25 }
                          dot={ false }
                          activeDot={ { r: 3 } }
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-sm text-eve-muted">
                    Нет точек: в выгрузке журнала кошелька нет дат в выбранном периоде.
                  </p>
                ) }
              </div>

              <div className="flex w-full min-w-0 max-w-full flex-col gap-4">
                <div className="@container w-full min-w-0 rounded border border-eve-border/55 bg-eve-bg/35 p-2.5 shadow-eve-inset">
                  <h3 className="eve-section-title mb-2">Торговая прибыль по типам</h3>
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
                  <p className="mb-2 text-[9px] leading-snug text-eve-muted/80">
                    Сверка с чужой таблицей: часто совпадает по{ ' ' }
                    <span className="whitespace-nowrap">периоду</span> и
                    { ' ' }
                    <span className="whitespace-nowrap">«брутто»</span>
                    { ' ' }или отдельному отчёту в игре; 1:1 не гарантируется (ESI обрезает историю,
                    исходы и налоги везде разные).
                  </p>
                  { tradeProfitWithNames.length > 0 ? (
                    <div className="max-h-[min(65vh,520px)] overflow-auto rounded border border-eve-border/40">
                      <table className="w-full min-w-0 text-left text-[11px] text-eve-bright/90">
                        <thead className="sticky top-0 z-[1] bg-eve-elevated/95 text-eve-muted">
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
                          { tradeProfitWithNames.map((r) =>
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
                            return (
                            <tr
                              key={ r.type_id }
                              className="border-t border-eve-border/25 odd:bg-eve-bg/15"
                            >
                              <td
                                className="max-w-[9rem] truncate px-2 py-1.5 pr-1 font-medium text-eve-cyan/95"
                                title={ r.name }
                              >
                                { r.name }
                              </td>
                              <td className="px-1 py-1.5 pr-2 align-middle">
                                <div
                                  className="flex min-w-[5rem] max-w-[10rem] items-center gap-1.5"
                                  title={ tradeProfitAbsSum > 0
                                    ? `${ profitShare.toFixed(1) }% (100×прибыль/Σ|прибыль|), Σ|приб.|=${ formatIsk(
                                      tradeProfitAbsSum
                                    ) } ISK`
                                    : '—' }
                                >
                                  <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-eve-bg/55 ring-1 ring-inset ring-eve-border/30">
                                    { r.profit > 0 && (
                                    <div
                                      className="h-full rounded-sm bg-eve-green"
                                      style={ { width: `${ Math.min(100, shareBarW) }%` } }
                                    />
                                    ) }
                                    { r.profit < 0 && (
                                    <div
                                      className="h-full rounded-sm bg-eve-red"
                                      style={ { width: `${ Math.min(100, shareBarW) }%` } }
                                    />
                                    ) }
                                  </div>
                                  <span
                                    className={ `shrink-0 tabular-nums text-[9px] ${
                                      r.profit > 0
                                        ? 'eve-green'
                                        : r.profit < 0
                                            ? 'eve-red'
                                            : 'text-eve-muted/70'
                                    }` }
                                  >
                                    { shareText }
                                  </span>
                                </div>
                              </td>
                              <td className="px-1 py-1.5 text-right tabular-nums text-eve-bright/95">
                                { formatInteger(r.quantitySold) }
                              </td>
                              <td
                                className={ `px-2 py-1.5 pl-1 text-right font-semibold tabular-nums ${
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
                        <tfoot className="border-t-2 border-eve-border/40 bg-eve-elevated/50 text-eve-bright/95">
                          <tr>
                            <th
                              scope="row"
                              className="px-2 py-1.5 pr-1 text-left font-semibold"
                            >
                              Итого ({ tradeProfitWithNames.length }{ ' ' }
                              { tradeProfitWithNames.length === 1
                                ? 'тип'
                                : 'типов' } в витрине)
                            </th>
                            <td className="px-1 py-1.5 pr-2">
                              { tradeProfitNetSharePct != null ? (
                                <span
                                  className={ `tabular-nums text-[9px] font-semibold ${
                                    tradeProfitTableProfitSum > 0
                                      ? 'eve-green'
                                      : tradeProfitTableProfitSum < 0
                                          ? 'eve-red'
                                          : 'text-eve-muted'
                                  }` }
                                  title="100×итог.приб./Σ|прибыль| по витрине (сальдо в доле)"
                                >
                                  { tradeProfitNetSharePct < 0 ? '−' : '' }
                                  { (Math.abs(
                                    tradeProfitNetSharePct
                                  )).toFixed(0) }%
                                </span>
                              ) : (
                                <span className="text-eve-muted" title="Нет величин">
                                  —
                                </span>
                              ) }
                            </td>
                            <td className="px-1 py-1.5 text-right text-eve-muted" title="Суммировать шт. по разным типам бессмысленно">
                              —
                            </td>
                            <td
                              className={ `px-2 py-1.5 pl-1 text-right font-semibold tabular-nums ${
                                tradeProfitTableProfitSum >= 0
                                  ? 'eve-green'
                                  : 'eve-red'
                              }` }
                            >
                              { formatIskMillionsShort(tradeProfitTableProfitSum) }
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-eve-muted">Нет сделок за период (или в режиме «Купля–продажа» нет пар buy+sell по типу).</p>
                  ) }
                </div>

                <div className="@container w-full min-w-0 rounded border border-eve-border/55 bg-eve-bg/35 p-2.5 shadow-eve-inset">
                  <h3 className="eve-section-title mb-2">Сделки по дням (ISK)</h3>
                  { tradeByDayInRange.length > 0 ? (
                    <div className="h-[260px] w-full min-w-0 sm:h-[280px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={ tradeByDayInRange }
                          margin={ { top: 8, right: 8, left: 4, bottom: 0 } }
                        >
                          <CartesianGrid
                            stroke={ CHART_COL.grid }
                            strokeDasharray="3 3"
                          />
                          <XAxis
                            dataKey="day"
                            tick={ { fontSize: 9, fill: CHART_COL.tick } }
                            minTickGap={ 8 }
                          />
                          <YAxis
                            tick={ { fontSize: 9, fill: CHART_COL.tick } }
                            tickFormatter={ (n) => formatInteger(n as number) }
                            width={ 52 }
                          />
                          <Tooltip
                            contentStyle={ {
                              background: 'rgba(16, 20, 28, 0.96)',
                              border: '1px solid rgba(123, 142, 176, 0.45)',
                              fontSize: 11,
                            } }
                            formatter={ (v: number) => iskFormatter(v) }
                          />
                          <Legend />
                          <Bar
                            dataKey="buyIsk"
                            name="Покупка"
                            fill={ CHART_COL.buy }
                            radius={ [ 2, 2, 0, 0 ] }
                          />
                          <Bar
                            dataKey="sellIsk"
                            name="Продажа"
                            fill={ CHART_COL.sell }
                            radius={ [ 2, 2, 0, 0 ] }
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p className="text-sm text-eve-muted">Нет рыночных транзакций.</p>
                  ) }
                </div>

                <div className="@container w-full min-w-0 rounded border border-eve-border/55 bg-eve-bg/35 p-2.5 shadow-eve-inset">
                  <h3 className="eve-section-title mb-2">Транзакции за последние 30 дней</h3>
                  { transactionsLast30DaysSeries.length > 0 ? (
                    <div className="h-[260px] w-full min-w-0 sm:h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={ transactionsLast30DaysSeries }
                          margin={ { top: 8, right: 8, left: 4, bottom: 0 } }
                        >
                          <CartesianGrid
                            stroke={ CHART_COL.grid }
                            strokeDasharray="3 3"
                          />
                          <XAxis
                            dataKey="day"
                            tick={ { fontSize: 8, fill: CHART_COL.tick } }
                            tickFormatter={ (v) => String(v).slice(5, 10) }
                            minTickGap={ 2 }
                            interval="preserveStartEnd"
                          />
                          <YAxis
                            domain={ transactionsLast30DaysYDomain }
                            tick={ { fontSize: 9, fill: CHART_COL.tick } }
                            tickFormatter={ (n) => formatInteger(n as number) }
                            width={ 52 }
                          />
                          <Tooltip
                            contentStyle={ {
                              background: 'rgba(16, 20, 28, 0.96)',
                              border: '1px solid rgba(123, 142, 176, 0.45)',
                              fontSize: 11,
                            } }
                            labelFormatter={ (d) => `Дата: ${ d }` }
                            formatter={ (v: number) =>
                            {
                              if (v == null || !Number.isFinite(v)) return [ '—', 'Динамика' ]
                              return [ iskFormatter(v), 'Динамика' ]
                            } }
                          />
                          <Legend />
                          <ReferenceLine
                            y={ 0 }
                            stroke={ CHART_COL.zeroLine }
                            strokeWidth={ 1.25 }
                          />
                          <Line
                            type="monotone"
                            dataKey="netIsk"
                            name="Динамика"
                            stroke={ CHART_COL.dynamics }
                            strokeWidth={ 2.5 }
                            dot={ false }
                            activeDot={ { r: 3 } }
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p className="text-sm text-eve-muted">Нет данных ESI.</p>
                  ) }
                </div>

                <div className="w-full min-w-0 max-w-full">
                  <ActiveMarketOrdersBlock
                    data={ state.data.activeMarketOrders }
                    errorMessage={ state.data.activeMarketOrdersError }
                    onRefresh={ refreshActiveMarketOrders }
                    refreshing={ activeMarketOrdersRefreshing }
                  />
                </div>

                <div className="@container w-full min-w-0 rounded border border-eve-border/55 bg-eve-bg/35 p-2.5 shadow-eve-inset">
                  <h3 className="eve-section-title mb-2">Доходность торговли</h3>
                  { tradeNetSeries.length > 0 ? (
                    <div className="h-[280px] w-full min-w-0 sm:h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={ tradeNetSeries }
                          margin={ { top: 8, right: 8, bottom: 0, left: 4 } }
                        >
                          <CartesianGrid
                            stroke={ CHART_COL.grid }
                            strokeDasharray="3 3"
                          />
                          <XAxis
                            dataKey="day"
                            tick={ { fontSize: 9, fill: CHART_COL.tick } }
                            minTickGap={ 18 }
                          />
                          <YAxis
                            tick={ { fontSize: 9, fill: CHART_COL.tick } }
                            tickFormatter={ (n) => formatInteger(n as number) }
                            width={ 56 }
                          />
                          <Tooltip
                            contentStyle={ {
                              background: 'rgba(16, 20, 28, 0.96)',
                              border: '1px solid rgba(123, 142, 176, 0.45)',
                              fontSize: 11,
                              borderRadius: 4,
                            } }
                            labelFormatter={ (l) => `Дата: ${ l }` }
                            formatter={ (v: number) =>
                              [ iskFormatter(v), 'Накопительная прибыль' ]
                            }
                          />
                          <Legend />
                          <ReferenceLine
                            y={ 0 }
                            stroke={ CHART_COL.zeroLine }
                            strokeWidth={ 1.25 }
                          />
                          <Line
                            type="monotone"
                            dataKey="cumulativeNet"
                            name="Суммарная торговая прибыль (ISK)"
                            stroke={ CHART_COL.wallet }
                            dot={ false }
                            strokeWidth={ 2.5 }
                            activeDot={ { r: 3 } }
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p className="text-sm text-eve-muted">В выбранном периоде нет торговых сделок.</p>
                  ) }
                </div>

                <div className="@container w-full min-w-0 rounded border border-eve-border/55 bg-eve-bg/35 p-2.5 shadow-eve-inset">
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
