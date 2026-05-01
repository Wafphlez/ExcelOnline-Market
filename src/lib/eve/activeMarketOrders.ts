import type { EsiCharacterOrder, EsiRegionalOrderRow } from '../../types/eveMarketOrders'
import { fetchTypeNameMap } from './characterEsi'
import { EsiHttpError, esiFetchJson } from './esiClient'
import
  {
    ESI_REQUEST_GAP_MS,
  } from './constants'
import
  {
    resolveLocationToRegionAndLabel,
    resolveRegionName,
  } from './universeResolve'

function sleep(ms: number): Promise<void>
{
  return new Promise((r) => setTimeout(r, ms))
}

const EPS = 0.01
const MAX_MARKET_ORDER_PAGES = 28

export type ActiveMarketOrderRow = {
  orderId: number
  typeId: number
  typeName: string
  price: number
  isBest: boolean
  isUndercut: boolean
  priceDiff: number | null
  volumeDone: number
  volumeTotal: number
  lineTotal: number
  ownerLabel: string
  expiresLabel: string
  stationLabel: string
  regionName: string
  rangeLabel: string | null
  minVolume: number | null
  escrowRemaining: number | null
  bookTruncated: boolean
}

export type ActiveMarketOrdersData = {
  sells: ActiveMarketOrderRow[]
  buys: ActiveMarketOrderRow[]
  sellTotalExposureIsk: number
  buyTotalEscrowIsk: number
  buyRemainingToCover: number
  scopeMissing: boolean
  errorMessage: string | null
}

function parseOrderBookPage(
  data: unknown
): { rows: EsiRegionalOrderRow[]; end: boolean }
{
  if (Array.isArray(data))
  {
    if (data.length === 0) return { rows: [], end: true }
    return { rows: data as EsiRegionalOrderRow[], end: data.length < 1000 }
  }
  if (data && typeof data === 'object' && 'error' in data)
  {
    const err = (data as { error?: unknown }).error
    const errStr = typeof err === 'string' ? err : String(err)
    if (/requested page does not exist|page does not exist/i.test(errStr)) return { rows: [], end: true }
    throw new Error(String(errStr))
  }
  throw new Error('ESI: неожиданный ответ /markets/…/orders/')
}

async function bestPriceInRegion(
  regionId: number,
  typeId: number,
  orderType: 'sell' | 'buy',
  signal: AbortSignal | undefined
): Promise<{ value: number | null; bookTruncated: boolean }>
{
  let best: number | null = null
  let bookTruncated = false
  for (let page = 1; page <= MAX_MARKET_ORDER_PAGES; page++)
  {
    if (signal?.aborted) break
    await sleep(ESI_REQUEST_GAP_MS)
    let data: unknown
    try
    {
      data = await esiFetchJson<unknown>(`/markets/${ regionId }/orders/`, {
        query: { order_type: orderType, type_id: typeId, page },
        signal,
      })
    } catch (e)
    {
      if (e instanceof EsiHttpError && e.status === 404) return { value: best, bookTruncated: true }
      throw e
    }
    const { rows, end } = parseOrderBookPage(data)
    for (const r of rows)
    {
      if (r.type_id !== typeId) continue
      if (orderType === 'sell' && r.is_buy_order) continue
      if (orderType === 'buy' && !r.is_buy_order) continue
      if (orderType === 'sell')
      {
        if (best == null || r.price < best) best = r.price
      } else if (best == null || r.price > best)
      {
        best = r.price
      }
    }
    if (rows.length === 0) break
    if (end) break
    if (page === MAX_MARKET_ORDER_PAGES) bookTruncated = true
  }
  return { value: best, bookTruncated }
}

function formatExpires(issued: string, durationDays: number): string
{
  const start = new Date(issued).getTime()
  if (Number.isNaN(start)) return '—'
  const end = start + Math.max(0, durationDays) * 86_400_000
  const left = end - Date.now()
  if (left <= 0) return 'истёк'
  const d = Math.floor(left / 86_400_000)
  const h = Math.floor((left % 86_400_000) / 3_600_000)
  const m = Math.floor((left % 3_600_000) / 60_000)
  return `${ d }d ${ h }h ${ m }m`
}

function formatBuyRange(r: EsiCharacterOrder['range']): string
{
  if (r == null) return '—'
  if (typeof r === 'string')
  {
    const t = r.trim()
    if (/^station|ст$/i.test(t)) return 'Станция'
    return t
  }
  if (!Number.isFinite(r)) return '—'
  if (r >= 32_000) return 'Регион'
  if (r <= 0) return 'Станция'
  if (r === 1) return '1 прыжок'
  if (r >= 2 && r <= 4) return `${ r } прыжка`
  return `${ r } прыжков`
}

