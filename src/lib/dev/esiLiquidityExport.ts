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
  ESI_MAX_ORDER_PAGES_USER_CAP,
} from '../esiOrderPageLimits'

const ESI_BASE = 'https://esi.evetech.net/latest'
const USER_AGENT =
  'ExcelOnlineMarket/1.0 (dev; https://github.com/Wafphlez/ExcelOnline-Market)'

const ESI_LOG_PREFIX = '[ESI export]'
const ESI_REQUEST_GAP_MS = 10

const MAX_DEV_LOG_LINES = 600
const esiDevLogBuffer: string[] = []

let esiProgress: EsiExportProgressState = { ...ESI_EXPORT_PROGRESS_IDLE }

/** Сигнал из POST /esi-stop: завершить сбор и собрать xlsx по текущим строкам. */
let esiStopRequested = false
/** Сигнал из POST /esi-stop-force: завершить сбор без сборки xlsx. */
let esiForceStopRequested = false
/** Активные HTTP-запросы к ESI для мгновенной отмены через stop-force. */
const esiActiveRequestControllers = new Set<AbortController>()

class EsiForceStopError extends Error {
  constructor() {
    super('ESI: stop-force (без сборки xlsx)')
    this.name = 'EsiForceStopError'
  }
}

export function isEsiForceStopError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'EsiForceStopError' || /ESI:\s*stop-force/i.test(err.message))
  )
}

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

export function requestEsiExportForceStop(): void {
  if (!esiForceStopRequested) {
    esiForceStopRequested = true
    esiStopRequested = true
    esiDevLog(
      'запрошен принудительный stop-force — остановка без сборки xlsx'
    )
    for (const controller of Array.from(esiActiveRequestControllers)) {
      try {
        controller.abort()
      } catch {
        /* ignore */
      }
    }
  }
}

function clearEsiStopRequest(): void {
  esiStopRequested = false
  esiForceStopRequested = false
  esiActiveRequestControllers.clear()
}

function isEsiStopRequested(): boolean {
  return esiStopRequested
}

function isEsiForceStopRequested(): boolean {
  return esiForceStopRequested
}

function assertNotEsiForceStopped(): void {
  if (isEsiForceStopRequested()) {
    throw new EsiForceStopError()
  }
}

function isAbortLikeError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if (err.name === 'AbortError') return true
  const code = (err as Error & { code?: unknown }).code
  if (code === 'ABORT_ERR' || code === 'ERR_CANCELED') return true
  return /aborted|abort/i.test(err.message)
}

