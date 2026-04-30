type UniverseStaticType = {
  name: string
  group_id: number
}

type UniverseStaticGroup = {
  name: string
  category_id: number
}

type UniverseStaticCategory = {
  name: string
}

type UniverseStaticCatalogRaw = {
  types?: Record<string, UniverseStaticType>
  groups?: Record<string, UniverseStaticGroup>
  categories?: Record<string, UniverseStaticCategory>
}

export type UniverseStaticCatalog = {
  types: Map<number, UniverseStaticType>
  groups: Map<number, UniverseStaticGroup>
  categories: Map<number, UniverseStaticCategory>
}

let catalogPromise: Promise<UniverseStaticCatalog> | null = null

function toNumberMap<T>(
  src: Record<string, T> | undefined
): Map<number, T> {
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

async function loadCatalogRaw(): Promise<UniverseStaticCatalogRaw> {
  const res = await fetch('/esi-universe-static.json', { cache: 'force-cache' })
  if (!res.ok)
  {
    throw new Error(`Не найден статический ESI-каталог: /esi-universe-static.json (HTTP ${ res.status })`)
  }
  return (await res.json()) as UniverseStaticCatalogRaw
}

export async function loadUniverseStaticCatalog(): Promise<UniverseStaticCatalog> {
  if (catalogPromise) return catalogPromise
  catalogPromise = (async () =>
  {
    const raw = await loadCatalogRaw()
    return {
      types: toNumberMap(raw.types),
      groups: toNumberMap(raw.groups),
      categories: toNumberMap(raw.categories),
    }
  })()
  return catalogPromise
}
