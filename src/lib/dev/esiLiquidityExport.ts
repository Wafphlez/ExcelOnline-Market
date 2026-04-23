/**
 * Сборка ликвидности для Excel по ESI (только Node / Vite dev middleware).
 * Ордера → лучший bid/ask; история → оборот/объём за ~30 дней.
 */
import * as https from 'node:https'
import * as XLSX from 'xlsx'
import {
  ESI_EXPORT_PROGRESS_IDLE,
  type EsiExportProgressState,
} from '../esiExportProgressTypes'

const ESI_BASE = 'https://esi.evetech.net/latest'
const USER_AGENT =
  'ExcelOnlineMarket/1.0 (dev; https://github.com/Wafphlez/ExcelOnline-Market)'

const ESI_LOG_PREFIX = '[ESI export]'

const MAX_DEV_LOG_LINES = 600
const esiDevLogBuffer: string[] = []

let esiProgress: EsiExportProgressState = { ...ESI_EXPORT_PROGRESS_IDLE }

/** Сигнал из POST /esi-stop: завершить сбор и собрать xlsx по текущим строкам. */
let esiStopRequested = false

/** Клиент (кнопка «стоп») — между запросами ESI сработает на следующем шаге. */
function requestEsiExportStopLog(): void {
  if (!esiStopRequested) {
    esiStopRequested = true
    esiDevLog(
      'запрошен принудительный стоп — после текущего запроса ESI сбор прервётся и запишется xlsx'
    )
  }
}

export function requestEsiExportStop(): void {
  requestEsiExportStopLog()
}

function clearEsiStopRequest(): void {
  esiStopRequested = false
}

function isEsiStopRequested(): boolean {
  return esiStopRequested
}

export function getEsiExportProgressState(): EsiExportProgressState {
  return { ...esiProgress }
}

function formatEsiQuery(q: Record<string, string>): string {
  const e = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) e.set(k, v)
  return e.toString()
}

/** Очистка буфера (перед новым POST /esi-liquidity). */
export function clearEsiDevLogs(): void {
  esiDevLogBuffer.length = 0
  esiProgress = { ...ESI_EXPORT_PROGRESS_IDLE }
  clearEsiStopRequest()
}

export function getEsiDevLogLines(): { lines: string[] } {
  return { lines: [...esiDevLogBuffer] }
}

function esiDevLog(message: string): void {
  const line = `${ESI_LOG_PREFIX} ${message}`
  console.log(line)
  esiDevLogBuffer.push(line)
  while (esiDevLogBuffer.length > MAX_DEV_LOG_LINES) {
    esiDevLogBuffer.shift()
  }
}

/**
 * Записать в буфер (и в консоль dev-сервера) исключение — видно в GET /esi-logs и в UI при 502.
 */
export function logEsiExportException(context: string, err: unknown): void {
  const m = err instanceof Error ? err.message : String(err)
  esiDevLog(`ОШИБКА [${context}]: ${m}`)
  if (err instanceof Error && err.stack) {
    for (const line of err.stack.split('\n').slice(0, 12)) {
      const t = line.trim()
      if (t) esiDevLog(`  ${t}`)
    }
  }
}

export type EsiLiquidityExportOptions = {
  /** Макс. типов с отдельным запросом истории (остальные отсекаются по активности ордеров). */
  maxTypes: number
  /** Макс. страниц ордеров (по 1000 шт.), защита от бесконечного цикла. */
  maxOrderPages: number
  /** Пауза между батчами типов (мс) — внутри батча имя + история по типу параллельны. */
  historyDelayMs: number
  /** Сколько типов обрабатывать одновременно (батчами, после батча — historyDelayMs). */
  typeConcurrency: number
}

const DEFAULT_OPTS: EsiLiquidityExportOptions = {
  maxTypes: 72,
  maxOrderPages: 90,
  historyDelayMs: 180,
  typeConcurrency: 3,
}