export function getEsiExportProgressState(): EsiExportProgressState {
  return { ...esiProgress }
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

/* ---------- Статический каталог universe (без runtime-запросов к ESI) ---------- */

const UNIVERSE_STATIC_FILE = 'esi-universe-static.json'
type EsiTypePayload = {
  name?: string
  group_id?: number
  [key: string]: unknown
}
type EsiTypeCacheFile = {
  types?: Record<string, EsiTypePayload>
  groups?: Record<string, { name?: string; category_id?: number }>
  categories?: Record<string, { name?: string }>
}

const typeNameById = new Map<number, string>()
const typePayloadById = new Map<number, EsiTypePayload>()
const groupNameById = new Map<number, string>()
const groupCategoryById = new Map<number, number>()
const categoryNameById = new Map<number, string>()

/**
 * Один Promise на весь прогон: нельзя ставить «загружено» до await read,
 * иначе параллельные getEsiTypeName (prefetch с ордеров) видят пустой кэш и
 * дублируют парсинг JSON.
 */
let typeNameCacheLoadFromDisk: Promise<void> | null = null

function typeCachePath(): string {
  return path.join(process.cwd(), 'public', UNIVERSE_STATIC_FILE)
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
          const entry = v as { name?: unknown; group_id?: unknown }
          if (
            Number.isInteger(id) &&
            entry &&
            typeof entry.name === 'string' &&
            entry.name
          ) {
            typeNameById.set(id, entry.name)
            const p: EsiTypePayload = { name: entry.name }
            if (
              typeof entry.group_id === 'number' &&
              Number.isFinite(entry.group_id)
            ) {
              p.group_id = Math.floor(entry.group_id)
            }
            typePayloadById.set(id, p)
          }
        }
      }
      if (j?.groups && typeof j.groups === 'object') {
        for (const [k, v] of Object.entries(j.groups)) {
          const id = Number(k)
          const entry = v as { name?: unknown; category_id?: unknown }
          if (!Number.isInteger(id) || !entry || typeof entry !== 'object') {
            continue
          }
          if (typeof entry.name === 'string' && entry.name) {
            groupNameById.set(id, entry.name)
          }
          if (
            typeof entry.category_id === 'number' &&
            Number.isFinite(entry.category_id)
          ) {
            groupCategoryById.set(id, Math.floor(entry.category_id))
          }
        }
      }
      if (j?.categories && typeof j.categories === 'object') {
        for (const [k, v] of Object.entries(j.categories)) {
          const id = Number(k)
          const entry = v as { name?: unknown }
          if (!Number.isInteger(id) || !entry || typeof entry !== 'object') {
            continue
          }
          if (typeof entry.name === 'string' && entry.name) {
            categoryNameById.set(id, entry.name)
          }
        }
      }
      esiDevLog(
        `статический universe-каталог: ${path.join('public', UNIVERSE_STATIC_FILE)} — types=${typeNameById.size}, groups=${groupNameById.size}/${groupCategoryById.size}, categories=${categoryNameById.size}`
      )
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        esiDevLog(
          `статический universe-каталог не найден: ${path.join('public', UNIVERSE_STATIC_FILE)}`
        )
      } else {
        esiDevLog(
          `статический universe-каталог: чтение пропущено (${e instanceof Error ? e.message : String(e)})`
        )
      }
    }
  })()
  return typeNameCacheLoadFromDisk
}

/**
 * Имя типа только из `public/esi-universe-static.json` (без HTTP к ESI).
 */
async function getEsiTypeName(typeId: number): Promise<string | undefined> {
  await loadTypeNameCacheFromDiskIfNeeded()
  return typeNameById.get(typeId)
}

async function getEsiGroupName(groupId: number): Promise<string | undefined> {
  await loadTypeNameCacheFromDiskIfNeeded()
  return groupNameById.get(groupId)
}

async function getEsiCategoryName(
  categoryId: number
): Promise<string | undefined> {
  await loadTypeNameCacheFromDiskIfNeeded()
  return categoryNameById.get(categoryId)
}

async function getEsiTypeCategory(typeId: number): Promise<string | undefined> {
  await loadTypeNameCacheFromDiskIfNeeded()
  const payload = typePayloadById.get(typeId)
  const groupIdRaw = payload?.group_id
  if (typeof groupIdRaw !== 'number' || !Number.isFinite(groupIdRaw)) {
    return undefined
  }
  const groupId = Math.floor(groupIdRaw)
  const categoryId = groupCategoryById.get(groupId)
  if (typeof categoryId === 'number') {
    const cachedCategoryName = categoryNameById.get(categoryId)
    if (cachedCategoryName) return cachedCategoryName
    const categoryName = await getEsiCategoryName(categoryId)
    if (categoryName) return categoryName
  }
  const groupName = await getEsiGroupName(groupId)
  const loadedCategoryId = groupCategoryById.get(groupId)
  if (typeof loadedCategoryId === 'number') {
    const categoryName = await getEsiCategoryName(loadedCategoryId)
    if (categoryName) return categoryName
  }
  return groupName
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
  /** Окно /markets/{region}/history в днях (2/7/30). */
  historyDays: 2 | 7 | 30
  /** Добавить в xlsx snapshot top-of-book и отдельный лист orders_snapshot. */
  includeOrderSnapshot: boolean
  /** Оставить только ордера конкретного торгового хаба (по location_id). */
  tradeHubOnly: boolean
  tradeHubLocationId?: number
}

const DEFAULT_OPTS: EsiLiquidityExportOptions = {
  historyDays: 30,
  includeOrderSnapshot: false,
  tradeHubOnly: false,
}

