import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse, Server } from 'node:http'
import https from 'node:https'
import fs from 'node:fs/promises'
import { URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { migrateColumnFiltersRatioToPercent } from './src/lib/filterPercentMigration'
import {
  buildEsiLiquidityXlsx,
  clearEsiDevLogs,
  getEsiDevLogLines,
  getEsiExportProgressState,
  logEsiExportException,
  requestEsiExportStop,
} from './src/lib/dev/esiLiquidityExport'
import {
  ESI_MAX_ORDER_PAGES_USER_CAP,
  ESI_MAX_TYPES_USER_CAP,
} from './src/lib/esiOrderPageLimits'

const __filename = fileURLToPath(import.meta.url)
const projectRoot = path.resolve(path.dirname(__filename), '.')
const exportsDir = path.join(projectRoot, 'exports')
const filtersFilePath = path.join(exportsDir, 'filters.json')

const ALLOWED_DOWNLOAD_URLS = new Set<string>([
  'https://eve.atpstealer.com/logistics/liquidity/exel?region=The%20Forge',
  'https://eve.atpstealer.com/logistics/liquidity/exel?region=Domain',
  'https://eve.atpstealer.com/logistics/liquidity/exel?region=Heimatar',
  'https://eve.atpstealer.com/logistics/liquidity/exel?region=Sinq%20Laison',
  'https://eve.atpstealer.com/logistics/liquidity/exel?region=Metropolis',
])

const URL_PREFIX = 'https://eve.atpstealer.com/logistics/liquidity/'

function isSafeFileName(name: string): boolean {
  return /^[a-zA-Z0-9._-]+\.(xlsx|xls)$/.test(name) && !name.includes('..')
}

function isUnderExportsDir(absolute: string): boolean {
  const resolved = path.resolve(absolute)
  const ed = path.resolve(exportsDir)
  return resolved === ed || resolved.startsWith(ed + path.sep)
}

function formatFileDateRu(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = String(d.getFullYear())
  return `${dd}.${mm}.${yyyy}`
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** Node &lt; 18 не имеет глобального fetch — скачивание только через https. */
function httpsGetToBuffer(
  fullUrl: string,
  ac: AbortController,
  timeoutMs: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const u = new URL(fullUrl)
    if (u.protocol !== 'https:') {
      reject(new Error('только https'))
      return
    }
    const req = https.get(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        port: u.port || 443,
        headers: { 'user-agent': 'ExcelOnlineMarket-dev-export' },
      },
      (incoming) => {
        const chunks: Buffer[] = []
        incoming.on('data', (c) => chunks.push(c as Buffer))
        incoming.on('end', () => {
          clearTimeout(timer)
          const code = incoming.statusCode ?? 0
          if (code < 200 || code >= 300) {
            reject(
              new Error(`источник HTTP ${code} ${incoming.statusMessage ?? ''}`)
            )
            return
          }
          resolve(Buffer.concat(chunks))
        })
      }
    )
    const timer = setTimeout(() => {
      ac.abort()
      req.destroy()
      reject(new Error('таймаут скачивания'))
    }, timeoutMs)
    const onAbort = () => {
      clearTimeout(timer)
      req.destroy()
      reject(new Error('aborted'))
    }
    if (ac.signal.aborted) onAbort()
    else ac.signal.addEventListener('abort', onAbort, { once: true })
    req.on('error', (e) => {
      clearTimeout(timer)
      ac.signal.removeEventListener('abort', onAbort)
      reject(e)
    })
  })
}

function applyDevCors(
  req: IncomingMessage,
  res: ServerResponse
): { handled: true } | { handled: false } {
  const pathname = (req.url?.split('?')[0] ?? req.url) as string
  const isDevApi =
    pathname.startsWith('/__dev/export/') || pathname.startsWith('/__dev/filters/')
  if (!isDevApi) return { handled: false }
  const origin = req.headers.origin
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*')
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Access-Control-Max-Age', '86400')
    res.statusCode = 204
    res.end()
    return { handled: true }
  }
  return { handled: false }
}

/** Долгий ESI-экспорт (минуты) — не обрывать сокет по умолчанию (Node 20: requestTimeout 300s). */
function extendServerTimeoutsForEsiExport(httpServer: Server | null | undefined): void {
  if (!httpServer) return
  httpServer.setTimeout(45 * 60 * 1000)
  const s = httpServer as Server & { requestTimeout?: number; headersTimeout?: number }
  if (typeof s.requestTimeout === 'number') s.requestTimeout = 0
  if (typeof s.headersTimeout === 'number') s.headersTimeout = 0
}

