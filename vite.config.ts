import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse, Server } from 'node:http'
import { watch as fsWatch } from 'node:fs'
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
  isEsiForceStopError,
  logEsiExportException,
  requestEsiExportForceStop,
  requestEsiExportStop,
} from './src/lib/dev/esiLiquidityExport'
import { EXPORT_REGIONS } from './src/lib/exportRegions'

const __filename = fileURLToPath(import.meta.url)
const projectRoot = path.resolve(path.dirname(__filename), '.')
const exportsDir = path.join(projectRoot, 'exports')
const filtersFilePath = path.join(exportsDir, 'filters.json')

function isSafeFileName(name: string): boolean {
  return /^[a-zA-Z0-9._-]+\.(xlsx|xls)$/.test(name) && !name.includes('..')
}

function isUnderExportsDir(absolute: string): boolean {
  const resolved = path.resolve(absolute)
  const ed = path.resolve(exportsDir)
  return resolved === ed || resolved.startsWith(ed + path.sep)
}

function parseMarketLogsDirPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (!v) return null
  return path.resolve(v)
}

function isSafeMarketLogFileName(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed || trimmed.includes('..')) return false
  if (trimmed.includes('/') || trimmed.includes('\\')) return false
  if (!/\.txt$/i.test(trimmed)) return false
  return true
}

function formatFileDateRu(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = String(d.getFullYear())
  return `${dd}.${mm}.${yyyy}`
}

