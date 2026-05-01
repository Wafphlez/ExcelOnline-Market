import { describe, expect, it } from 'vitest'
import
  {
    aggregateMarketFeeDeltasFromJournal,
    aggregateMarketFeeDeltasFromJournalEstimated,
    aggregateTradeProfitByType,
    aggregateTradesByDay,
    buildWalletBalanceSeries,
    buildWalletJournalRefIdToTypeMap,
    buildWalletTransactionIdToTypeMap,
    filterJournalInRange,
    filterNetWorthSeriesFrom,
    filterTransactionsInRange,
    sumJournalInRange,
    tradeProfitCumulativeDailySeries,
    tradeProfitCumulativeHourlySeries,
    buildNetWorthOverlayPoints,
    valueAssets,
    valuePlexInAssets,
    pricesToMap,
  } from './capitalMetrics'
import type
  {
    EveWalletJournalEntry,
    EveWalletTransaction,
  } from '../../types/eveCharacter'

describe('capitalMetrics', () => {
  it('valuePlexInAssets counts PLEX type_ids only', () => {
    const by = new Map<number, number>([
      [44992, 500],
      [10, 1],
    ])
    const prices = new Map<number, number>([
      [44992, 4_000_000],
      [10, 100],
    ])
    expect(valuePlexInAssets(by, prices)).toBe(500 * 4_000_000)
  })

  it('buildNetWorthOverlayPoints adds escrow to each point', () => {
    const pts = buildNetWorthOverlayPoints(
      [
        { t: '2024-01-01T00:00:00Z', y: 100 },
        { t: '2024-01-02T00:00:00Z', y: 200 },
      ],
      50,
      25
    )
    expect(pts).toHaveLength(2)
    expect(pts[0]!.netWorth).toBe(100 + 50 + 25)
    expect(pts[1]!.netWorth).toBe(200 + 50 + 25)
  })

  it('valueAssets sums qty * price', () => {
    const by = new Map<number, number>([
      [1, 2],
      [2, 3],
    ])
    const p = new Map<number, number>([
      [1, 10],
      [2, 100],
    ])
    expect(valueAssets(by, p)).toBe(2 * 10 + 3 * 100)
  })

  it('pricesToMap prefers average_price', () => {
    const m = pricesToMap([{ type_id: 1, average_price: 5, adjusted_price: 1 }])
    expect(m.get(1)).toBe(5)
  })

  it('buildWalletBalanceSeries uses balance when present', () => {
    const j: EveWalletJournalEntry[] = [
      { id: 1, date: '2020-01-02T00:00:00Z', ref_type: 'a', amount: 1, balance: 100 },
      { id: 2, date: '2020-01-01T00:00:00Z', ref_type: 'b', amount: -1, balance: 99 },
    ]
    const s = buildWalletBalanceSeries(j)
    expect(s[0]!.t < s[1]!.t).toBe(true)
    expect(s[0]!.y).toBe(99)
    expect(s[1]!.y).toBe(100)
  })

  it('sumJournalInRange sums', () => {
    const j: EveWalletJournalEntry[] = [
      { id: 1, date: '2024-01-15T12:00:00Z', ref_type: 'x', amount: 10 },
    ]
    const t = new Date('2024-01-15T00:00:00Z').getTime()
    const t2 = new Date('2024-01-16T00:00:00Z').getTime()
    expect(sumJournalInRange(j, t, t2)).toBe(10)
  })

  it('aggregateTradesByDay splits buy/sell', () => {
    const tr: EveWalletTransaction[] = [
      {
        transaction_id: 1,
        date: '2024-01-10T00:00:00Z',
        type_id: 1,
        location_id: 1,
        unit_price: 2,
        quantity: 3,
        client_id: 0,
        is_buy: true,
        is_personal: true,
        journal_ref_id: 0,
      },
      {
        transaction_id: 2,
        date: '2024-01-10T00:00:00Z',
        type_id: 1,
        location_id: 1,
        unit_price: 10,
        quantity: 1,
        client_id: 0,
        is_buy: false,
        is_personal: true,
        journal_ref_id: 0,
      },
    ]
    const a = aggregateTradesByDay(tr)
    expect(a).toHaveLength(1)
    expect(a[0]!.day).toBe('2024-01-10')
    expect(a[0]!.buyIsk).toBe(2 * 3)
    expect(a[0]!.sellIsk).toBe(10)
  })

  it('filterTransactionsInRange keeps only in window', () => {
    const tr: EveWalletTransaction[] = [
      {
        transaction_id: 1,
        date: '2020-01-01T00:00:00Z',
        type_id: 1,
        location_id: 1,
        unit_price: 1,
        quantity: 1,
        client_id: 0,
        is_buy: true,
        is_personal: true,
        journal_ref_id: 0,
      },
      {
        transaction_id: 2,
        date: '2024-06-15T12:00:00Z',
        type_id: 1,
        location_id: 1,
        unit_price: 1,
        quantity: 1,
        client_id: 0,
        is_buy: false,
        is_personal: true,
        journal_ref_id: 0,
      },
    ]
    const from = new Date('2024-01-01T00:00:00Z').getTime()
    const to = new Date('2024-12-31T00:00:00Z').getTime()
    const f = filterTransactionsInRange(tr, from, to)
    expect(f).toHaveLength(1)
    expect(f[0]!.transaction_id).toBe(2)
  })

  it('filterNetWorthSeriesFrom clips by time', () => {
    const s = filterNetWorthSeriesFrom(
      [
        { time: '2020-01-01T00:00:00Z', wallet: 1, netWorth: 2 },
        { time: '2024-01-01T00:00:00Z', wallet: 3, netWorth: 4 },
      ],
      new Date('2023-01-01T00:00:00Z').getTime()
    )
    expect(s).toHaveLength(1)
    expect(s[0]!.wallet).toBe(3)
  })

  it('aggregateTradeProfitByType uses FIFO for realized profit', () => {
    const tr: EveWalletTransaction[] = [
      {
        transaction_id: 1,
        date: '2024-01-01T00:00:00Z',
        type_id: 10,
        location_id: 1,
        unit_price: 100,
        quantity: 2,
        client_id: 0,
        is_buy: true,
        is_personal: true,
        journal_ref_id: 0,
      },
      {
        transaction_id: 2,
        date: '2024-01-02T00:00:00Z',
        type_id: 10,
        location_id: 1,
        unit_price: 200,
        quantity: 1,
        client_id: 0,
        is_buy: false,
        is_personal: true,
        journal_ref_id: 0,
      },
    ]
    const rows = aggregateTradeProfitByType(tr, 10)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.quantitySold).toBe(1)
    expect(rows[0]!.sellIsk).toBe(200)
    expect(rows[0]!.buyIsk).toBe(200)
    expect(rows[0]!.profit).toBe(100)
  })

  it('aggregateTradeProfitByType gross is sellIsk - buyIsk', () => {
    const tr: EveWalletTransaction[] = [
      {
        transaction_id: 1,
        date: '2024-01-01T00:00:00Z',
        type_id: 10,
        location_id: 1,
        unit_price: 100,
        quantity: 2,
        client_id: 0,
        is_buy: true,
        is_personal: true,
        journal_ref_id: 0,
      },
      {
        transaction_id: 2,
        date: '2024-01-02T00:00:00Z',
        type_id: 10,
        location_id: 1,
        unit_price: 200,
        quantity: 1,
        client_id: 0,
        is_buy: false,
        is_personal: true,
        journal_ref_id: 0,
      },
    ]
    const rows = aggregateTradeProfitByType(tr, 10, 'all', 'gross')
    expect(rows[0]!.profit).toBe(0)
  })

  it('aggregateTradeProfitByType FIFO: unsold stock does not count as loss', () => {
    const tr: EveWalletTransaction[] = [
      {
        transaction_id: 1,
        date: '2024-01-01T00:00:00Z',
        type_id: 20,
        location_id: 1,
        unit_price: 100,
        quantity: 3,
        client_id: 0,
        is_buy: true,
        is_personal: true,
        journal_ref_id: 0,
      },
    ]
    const rows = aggregateTradeProfitByType(tr, 10, 'all')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.profit).toBe(0)
    expect(rows[0]!.buyIsk).toBe(300)
  })

  it('aggregateTradeProfitByType roundtrip omits sell-only types', () => {
    const tr: EveWalletTransaction[] = [
      {
        transaction_id: 1,
        date: '2024-01-01T00:00:00Z',
        type_id: 1,
        location_id: 1,
        unit_price: 50,
        quantity: 10,
        client_id: 0,
        is_buy: false,
        is_personal: true,
        journal_ref_id: 0,
      },
      {
        transaction_id: 2,
        date: '2024-01-02T00:00:00Z',
        type_id: 2,
        location_id: 1,
        unit_price: 10,
        quantity: 1,
        client_id: 0,
        is_buy: true,
        is_personal: true,
        journal_ref_id: 0,
      },
      {
        transaction_id: 3,
        date: '2024-01-03T00:00:00Z',
        type_id: 2,
        location_id: 1,
        unit_price: 20,
        quantity: 1,
        client_id: 0,
        is_buy: false,
        is_personal: true,
        journal_ref_id: 0,
      },
    ]
    const all = aggregateTradeProfitByType(tr, 10, 'all')
    const rt = aggregateTradeProfitByType(tr, 10, 'roundtrip')
    expect(all.map((r) => r.type_id).sort((a, b) => a - b)).toEqual([1, 2])
    expect(rt).toHaveLength(1)
    expect(rt[0]!.type_id).toBe(2)
  })

  it('tradeProfitCumulativeDailySeries last point matches aggregate (FIFO, all)', () => {
    const tr: EveWalletTransaction[] = [
      {
        transaction_id: 1,
        date: '2024-01-01T00:00:00Z',
        type_id: 10,
        location_id: 1,
        unit_price: 100,
        quantity: 2,
        client_id: 0,
        is_buy: true,
        is_personal: true,
        journal_ref_id: 0,
      },
      {
        transaction_id: 2,
        date: '2024-01-03T00:00:00Z',
        type_id: 10,
        location_id: 1,
        unit_price: 200,
        quantity: 1,
        client_id: 0,
        is_buy: false,
        is_personal: true,
        journal_ref_id: 0,
      },
    ]
    const from = new Date('2023-12-01T00:00:00Z').getTime()
    const to = new Date('2024-06-01T00:00:00Z').getTime()
    const tid = buildWalletTransactionIdToTypeMap(tr)
    const jid = buildWalletJournalRefIdToTypeMap(tr)
    const series = tradeProfitCumulativeDailySeries(
      tr,
      [],
      from,
      to,
      'all',
      'fifo',
      tid,
      jid,
    )
    expect(series.map((p) => p.day)).toEqual([
      '2024-01-01',
      '2024-01-02',
      '2024-01-03',
    ])
    expect(series[0]!.cumulativeProfit).toBe(0)
    expect(series[1]!.cumulativeProfit).toBe(0)
    expect(series[2]!.cumulativeProfit).toBe(100)
    const rows = aggregateTradeProfitByType(
      tr,
      Number.POSITIVE_INFINITY,
      'all',
      'fifo',
      null,
    )
    expect(series[series.length - 1]!.cumulativeProfit).toBe(
      rows.reduce((s, r) => s + r.profit, 0),
    )
  })

  it('tradeProfitCumulativeDailySeries roundtrip matches full-period roundtrip total', () => {
    const tr: EveWalletTransaction[] = [
      {
        transaction_id: 1,
        date: '2024-01-01T00:00:00Z',
        type_id: 1,
        location_id: 1,
        unit_price: 50,
        quantity: 10,
        client_id: 0,
        is_buy: false,
        is_personal: true,
        journal_ref_id: 0,
      },
      {
        transaction_id: 2,
        date: '2024-01-02T00:00:00Z',
        type_id: 2,
        location_id: 1,
        unit_price: 10,
        quantity: 1,
        client_id: 0,
        is_buy: true,
        is_personal: true,
        journal_ref_id: 0,
      },
      {
        transaction_id: 3,
        date: '2024-01-03T00:00:00Z',
        type_id: 2,
        location_id: 1,
        unit_price: 20,
        quantity: 1,
        client_id: 0,
        is_buy: false,
        is_personal: true,
        journal_ref_id: 0,
      },
    ]
    const from = new Date('2023-12-01T00:00:00Z').getTime()
    const to = new Date('2024-06-01T00:00:00Z').getTime()
    const tid = buildWalletTransactionIdToTypeMap(tr)
    const jid = buildWalletJournalRefIdToTypeMap(tr)
    const series = tradeProfitCumulativeDailySeries(
      tr,
      [],
      from,
      to,
      'roundtrip',
      'fifo',
      tid,
      jid,
    )
    expect(series[0]!.cumulativeProfit).toBe(0)
    expect(series[1]!.cumulativeProfit).toBe(0)
    const rt = aggregateTradeProfitByType(
      tr,
      Number.POSITIVE_INFINITY,
      'roundtrip',
      'fifo',
      null,
    )
    expect(series[series.length - 1]!.cumulativeProfit).toBe(
      rt.reduce((s, r) => s + r.profit, 0),
    )
    expect(series[series.length - 1]!.cumulativeProfit).toBe(10)
  })

  it('tradeProfitCumulativeHourlySeries steps UTC hours and matches end total', () => {
    const tr: EveWalletTransaction[] = [
      {
        transaction_id: 1,
        date: '2024-01-03T10:00:00Z',
        type_id: 10,
        location_id: 1,
        unit_price: 100,
        quantity: 2,
        client_id: 0,
        is_buy: true,
        is_personal: true,
        journal_ref_id: 0,
      },
      {
        transaction_id: 2,
        date: '2024-01-03T15:00:00Z',
        type_id: 10,
        location_id: 1,
        unit_price: 200,
        quantity: 1,
        client_id: 0,
        is_buy: false,
        is_personal: true,
        journal_ref_id: 0,
      },
    ]
    const from = new Date('2023-12-01T00:00:00Z').getTime()
    const to = new Date('2024-06-01T00:00:00Z').getTime()
    const tid = buildWalletTransactionIdToTypeMap(tr)
    const jid = buildWalletJournalRefIdToTypeMap(tr)
    const series = tradeProfitCumulativeHourlySeries(
      tr,
      [],
      from,
      to,
      'all',
      'fifo',
      tid,
      jid,
    )
    expect(series).toHaveLength(6)
    expect(series[0]!.t).toBe('2024-01-03T10:00:00.000Z')
    expect(series[series.length - 1]!.t).toBe('2024-01-03T15:00:00.000Z')
    expect(series[0]!.cumulativeProfit).toBe(0)
    expect(series[series.length - 2]!.cumulativeProfit).toBe(0)
    expect(series[series.length - 1]!.cumulativeProfit).toBe(100)
    const rows = aggregateTradeProfitByType(
      tr,
      Number.POSITIVE_INFINITY,
      'all',
      'fifo',
      null,
    )
    expect(series[series.length - 1]!.cumulativeProfit).toBe(
      rows.reduce((s, r) => s + r.profit, 0),
    )
  })

  it('filterJournalInRange by date', () => {
    const j: EveWalletJournalEntry[] = [
      { id: 1, date: '2024-01-10T00:00:00Z', ref_type: 'x', amount: 1 },
      { id: 2, date: '2024-06-15T12:00:00Z', ref_type: 'y', amount: 2 },
    ]
    const from = new Date('2024-01-01T00:00:00Z').getTime()
    const to = new Date('2024-12-31T00:00:00Z').getTime()
    expect(filterJournalInRange(j, from, to)).toHaveLength(2)
  })

  it('aggregateMarketFeeDeltasFromJournal maps tax via market_transaction_id', () => {
    const journal: EveWalletJournalEntry[] = [
      {
        id: 10,
        date: '2024-01-10T00:00:00Z',
        ref_type: 'transaction_tax',
        ref_id: 0,
        amount: -50,
        context_id: 2,
        context_id_type: 'market_transaction_id',
      },
    ]
    const tr: EveWalletTransaction[] = [
      {
        transaction_id: 2,
        date: '2024-01-10T00:00:00Z',
        type_id: 10,
        location_id: 1,
        unit_price: 100,
        quantity: 1,
        client_id: 0,
        is_buy: false,
        is_personal: true,
        journal_ref_id: 0,
      },
    ]
    const m = aggregateMarketFeeDeltasFromJournal(
      journal,
      buildWalletTransactionIdToTypeMap(tr),
      buildWalletJournalRefIdToTypeMap(tr)
    )
    expect(m.get(10)).toBe(-50)
  })

  it('aggregateMarketFeeDeltasFromJournalEstimated spreads unmatched tax by sell isk', () => {
    const journal: EveWalletJournalEntry[] = [
      { id: 1, date: '2024-01-10T00:00:00Z', ref_type: 'transaction_tax', amount: -100 },
    ]
    const tr: EveWalletTransaction[] = [
      {
        transaction_id: 1,
        date: '2024-01-10T00:00:00Z',
        type_id: 1,
        location_id: 1,
        unit_price: 10,
        quantity: 10,
        client_id: 0,
        is_buy: false,
        is_personal: true,
        journal_ref_id: 0,
      },
      {
        transaction_id: 2,
        date: '2024-01-10T00:00:00Z',
        type_id: 2,
        location_id: 1,
        unit_price: 30,
        quantity: 10,
        client_id: 0,
        is_buy: false,
        is_personal: true,
        journal_ref_id: 0,
      },
    ]
    const m = aggregateMarketFeeDeltasFromJournalEstimated(
      journal,
      buildWalletTransactionIdToTypeMap(tr),
      buildWalletJournalRefIdToTypeMap(tr),
      tr
    )
    expect(m.get(1)).toBeCloseTo(-25, 5)
    expect(m.get(2)).toBeCloseTo(-75, 5)
  })

  it('aggregateMarketFeeDeltasFromJournalEstimated still applies strict match first', () => {
    const journal: EveWalletJournalEntry[] = [
      {
        id: 1,
        date: '2024-01-10T00:00:00Z',
        ref_type: 'transaction_tax',
        amount: -10,
        context_id: 2,
        context_id_type: 'market_transaction_id',
      },
      { id: 2, date: '2024-01-10T00:00:00Z', ref_type: 'transaction_tax', amount: -90 },
    ]
    const tr: EveWalletTransaction[] = [
      {
        transaction_id: 2,
        date: '2024-01-10T00:00:00Z',
        type_id: 10,
        location_id: 1,
        unit_price: 100,
        quantity: 1,
        client_id: 0,
        is_buy: false,
        is_personal: true,
        journal_ref_id: 0,
      },
    ]
    const m = aggregateMarketFeeDeltasFromJournalEstimated(
      journal,
      buildWalletTransactionIdToTypeMap(tr),
      buildWalletJournalRefIdToTypeMap(tr),
      tr
    )
    expect(m.get(10)).toBe(-100)
  })

  it('aggregateMarketFeeDeltasFromJournalEstimated splits unmatched broker by sell/buy pools', () => {
    const journal: EveWalletJournalEntry[] = [
      { id: 1, date: '2024-01-10T00:00:00Z', ref_type: 'brokers_fee', amount: -300 },
    ]
    const tr: EveWalletTransaction[] = [
      {
        transaction_id: 1,
        date: '2024-01-10T00:00:00Z',
        type_id: 1,
        location_id: 1,
        unit_price: 100,
        quantity: 1,
        client_id: 0,
        is_buy: true,
        is_personal: true,
        journal_ref_id: 0,
      },
      {
        transaction_id: 2,
        date: '2024-01-10T00:00:00Z',
        type_id: 2,
        location_id: 1,
        unit_price: 200,
        quantity: 1,
        client_id: 0,
        is_buy: false,
        is_personal: true,
        journal_ref_id: 0,
      },
    ]
    const m = aggregateMarketFeeDeltasFromJournalEstimated(
      journal,
      buildWalletTransactionIdToTypeMap(tr),
      buildWalletJournalRefIdToTypeMap(tr),
      tr
    )
    // Σ sell=200, Σ buy=100 → 2/3 broker to sell side (type 2), 1/3 to buy (type 1)
    expect(m.get(1)).toBeCloseTo(-100, 5)
    expect(m.get(2)).toBeCloseTo(-200, 5)
  })

  it('aggregateMarketFeeDeltasFromJournal maps brokers_fee via journal ref_id', () => {
    const journal: EveWalletJournalEntry[] = [
      {
        id: 1,
        date: '2024-01-10T00:00:00Z',
        ref_type: 'brokers_fee',
        ref_id: 99,
        amount: -14,
      },
    ]
    const tr: EveWalletTransaction[] = [
      {
        transaction_id: 1,
        date: '2024-01-10T00:00:00Z',
        type_id: 5,
        location_id: 1,
        unit_price: 10,
        quantity: 1,
        client_id: 0,
        is_buy: true,
        is_personal: true,
        journal_ref_id: 99,
      },
    ]
    const m = aggregateMarketFeeDeltasFromJournal(
      journal,
      buildWalletTransactionIdToTypeMap(tr),
      buildWalletJournalRefIdToTypeMap(tr)
    )
    expect(m.get(5)).toBe(-14)
  })

  it('aggregateTradeProfitByType includes journal fee in profit', () => {
    const tr: EveWalletTransaction[] = [
      {
        transaction_id: 1,
        date: '2024-01-01T00:00:00Z',
        type_id: 10,
        location_id: 1,
        unit_price: 100,
        quantity: 1,
        client_id: 0,
        is_buy: true,
        is_personal: true,
        journal_ref_id: 0,
      },
      {
        transaction_id: 2,
        date: '2024-01-02T00:00:00Z',
        type_id: 10,
        location_id: 1,
        unit_price: 200,
        quantity: 1,
        client_id: 0,
        is_buy: false,
        is_personal: true,
        journal_ref_id: 0,
      },
    ]
    const fees = new Map([[10, -42 as number]])
    const rows = aggregateTradeProfitByType(tr, 10, 'all', 'fifo', fees)
    expect(rows[0]!.profit).toBe(100 - 42)
  })
})