function devExportPlugin(): Plugin {
  return {
    name: 'dev-export-exports',
    configureServer(server) {
      void fs.mkdir(exportsDir, { recursive: true })
      extendServerTimeoutsForEsiExport(server.httpServer)
      server.middlewares.use(
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          if (!req.url) return next()
          const pathname = (req.url.split('?')[0] ?? req.url) as string
          const opt = applyDevCors(req, res)
          if (opt.handled) return
          void (async () => {
            if (req.method === 'GET' && pathname === '/__dev/export/list') {
              try {
                const names = await fs.readdir(exportsDir)
                const out: { name: string; size: number; mtime: string }[] = []
                for (const name of names) {
                  if (name.startsWith('.')) continue
                  if (!/\.(xlsx|xls)$/i.test(name)) continue
                  const p = path.join(exportsDir, name)
                  if (!isUnderExportsDir(p)) continue
                  const st = await fs.stat(p)
                  out.push({
                    name,
                    size: st.size,
                    mtime: st.mtime.toISOString(),
                  })
                }
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                res.end(JSON.stringify({ files: out }))
              } catch (e) {
                res.statusCode = 500
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                res.end(
                  JSON.stringify({
                    error: e instanceof Error ? e.message : 'list failed',
                  })
                )
              }
              return
            }

            if (req.method === 'POST' && pathname === '/__dev/export/esi-stop') {
              try {
                requestEsiExportStop()
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                res.end(JSON.stringify({ ok: true }))
              } catch (e) {
                res.statusCode = 500
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                res.end(
                  JSON.stringify({
                    error: e instanceof Error ? e.message : 'esi stop failed',
                  })
                )
              }
              return
            }

            if (req.method === 'GET' && pathname === '/__dev/export/esi-logs') {
              try {
                const { lines } = getEsiDevLogLines()
                const progress = getEsiExportProgressState()
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                res.end(JSON.stringify({ lines, progress }))
              } catch (e) {
                res.statusCode = 500
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                res.end(
                  JSON.stringify({
                    error: e instanceof Error ? e.message : 'esi logs failed',
                  })
                )
              }
              return
            }

            if (req.method === 'GET' && pathname.startsWith('/__dev/export/file/')) {
              const raw = decodeURIComponent(
                pathname.slice('/__dev/export/file/'.length) ?? ''
              )
              if (!isSafeFileName(raw)) {
                res.statusCode = 400
                return res.end('bad filename')
              }
              const filePath = path.join(exportsDir, path.basename(raw))
              if (!isUnderExportsDir(filePath) || !isSafeFileName(path.basename(filePath))) {
                res.statusCode = 400
                return res.end('bad path')
              }
              try {
                const data = await fs.readFile(filePath)
                res.setHeader(
                  'Content-Type',
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                )
                res.setHeader(
                  'Content-Disposition',
                  `inline; filename="${encodeURIComponent(path.basename(filePath))}"`
                )
                res.end(data)
              } catch {
                res.statusCode = 404
                res.end('not found')
              }
              return
            }

            if (req.method === 'GET' && pathname === '/__dev/filters/load') {
              try {
                const raw = await fs.readFile(filtersFilePath, 'utf8')
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                res.end(raw)
              } catch {
                res.statusCode = 404
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                res.end(JSON.stringify({ error: 'not found' }))
              }
              return
            }

            if (req.method === 'POST' && pathname === '/__dev/filters/save') {
              try {
                const raw = (await readBody(req)).toString('utf8')
                if (raw.length > 2_000_000) {
                  res.statusCode = 413
                  return res.end('body too large')
                }
                const j = JSON.parse(raw) as {
                  version?: number
                  columnFilters?: unknown
                  activePreset?: string | null
                }
                if (j?.version !== 1 && j?.version !== 2) {
                  res.statusCode = 400
                  res.setHeader('Content-Type', 'application/json; charset=utf-8')
                  return res.end(JSON.stringify({ error: 'invalid payload' }))
                }
                if (!Array.isArray(j.columnFilters)) {
                  res.statusCode = 400
                  res.setHeader('Content-Type', 'application/json; charset=utf-8')
                  return res.end(JSON.stringify({ error: 'invalid payload' }))
                }
                const preset =
                  j.activePreset == null || j.activePreset === ''
                    ? null
                    : typeof j.activePreset === 'string'
                      ? j.activePreset
                      : null
                const columnFilters =
                  j.version === 1
                    ? migrateColumnFiltersRatioToPercent(j.columnFilters)
                    : j.columnFilters
                const out = JSON.stringify(
                  { version: 2 as const, columnFilters, activePreset: preset },
                  null,
                  0
                )
                await fs.mkdir(exportsDir, { recursive: true })
                await fs.writeFile(filtersFilePath, out, 'utf8')
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                res.end(JSON.stringify({ ok: true }))
              } catch (e) {
                res.statusCode = 500
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                res.end(
                  JSON.stringify({
                    error: e instanceof Error ? e.message : 'save failed',
                  })
                )
              }
              return
            }

            if (req.method === 'POST' && pathname === '/__dev/export/esi-liquidity') {
              const esiPostStart = Date.now()
              type EsiBody = {
                regionId?: number
                maxTypes?: number
                maxOrderPages?: number
                orderPagesUntilExhausted?: boolean
                fileName?: string
              }
              let raw: string
              try {
                raw = (await readBody(req)).toString('utf8')
              } catch (e) {
                clearEsiDevLogs()
                logEsiExportException('readBody', e)
                res.statusCode = 500
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                return res.end(
                  JSON.stringify({
                    error:
                      e instanceof Error
                        ? e.message
                        : 'не удалось прочитать тело запроса',
                  })
                )
              }
              let j: EsiBody
              try {
                j = JSON.parse(raw) as EsiBody
              } catch (e) {
                clearEsiDevLogs()
                logEsiExportException('JSON тела', e)
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                return res.end(
                  JSON.stringify({
                    error: 'неверный JSON в теле POST (пусто или битая строка)',
                  })
                )
              }
              const rid = j.regionId
              if (
                typeof rid !== 'number' ||
                !Number.isInteger(rid) ||
                rid <= 0 ||
                rid > 99_999_999
              ) {
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                return res.end(
                  JSON.stringify({ error: 'regionId: positive integer required' })
                )
              }
              clearEsiDevLogs()
              console.log(
                `[ESI export] dev сервер: POST /esi-liquidity regionId=${rid} — старт`
              )
              try {
                const orderPagesUntilExhausted = j.orderPagesUntilExhausted === true
                const { buffer, rowCount, partial } = await buildEsiLiquidityXlsx(rid, {
                  maxTypes:
                    typeof j.maxTypes === 'number' && j.maxTypes > 0
                      ? Math.min(ESI_MAX_TYPES_USER_CAP, j.maxTypes)
                      : undefined,
                  orderPagesUntilExhausted,
                  maxOrderPages:
                    !orderPagesUntilExhausted &&
                    typeof j.maxOrderPages === 'number' &&
                    j.maxOrderPages > 0
                      ? Math.min(ESI_MAX_ORDER_PAGES_USER_CAP, j.maxOrderPages)
                      : undefined,
                })
                const baseName =
                  typeof j.fileName === 'string' &&
                  /^[a-zA-Z0-9._-]+\.xlsx$/.test(j.fileName)
                    ? j.fileName
                    : `liquidity-esi-${rid}-${formatFileDateRu(new Date())}.xlsx`
                if (!isSafeFileName(baseName)) {
                  res.statusCode = 400
                  return res.end('bad filename')
                }
                const filePath = path.join(exportsDir, baseName)
                if (!isUnderExportsDir(filePath)) {
                  res.statusCode = 400
                  return res.end('bad path')
                }
                await fs.mkdir(exportsDir, { recursive: true })
                await fs.writeFile(filePath, buffer)
                const totalMs = Date.now() - esiPostStart
                console.log(
                  `[ESI export] dev сервер: готово ${baseName} (${rowCount} строк, ${buffer.length} B${partial ? ', частично' : ''}) за ${totalMs} ms`
                )
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                return res.end(
                  JSON.stringify({
                    ok: true,
                    fileName: baseName,
                    bytes: buffer.length,
                    rowCount,
                    partial,
                  })
                )
              } catch (e) {
                const msg = e instanceof Error ? e.message : 'esi export failed'
                const ms = Date.now() - esiPostStart
                logEsiExportException('сборка ESI / запись файла', e)
                console.error(
                  `[ESI export] dev сервер: POST /esi-liquidity — ошибка за ${ms} ms:`,
                  e
                )
                res.statusCode = 502
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                return res.end(
                  JSON.stringify({
                    error: msg,
                  })
                )
              }
            }

            if (req.method === 'POST' && pathname === '/__dev/export/download') {
              let body: { url?: string; fileName?: string }
              try {
                const raw = (await readBody(req)).toString('utf8')
                body = JSON.parse(raw) as { url?: string; fileName?: string }
              } catch {
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                return res.end(JSON.stringify({ error: 'invalid json' }))
              }
              const url = body.url
              const fileName = body.fileName
              if (typeof url !== 'string' || typeof fileName !== 'string') {
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                return res.end(
                  JSON.stringify({ error: 'url and fileName required' })
                )
              }
              if (!url.startsWith(URL_PREFIX) || !ALLOWED_DOWNLOAD_URLS.has(url)) {
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                return res.end(
                  JSON.stringify({ error: 'url not in allowed export list' })
                )
              }
              if (!isSafeFileName(fileName)) {
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                return res.end(
                  JSON.stringify({ error: 'invalid fileName' })
                )
              }
              const filePath = path.join(exportsDir, fileName)
              if (!isUnderExportsDir(filePath)) {
                res.statusCode = 400
                return res.end('bad path')
              }
              try {
                const ac = new AbortController()
                const buf = await httpsGetToBuffer(url, ac, 120_000)
                await fs.writeFile(filePath, buf)
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                return res.end(
                  JSON.stringify({ ok: true, fileName, bytes: buf.length })
                )
              } catch (e) {
                res.statusCode = 502
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                return res.end(
                  JSON.stringify({
                    error: e instanceof Error ? e.message : 'fetch failed',
                  })
                )
              }
            }

            next()
          })()
        }
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), devExportPlugin()],
  server: {
    fs: { allow: [projectRoot] },
  },
})
