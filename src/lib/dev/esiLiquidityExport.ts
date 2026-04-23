/**
 * Сборка ликвидности для Excel по ESI (только Node / Vite dev middleware).
 * Ордера → лучший bid/ask; история → оборот/объём за ~30 дней.
 */
import * as fs from 'node:fs/promises'
import * as https from 'node:https'
import * as path from 'node:path'
import * as XLSX from 'xlsx'
import {
  ESI_EXPORT_PROGRESS_IDLE,
  type EsiExportProgressState,
} from '../esiExportProgressTypes'
import {
  ESI_DEFAULT_MAX_TYPES,
  ESI_MAX_ORDER_PAGES_USER_CAP,
  ESI_MAX_TYPES_USER_CAP,
  ESI_ORDER_PAGE_STAGGER_SEC,
} from '../esiOrderPageLimits'

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

/* ---------- Локальный кэш GET /universe/types/{id}/ (имя не меняется, тянуть ESI смысла нет) ---------- */

const TYPE_CACHE_FILE = 'esi-type-cache.json'
const TYPE_CACHE_VERSION = 1
type EsiTypeCacheFile = { v: number; types: Record<string, { name: string }> }

const typeNameById = new Map<number, string>()
let typeNameCacheDirty = false
const typeNameFetchInflight = new Map<number, Promise<string | undefined>>()

/**
 * Один Promise на весь прогон: нельзя ставить «загружено» до await read,
 * иначе параллельные getEsiTypeName (prefetch с ордеров) видят пустой кэш и
 * дублируют GET /universe/types/.
 */
let typeNameCacheLoadFromDisk: Promise<void> | null = null

function typeCachePath(): string {
  return path.join(process.cwd(), 'data', TYPE_CACHE_FILE)
}

async function loadTypeNameCacheFromDiskIfNeeded(): Promise<void> {
  if (typeNameCacheLoadFromDisk) return typeNameCacheLoadFromDisk
  typeNameCacheLoadFromDisk = (async () => {
    try {
      const raw = await fs.readFile(typeCachePath(), 'utf8')
      const j = JSON.parse(raw) as EsiTypeCacheFile
      if (j && j.types && typeof j.types === 'object') {
        for (const [k, v] of Object.entries(j.types)) {
          const id = Number(k)
          if (Number.isInteger(id) && v && typeof v.name === 'string' && v.name) {
            typeNameById.set(id, v.name)
          }
        }
      }
      esiDevLog(
        `кэш type names: из ${path.join('data', TYPE_CACHE_FILE)} — ${typeNameById.size} id`
      )
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        /* первый прогон — файла ещё нет */
      } else {
        esiDevLog(
          `кэш type names: чтение пропущено (${e instanceof Error ? e.message : String(e)})`
        )
      }
    }
  })()
  return typeNameCacheLoadFromDisk
}

async function persistTypeNameCacheToDisk(): Promise<void> {
  if (!typeNameCacheDirty) return
  const types: Record<string, { name: string }> = {}
  for (const [id, name] of typeNameById) {
    if (name) types[String(id)] = { name }
  }
  const out: EsiTypeCacheFile = { v: TYPE_CACHE_VERSION, types }
  const dir = path.join(process.cwd(), 'data')
  try {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      typeCachePath(),
      `${JSON.stringify(out, null, 2)}\n`,
      'utf8'
    )
    typeNameCacheDirty = false
    esiDevLog(
      `кэш type names: записан ${typeCachePath()} (${Object.keys(types).length} id)`
    )
  } catch (e) {
    esiDevLog(
      `кэш type names: не удалось записать (${
        e instanceof Error ? e.message : String(e)
      })`
    )
  }
}

/**
 * Имя типа с ESI — один раз на `type_id`, далее из `data/esi-type-cache.json`.
 * Параллельные вызовы с одним id не дублируют HTTP (тот же inflight).
 */
