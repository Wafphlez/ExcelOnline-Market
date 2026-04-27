import type
  {
    EveAsset,
    EveWalletJournalEntry,
    EveWalletTransaction,
  } from '../../types/eveCharacter'

export type TimePoint = { t: string; y: number }

export function aggregateAssetQuantities(assets: EveAsset[]): Map<number, number>
{
  const m = new Map<number, number>()
  for (const a of assets)
  {
    const q = a.quantity
    m.set(a.type_id, (m.get(a.type_id) ?? 0) + q)
  }
  return m
}

/**
 * Оценка стоимости по средней цене ESI (CPI) — приближение к «рынку».
 */
export function valueAssets(
  byType: Map<number, number>,
  prices: Map<number, number>
): number
{
  let s = 0
  for (const [typeId, qty] of byType)
  {
    const p = prices.get(typeId) ?? 0
    s += qty * p
  }
  return s
}

export function pricesToMap(
  list: { type_id: number; average_price?: number; adjusted_price?: number }[]
): Map<number, number>
{
  const m = new Map<number, number>()
  for (const row of list)
  {
    const p = row.average_price ?? row.adjusted_price ?? 0
    if (p > 0) m.set(row.type_id, p)
  }
  return m
}

export function buildWalletBalanceSeries(
  journal: EveWalletJournalEntry[]
): TimePoint[]
{
  const withBalance = journal.filter(
    (j) => j.balance != null && Number.isFinite(j.balance) && j.date
  )
  if (withBalance.length > 0)
  {
    const sorted = [...withBalance].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    )
    return sorted.map((j) => ({ t: j.date, y: j.balance! }))
  }
  // fallback: кумулятив по amount
  const sorted = [...journal]
    .filter((j) => j.date)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  let acc = 0
  return sorted.map((j) =>
  {
    acc += j.amount
    return { t: j.date, y: acc }
  })
}

function parseIso(s: string): number
{
  return new Date(s).getTime()
}

/**
 * Сумма проводок за интервал (по дате).
 */
export function sumJournalInRange(
  journal: EveWalletJournalEntry[],
  fromMs: number,
  toMs: number
): number
{
  let s = 0
  for (const j of journal)
  {
    const t = parseIso(j.date)
    if (t >= fromMs && t <= toMs) s += j.amount
  }
  return s
}

export type TradeDayAgg = {
  day: string
  buyIsk: number
  sellIsk: number
  count: number
}

export function aggregateTradesByDay(
  transactions: EveWalletTransaction[]
): TradeDayAgg[]
{
  const map = new Map<string, { buy: number; sell: number; count: number }>()
  for (const tr of transactions)
  {
    const d = tr.date.slice(0, 10)
    if (!d) continue
    const g = map.get(d) ?? { buy: 0, sell: 0, count: 0 }
    g.count += 1
    const isk = tr.unit_price * tr.quantity
    if (tr.is_buy) g.buy += isk
    else g.sell += isk
    map.set(d, g)
  }
  return [...map.entries()]
    .map(([day, v]) => ({
      day,
      buyIsk: v.buy,
      sellIsk: v.sell,
      count: v.count,
    }))
    .sort((a, b) => a.day.localeCompare(b.day))
}

export type TopType = { type_id: number; isk: number; qty: number }

export function topTradedTypes(
  transactions: EveWalletTransaction[],
  limit: number
): TopType[]
{
  const m = new Map<number, { isk: number; qty: number }>()
  for (const tr of transactions)
  {
    const isk = Math.abs(tr.unit_price * tr.quantity)
    const g = m.get(tr.type_id) ?? { isk: 0, qty: 0 }
    g.isk += isk
    g.qty += tr.quantity
    m.set(tr.type_id, g)
  }
  return [...m.entries()]
    .map(([type_id, v]) => ({ type_id, isk: v.isk, qty: v.qty }))
    .sort((a, b) => b.isk - a.isk)
    .slice(0, limit)
}

/**
 * «Торговая прибыль» по типу за период (рыночные транзакции ESI).
 * `buyIsk` / `sellIsk` — **грубые** суммы сделок buy/sell в окне; `profit` — **по FIFO** (ниже).
 */
export type TradeProfitByType = {
  type_id: number
  /** Сколько единиц продано (только is_buy = false) */
  quantitySold: number
  buyIsk: number
  sellIsk: number
  /**
   * Либо реализация по FIFO (см. `tradeProfitFifoForType`), либо брутто `sellIsk − buyIsk` —
   * в зависимости от аргумента `how` в `aggregateTradeProfitByType`.
   */
  profit: number
}

/**
 * - `all` — все типы с сделками; только продажа: прибыль = выручка (себестоимость 0),
 *   если не было buy-строк в выгрузке.
 * - `roundtrip` — только типы, где в периоде были **и** buy, **и** sell.
 */
export type TradeProfitByTypeMode = 'all' | 'roundtrip'

/** Как счи́тать `profit`: брутто по суммам в окне или реализация по FIFO. */
export type TradeProfitHow = 'fifo' | 'gross'

function compareWalletTx(
  a: EveWalletTransaction,
  b: EveWalletTransaction
): number
{
  const da = new Date(a.date).getTime()
  const db = new Date(b.date).getTime()
  if (da !== db) return da - db
  return a.transaction_id - b.transaction_id
}

type BuyLot = { qty: number; unitPrice: number }