/** Vite передаёт в opts явные `undefined` — без этого они затирают DEFAULT_OPTS при object spread. */
function mergeEsiOpts(
  partial?: Partial<EsiLiquidityExportOptions>
): EsiLiquidityExportOptions {
  const o: EsiLiquidityExportOptions = { ...DEFAULT_OPTS }
  if (!partial) return o
  if (partial.historyDays !== undefined) {
    o.historyDays =
      partial.historyDays === 2 || partial.historyDays === 7 || partial.historyDays === 30
        ? partial.historyDays
        : 30
  }
  if (partial.includeOrderSnapshot !== undefined) {
    o.includeOrderSnapshot = partial.includeOrderSnapshot
  }
  if (partial.tradeHubOnly !== undefined) {
    o.tradeHubOnly = partial.tradeHubOnly
  }
  if (partial.tradeHubLocationId !== undefined) {
    o.tradeHubLocationId = partial.tradeHubLocationId
  }
  return o
}

type EsiMarketOrder = {
  type_id: number
  is_buy_order: boolean
  price: number
  volume_remain: number
  location_id: number
}

type EsiHistoryDay = {
  date: string
  average: number
  volume: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Глобальный троттлинг исходящих запросов к ESI:
 * между стартами соседних запросов держим паузу не меньше ESI_REQUEST_GAP_MS.
 */
let esiRequestThrottleTail: Promise<void> = Promise.resolve()
let esiLastRequestStartedAt = 0

async function awaitEsiRequestSlot(): Promise<void> {
  const prev = esiRequestThrottleTail
  let release!: () => void
  esiRequestThrottleTail = new Promise<void>((resolve) => {
    release = resolve
  })
  await prev
  const waitMs = Math.max(
    0,
    ESI_REQUEST_GAP_MS - (Date.now() - esiLastRequestStartedAt)
  )
  if (waitMs > 0) {
    await sleep(waitMs)
  }
  esiLastRequestStartedAt = Date.now()
  release()
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
async function esiFetch<T>(
  path: string,
  query: Record<string, string>,
  shouldAbort?: () => boolean
): Promise<T> {
  const requestUrl = buildEsiUrl(path, query)
  for (let attempt = 0; attempt < 12; attempt++) {
    if (shouldAbort?.()) {
      throw new Error('ESI: page exhausted (skip queued request)')
    }
    const url = requestUrl
    esiDevLog(`GET ${url} (попытка ${attempt + 1})`)
    await awaitEsiRequestSlot()
    if (shouldAbort?.()) {
      throw new Error('ESI: page exhausted (skip queued request)')
    }
    const t0 = Date.now()
    const controller = new AbortController()
    esiActiveRequestControllers.add(controller)
    let body = ''
    let status = 0
    try {
      const out = await new Promise<{
        body: string
        status: number
      }>((resolve, reject) => {
        const req = https.get(
          url,
          {
            headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
            signal: controller.signal,
          },
          (incoming) => {
            const chunks: Buffer[] = []
            incoming.on('data', (c) => chunks.push(c as Buffer))
            incoming.on('end', () => {
              resolve({
                body: Buffer.concat(chunks).toString('utf8'),
                status: incoming.statusCode ?? 0,
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
      body = out.body
      status = out.status
    } catch (e) {
      if (
        isEsiForceStopRequested() &&
        (isAbortLikeError(e) || shouldAbort?.())
      ) {
        throw new EsiForceStopError()
      }
      throw e
    } finally {
      esiActiveRequestControllers.delete(controller)
    }
    const ms = Date.now() - t0
    if (status === 200) {
      esiDevLog(
        `← ${url} HTTP 200, ${body.length} B, ${ms} ms`
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
              `← ${url} HTTP 404, ${ms} ms — нет такой страницы ордеров (конец пагинации)`
            )
            return j as T
          }
        } catch {
          /* not JSON */
        }
      }
      if (body.includes('Not found')) {
        esiDevLog(`← ${url} HTTP 404, ${ms} ms — не найдено`)
        throw new Error(`ESI 404: ${url}`)
      }
    }
    if (status === 420 || status === 429 || status === 503) {
      const w = 10_000
      esiDevLog(
        `← ${url} HTTP ${status}, ${ms} ms — пауза ${w} ms (фиксированный retry interval)`
      )
      await sleep(w)
      continue
    }
    if (status >= 500) {
      const w = 3000 * (attempt + 1)
      esiDevLog(
        `← ${url} HTTP ${status}, ${ms} ms — сервер, пауза ${w} ms`
      )
      await sleep(w)
      continue
    }
    esiDevLog(`← ${url} HTTP ${status}, ${ms} ms — фатал`)
    throw new Error(`ESI ${status}: ${body.slice(0, 300)}`)
  }
  esiDevLog(`← ${requestUrl} — слишком много повторов`)
  throw new Error('ESI: слишком много повторов')
}

export type LiquidityRow = {
  name: string
  type: string
  type_id: number
  day_volume: number
  /** млн ISK, как в выгрузке для mapColumns (excelMillionsToIsk) */
  day_turnover: number
  price: number
  price_sell: number
  price_bay: number
  top_sell_now: number
  top_buy_now: number
  top_sell_volume_now: number
  top_buy_volume_now: number
  orders_snapshot_at: string
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

function isSkipQueuedRequestError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /page exhausted \(skip queued request\)/i.test(msg)
}

/** Каждая страница — отдельный асинхронный GET (без глобальной цепочки sell/buy). */
async function fetchOrderPageForSide(
  side: 'sell' | 'buy',
  regionId: number,
  page: number,
  shouldAbort?: () => boolean
): Promise<unknown> {
  const oneGet = () =>
    esiFetch<unknown>(`/markets/${regionId}/orders/`, {
      order_type: side,
      page: String(page),
    }, shouldAbort)
  let lastErr: unknown
  for (let attempt = 0; attempt < ORDER_PAGE_OUTER_RETRIES; attempt++) {
    assertNotEsiForceStopped()
    if (shouldAbort?.()) {
      throw new Error('ESI: page exhausted (skip queued request)')
    }
    if (isEsiStopRequested()) {
      throw new Error('ESI: остановка экспорта')
    }
    try {
      return await oneGet()
    } catch (e) {
      if (isSkipQueuedRequestError(e)) {
        // Это штатный «не запускать лишний запрос после конца пагинации», без ретраев.
        throw e
      }
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
        assertNotEsiForceStopped()
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
  if (data && typeof data === 'object' && 'error' in data) {
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

/** Строгая пагинация до конца ESI: 1,2,... пока не endOfSide. */
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
    assertNotEsiForceStopped()
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
    assertNotEsiForceStopped()
  }
  return all
}

/**
 * Собирает ордера: sell и buy в `Promise.all` (стороны независимы), до конца пагинации ESI.
 * `onPageRows` — сразу по приходе страницы (можно гонять history параллельно с дальнейшим сбором sell/buy).
 */
export async function fetchAllMarketOrders(
  regionId: number,
  onPageRows?: (
    side: 'sell' | 'buy',
    page: number,
    rows: EsiMarketOrder[]
  ) => void
): Promise<EsiMarketOrder[]> {
  esiProgress.phase = 'orders'
  esiProgress.maxOrderPages = ESI_MAX_ORDER_PAGES_USER_CAP
  esiProgress.sellPage = 0
  esiProgress.buyPage = 0
  esiProgress.orderSellPageBarMax = 0
  esiProgress.orderBuyPageBarMax = 0
  const [sellOrders, buyOrders] = await Promise.all([
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
  return [...sellOrders, ...buyOrders]
}

type Agg = {
  asks: number[]
  bids: number[]
  activity: number
  askVolByPrice: Map<number, number>
  bidVolByPrice: Map<number, number>
}

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
      a = {
        asks: [],
        bids: [],
        activity: 0,
        askVolByPrice: new Map<number, number>(),
        bidVolByPrice: new Map<number, number>(),
      }
      m.set(t, a)
    }
    a.activity += o.volume_remain
    if (o.is_buy_order) {
      a.bids.push(o.price)
      a.bidVolByPrice.set(
        o.price,
        (a.bidVolByPrice.get(o.price) ?? 0) + Math.max(0, o.volume_remain)
      )
    } else {
      a.asks.push(o.price)
      a.askVolByPrice.set(
        o.price,
        (a.askVolByPrice.get(o.price) ?? 0) + Math.max(0, o.volume_remain)
      )
    }
  }
  for (const t of touched) {
    const a = m.get(t)
    if (!a) continue
    a.asks.sort((x, y) => x - y)
    a.bids.sort((x, y) => y - x)
  }
}

function bestAsk(a: Agg): number | null {
  const [head] = a.asks
  return head ?? null
}
function bestBid(a: Agg): number | null {
  const [head] = a.bids
  return head ?? null
}

/** Имя + `/markets/.../history/` — независимые async GET (без bid/ask из ордеров). */
type TypeNameAndHistory = { name: string; type: string; hist: EsiHistoryDay[] }

async function fetchTypeNameAndHistory(
  typeId: number,
  regionId: number
): Promise<TypeNameAndHistory | null> {
  assertNotEsiForceStopped()
  if (isEsiStopRequested()) {
    return null
  }
  let name = `Type ${typeId}`
  let type = ''
  const [typeName, typeCategory, hist] = await Promise.all([
    getEsiTypeName(typeId),
    getEsiTypeCategory(typeId),
    (async () => {
      try {
        return await esiFetch<EsiHistoryDay[]>(`/markets/${regionId}/history/`, {
          type_id: String(typeId),
        }).catch(() => [] as EsiHistoryDay[])
      } finally {
        esiProgress.historyDone += 1
      }
    })(),
  ])
  if (typeName) {
    name = typeName
  }
  if (typeCategory) {
    type = typeCategory
  }
  if (!Array.isArray(hist) || hist.length === 0) {
    return null
  }
  return { name, type, hist }
}

/** Bid/ask — из **финального** агрегата по ордерам; история/имя — с префетча или свежий запрос. */
function composeLiquidityRow(
  typeId: number,
  byType: Map<number, Agg>,
  monthAgo: Date,
  parts: TypeNameAndHistory | null,
  snapshotAtIso: string
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
    type: parts.type,
    type_id: typeId,
    day_volume: liq.dayAvgVolume,
    day_turnover: liq.dayTurnoverMln,
    price: liq.last3AvgPrice,
    price_sell: priceSell,
    price_bay: priceBuy,
    top_sell_now: priceSell,
    top_buy_now: priceBuy,
    top_sell_volume_now: agg.askVolByPrice.get(priceSell) ?? 0,
    top_buy_volume_now: agg.bidVolByPrice.get(priceBuy) ?? 0,
    orders_snapshot_at: snapshotAtIso,
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
  assertNotEsiForceStopped()
  const o = mergeEsiOpts(opts)
  /** До завершения сбора ордеров итоговое число типов неизвестно. */
  esiProgress.typeTotal = 0
  esiProgress.typesDone = 0
  const historyFromDate = new Date(Date.now() - o.historyDays * 24 * 60 * 60 * 1000)
  const tAll = Date.now()
  await loadTypeNameCacheFromDiskIfNeeded()
  esiDevLog(
    `строки ликвидности: region=${regionId}; полный режим sell|buy до конца ESI + history/имя по мере прихода страниц; окно history=${o.historyDays}d; bid/ask в строке — по финальному агрегату; каталог universe — public/${UNIVERSE_STATIC_FILE}`
  )
  if (o.tradeHubOnly) {
    esiDevLog(
      `режим торгового хаба: location_id=${o.tradeHubLocationId ?? 'не задан'} (фильтрация по location_id)`
    )
  }

  const filterHubOrders = (
    rows: readonly EsiMarketOrder[]
  ): EsiMarketOrder[] => {
    if (!o.tradeHubOnly) return [...rows]
    const hubLocationId = o.tradeHubLocationId
    if (typeof hubLocationId !== 'number' || !Number.isFinite(hubLocationId)) {
      return []
    }
    return rows.filter((x) => x.location_id === hubLocationId)
  }

  const partialByType = new Map<number, Agg>()
  const typePrefetch = new Map<number, Promise<TypeNameAndHistory | null>>()
  const onOrderPageRows: (
    side: 'sell' | 'buy',
    _page: number,
    rows: EsiMarketOrder[]
  ) => void = (_side, _page, rows) => {
    const hubRows = filterHubOrders(rows)
    if (hubRows.length === 0) return
    mergeOrdersInto(partialByType, hubRows)
    const preCandidates: { typeId: number; activity: number }[] = []
    for (const [typeId, agg] of partialByType) {
      const ask = bestAsk(agg)
      const bid = bestBid(agg)
      if (ask == null || bid == null) continue
      if (ask <= 0 || bid <= 0) continue
      preCandidates.push({ typeId, activity: agg.activity })
    }
    preCandidates.sort((a, b) => b.activity - a.activity)
    for (const { typeId } of preCandidates) {
      if (typePrefetch.has(typeId)) continue
      typePrefetch.set(
        typeId,
        fetchTypeNameAndHistory(typeId, regionId).catch((e) => {
          if (!isEsiForceStopError(e) && !isEsiStopRequested()) {
            esiDevLog(
              `prefetch type ${typeId}: пропуск (${
                e instanceof Error ? e.message : String(e)
              })`
            )
          }
          return null
        })
      )
    }
  }

  const orders = await fetchAllMarketOrders(
    regionId,
    onOrderPageRows
  )
  const filteredOrders = filterHubOrders(orders)
  assertNotEsiForceStopped()
  esiDevLog(
    `ордера собраны: ${orders.length} шт., после фильтра хаба: ${filteredOrders.length} шт. за ${((Date.now() - tAll) / 1000).toFixed(1)} s`
  )
  if (filteredOrders.length === 0) {
    const stopped = isEsiStopRequested()
    esiProgress = { ...ESI_EXPORT_PROGRESS_IDLE }
    if (stopped) {
      esiDevLog('принудительный стоп: ордера пусты — в xlsx будет служебная строка')
    }
    return { rows: [], stoppedEarly: stopped }
  }
  const byType = aggregateByType(filteredOrders)
  const snapshotAtIso = new Date().toISOString()
  const candidates: { typeId: number; activity: number }[] = []
  for (const [typeId, agg] of byType) {
    const ask = bestAsk(agg)
    const bid = bestBid(agg)
    if (ask == null || bid == null) continue
    if (ask <= 0 || bid <= 0) continue
    candidates.push({ typeId, activity: agg.activity })
  }
  candidates.sort((a, b) => b.activity - a.activity)
  const chosen = candidates
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
  esiProgress.historyTotal = chosen.length
  esiProgress.historyDone = 0
  esiProgress.snapshotTotal = o.includeOrderSnapshot ? chosen.length : 0
  esiProgress.snapshotDone = 0

  const rowResults = await Promise.all(
    chosen.map(async ({ typeId }) => {
      try {
        assertNotEsiForceStopped()
        if (isEsiStopRequested()) {
          return null
        }
        const pref = typePrefetch.get(typeId)
        const parts =
          pref != null
            ? await pref
            : await fetchTypeNameAndHistory(typeId, regionId)
        return composeLiquidityRow(typeId, byType, historyFromDate, parts, snapshotAtIso)
      } finally {
        esiProgress.typesDone += 1
        if (o.includeOrderSnapshot) {
          // Snapshot top-of-book формируется из финального агрегата по каждому выбранному типу.
          esiProgress.snapshotDone += 1
        }
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
    /* static catalog: nothing to persist */
  }
}

/**
 * Собирает xlsx (один лист) в Buffer — те же смыслы колонок, что [mapColumns](src/lib/mapColumns.ts).
 */
export function liquidityRowsToXlsxBuffer(rows: LiquidityRow[]): Buffer {
  const sheetRows = rows.map((r) => ({
    name: r.name,
    type: r.type,
    type_id: r.type_id,
    day_volume: r.day_volume,
    day_turnover: r.day_turnover,
    price: r.price,
    price_sell: r.price_sell,
    price_bay: r.price_bay,
    top_sell_now: r.top_sell_now,
    top_buy_now: r.top_buy_now,
    top_sell_volume_now: r.top_sell_volume_now,
    top_buy_volume_now: r.top_buy_volume_now,
    orders_snapshot_at: r.orders_snapshot_at,
  }))
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(sheetRows, { cellDates: true })
  XLSX.utils.book_append_sheet(wb, ws, 'liquidity')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

function appendOrdersSnapshotSheet(wb: XLSX.WorkBook, rows: LiquidityRow[]): void {
  const snapRows = rows.map((r) => ({
    type_id: r.type_id,
    name: r.name,
    type: r.type,
    top_sell_now: r.top_sell_now,
    top_sell_volume_now: r.top_sell_volume_now,
    top_buy_now: r.top_buy_now,
    top_buy_volume_now: r.top_buy_volume_now,
    orders_snapshot_at: r.orders_snapshot_at,
  }))
  const ws = XLSX.utils.json_to_sheet(snapRows, { cellDates: true })
  XLSX.utils.book_append_sheet(wb, ws, 'orders_snapshot')
}

function liquidityXlsxFromRowsOrEmptyStopNote(
  rows: LiquidityRow[],
  note: string,
  includeOrderSnapshot = false
): Buffer {
  if (rows.length > 0) {
    if (!includeOrderSnapshot) {
      return liquidityRowsToXlsxBuffer(rows)
    }
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(
      rows.map((r) => ({
        name: r.name,
        type: r.type,
        type_id: r.type_id,
        day_volume: r.day_volume,
        day_turnover: r.day_turnover,
        price: r.price,
        price_sell: r.price_sell,
        price_bay: r.price_bay,
        top_sell_now: r.top_sell_now,
        top_buy_now: r.top_buy_now,
        top_sell_volume_now: r.top_sell_volume_now,
        top_buy_volume_now: r.top_buy_volume_now,
        orders_snapshot_at: r.orders_snapshot_at,
      })),
      { cellDates: true }
    )
    XLSX.utils.book_append_sheet(wb, ws, 'liquidity')
    appendOrdersSnapshotSheet(wb, rows)
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  }
  return liquidityRowsToXlsxBuffer([
    {
      name: note,
      type: '',
      type_id: 0,
      day_volume: 0,
      day_turnover: 0,
      price: 0,
      price_sell: 0,
      price_bay: 0,
      top_sell_now: 0,
      top_buy_now: 0,
      top_sell_volume_now: 0,
      top_buy_volume_now: 0,
      orders_snapshot_at: new Date().toISOString(),
    },
  ])
}

export async function buildEsiLiquidityXlsx(
  regionId: number,
  opts?: Partial<EsiLiquidityExportOptions>
): Promise<{ buffer: Buffer; rowCount: number; partial: boolean }> {
  const t0 = Date.now()
  try {
    assertNotEsiForceStopped()
    const mergedOpts = mergeEsiOpts(opts)
    const { rows, stoppedEarly } = await buildLiquidityRows(regionId, mergedOpts)
    assertNotEsiForceStopped()
    if (rows.length === 0) {
      if (!stoppedEarly) {
        throw new Error(
          'Нет строк: ордера пусты или нет пересечения ордеров/истории за период.'
        )
      }
      const buffer = liquidityXlsxFromRowsOrEmptyStopNote(
        [],
        'Принудительный стоп — нет полных строк (нужны bid+ask по типам).',
        mergedOpts.includeOrderSnapshot
      )
      esiDevLog(
        `xlsx (частично): 0 позиций, ${buffer.length} B, ${((Date.now() - t0) / 1000).toFixed(1)} s`
      )
      return { buffer, rowCount: 0, partial: true }
    }
    const buffer = liquidityXlsxFromRowsOrEmptyStopNote(
      rows,
      '',
      mergedOpts.includeOrderSnapshot
    )
    esiDevLog(
      `xlsx: ${rows.length} строк, ${buffer.length} B файла, всего ${((Date.now() - t0) / 1000).toFixed(1)} s${stoppedEarly ? ' (частично, стоп)' : ''}`
    )
    return { buffer, rowCount: rows.length, partial: stoppedEarly }
  } finally {
    clearEsiStopRequest()
  }
}