async function getEsiTypeName(typeId: number): Promise<string | undefined> {
  await loadTypeNameCacheFromDiskIfNeeded()
  const mem = typeNameById.get(typeId)
  if (mem) return mem
  const wait = typeNameFetchInflight.get(typeId)
  if (wait) return wait
  const p = (async () => {
    const res = await esiFetch<{ name?: string }>(
      `/universe/types/${typeId}/`,
      { language: 'en' }
    ).catch(() => ({} as { name?: string }))
    const n = res.name
    if (n) {
      typeNameById.set(typeId, n)
      typeNameCacheDirty = true
    }
    return n
  })()
  typeNameFetchInflight.set(typeId, p)
  p.finally(() => {
    typeNameFetchInflight.delete(typeId)
  }).catch(() => {
    /* отклонения уже у вызывающих */
  })
  return p
}

/** Имена типов не в очереди ордеров — качаем заранее, пока ещё идут sell/buy. */
function prefetchEsiTypeNamesFromOrderRows(
  rows: readonly { type_id: number }[]
): void {
  for (const o of rows) {
    void getEsiTypeName(o.type_id).catch(() => undefined)
  }
}

export type EsiLiquidityExportOptions = {
  /** Макс. типов с отдельным запросом истории (остальные отсекаются по активности ордеров). */
  maxTypes: number
  /** Макс. страниц ордеров (по 1000 шт.) — только в режиме `orderPagesUntilExhausted: false`. */
  maxOrderPages: number
  /**
   * true — запрашивать страницы подряд, пока ESI не вернёт JSON вроде
   * `{"error":"Requested page does not exist!"}` или пустой массив; `maxOrderPages` не лимит.
   */
  orderPagesUntilExhausted: boolean
}

const DEFAULT_OPTS: EsiLiquidityExportOptions = {
  maxTypes: ESI_DEFAULT_MAX_TYPES,
  maxOrderPages: 90,
  orderPagesUntilExhausted: false,
}

