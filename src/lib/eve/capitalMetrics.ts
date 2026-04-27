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

/** PLEX: текущий тип 44992; 40520 — старый ид (если встречается). */
const PLEX_TYPE_IDS = [ 44992, 40520 ] as const

/**
 * Стоимость PLEX, который виден в `GET /characters/…/assets/` (type_id 44992 / 40520).
 * PLEX только в PLEX Vault (привязан к аккаунту) CCP не отдаёт в ESI: в клиенте строка
 * «Примерная цена PLEX» может быть большой, а здесь — 0. Уже входит в `valueAssets`.
 */
export function valuePlexInAssets(
  byType: Map<number, number>,
  prices: Map<number, number>
): number
{
  let s = 0
  for (const id of PLEX_TYPE_IDS)
  {
    const q = byType.get(id) ?? 0
    if (q <= 0) continue
    const p = prices.get(id) ?? 0
    s += q * p
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

/**
 * Сумма рыночных комиссий/налогов по дням (обычно отрицательная),
 * включая `brokers_fee` / `transaction_tax` и алиасы.
 */
export function aggregateMarketFeesByDay(
  journal: EveWalletJournalEntry[]
): Map<string, number>
{
  const out = new Map<string, number>()
  for (const j of journal)
  {
    if (!isMarketFeeRefType(j.ref_type)) continue
    if (!Number.isFinite(j.amount)) continue
    const day = j.date.slice(0, 10)
    if (!day) continue
    out.set(day, (out.get(day) ?? 0) + j.amount)
  }
  return out
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
   * плюс суммы из журнала по `brokers_fee` / `transaction_tax` (см. `feeDeltasByType`).
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

/** Синтетический `type_id` для комиссий журнала, не привязанных к типу. */
export const UNMATCHED_FEE_TYPE_ID = 0

/**
 * `transaction_id` сделки → `type_id` (вся выгрузка, для сопоставления с journalist fees).
 */
export function buildWalletTransactionIdToTypeMap(
  transactions: EveWalletTransaction[]
): ReadonlyMap<number, number>
{
  const m = new Map<number, number>()
  for (const t of transactions)
  {
    m.set(t.transaction_id, t.type_id)
  }
  return m
}

/**
 * `journal_ref_id` из wallet transactions → `type_id` (связь комиссий с сделкой).
 */
export function buildWalletJournalRefIdToTypeMap(
  transactions: EveWalletTransaction[]
): ReadonlyMap<number, number>
{
  const m = new Map<number, number>()
  for (const t of transactions)
  {
    if (t.journal_ref_id != null && t.journal_ref_id > 0) m.set(t.journal_ref_id, t.type_id)
  }
  return m
}

const FEE_JOURNAL_REF = new Set([
  'brokers_fee',
  'broker_fee',
  'transaction_tax',
  'sales_tax',
])

function isMarketFeeRefType(ref: string): boolean
{
  return FEE_JOURNAL_REF.has(ref.trim().toLowerCase().split('-').join('_'))
}

/**
 * type_id | UNMATCHED_FEE_TYPE_ID → сумма `amount` (обычно отрицательная).
 */
function resolveTypeIdForMarketFee(
  j: EveWalletJournalEntry,
  transactionIdToType: ReadonlyMap<number, number>,
  journalRefIdToType: ReadonlyMap<number, number>
): number | null
{
  const toNum = (v: unknown): number | null =>
  {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim())
    return null
  }

  const ct = j.context_id_type?.toLowerCase().split('-').join('_')
  const contextId = toNum(j.context_id)
  if (contextId != null && ct)
  {
    if (ct === 'market_transaction_id' || ct === 'markettransactionid' || ct.includes('market_transaction'))
    {
      const t = transactionIdToType.get(contextId)
      if (t != null) return t
    }
  }
  const refId = toNum(j.ref_id)
  if (refId != null && refId > 0)
  {
    const t = journalRefIdToType.get(refId)
    if (t != null) return t
    // Некоторые записи ESI отдают `ref_id`, который совпадает с `transaction_id`.
    const txType = transactionIdToType.get(refId)
    if (txType != null) return txType
  }
  const ex = j.extra_info
  if (ex && typeof ex === 'object' && !Array.isArray(ex))
  {
    const typeId = toNum((ex as { type_id?: unknown }).type_id)
    if (typeId != null && typeId > 0) return typeId
    const transactionId = toNum(
      (ex as { transaction_id?: unknown; market_transaction_id?: unknown }).transaction_id
      ?? (ex as { transaction_id?: unknown; market_transaction_id?: unknown }).market_transaction_id
    )
    if (transactionId != null)
    {
      const t = transactionIdToType.get(transactionId)
      if (t != null) return t
    }
  }
  return null
}

/**
 * Суммирует налог с продаж и комиссии брокера (в т.ч. на переставление) из journal за интервал
 * дат, раскладывая по `type_id` EVE там, где ESI привязывает к market transaction.
 */
export function aggregateMarketFeeDeltasFromJournal(
  journalInRange: EveWalletJournalEntry[],
  transactionIdToType: ReadonlyMap<number, number>,
  journalRefIdToType: ReadonlyMap<number, number>
): Map<number, number>
{
  const out = new Map<number, number>()
  for (const j of journalInRange)
  {
    if (!isMarketFeeRefType(j.ref_type)) continue
    const amt = j.amount
    if (!Number.isFinite(amt)) continue
    const tid =
      resolveTypeIdForMarketFee(j, transactionIdToType, journalRefIdToType) ??
      UNMATCHED_FEE_TYPE_ID
    out.set(tid, (out.get(tid) ?? 0) + amt)
  }
  return out
}

function refTypeIsSalesTax(ref: string): boolean
{
  const t = ref.trim().toLowerCase().split('-').join('_')
  return t === 'transaction_tax' || t === 'sales_tax'
}

/**
 * Брутто buy/sell по `type_id` за выбранные сделки (для весов оценочного распределения комиссий).
 */
export function grossBuySellIskByType(
  transactions: EveWalletTransaction[]
): Map<number, { buyIsk: number; sellIsk: number }>
{
  const m = new Map<number, { buyIsk: number; sellIsk: number }>()
  for (const t of transactions)
  {
    const line = t.unit_price * t.quantity
    if (!Number.isFinite(line)) continue
    const g = m.get(t.type_id) ?? { buyIsk: 0, sellIsk: 0 }
    if (t.is_buy) g.buyIsk += line
    else g.sellIsk += line
    m.set(t.type_id, g)
  }
  return m
}

function distributeAmountByWeights(
  totalAmount: number,
  weights: Map<number, number>
): Map<number, number>
{
  const pos = [...weights.entries()].filter(
    ([, w]) => Number.isFinite(w) && w > 0
  )
  if (pos.length === 0 || !Number.isFinite(totalAmount) || totalAmount === 0)
  {
    return new Map()
  }
  const wsum = pos.reduce((s, [, w]) => s + w, 0)
  if (wsum <= 0) return new Map()
  const out = new Map<number, number>()
  let acc = 0
  for (let i = 0; i < pos.length; i++)
  {
    const [id, w] = pos[i]!
    if (i === pos.length - 1) out.set(id, totalAmount - acc)
    else
    {
      const part = (totalAmount * w) / wsum
      out.set(id, part)
      acc += part
    }
  }
  return out
}

/**
 * Как `aggregateMarketFeeDeltasFromJournal`, но непривязанные к сделке суммы
 * `transaction_tax` / `sales_tax` распределяются пропорционально обороту продаж по типу,
 * `brokers_fee` / `broker_fee` без привязки: сумма делится по глобальным `Σ sell` / `Σ buy`,
 * затем по `sellIsk` и `buyIsk` по типам. Остаток при нулевом обороте — в `UNMATCHED_FEE_TYPE_ID`.
 */
export function aggregateMarketFeeDeltasFromJournalEstimated(
  journalInRange: EveWalletJournalEntry[],
  transactionIdToType: ReadonlyMap<number, number>,
  journalRefIdToType: ReadonlyMap<number, number>,
  transactionsInRange: EveWalletTransaction[]
): Map<number, number>
{
  const out = new Map<number, number>()
  let unmatchedTax = 0
  let unmatchedBroker = 0
  for (const j of journalInRange)
  {
    if (!isMarketFeeRefType(j.ref_type)) continue
    const amt = j.amount
    if (!Number.isFinite(amt)) continue
    const resolved = resolveTypeIdForMarketFee(
      j,
      transactionIdToType,
      journalRefIdToType
    )
    if (resolved != null)
    {
      out.set(resolved, (out.get(resolved) ?? 0) + amt)
    } else if (refTypeIsSalesTax(j.ref_type)) unmatchedTax += amt
    else unmatchedBroker += amt
  }
  const gross = grossBuySellIskByType(transactionsInRange)
  const sellW = new Map<number, number>()
  const buyW = new Map<number, number>()
  for (const [id, g] of gross)
  {
    if (g.sellIsk > 0) sellW.set(id, g.sellIsk)
    if (g.buyIsk > 0) buyW.set(id, g.buyIsk)
  }
  const sumSell = [...sellW.values()].reduce((a, b) => a + b, 0)
  const sumBuy = [...buyW.values()].reduce((a, b) => a + b, 0)
  const activity = sumSell + sumBuy
  for (const [id, d] of distributeAmountByWeights(unmatchedTax, sellW))
  {
    out.set(id, (out.get(id) ?? 0) + d)
  }
  if (unmatchedTax !== 0 && sellW.size === 0)
  {
    out.set(
      UNMATCHED_FEE_TYPE_ID,
      (out.get(UNMATCHED_FEE_TYPE_ID) ?? 0) + unmatchedTax
    )
  }
  if (unmatchedBroker !== 0 && activity > 0)
  {
    const toSellPool = unmatchedBroker * (sumSell / activity)
    const toBuyPool = unmatchedBroker - toSellPool
    for (const [id, d] of distributeAmountByWeights(toSellPool, sellW))
    {
      out.set(id, (out.get(id) ?? 0) + d)
    }
    for (const [id, d] of distributeAmountByWeights(toBuyPool, buyW))
    {
      out.set(id, (out.get(id) ?? 0) + d)
    }
  } else if (unmatchedBroker !== 0)
  {
    out.set(
      UNMATCHED_FEE_TYPE_ID,
      (out.get(UNMATCHED_FEE_TYPE_ID) ?? 0) + unmatchedBroker
    )
  }
  return out
}

export function filterJournalInRange(
  journal: EveWalletJournalEntry[],
  fromMs: number,
  toMs: number
): EveWalletJournalEntry[]
{
  return journal.filter((e) =>
  {
    const t = new Date(e.date).getTime()
    return t >= fromMs && t <= toMs
  })
}

export function aggregateTradeProfitByType(
  transactions: EveWalletTransaction[],
  limit: number,
  mode: TradeProfitByTypeMode = 'all',
  how: TradeProfitHow = 'fifo',
  feeDeltasByType: ReadonlyMap<number, number> | null = null
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
  if (feeDeltasByType != null && feeDeltasByType.size > 0)
  {
    const byId = new Map(rows.map((r) => [r.type_id, { ...r }]))
    for (const [typeId, delta] of feeDeltasByType)
    {
      if (!Number.isFinite(delta) || delta === 0) continue
      const cur = byId.get(typeId)
      if (cur) cur.profit += delta
      else
      {
        byId.set(typeId, {
          type_id: typeId,
          quantitySold: 0,
          buyIsk: 0,
          sellIsk: 0,
          profit: delta,
        })
      }
    }
    rows = [...byId.values()]
  }
  if (mode === 'roundtrip')
  {
    rows = rows.filter(
      (r) => r.type_id === UNMATCHED_FEE_TYPE_ID
        || (r.buyIsk > 0 && r.sellIsk > 0)
    )
  }
  return rows
    .sort((a, b) => b.profit - a.profit)
    .slice(0, limit)
}

/**
 * Комбинированные точки: кошелёк (история) + net worth = wallet + оценка активов (текущий срез)
 * + эскроу buy-ордеров (текущий срез, как с активами).
 */
export function buildNetWorthOverlayPoints(
  walletSeries: TimePoint[],
  assetsValueNow: number,
  marketEscrowIsk: number = 0
): { time: string; wallet: number; netWorth: number }[]
{
  if (walletSeries.length === 0)
  {
    return []
  }
  const extra = marketEscrowIsk
  return walletSeries.map((p) => ({
    time: p.t,
    wallet: p.y,
    netWorth: p.y + assetsValueNow + extra,
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