function tradeProfitFifoForType(
  txs: EveWalletTransaction[]
): { quantitySold: number; buyIsk: number; sellIsk: number; profit: number }
{
  const sorted = [...txs].sort(compareWalletTx)
  const lots: BuyLot[] = []
  let buyIsk = 0
  let sellIsk = 0
  let quantitySold = 0
  let profit = 0
  for (const t of sorted)
  {
    const line = t.unit_price * t.quantity
    if (t.is_buy)
    {
      buyIsk += line
      lots.push({ qty: t.quantity, unitPrice: t.unit_price })
    } else
    {
      quantitySold += t.quantity
      sellIsk += line
      let need = t.quantity
      let cost = 0
      while (need > 0 && lots.length > 0)
      {
        const lot = lots[0]!
        const take = Math.min(need, lot.qty)
        cost += take * lot.unitPrice
        lot.qty -= take
        need -= take
        if (lot.qty <= 0) lots.shift()
      }
      // need > 0: продали больше, чем buy в логе — остаток с себестоимостью 0
      profit += line - cost
    }
  }
  return { quantitySold, buyIsk, sellIsk, profit }
}

function tradeProfitGrossForType(
  txs: EveWalletTransaction[]
): { quantitySold: number; buyIsk: number; sellIsk: number; profit: number }
{
  let buyIsk = 0
  let sellIsk = 0
  let quantitySold = 0
  for (const t of txs)
  {
    const line = t.unit_price * t.quantity
    if (t.is_buy) buyIsk += line
    else
    {
      sellIsk += line
      quantitySold += t.quantity
    }
  }
  return {
    quantitySold,
    buyIsk,
    sellIsk,
    profit: sellIsk - buyIsk,
  }
}

export function aggregateTradeProfitByType(
  transactions: EveWalletTransaction[],
  limit: number,
  mode: TradeProfitByTypeMode = 'all',
  how: TradeProfitHow = 'fifo'
): TradeProfitByType[]
{
  const byType = new Map<number, EveWalletTransaction[]>()
  for (const t of transactions)
  {
    const a = byType.get(t.type_id) ?? []
    a.push(t)
    byType.set(t.type_id, a)
  }
  let rows: TradeProfitByType[] = []
  for (const [type_id, txs] of byType)
  {
    const { quantitySold, buyIsk, sellIsk, profit } = how === 'fifo'
      ? tradeProfitFifoForType(txs)
      : tradeProfitGrossForType(txs)
    rows.push({ type_id, quantitySold, buyIsk, sellIsk, profit })
  }
  if (mode === 'roundtrip')
  {
    rows = rows.filter((r) => r.buyIsk > 0 && r.sellIsk > 0)
  }
  return rows
    .sort((a, b) => b.profit - a.profit)
    .slice(0, limit)
}

/**
 * Комбинированные точки: кошелёк (история) + net worth = wallet + оценка активов (текущий срез).
 */
export function buildNetWorthOverlayPoints(
  walletSeries: TimePoint[],
  assetsValueNow: number
): { time: string; wallet: number; netWorth: number }[]
{
  if (walletSeries.length === 0)
  {
    return []
  }
  return walletSeries.map((p) => ({
    time: p.t,
    wallet: p.y,
    netWorth: p.y + assetsValueNow,
  }))
}

export function isMarketRelatedRefType(ref: string): boolean
{
  const t = ref.toLowerCase()
  if (t.includes('market')) return true
  if (t === 'brokers_fee' || t === 'transaction_tax') return true
  if (t.includes('contract')) return true
  return false
}

export const MS_DAY = 86_400_000

export type DashboardRangeId = 'd7' | 'd30' | 'd90' | 'all'

export const DASHBOARD_RANGE_PRESETS: readonly {
  id: DashboardRangeId
  label: string
  /** 0 = не используется, только для `all` (см. период в CharacterDashboard) */
  durationMs: number
}[] = [
  { id: 'd7', label: 'Неделя', durationMs: 7 * MS_DAY },
  { id: 'd30', label: 'Месяц', durationMs: 30 * MS_DAY },
  { id: 'd90', label: '3 мес', durationMs: 90 * MS_DAY },
  { id: 'all', label: 'Вся выгрузка', durationMs: 0 },
] as const

export function findDashboardRange(
  id: DashboardRangeId
): (typeof DASHBOARD_RANGE_PRESETS)[number] | undefined
{
  return DASHBOARD_RANGE_PRESETS.find((p) => p.id === id)
}

export function filterTransactionsInRange(
  transactions: EveWalletTransaction[],
  fromMs: number,
  toMs: number
): EveWalletTransaction[]
{
  return transactions.filter((t) =>
  {
    const x = new Date(t.date).getTime()
    return x >= fromMs && x <= toMs
  })
}

export function filterNetWorthSeriesFrom(
  series: { time: string; wallet: number; netWorth: number }[],
  fromMs: number
): { time: string; wallet: number; netWorth: number }[]
{
  return series.filter((p) => new Date(p.time).getTime() >= fromMs)
}

export function oldestJournalTimeMs(
  journal: EveWalletJournalEntry[]
): number | null
{
  if (journal.length === 0) return null
  let m = Number.POSITIVE_INFINITY
  for (const j of journal)
  {
    const t = new Date(j.date).getTime()
    if (Number.isFinite(t) && t < m) m = t
  }
  return Number.isFinite(m) ? m : null
}