export async function loadActiveMarketOrdersData(
  characterId: number,
  accessToken: string,
  signal: AbortSignal | undefined
): Promise<ActiveMarketOrdersData>
{
  const empty: ActiveMarketOrdersData = {
    sells: [],
    buys: [],
    sellTotalExposureIsk: 0,
    buyTotalEscrowIsk: 0,
    buyRemainingToCover: 0,
    scopeMissing: false,
    errorMessage: null,
  }

  let raw: EsiCharacterOrder[] = []
  try
  {
    await sleep(ESI_REQUEST_GAP_MS)
    raw = await esiFetchJson<EsiCharacterOrder[]>(
      `/characters/${ characterId }/orders/`,
      { accessToken, signal }
    )
  } catch (e)
  {
    if (e instanceof EsiHttpError && (e.status === 401 || e.status === 403))
    {
      return {
        ...empty,
        scopeMissing: true,
        errorMessage: 'Нет права `esi-markets.read_character_orders.v1` — выйдите и войдите снова через EVE SSO.',
      }
    }
    return {
      ...empty,
      errorMessage: e instanceof Error ? e.message : 'Не удалось загрузить рыночные ордера',
    }
  }

  if (!Array.isArray(raw) || raw.length === 0) return empty

  const active = raw.filter(
    (o) => o.state == null || String(o.state).toLowerCase() === 'active'
  )
  if (active.length === 0) return empty

  const typeIds = [...new Set(active.map((a) => a.type_id))]

  const locIds = [...new Set(active.map((a) => a.location_id))]

  const locInfo = new Map<
    number,
    { regionId: number; label: string; regionName: string }
  >()
  for (const lid of locIds)
  {
    if (signal?.aborted) return empty
    try
    {
      const { regionId, label } = await resolveLocationToRegionAndLabel(
        lid,
        accessToken,
        signal
      )
      const rn = await resolveRegionName(regionId, signal)
      locInfo.set(lid, { regionId, label, regionName: rn })
    } catch
    {
      locInfo.set(lid, {
        regionId: -1,
        label: `Локация ${ lid }`,
        regionName: '—',
      })
    }
  }

  const typeNames = await fetchTypeNameMap(typeIds, signal)
  if (signal?.aborted) return empty

  const bestCache = new Map<string, { value: number | null; bookTruncated: boolean }>()
  const key = (r: number, t: number, s: 'sell' | 'buy') => `${ r }:${ t }:${ s }`
  const ensureBest = async (regionId: number, typeId: number, isBuy: boolean) =>
  {
    const k = key(regionId, typeId, isBuy ? 'buy' : 'sell')
    if (bestCache.has(k)) return
    const { value, bookTruncated } = await bestPriceInRegion(
      regionId,
      typeId,
      isBuy ? 'buy' : 'sell',
      signal
    )
    bestCache.set(k, { value, bookTruncated })
  }

  const sells: ActiveMarketOrderRow[] = []
  const buys: ActiveMarketOrderRow[] = []
  for (const o of active)
  {
    if (signal?.aborted) return empty
    const li = locInfo.get(o.location_id)
    if (!li) continue
    const canBook = li.regionId >= 0
    const typeName = typeNames.get(o.type_id) ?? `#${ o.type_id }`
    const volDone = o.volume_total - o.volume_remain
    const lineTotal = o.price * o.volume_total
    const owner = o.is_corporation ? 'Корпорация' : 'Лично'
    const exp = formatExpires(o.issued, o.duration)
    if (canBook)
    {
      if (o.is_buy_order) await ensureBest(li.regionId, o.type_id, true)
      else await ensureBest(li.regionId, o.type_id, false)
    }
    const bk = o.is_buy_order
      ? (canBook ? bestCache.get(key(li.regionId, o.type_id, 'buy')) : undefined)
      : (canBook ? bestCache.get(key(li.regionId, o.type_id, 'sell')) : undefined)
    const best = bk?.value ?? null
    const bookTruncated = bk?.bookTruncated ?? false
    let isBest = false
    let isUndercut = false
    let priceDiff: number | null = null
    if (best != null)
    {
      if (o.is_buy_order)
      {
        if (o.price + EPS >= best) { isBest = true; priceDiff = 0 }
        else
        {
          isUndercut = true
          priceDiff = best - o.price
        }
      } else if (o.price - EPS <= best)
      {
        isBest = true
        priceDiff = 0
      } else
      {
        isUndercut = true
        priceDiff = o.price - best
      }
    }
    const escrow = o.is_buy_order ? o.price * o.volume_remain : null
    const row: ActiveMarketOrderRow = {
      orderId: o.order_id,
      typeId: o.type_id,
      typeName,
      price: o.price,
      isBest,
      isUndercut,
      priceDiff,
      volumeDone: volDone,
      volumeTotal: o.volume_total,
      lineTotal,
      ownerLabel: owner,
      expiresLabel: exp,
      stationLabel: li.label,
      regionName: li.regionName,
      rangeLabel: o.is_buy_order ? formatBuyRange(o.range) : null,
      minVolume: o.is_buy_order ? o.min_volume : null,
      escrowRemaining: escrow,
      bookTruncated,
    }
    if (o.is_buy_order) buys.push(row)
    else sells.push(row)
  }

  sells.sort((a, b) => b.lineTotal - a.lineTotal)
  buys.sort((a, b) => b.lineTotal - a.lineTotal)

  const sellTotalExposureIsk = sells.reduce(
    (s, r) => s + r.price * Math.max(0, r.volumeTotal - r.volumeDone),
    0
  )
  const buyEsc = buys.reduce(
    (s, r) => s + (r.escrowRemaining ?? 0),
    0
  )

  return {
    sells,
    buys,
    sellTotalExposureIsk,
    buyTotalEscrowIsk: buyEsc,
    buyRemainingToCover: 0,
    scopeMissing: false,
    errorMessage: null,
  }
}
