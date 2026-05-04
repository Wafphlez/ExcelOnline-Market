type RegionInfo = { name: string }
type LocationInfo = { name: string; region_id: number }

import { publicAssetUrl } from '../publicAssetUrl'

type TradeHubsStaticRaw = {
  regions?: Record<string, RegionInfo>
  stations?: Record<string, LocationInfo>
  structures?: Record<string, LocationInfo>
}

export type TradeHubsStaticCatalog = {
  regions: Map<number, RegionInfo>
  stations: Map<number, LocationInfo>
  structures: Map<number, LocationInfo>
}

let catalogPromise: Promise<TradeHubsStaticCatalog> | null = null

function toNumberMap<T>(src: Record<string, T> | undefined): Map<number, T> {
  const out = new Map<number, T>()
  if (!src) return out
  for (const [k, v] of Object.entries(src))
  {
    const id = Number(k)
    if (!Number.isInteger(id) || !v || typeof v !== 'object') continue
    out.set(id, v)
  }
  return out
}

export async function loadTradeHubsStaticCatalog(): Promise<TradeHubsStaticCatalog> {
  if (catalogPromise) return catalogPromise
  catalogPromise = (async () =>
  {
    const res = await fetch(publicAssetUrl('esi-trade-hubs-static.json'), {
      cache: 'force-cache',
    })
    if (!res.ok)
    {
      return { regions: new Map(), stations: new Map(), structures: new Map() }
    }
    const raw = (await res.json()) as TradeHubsStaticRaw
    return {
      regions: toNumberMap(raw.regions),
      stations: toNumberMap(raw.stations),
      structures: toNumberMap(raw.structures),
    }
  })()
  return catalogPromise
}