/** Vite передаёт в opts явные `undefined` — без этого они затирают DEFAULT_OPTS при object spread. */
function mergeEsiOpts(
  partial?: Partial<EsiLiquidityExportOptions>
): EsiLiquidityExportOptions {
  const o: EsiLiquidityExportOptions = { ...DEFAULT_OPTS }
  if (!partial) return o
  if (partial.maxTypes !== undefined) o.maxTypes = partial.maxTypes
  if (partial.maxOrderPages !== undefined) o.maxOrderPages = partial.maxOrderPages
  if (partial.historyDelayMs !== undefined) o.historyDelayMs = partial.historyDelayMs
  if (partial.typeConcurrency !== undefined) {
    o.typeConcurrency = Math.max(1, Math.min(8, Math.floor(partial.typeConcurrency)))
  }
  return o
}

type EsiMarketOrder = {
  type_id: number
  is_buy_order: boolean
  price: number
  volume_remain: number
}

type EsiHistoryDay = {
  date: string
  average: number
  volume: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function buildEsiUrl(path: string, query: Record<string, string>): string {
  const p = path.startsWith('/') ? path : `/${path}`
  // Нельзя new URL(p, ESI_BASE): ведущий / заменяет путь и теряется сегмент /latest
  const u = new URL(`${ESI_BASE.replace(/\/$/, '')}${p}`)
  u.searchParams.set('datasource', 'tranquility')
  for (const [k, v] of Object.entries(query)) {
    u.searchParams.set(k, v)
  }
  return u.toString()
}

/** GET с повтором при 420/429/503/5xx. */
async function esiFetch<T>(path: string, query: Record<string, string>): Promise<T> {
  const qStr = formatEsiQuery(query)
  const label = qStr ? `${path}?${qStr}` : path
  for (let attempt = 0; attempt < 12; attempt++) {
    const url = buildEsiUrl(path, query)
    esiDevLog(`GET ${label} (попытка ${attempt + 1}) → esi.evetech.net`)
    const t0 = Date.now()
    const { body, status, retryAfterSec } = await new Promise<{
      body: string
      status: number
      retryAfterSec: number
    }>((resolve, reject) => {
      const req = https.get(
        url,
        {
          headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
        },
        (incoming) => {
          const chunks: Buffer[] = []
          incoming.on('data', (c) => chunks.push(c as Buffer))
          incoming.on('end', () => {
            resolve({
              body: Buffer.concat(chunks).toString('utf8'),
              status: incoming.statusCode ?? 0,
              retryAfterSec: Number(incoming.headers['retry-after'] ?? 0),
            })
          })
        }
      )
      req.on('error', reject)
      req.setTimeout(120_000, () => {
        req.destroy()
        reject(new Error('ESI timeout'))
      })
    })
    const ms = Date.now() - t0
    if (status === 200) {
      esiDevLog(
        `← ${path} HTTP 200, ${body.length} B, ${ms} ms`
      )
      return JSON.parse(body) as T
    }
    if (status === 404 && body.includes('Not found')) {
      esiDevLog(`← ${path} HTTP 404, ${ms} ms — не найдено`)
      throw new Error(`ESI 404: ${path}`)
    }
    if (status === 420 || status === 429 || status === 503) {
      const w = Math.max(
        10_000,
        retryAfterSec * 1000 || (attempt + 1) * 8000
      )
      esiDevLog(
        `← ${path} HTTP ${status}, ${ms} ms — пауза ${w} ms (retry-after/slip)`
      )
      await sleep(w)
      continue
    }
    if (status >= 500) {
      const w = 3000 * (attempt + 1)
      esiDevLog(
        `← ${path} HTTP ${status}, ${ms} ms — сервер, пауза ${w} ms`
      )
      await sleep(w)
      continue
    }
    esiDevLog(`← ${path} HTTP ${status}, ${ms} ms — фатал`)
    throw new Error(`ESI ${status}: ${body.slice(0, 300)}`)
  }
  esiDevLog(`← ${path} — слишком много повторов`)
  throw new Error('ESI: слишком много повторов')
}

export type LiquidityRow = {
  name: string
  type_id: number
  day_volume: number
  /** млн ISK, как в выгрузке для mapColumns (excelMillionsToIsk) */
  day_turnover: number
  price: number
  price_sell: number
  price_bay: number
}

function parseEsiDate(d: string): Date {
  return new Date(d.includes('T') ? d : `${d}T00:00:00Z`)
}

function filterLastDays(
  days: EsiHistoryDay[],
  fromDate: Date
): EsiHistoryDay[] {
  return days
    .filter((h) => parseEsiDate(h.date) >= fromDate)
    .sort(
      (a, b) => parseEsiDate(a.date).getTime() - parseEsiDate(b.date).getTime()
    )
}

function liquidityFromHistory(
  days: EsiHistoryDay[],
  fromDate: Date
): { dayAvgVolume: number; last3AvgPrice: number; dayTurnoverMln: number } | null {
  const h = filterLastDays(days, fromDate)
  if (h.length === 0) return null
  const totalVol = h.reduce((s, d) => s + d.volume, 0)
  const rangeDays = Math.max(
    1,
    Math.round(
      (Date.now() - fromDate.getTime()) / (24 * 60 * 60 * 1000)
    ) || 30
  )
  const dayAvgVolume = totalVol / rangeDays
  const n = h.length
  const last3 = h.slice(Math.max(0, n - 3))
  const last3AvgPrice =
    last3.reduce((s, d) => s + d.average, 0) / last3.length
  const dayTurnoverMln = (dayAvgVolume * last3AvgPrice) / 1_000_000
  return { dayAvgVolume, last3AvgPrice, dayTurnoverMln }
}

/**
 * Одна сторона книги (sell / buy) — пагинация. Sell и buy вызываются параллельно.
 */
async function fetchOrdersForSide(
  regionId: number,
  maxPages: number,
  side: 'sell' | 'buy',
  onPage: (page: number) => void
): Promise<EsiMarketOrder[]> {
  const all: EsiMarketOrder[] = []
  for (let page = 1; page <= maxPages; page++) {
    if (isEsiStopRequested()) {
      esiDevLog(
        `ордера ${side}: стоп — собрано ${all.length} (обе стороны запрашивались параллельно)`
      )
      return all
    }
    onPage(page)
    const part = await esiFetch<EsiMarketOrder[]>(`/markets/${regionId}/orders/`, {
      order_type: side,
      page: String(page),
    })
    if (!Array.isArray(part) || part.length === 0) {
      esiDevLog(
        `ордера region=${regionId} ${side} page=${page} — пусто, конец стороны (всего ${all.length})`
      )
      break
    }
    all.push(...part)
    esiDevLog(
      `ордера region=${regionId} ${side} page=${page} — +${part.length} (всего по ${side} ${all.length})`
    )
    if (part.length < 1000) break
    await sleep(200)
    if (isEsiStopRequested()) {
      esiDevLog(`ордера ${side}: стоп после паузы — ${all.length}`)
      return all
    }
  }
  return all
}

/**
 * Собирает ордера: sell + buy **параллельно** (два независимых `Promise.all`).
 * Не используем `order_type=all` — только отдельные sell/buy.
 */
export async function fetchAllMarketOrders(
  regionId: number,
  maxPages: number
): Promise<EsiMarketOrder[]> {
  esiProgress.phase = 'orders'
  esiProgress.maxOrderPages = maxPages
  esiProgress.sellPage = 0
  esiProgress.buyPage = 0
  const [sellOrders, buyOrders] = await Promise.all([
    fetchOrdersForSide(regionId, maxPages, 'sell', (p) => {
      esiProgress.sellPage = p
    }),
    fetchOrdersForSide(regionId, maxPages, 'buy', (p) => {
      esiProgress.buyPage = p
    }),
  ])
  return [...sellOrders, ...buyOrders]
}

type Agg = { asks: number[]; bids: number[]; activity: number }

function aggregateByType(orders: EsiMarketOrder[]): Map<number, Agg> {
  const m = new Map<number, Agg>()
  for (const o of orders) {
    const t = o.type_id
    let a = m.get(t)
    if (!a) {
      a = { asks: [], bids: [], activity: 0 }
      m.set(t, a)
    }
    a.activity += o.volume_remain
    if (o.is_buy_order) a.bids.push(o.price)
    else a.asks.push(o.price)
  }
  for (const a of m.values()) {
    a.asks.sort((x, y) => x - y)
    a.bids.sort((x, y) => y - x)
  }
  return m
}

function bestAsk(a: Agg): number | null {
  return a.asks.length ? a.asks[0]! : null
}
function bestBid(a: Agg): number | null {
  return a.bids.length ? a.bids[0]! : null
}

/** Имя типа + история рынка — параллельно (два HTTP к ESI). */
async function buildOneLiquidityRow(
  typeId: number,
  regionId: number,
  monthAgo: Date,
  byType: Map<number, Agg>
): Promise<LiquidityRow | null> {
  if (isEsiStopRequested()) {
    return null
  }
  const agg = byType.get(typeId)
  if (!agg) return null
  const priceSell = bestAsk(agg)
  const priceBuy = bestBid(agg)
  if (priceSell == null || priceBuy == null) return null
  if (priceSell <= 0 || priceBuy <= 0) return null

  let name = `Type ${typeId}`

  const [typeRes, hist] = await Promise.all([
    esiFetch<{ name?: string }>(`/universe/types/${typeId}/`, { language: 'en' }).catch(
      () => ({}) as { name?: string }
    ),
    esiFetch<EsiHistoryDay[]>(`/markets/${regionId}/history/`, {
      type_id: String(typeId),
    }).catch(() => [] as EsiHistoryDay[]),
  ])
  if (typeRes.name) {
    name = typeRes.name
  }
  if (!Array.isArray(hist) || hist.length === 0) {
    return null
  }
  const liq = liquidityFromHistory(hist, monthAgo)
  if (!liq) {
    return null
  }
  return {
    name,
    type_id: typeId,
    day_volume: liq.dayAvgVolume,
    day_turnover: liq.dayTurnoverMln,
    price: liq.last3AvgPrice,
    price_sell: priceSell,
    price_bay: priceBuy,
  }
}

export type BuildLiquidityRowsResult = {
  rows: LiquidityRow[]
  /** true — сработал POST /esi-stop, в файле неполный набор. */
  stoppedEarly: boolean
}

export async function buildLiquidityRows(
  regionId: number,
  opts: Partial<EsiLiquidityExportOptions> = {}
): Promise<BuildLiquidityRowsResult> {
  const o = mergeEsiOpts(opts)
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const tAll = Date.now()
  esiDevLog(
    `строки ликвидности: region=${regionId}, maxOrderPages=${o.maxOrderPages}, maxTypes=${o.maxTypes}, typeConcurrency=${o.typeConcurrency}, historyDelayMs=${o.historyDelayMs}; ордера sell|buy — параллельно, типы — батчами`
  )

  const orders = await fetchAllMarketOrders(regionId, o.maxOrderPages)
  esiDevLog(
    `ордера собраны: ${orders.length} шт. за ${((Date.now() - tAll) / 1000).toFixed(1)} s`
  )
  if (orders.length === 0) {
    const stopped = isEsiStopRequested()
    esiProgress = { ...ESI_EXPORT_PROGRESS_IDLE }
    if (stopped) {
      esiDevLog('принудительный стоп: ордера пусты — в xlsx будет служебная строка')
    }
    return { rows: [], stoppedEarly: stopped }
  }
  const byType = aggregateByType(orders)
  const candidates: { typeId: number; activity: number }[] = []
  for (const [typeId, agg] of byType) {
    const ask = bestAsk(agg)
    const bid = bestBid(agg)
    if (ask == null || bid == null) continue
    if (ask <= 0 || bid <= 0) continue
    candidates.push({ typeId, activity: agg.activity })
  }
  candidates.sort((a, b) => b.activity - a.activity)
  const chosen = candidates.slice(0, o.maxTypes)
  esiDevLog(
    `кандидатов с bid+ask: ${candidates.length}, обрабатываем топ: ${chosen.length} типов`
  )
  if (chosen.length === 0) {
    const stopped = isEsiStopRequested()
    esiProgress = { ...ESI_EXPORT_PROGRESS_IDLE }
    if (stopped) {
      esiDevLog(
        'принудительный стоп: нет пар bid+ask по текущему набору ордеров — пустой/служебный лист'
      )
    }
    return { rows: [], stoppedEarly: stopped }
  }
  esiProgress.phase = 'types'
  esiProgress.typeTotal = chosen.length
  esiProgress.typesDone = 0
  const conc = o.typeConcurrency
  esiProgress.typeConcurrency = conc

  const rows: LiquidityRow[] = []
  let stoppedInTypes = false
  for (let i = 0; i < chosen.length; i += conc) {
    if (isEsiStopRequested()) {
      stoppedInTypes = true
      esiDevLog(
        `типы: стоп — собрано ${rows.length} позиций (параллель по ${conc})`
      )
      break
    }
    const batch = chosen.slice(i, i + conc)
    const batchRows = await Promise.all(
      batch.map(({ typeId }) =>
        buildOneLiquidityRow(typeId, regionId, monthAgo, byType)
      )
    )
    for (const row of batchRows) {
      if (row) rows.push(row)
    }
    const added = batchRows.filter(Boolean).length
    esiDevLog(
      `типы: батч ${Math.floor(i / conc) + 1}, +${added}/${batch.length} к строкам, всего ${rows.length}`
    )
    esiProgress.typesDone = Math.min(i + batch.length, chosen.length)
    if (i + conc < chosen.length) {
      if (isEsiStopRequested()) {
        stoppedInTypes = true
        esiDevLog(`типы: стоп после батча — ${rows.length} позиций`)
        break
      }
      await sleep(o.historyDelayMs)
    }
  }

  esiDevLog(
    `сборка строк завершена: ${rows.length} позиций${stoppedInTypes ? ' (частично, стоп)' : ''} за ${((Date.now() - tAll) / 1000).toFixed(1)} s`
  )
  esiProgress = { ...ESI_EXPORT_PROGRESS_IDLE }
  return { rows, stoppedEarly: stoppedInTypes }
}

/**
 * Собирает xlsx (один лист) в Buffer — те же смыслы колонок, что [mapColumns](src/lib/mapColumns.ts).
 */
export function liquidityRowsToXlsxBuffer(rows: LiquidityRow[]): Buffer {
  const sheetRows = rows.map((r) => ({
    name: r.name,
    type_id: r.type_id,
    day_volume: r.day_volume,
    day_turnover: r.day_turnover,
    price: r.price,
    price_sell: r.price_sell,
    price_bay: r.price_bay,
  }))
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(sheetRows, { cellDates: true })
  XLSX.utils.book_append_sheet(wb, ws, 'liquidity')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

function liquidityXlsxFromRowsOrEmptyStopNote(
  rows: LiquidityRow[],
  note: string
): Buffer {
  if (rows.length > 0) {
    return liquidityRowsToXlsxBuffer(rows)
  }
  return liquidityRowsToXlsxBuffer([
    {
      name: note,
      type_id: 0,
      day_volume: 0,
      day_turnover: 0,
      price: 0,
      price_sell: 0,
      price_bay: 0,
    },
  ])
}

export async function buildEsiLiquidityXlsx(
  regionId: number,
  opts?: Partial<EsiLiquidityExportOptions>
): Promise<{ buffer: Buffer; rowCount: number; partial: boolean }> {
  const t0 = Date.now()
  try {
    const { rows, stoppedEarly } = await buildLiquidityRows(regionId, opts)
    if (rows.length === 0) {
      if (!stoppedEarly) {
        throw new Error(
          'Нет строк: ордера пусты или нет пересечения ордеров/истории за период.'
        )
      }
      const buffer = liquidityXlsxFromRowsOrEmptyStopNote(
        [],
        'Принудительный стоп — нет полных строк (нужны bid+ask по типам).'
      )
      esiDevLog(
        `xlsx (частично): 0 позиций, ${buffer.length} B, ${((Date.now() - t0) / 1000).toFixed(1)} s`
      )
      return { buffer, rowCount: 0, partial: true }
    }
    const buffer = liquidityRowsToXlsxBuffer(rows)
    esiDevLog(
      `xlsx: ${rows.length} строк, ${buffer.length} B файла, всего ${((Date.now() - t0) / 1000).toFixed(1)} s${stoppedEarly ? ' (частично, стоп)' : ''}`
    )
    return { buffer, rowCount: rows.length, partial: stoppedEarly }
  } finally {
    clearEsiStopRequest()
  }
}
