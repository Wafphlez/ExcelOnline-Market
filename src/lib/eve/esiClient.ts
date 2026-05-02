import
  {
    DEFAULT_EVE_USER_AGENT,
    ESI_BASE,
    ESI_MAX_RETRIES,
    ESI_REQUEST_GAP_MS,
  } from './constants'

function sleep(ms: number): Promise<void>
{
  return new Promise((r) => setTimeout(r, ms))
}

function buildEsiUrl(
  path: string,
  query: Record<string, string | number | boolean | undefined>
): string
{
  const p = path.startsWith('/') ? path : `/${ path }`
  const u = new URL(`${ ESI_BASE.replace(/\/$/, '') }${ p }`)
  u.searchParams.set('datasource', 'tranquility')
  for (const [k, v] of Object.entries(query))
  {
    if (v === undefined) continue
    u.searchParams.set(k, String(v))
  }
  return u.toString()
}

export class EsiHttpError extends Error
{
  constructor(
    public readonly path: string,
    public readonly status: number,
    public readonly body: string
  )
  {
    const detail = body ? `: ${ body.slice(0, 120) }` : ''
    super(`ESI ${ path } → HTTP ${ status }${ detail }`)
    this.name = 'EsiHttpError'
  }
}

type EsiAttemptResult<T> =
  | { kind: 'empty' }
  | { kind: 'json'; data: T }
  | { kind: 'retry'; err: EsiHttpError }
  | { kind: 'fatal'; err: EsiHttpError }

async function esiFetchAttempt<T>(
  url: string,
  path: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }
): Promise<EsiAttemptResult<T>>
{
  const res = await fetch(url, init)
  const status = res.status
  if (status === 204) return { kind: 'empty' }
  const retriable =
    status === 420 || status === 429 || status === 503 || status >= 500
  if (retriable)
  {
    const t = await res.text().catch(() => '')
    return { kind: 'retry', err: new EsiHttpError(path, status, t) }
  }
  if (!res.ok)
  {
    const t = await res.text().catch(() => '')
    return { kind: 'fatal', err: new EsiHttpError(path, status, t) }
  }
  return { kind: 'json', data: (await res.json()) as T }
}

export type EsiFetchOptions = {
  method?: 'GET' | 'POST' | 'DELETE'
  accessToken?: string
  body?: string
  query?: Record<string, string | number | boolean | undefined>
  signal?: AbortSignal
}

/**
 * ESI-запрос с паузой между ретраями (420/429/503/5xx), как в dev ESI-экспорте.
 */
export async function esiFetchJson<T>(
  path: string,
  options: EsiFetchOptions = {}
): Promise<T>
{
  const { method = 'GET', accessToken, body, query = {}, signal } = options
  const url = buildEsiUrl(path, query)
  let lastErr: unknown = null
  for (let attempt = 0; attempt < ESI_MAX_RETRIES; attempt++)
  {
    if (attempt > 0) await sleep(ESI_REQUEST_GAP_MS * attempt)
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': DEFAULT_EVE_USER_AGENT,
    }
    if (accessToken) headers.Authorization = `Bearer ${ accessToken }`
    if (body != null) headers['Content-Type'] = 'application/json'

    const attemptRes = await esiFetchAttempt<T>(url, path, {
      method,
      headers,
      body,
      signal,
    })
    if (attemptRes.kind === 'empty') return null as T
    if (attemptRes.kind === 'fatal') throw attemptRes.err
    if (attemptRes.kind === 'json') return attemptRes.data

    lastErr = attemptRes.err
    const st = attemptRes.err.status
    const backoffMs =
      st >= 500 ? 500 * Math.min(4, 1 + attempt) : 10_000
    await sleep(backoffMs)
  }
  if (lastErr instanceof Error) throw lastErr
  throw new EsiHttpError(path, 0, 'ESI: превышено число ретраев')
}

export function esiGetPublicPath(path: string, query: Record<string, string | number | boolean | undefined> = {}): string
{
  return buildEsiUrl(path, query)
}
