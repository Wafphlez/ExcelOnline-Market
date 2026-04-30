import { EsiHttpError, esiFetchJson } from './esiClient'
import type
  {
    EveAsset,
    EveCharacterInfo,
    EveCorporation,
    EveWalletJournalEntry,
    EveWalletTransaction,
    MarketPrice,
  } from '../../types/eveCharacter'
import { DEFAULT_EVE_USER_AGENT, ESI_BASE } from './constants'
import { loadUniverseStaticCatalog } from './universeStaticCatalog'

/** ESI обычно отдаёт до 250 записей; пагинация — пока `from_id` не вернёт пусто. */

/**
 * Кошелёк — число.
 */
export async function fetchCharacterWallet(
  characterId: number,
  accessToken: string
): Promise<number>
{
  return esiFetchJson<number>(`/characters/${ characterId }/wallet/`, {
    accessToken,
  })
}

/**
 * Публичная информация о персонаже.
 */
export async function fetchPublicCharacter(
  characterId: number
): Promise<EveCharacterInfo>
{
  return esiFetchJson<EveCharacterInfo>(`/characters/${ characterId }/`, {})
}

export async function fetchCorporation(
  corporationId: number
): Promise<EveCorporation>
{
  return esiFetchJson<EveCorporation>(`/corporations/${ corporationId }/`, {})
}

export async function fetchUniverseTypeName(typeId: number): Promise<string>
{
  const c = await loadUniverseStaticCatalog()
  const t = c.types.get(typeId)
  if (!t?.name)
  {
    throw new Error(`Type ${ typeId } не найден в локальном esi-universe-static.json`)
  }
  return t.name
}

/**
 * С ограничением параллелизма, чтобы не упереться в rate limit.
 */
export async function fetchTypeNameMap(
  typeIds: number[],
  signal?: AbortSignal
): Promise<Map<number, string>>
{
  const unique = [...new Set(typeIds)].filter((id) => id > 0)
  const c = await loadUniverseStaticCatalog()
  const m = new Map<number, string>()
  for (const id of unique)
  {
    if (signal?.aborted) break
    m.set(id, c.types.get(id)?.name ?? `#${ id }`)
  }
  return m
}

export async function fetchAllWalletJournal(
  characterId: number,
  accessToken: string,
  signal?: AbortSignal
): Promise<EveWalletJournalEntry[]>
{
  const all: EveWalletJournalEntry[] = []
  const seen = new Set<number>()
  let fromId: number | undefined
  for (;;)
  {
    const page = await esiFetchJson<EveWalletJournalEntry[]>(
      `/characters/${ characterId }/wallet/journal/`,
      {
        accessToken,
        query: fromId != null ? { from_id: fromId } : {},
        signal,
      }
    )
    if (page.length === 0) break
    const fresh = page.filter((e) =>
    {
      if (seen.has(e.id)) return false
      seen.add(e.id)
      return true
    })
    if (fresh.length === 0) break
    all.push(...fresh)
    const minId = Math.min(...page.map((e) => e.id))
    if (fromId != null && minId >= fromId) break
    fromId = minId
  }
  return all
}

export async function fetchAllWalletTransactions(
  characterId: number,
  accessToken: string,
  signal?: AbortSignal
): Promise<EveWalletTransaction[]>
{
  const all: EveWalletTransaction[] = []
  const seen = new Set<number>()
  let fromId: number | undefined
  for (;;)
  {
    const page = await esiFetchJson<EveWalletTransaction[]>(
      `/characters/${ characterId }/wallet/transactions/`,
      {
        accessToken,
        query: fromId != null ? { from_id: fromId } : {},
        signal,
      }
    )
    if (page.length === 0) break
    const fresh = page.filter((e) =>
    {
      if (seen.has(e.transaction_id)) return false
      seen.add(e.transaction_id)
      return true
    })
    if (fresh.length === 0) break
    all.push(...fresh)
    const minId = Math.min(...page.map((e) => e.transaction_id))
    if (fromId != null && minId >= fromId) break
    fromId = minId
  }
  return all
}

/**
 * Активы: ESI, `page` 1-based. При **отсутствии** имущества или при запросе несуществующей
 * страницы CCP нередко отвечает `404` + `{"error":"Requested page does not exist!"}`, а не `[]`.
 */
function isEsiNoSuchPageError(err: unknown): boolean
{
  if (!(err instanceof EsiHttpError)) return false
  if (err.status !== 404) return false
  return /page\s+does\s+not\s+exist|requested\s+page/i.test(err.body)
}

export async function fetchAllAssets(
  characterId: number,
  accessToken: string,
  signal?: AbortSignal
): Promise<EveAsset[]>
{
  const all: EveAsset[] = []
  for (let p = 1; ; p++)
  {
    let page: EveAsset[]
    try
    {
      page = await esiFetchJson<EveAsset[]>(`/characters/${ characterId }/assets/`, {
        accessToken,
        query: { page: p },
        signal,
      })
    } catch (e)
    {
      if (isEsiNoSuchPageError(e))
      {
        if (p === 1) return []
        break
      }
      throw e
    }
    if (page.length === 0) break
    all.push(...page)
  }
  return all
}

/**
 * GET /markets/prices/ — `type_ids` передаётся как повторяющийся query key.
 * Реализация через buildUrl с array не сработала: используем ручной query string.
 */
export async function fetchMarketPrices(
  typeIds: number[],
  signal?: AbortSignal
): Promise<MarketPrice[]>
{
  if (typeIds.length === 0) return []
  const out: MarketPrice[] = []
  const chunk = 200
  for (let i = 0; i < typeIds.length; i += chunk)
  {
    const part = typeIds.slice(i, i + chunk)
    const q = new URLSearchParams()
    q.set('datasource', 'tranquility')
    for (const id of part) q.append('type_ids', String(id))
    const u = `${ ESI_BASE.replace(/\/$/, '') }/markets/prices/?${ q.toString() }`
    const res = await fetch(u, {
      signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': DEFAULT_EVE_USER_AGENT,
      },
    })
    if (!res.ok)
    {
      const t = await res.text().catch(() => '')
      throw new Error(`ESI /markets/prices/ → HTTP ${ res.status } ${ t.slice(0, 200) }`)
    }
    const j = (await res.json()) as MarketPrice[]
    out.push(...j)
  }
  return out
}
