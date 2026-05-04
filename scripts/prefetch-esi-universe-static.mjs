import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const ESI_BASE = 'https://esi.evetech.net/latest'
const USER_AGENT =
  'ExcelOnlineMarket/1.0 (prefetch; https://github.com/Wafphlez/ExcelOnline-Market)'
const OUT_FILE = path.join(process.cwd(), 'public', 'esi-universe-static.json')
const RETRIES = 10
const CONCURRENCY = 24

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildUrl(p, query = {}) {
  const pathPart = p.startsWith('/') ? p : `/${p}`
  const u = new URL(`${ESI_BASE}${pathPart}`)
  u.searchParams.set('datasource', 'tranquility')
  for (const [k, v] of Object.entries(query))
  {
    if (v == null) continue
    u.searchParams.set(k, String(v))
  }
  return u.toString()
}

async function fetchJson(pathname, query = {}) {
  let lastErr = null
  for (let attempt = 0; attempt < RETRIES; attempt++)
  {
    const u = buildUrl(pathname, query)
    try
    {
      const res = await fetch(u, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      })
      if (res.status === 420 || res.status === 429 || res.status === 503)
      {
        lastErr = new Error(`${pathname}: HTTP ${res.status}`)
        await sleep(10_000)
        continue
      }
      if (res.status >= 500)
      {
        lastErr = new Error(`${pathname}: HTTP ${res.status}`)
        await sleep(1_000 * (attempt + 1))
        continue
      }
      if (!res.ok)
      {
        const t = await res.text().catch(() => '')
        throw new Error(`${pathname}: HTTP ${res.status} ${t.slice(0, 160)}`)
      }
      return await res.json()
    } catch (e)
    {
      lastErr = e
      await sleep(700 * (attempt + 1))
    }
  }
  throw (lastErr instanceof Error ? lastErr : new Error(String(lastErr)))
}

async function fetchAllIds(resourcePath) {
  const firstUrl = buildUrl(resourcePath, { page: 1 })
  const firstRes = await fetch(firstUrl, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  })
  if (!firstRes.ok)
  {
    const t = await firstRes.text().catch(() => '')
    throw new Error(`${resourcePath}: HTTP ${firstRes.status} ${t.slice(0, 160)}`)
  }
  const firstIds = await firstRes.json()
  const xPages = Number(firstRes.headers.get('x-pages') ?? '1')
  const pages = Number.isFinite(xPages) && xPages > 0 ? Math.floor(xPages) : 1
  const all = Array.isArray(firstIds) ? [...firstIds] : []
  if (pages <= 1) return all
  for (let p = 2; p <= pages; p++)
  {
    const part = await fetchJson(resourcePath, { page: p })
    if (Array.isArray(part)) all.push(...part)
    if (p % 25 === 0 || p === pages)
    {
      console.log(`${resourcePath}: pages ${p}/${pages}`)
    }
  }
  return all
}

async function runPool(items, worker) {
  const out = new Array(items.length)
  let idx = 0
  async function oneWorker() {
    for (;;)
    {
      const i = idx++
      if (i >= items.length) return
      out[i] = await worker(items[i], i)
    }
  }
  const workers = Array.from({ length: Math.max(1, CONCURRENCY) }, () => oneWorker())
  await Promise.all(workers)
  return out
}

function sortRecordByNumericKey(obj) {
  return Object.fromEntries(
    Object.entries(obj).sort((a, b) => Number(a[0]) - Number(b[0]))
  )
}

async function main() {
  console.log('Fetching IDs...')
  const [categoryIdsRaw, groupIdsRaw, typeIdsRaw] = await Promise.all([
    fetchAllIds('/universe/categories/'),
    fetchAllIds('/universe/groups/'),
    fetchAllIds('/universe/types/'),
  ])
  const categoryIds = [...new Set(categoryIdsRaw.map((x) => Number(x)).filter(Number.isInteger))]
  const groupIds = [...new Set(groupIdsRaw.map((x) => Number(x)).filter(Number.isInteger))]
  const typeIds = [...new Set(typeIdsRaw.map((x) => Number(x)).filter(Number.isInteger))]
  console.log(`IDs: types=${typeIds.length}, groups=${groupIds.length}, categories=${categoryIds.length}`)

  console.log('Fetching categories...')
  const categories = {}
  await runPool(categoryIds, async (id, i) => {
    const j = await fetchJson(`/universe/categories/${id}/`, { language: 'en' })
    categories[String(id)] = { name: typeof j?.name === 'string' ? j.name : `Category ${id}` }
    if ((i + 1) % 50 === 0 || i + 1 === categoryIds.length)
    {
      console.log(`categories ${i + 1}/${categoryIds.length}`)
    }
  })

  console.log('Fetching groups...')
  const groups = {}
  await runPool(groupIds, async (id, i) => {
    const j = await fetchJson(`/universe/groups/${id}/`, { language: 'en' })
    const categoryId = Number(j?.category_id)
    groups[String(id)] = {
      name: typeof j?.name === 'string' ? j.name : `Group ${id}`,
      category_id: Number.isInteger(categoryId) ? categoryId : 0,
    }
    if ((i + 1) % 100 === 0 || i + 1 === groupIds.length)
    {
      console.log(`groups ${i + 1}/${groupIds.length}`)
    }
  })

  console.log('Fetching types...')
  const types = {}
  await runPool(typeIds, async (id, i) => {
    const j = await fetchJson(`/universe/types/${id}/`, { language: 'en' })
    const groupId = Number(j?.group_id)
    const packagedVolumeRaw = Number(j?.packaged_volume)
    const volumeRaw = Number(j?.volume)
    types[String(id)] = {
      name: typeof j?.name === 'string' ? j.name : `Type ${id}`,
      group_id: Number.isInteger(groupId) ? groupId : 0,
      packaged_volume: Number.isFinite(packagedVolumeRaw) ? packagedVolumeRaw : undefined,
      volume: Number.isFinite(volumeRaw) ? volumeRaw : undefined,
    }
    if ((i + 1) % 500 === 0 || i + 1 === typeIds.length)
    {
      console.log(`types ${i + 1}/${typeIds.length}`)
    }
  })

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'esi.evetech.net/latest',
    types: sortRecordByNumericKey(types),
    groups: sortRecordByNumericKey(groups),
    categories: sortRecordByNumericKey(categories),
  }

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true })
  await fs.writeFile(OUT_FILE, `${JSON.stringify(payload)}\n`, 'utf8')
  console.log(`Done: ${OUT_FILE}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e))
  process.exitCode = 1
})
