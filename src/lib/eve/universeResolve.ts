import { EsiHttpError, esiFetchJson } from './esiClient'
import { ESI_REQUEST_GAP_MS } from './constants'

function sleep(ms: number): Promise<void>
{
  return new Promise((r) => setTimeout(r, ms))
}

const locationToRegion = new Map<number, number>()
const locationLabel = new Map<number, string>()
const regionName = new Map<number, string>()

async function systemIdToRegionId(
  systemId: number,
  signal?: AbortSignal
): Promise<number>
{
  const sys = await esiFetchJson<{ constellation_id: number }>(
    `/universe/systems/${ systemId }/`,
    { signal }
  )
  await sleep(ESI_REQUEST_GAP_MS)
  const cons = await esiFetchJson<{ region_id: number }>(
    `/universe/constellations/${ sys.constellation_id }/`,
    { signal }
  )
  return cons.region_id
}

/**
 * Станция или плеерная структура → регион и подпись локации (кэш в рамках сессии).
 * Для structure нужен `accessToken` (ESI 404 на `/stations/` → `/structures/`).
 */
export async function resolveLocationToRegionAndLabel(
  locationId: number,
  accessToken: string | undefined,
  signal?: AbortSignal
): Promise<{ regionId: number; label: string }>
{
  const r0 = locationToRegion.get(locationId)
  const n0 = locationLabel.get(locationId)
  if (r0 != null && n0) return { regionId: r0, label: n0 }
  await sleep(ESI_REQUEST_GAP_MS)
  try
  {
    const st = await esiFetchJson<{
      name: string
      system_id: number
    }>(`/universe/stations/${ locationId }/`, { signal })
    const label = st.name ?? `#${ locationId }`
    locationLabel.set(locationId, label)
    const rid = await systemIdToRegionId(st.system_id, signal)
    locationToRegion.set(locationId, rid)
    return { regionId: rid, label }
  } catch (e)
  {
    if (!accessToken) throw e
    if (!(e instanceof EsiHttpError) || e.status !== 404) throw e
    await sleep(ESI_REQUEST_GAP_MS)
    const st = await esiFetchJson<{
      name: string
      solar_system_id: number
    }>(`/universe/structures/${ locationId }/`, { accessToken, signal })
    const label = st.name ?? `#${ locationId }`
    locationLabel.set(locationId, label)
    const rid = await systemIdToRegionId(st.solar_system_id, signal)
    locationToRegion.set(locationId, rid)
    return { regionId: rid, label }
  }
}

export async function resolveRegionName(
  regionId: number,
  signal?: AbortSignal
): Promise<string>
{
  if (regionName.has(regionId)) return regionName.get(regionId)!
  await sleep(ESI_REQUEST_GAP_MS)
  const r = await esiFetchJson<{ name: string }>(`/universe/regions/${ regionId }/`, { signal })
  const n = r.name ?? `Region ${ regionId }`
  regionName.set(regionId, n)
  return n
}