/** Vite передаёт в opts явные `undefined` — без этого они затирают DEFAULT_OPTS при object spread. */
function mergeEsiOpts(
  partial?: Partial<EsiLiquidityExportOptions>
): EsiLiquidityExportOptions {
  const o: EsiLiquidityExportOptions = { ...DEFAULT_OPTS }
  if (!partial) return o
  if (partial.maxTypes !== undefined) {
    o.maxTypes = Math.max(
      1,
      Math.min(ESI_MAX_TYPES_USER_CAP, Math.floor(partial.maxTypes))
    )
  }
  if (partial.maxOrderPages !== undefined) {
    o.maxOrderPages = Math.max(
      1,
      Math.min(
        ESI_MAX_ORDER_PAGES_USER_CAP,
        Math.floor(partial.maxOrderPages)
      )
    )
  }
  if (partial.orderPagesUntilExhausted !== undefined) {
    o.orderPagesUntilExhausted = partial.orderPagesUntilExhausted
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
    if (status === 404) {
      const t = body.trim()
      if (t.startsWith('{')) {
        try {
          const j = JSON.parse(body) as { error?: string }
          if (
            j &&
            typeof j.error === 'string' &&
            /requested page does not exist|page does not exist/i.test(j.error)
          ) {
            esiDevLog(
              `← ${path} HTTP 404, ${ms} ms — нет такой страницы ордеров (конец пагинации)`
            )
            return j as T
          }
        } catch {
          /* not JSON */
        }
      }
      if (body.includes('Not found')) {
        esiDevLog(`← ${path} HTTP 404, ${ms} ms — не найдено`)
        throw new Error(`ESI 404: ${path}`)
      }
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

const UNBOUNDED_ORDER_PAGES_SAFETY = 10_000

/** Повтор страницы ордеров вне `esiFetch` (сеть, неожиданный отбор и т.д.). */
const ORDER_PAGE_OUTER_RETRIES = 3
const ORDER_PAGE_OUTER_BACKOFF_MS = 1_200

/** Каждая страница — отдельный асинхронный GET (без глобальной цепочки sell/buy). */
async function fetchOrderPageForSide(
  side: 'sell' | 'buy',
  regionId: number,
  page: number
): Promise<unknown> {
  const oneGet = () =>
    esiFetch<unknown>(`/markets/${regionId}/orders/`, {
      order_type: side,
      page: String(page),
    })
  let lastErr: unknown
  for (let attempt = 0; attempt < ORDER_PAGE_OUTER_RETRIES; attempt++) {
    if (isEsiStopRequested()) {
      throw new Error('ESI: остановка экспорта')
    }
    try {
      return await oneGet()
    } catch (e) {
      lastErr = e
      if (attempt < ORDER_PAGE_OUTER_RETRIES - 1) {
        const w = ORDER_PAGE_OUTER_BACKOFF_MS * (attempt + 1)
        esiDevLog(
          `ордера ${side} p.${page}: внешний повтор ${attempt + 2}/${
            ORDER_PAGE_OUTER_RETRIES
          } через ${w} ms (${
            e instanceof Error ? e.message : String(e)
          })`
        )
        await sleep(w)
        if (isEsiStopRequested()) {
          throw new Error('ESI: остановка экспорта')
        }
      }
    }
  }
  throw lastErr
}

type EsiOrderPageParseResult = {
  rows: EsiMarketOrder[]
  endOfSide: boolean
  /** true — /orders/ за пределом (в т.ч. HTTP 404 + JSON), UI: шкала стороны = 100 % */
  noSuchPage?: boolean
}

/**
 * Разбор ответа ESI на страницу ордеров: массив, пусто или `{"error":"Requested page does not exist!"}`.
 */
function parseEsiOrderPage(
  data: unknown,
  page: number,
  side: 'sell' | 'buy',
  regionId: number
): EsiOrderPageParseResult {
  if (Array.isArray(data)) {
    if (data.length === 0) {
      esiDevLog(
        `ордера region=${regionId} ${side} page=${page} — пусто, конец стороны`
      )
      return { rows: [], endOfSide: true }
    }
    return { rows: data as EsiMarketOrder[], endOfSide: data.length < 1000 }
  }
  if (data && typeof data === 'object' && 'error' in (data as object)) {
    const err = (data as { error?: unknown }).error
    const errStr = typeof err === 'string' ? err : String(err)
    if (/requested page does not exist|page does not exist/i.test(errStr)) {
      esiDevLog(
        `ордера region=${regionId} ${side} page=${page} — ESI: ${errStr} (конец пагинации)`
      )
      return { rows: [], endOfSide: true, noSuchPage: true }
    }
    throw new Error(`ESI orders ${side} p.${page}: ${errStr}`)
  }
  throw new Error(
    `ESI orders ${side} p.${page}: ожидался массив ордеров, получено: ${typeof data}`
  )
}

/** Шкала стороны = факт p/p, когда пагинация sell/buy закончилась (в т.ч. 404 «нет стр.»). */
function setOrderSidePageBarActual(side: 'sell' | 'buy', page: number): void {
  if (page <= 0) return
  if (side === 'sell') {
    esiProgress.sellPage = page
    esiProgress.orderSellPageBarMax = page
  } else {
    esiProgress.buyPage = page
    esiProgress.orderBuyPageBarMax = page
  }
}

const STAGGER_MS = ESI_ORDER_PAGE_STAGGER_SEC * 1000

/**
 * Режим «максимум страниц» (bounded): при `ESI_ORDER_PAGE_STAGGER_SEC > 0` старты p=1,2,…
 * разведены по времени; при 0 — все GET стартуют сразу. Каждая страница — независимый `esiFetch`.
 * `onPageSuccess` — после успешного ответа и parse (счётчик +1 в UI).
 * Слияние: по номерам страниц 1..N, останов на первом `endOfSide` (ниже — не берём,
 * ответы всё равно приходят, если уже в полёте).
 */
async function fetchOrderBookSideStaggered(
  regionId: number,
  maxPages: number,
  side: 'sell' | 'buy',
  tBatchStart: number,
  onPageSuccess: () => void,
  onPageRows?: (
    side: 'sell' | 'buy',
    page: number,
    rows: EsiMarketOrder[]
  ) => void
): Promise<EsiMarketOrder[]> {
  const hardCap = maxPages
  const tasks: Promise<{
    page: number
    rows: EsiMarketOrder[]
    endOfSide: boolean
    aborted?: boolean
  }>[] = []
  for (let page = 1; page <= hardCap; page++) {
    const p = page
    tasks.push(
      (async () => {
        const startAt = tBatchStart + (p - 1) * STAGGER_MS
        const wait = Math.max(0, startAt - Date.now())
        if (wait > 0) {
          await sleep(wait)
        }
        if (isEsiStopRequested()) {
          return { page: p, rows: [], endOfSide: true, aborted: true }
        }
        let data: unknown
        try {
          data = await fetchOrderPageForSide(side, regionId, p)
        } catch (e) {
          if (isEsiStopRequested()) {
            esiDevLog(
              `ордера ${side}: прервано (stagger) п.${p} — к объединению не пойдёт`
            )
            return { page: p, rows: [], endOfSide: true, aborted: true }
          }
          throw e
        }
        const parsed = parseEsiOrderPage(data, p, side, regionId)
        onPageSuccess()
        onPageRows?.(side, p, parsed.rows)
        if (parsed.rows.length > 0) {
          prefetchEsiTypeNamesFromOrderRows(parsed.rows)
        }
        return { page: p, rows: parsed.rows, endOfSide: parsed.endOfSide }
      })()
    )
  }
  const parts = await Promise.all(tasks)
  const byPage = new Map(parts.map((x) => [x.page, x]))
  const all: EsiMarketOrder[] = []
  let mergeAborted = false
  let setBarFromEndOfSide = false
  for (let p = 1; p <= hardCap; p++) {
    const b = byPage.get(p)
    if (!b) {
      break
    }
    if (b.aborted) {
      mergeAborted = true
      esiDevLog(
        `ордера ${side} (stagger): сбор по объединению, прервано на/до п.${p}, ордеров ${all.length}`
      )
      break
    }
    if (b.rows.length > 0) {
      all.push(...b.rows)
    }
    esiDevLog(
      `ордера region=${regionId} ${side} page=${p} — +${b.rows.length} (stagger merge, всего ${all.length})`
    )
    if (b.endOfSide) {
      setOrderSidePageBarActual(side, p)
      setBarFromEndOfSide = true
      break
    }
  }
  if (!mergeAborted && !setBarFromEndOfSide && esiProgress.maxOrderPages > 0) {
    const last = byPage.get(hardCap)
    if (last && !last.aborted && !last.endOfSide) {
      setOrderSidePageBarActual(side, hardCap)
    }
  }
  return all
}

/**
 * Режим «все страницы до конца ESI» — строго по одной странице за итерацию
 * (нужен `endOfSide` от предыдущей). Каждый GET — отдельный `fetchOrderPageForSide`.
 */
async function fetchOrderBookSideSequential(
  regionId: number,
  side: 'sell' | 'buy',
  onPageCompleted: (page: number) => void,
  onPageRows?: (
    side: 'sell' | 'buy',
    page: number,
    rows: EsiMarketOrder[]
  ) => void
): Promise<EsiMarketOrder[]> {
  const all: EsiMarketOrder[] = []
  const hardCap = UNBOUNDED_ORDER_PAGES_SAFETY
  let page = 1
  for (;;) {
    if (page > hardCap) {
      esiDevLog(
        `ордера ${side}: лимит безопасности ${UNBOUNDED_ORDER_PAGES_SAFETY} стр. — останов`
      )
      break
    }
    if (isEsiStopRequested()) {
      esiDevLog(
        `ордера ${side}: стоп — собрано ${all.length} (всего по стороне)`
      )
      return all
    }
    let data: unknown
    try {
      data = await fetchOrderPageForSide(side, regionId, page)
    } catch (e) {
      if (isEsiStopRequested()) {
        esiDevLog(`ордера ${side}: прервано — ${all.length} по стороне`)
        return all
      }
      throw e
    }
    const parsed = parseEsiOrderPage(
      data,
      page,
      side,
      regionId
    )
    const { rows, endOfSide } = parsed
    onPageCompleted(page)
    onPageRows?.(side, page, rows)
    if (rows.length > 0) {
      all.push(...rows)
      prefetchEsiTypeNamesFromOrderRows(rows)
      esiDevLog(
        `ордера region=${regionId} ${side} page=${page} — +${rows.length} (всего по ${side} ${all.length})`
      )
    }
    if (endOfSide) {
      setOrderSidePageBarActual(side, page)
      break
    }
    page += 1
    if (isEsiStopRequested()) {
      esiDevLog(`ордера ${side}: стоп после стр. ${page - 1} — ${all.length}`)
      return all
    }
  }
  return all
}

/**
 * Собирает ордера: sell и buy в `Promise.all` (стороны независимы).
 * Bounded — при stagger=0 все страницы стороны параллельно; unbounded — строгая пагинация 1,2,…
 * (каждое обращение — отдельный асинхронный GET).
 * `onPageRows` — сразу по приходе страницы (можно гонять history параллельно с дальнейшим сбором sell/buy).
 */
export async function fetchAllMarketOrders(
  regionId: number,
  maxPages: number,
  orderPagesUntilExhausted: boolean,
  onPageRows?: (
    side: 'sell' | 'buy',
    page: number,
    rows: EsiMarketOrder[]
  ) => void
): Promise<EsiMarketOrder[]> {
  esiProgress.phase = 'orders'
  esiProgress.unboundedOrderPages = orderPagesUntilExhausted
  /**
   * Только для ордеров: при «максимум» (все стр. до 404) — потолок для шкалы/ETA = лимит ESI, не 0
   * (сбор по-прежнему sequential до endOfSide; «Типы» и maxTypes на это не завязаны).
   */
  esiProgress.maxOrderPages = orderPagesUntilExhausted
    ? ESI_MAX_ORDER_PAGES_USER_CAP
    : maxPages
  esiProgress.sellPage = 0
  esiProgress.buyPage = 0
  esiProgress.orderSellPageBarMax = 0
  esiProgress.orderBuyPageBarMax = 0
  const tStagger = Date.now()
  let sellN = 0
  let buyN = 0
  const [sellOrders, buyOrders] = orderPagesUntilExhausted
    ? await Promise.all([
        fetchOrderBookSideSequential(
          regionId,
          'sell',
          (p) => {
            esiProgress.sellPage = p
          },
          onPageRows
        ),
        fetchOrderBookSideSequential(
          regionId,
          'buy',
          (p) => {
            esiProgress.buyPage = p
          },
          onPageRows
        ),
      ])
    : await Promise.all([
        fetchOrderBookSideStaggered(
          regionId,
          maxPages,
          'sell',
          tStagger,
          () => {
            sellN += 1
            esiProgress.sellPage = sellN
          },
          onPageRows
        ),
        fetchOrderBookSideStaggered(
          regionId,
          maxPages,
          'buy',
          tStagger,
          () => {
            buyN += 1
            esiProgress.buyPage = buyN
          },
          onPageRows
        ),
      ])
  return [...sellOrders, ...buyOrders]
}

type Agg = { asks: number[]; bids: number[]; activity: number }

function aggregateByType(orders: EsiMarketOrder[]): Map<number, Agg> {
  const m = new Map<number, Agg>()
  mergeOrdersInto(m, orders)
  return m
}

/** Добавляет ордера в агрегат (только у затронутых type_id пересортирует bid/ask). */
function mergeOrdersInto(
  m: Map<number, Agg>,
  rows: readonly EsiMarketOrder[]
): void {
  const touched = new Set<number>()
  for (const o of rows) {
    const t = o.type_id
    touched.add(t)
    let a = m.get(t)
    if (!a) {
      a = { asks: [], bids: [], activity: 0 }
      m.set(t, a)
    }
    a.activity += o.volume_remain
    if (o.is_buy_order) a.bids.push(o.price)
    else a.asks.push(o.price)
  }
  for (const t of touched) {
    const a = m.get(t)
    if (!a) continue
    a.asks.sort((x, y) => x - y)
    a.bids.sort((x, y) => y - x)
  }
}

function bestAsk(a: Agg): number | null {
  return a.asks.length ? a.asks[0]! : null
}
function bestBid(a: Agg): number | null {
  return a.bids.length ? a.bids[0]! : null
}

/** Имя + `/markets/.../history/` — независимые async GET (без bid/ask из ордеров). */
type TypeNameAndHistory = { name: string; hist: EsiHistoryDay[] }

async function fetchTypeNameAndHistory(
  typeId: number,
  regionId: number
): Promise<TypeNameAndHistory | null> {
  if (isEsiStopRequested()) {
    return null
  }
  let name = `Type ${typeId}`
  const [typeName, hist] = await Promise.all([
    getEsiTypeName(typeId),
    esiFetch<EsiHistoryDay[]>(`/markets/${regionId}/history/`, {
      type_id: String(typeId),
    }).catch(() => [] as EsiHistoryDay[]),
  ])
  if (typeName) {
    name = typeName
  }
  if (!Array.isArray(hist) || hist.length === 0) {
    return null
  }
  return { name, hist }
}

/** Bid/ask — из **финального** агрегата по ордерам; история/имя — с префетча или свежий запрос. */
function composeLiquidityRow(
  typeId: number,
  byType: Map<number, Agg>,
  monthAgo: Date,
  parts: TypeNameAndHistory | null
): LiquidityRow | null {
  const agg = byType.get(typeId)
  if (!agg) return null
  const priceSell = bestAsk(agg)
  const priceBuy = bestBid(agg)
  if (priceSell == null || priceBuy == null) return null
  if (priceSell <= 0 || priceBuy <= 0) return null
  if (!parts) return null
  const liq = liquidityFromHistory(parts.hist, monthAgo)
  if (!liq) {
    return null
  }
  return {
    name: parts.name,
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
  try {
  const o = mergeEsiOpts(opts)
  /** Сразу для UI: шкала «типы» видна на фазе ордеров (0 / maxTypes), прежде чем придут все страницы. */
  esiProgress.typeTotal = o.maxTypes
  esiProgress.typesDone = 0
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const tAll = Date.now()
  await loadTypeNameCacheFromDiskIfNeeded()
  esiDevLog(
    `строки ликвидности: region=${regionId}, orderPagesUntilExhausted=${o.orderPagesUntilExhausted}, maxOrderPages=${o.maxOrderPages}, maxTypes=${o.maxTypes}; sell|buy|history+имя — независимые async: по мере прихода страниц ордеров стартует префетч /markets/.../history/ и имени; bid/ask в строке — по финальному агрегату; кэш имён — data/${TYPE_CACHE_FILE}`
  )

  const partialByType = new Map<number, Agg>()
  const typePrefetch = new Map<number, Promise<TypeNameAndHistory | null>>()
  const onOrderPageRows: (
    side: 'sell' | 'buy',
    _page: number,
    rows: EsiMarketOrder[]
  ) => void = (_side, _page, rows) => {
    if (rows.length === 0) return
    mergeOrdersInto(partialByType, rows)
    const preCandidates: { typeId: number; activity: number }[] = []
    for (const [typeId, agg] of partialByType) {
      const ask = bestAsk(agg)
      const bid = bestBid(agg)
      if (ask == null || bid == null) continue
      if (ask <= 0 || bid <= 0) continue
      preCandidates.push({ typeId, activity: agg.activity })
    }
    preCandidates.sort((a, b) => b.activity - a.activity)
    for (const { typeId } of preCandidates.slice(0, o.maxTypes)) {
      if (typePrefetch.has(typeId)) continue
      typePrefetch.set(typeId, fetchTypeNameAndHistory(typeId, regionId))
    }
  }

  const orders = await fetchAllMarketOrders(
    regionId,
    o.maxOrderPages,
    o.orderPagesUntilExhausted,
    onOrderPageRows
  )
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
  esiProgress.typeConcurrency = chosen.length

  const rowResults = await Promise.all(
    chosen.map(async ({ typeId }) => {
      try {
        if (isEsiStopRequested()) {
          return null
        }
        const pref = typePrefetch.get(typeId)
        const parts =
          pref != null
            ? await pref
            : await fetchTypeNameAndHistory(typeId, regionId)
        return composeLiquidityRow(typeId, byType, monthAgo, parts)
      } finally {
        esiProgress.typesDone += 1
      }
    })
  )
  const rows: LiquidityRow[] = []
  for (const r of rowResults) {
    if (r) rows.push(r)
  }
  const stoppedInTypes = isEsiStopRequested()
  if (stoppedInTypes) {
    esiDevLog(
      `типы: стоп — ${rows.length} строк в таблицу, запросы по ${chosen.length} слотам завершены`
    )
  } else {
    esiDevLog(
      `типы: ${chosen.length} слотов (имя+history параллельно с ордерами, где префетч) → +${rows.length} строк в таблицу`
    )
  }
  esiDevLog(
    `сборка строк завершена: ${rows.length} позиций${stoppedInTypes ? ' (частично, стоп)' : ''} за ${((Date.now() - tAll) / 1000).toFixed(1)} s`
  )
  esiProgress = { ...ESI_EXPORT_PROGRESS_IDLE }
  return { rows, stoppedEarly: stoppedInTypes }
  } finally {
    await persistTypeNameCacheToDisk()
  }
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