/** Только [a-zA-Z0-9._-] — иначе `isSafeFileName` отклонит `liquidity-esi-…`. */
function toSafeFileToken(v: string): string {
  const cleaned = v
    .trim()
    .replace(/[\\/:*?"<>|]+/g, ' ')
    // Без «._» как диапазона: иначе в класс попадает почти весь ASCII и ломается санитизация.
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'region'
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
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

            if (req.method === 'GET' && pathname === '/__dev/export/marketlogs/stream') {
              const reqUrl = new URL(req.url, 'http://127.0.0.1')
              const dirPath = parseMarketLogsDirPath(reqUrl.searchParams.get('dirPath'))
              if (!dirPath) {
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                return res.end(JSON.stringify({ error: 'dirPath required' }))
              }
              try {
                const st = await fs.stat(dirPath)
                if (!st.isDirectory()) {
                  res.statusCode = 400
                  res.setHeader('Content-Type', 'application/json; charset=utf-8')
                  return res.end(JSON.stringify({ error: 'dirPath must be a directory' }))
                }
              } catch (e) {
                res.statusCode = 500
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                return res.end(
                  JSON.stringify({
                    error: e instanceof Error ? e.message : 'marketlogs stream failed',
                  })
                )
              }

              res.statusCode = 200
              res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
              res.setHeader('Cache-Control', 'no-cache, no-transform')
              res.setHeader('Connection', 'keep-alive')
              res.flushHeaders?.()
              res.write(`event: ready\ndata: {"ok":true}\n\n`)

              const heartbeat = setInterval(() => {
                try {
                  res.write(': ping\n\n')
                } catch {
                  /* ignore */
                }
              }, 20_000)

              const watcher = fsWatch(dirPath, { persistent: true }, (eventType, fileName) => {
                const file = String(fileName ?? '')
                if (!file || !/\.txt$/i.test(file)) return
                try {
                  res.write(
                    `event: marketlog\ndata: ${JSON.stringify({
                      eventType,
                      fileName: file,
                    })}\n\n`
                  )
                } catch {
                  /* ignore */
                }
              })

              const close = () => {
                clearInterval(heartbeat)
                watcher.close()
              }
              req.on('close', close)
              req.on('error', close)
              return
            }

            if (req.method === 'POST' && pathname === '/__dev/export/marketlogs/latest') {
              let body: { dirPath?: unknown }
              try {
                const raw = (await readBody(req)).toString('utf8')
                body = JSON.parse(raw) as { dirPath?: unknown }
              } catch {
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                return res.end(JSON.stringify({ error: 'invalid json' }))
              }
              const dirPath = parseMarketLogsDirPath(body.dirPath)
              if (!dirPath) {
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                return res.end(JSON.stringify({ error: 'dirPath required' }))
              }
              try {
                const st = await fs.stat(dirPath)
                if (!st.isDirectory()) {
                  res.statusCode = 400
                  res.setHeader('Content-Type', 'application/json; charset=utf-8')
                  return res.end(JSON.stringify({ error: 'dirPath must be a directory' }))
                }
                const names = await fs.readdir(dirPath)
                const files: { name: string; size: number; mtime: string; birthtime: string }[] = []
                for (const name of names) {
                  if (name.startsWith('.')) continue
                  if (!/\.txt$/i.test(name)) continue
                  const p = path.join(dirPath, name)
                  const fst = await fs.stat(p)
                  if (!fst.isFile()) continue
                  files.push({
                    name,
                    size: fst.size,
                    mtime: fst.mtime.toISOString(),
                    birthtime: fst.birthtime.toISOString(),
                  })
                }
                files.sort(
                  (a, b) => b.mtime.localeCompare(a.mtime) || a.name.localeCompare(b.name)
                )
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                return res.end(JSON.stringify({ file: files[0] ?? null }))
              } catch (e) {
                res.statusCode = 500
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                return res.end(
                  JSON.stringify({
                    error:
                      e instanceof Error ? e.message : 'marketlogs latest failed',
                  })
                )
              }
            }

            if (req.method === 'POST' && pathname === '/__dev/export/marketlogs/file') {
              let body: { dirPath?: unknown; fileName?: unknown }
              try {
                const raw = (await readBody(req)).toString('utf8')
                body = JSON.parse(raw) as { dirPath?: unknown; fileName?: unknown }
              } catch {
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                return res.end(JSON.stringify({ error: 'invalid json' }))
              }
              const dirPath = parseMarketLogsDirPath(body.dirPath)
              if (!dirPath) {
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                return res.end(JSON.stringify({ error: 'dirPath required' }))
              }
              if (
                typeof body.fileName !== 'string' ||
                !isSafeMarketLogFileName(body.fileName)
              ) {
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                return res.end(JSON.stringify({ error: 'invalid fileName' }))
              }
              try {
                const filePath = path.join(dirPath, path.basename(body.fileName))
                const st = await fs.stat(filePath)
                if (!st.isFile()) {
                  res.statusCode = 404
                  return res.end('not found')
                }
                const data = await fs.readFile(filePath)
                res.setHeader(
                  'Content-Type',
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                )
                return res.end(data)
              } catch {
                res.statusCode = 404
                return res.end('not found')
              }
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

            if (req.method === 'POST' && pathname === '/__dev/export/esi-stop-force') {
              try {
                requestEsiExportForceStop()
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                res.end(JSON.stringify({ ok: true }))
              } catch (e) {
                res.statusCode = 500
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                res.end(
                  JSON.stringify({
                    error: e instanceof Error ? e.message : 'esi stop-force failed',
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
                historyDays?: number
                includeOrderSnapshot?: boolean
                tradeHubOnly?: boolean
                tradeHubLocationId?: number
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
                const historyDays =
                  j.historyDays === 2 || j.historyDays === 7 || j.historyDays === 30
                    ? j.historyDays
                    : 30
                const { buffer, rowCount, partial } = await buildEsiLiquidityXlsx(rid, {
                  historyDays,
                  includeOrderSnapshot: j.includeOrderSnapshot === true,
                  tradeHubOnly: j.tradeHubOnly === true,
                  tradeHubLocationId:
                    typeof j.tradeHubLocationId === 'number' && Number.isFinite(j.tradeHubLocationId)
                      ? Math.floor(j.tradeHubLocationId)
                      : undefined,
                })
                const regionMeta = EXPORT_REGIONS.find((x) => x.esiRegionId === rid)
                const fileRegionToken =
                  j.tradeHubOnly === true && regionMeta?.tradeHubName
                    ? toSafeFileToken(regionMeta.tradeHubName)
                    : toSafeFileToken(regionMeta?.label ?? String(rid))
                const baseName =
                  typeof j.fileName === 'string' &&
                  /^[a-zA-Z0-9._-]+\.xlsx$/.test(j.fileName)
                    ? j.fileName
                    : `liquidity-esi-${fileRegionToken}-${formatFileDateRu(new Date())}.xlsx`
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
                if (isEsiForceStopError(e)) {
                  console.log(
                    `[ESI export] dev сервер: POST /esi-liquidity — stop-force за ${ms} ms`
                  )
                  res.statusCode = 409
                  res.setHeader('Content-Type', 'application/json; charset=utf-8')
                  return res.end(
                    JSON.stringify({
                      error: msg,
                      stopped: true,
                      force: true,
                    })
                  )
                }
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
