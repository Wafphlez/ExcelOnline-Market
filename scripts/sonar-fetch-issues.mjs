#!/usr/bin/env node
/**
 * Выгрузка всех замечаний SonarQube / SonarCloud через Web API.
 *
 * Переменные окружения:
 *   SONAR_HOST_URL — по умолчанию http://127.0.0.1:9000
 *   SONAR_TOKEN    — обязательно (User token в SonarQube / SonarCloud)
 *   SONAR_PROJECT_KEY — по умолчанию excel-online-market
 *
 * Результат: reports/sonar/issues.json и reports/sonar/issues.md
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outDir = join(root, 'reports', 'sonar')

const host = (process.env.SONAR_HOST_URL || 'http://127.0.0.1:9000').replace(/\/$/, '')
const token = process.env.SONAR_TOKEN
const projectKey = process.env.SONAR_PROJECT_KEY || 'excel-online-market'

function basicAuthHeader(tok)
{
  const raw = `${ tok }:`
  return `Basic ${ Buffer.from(raw, 'utf8').toString('base64') }`
}

async function fetchPage(page, pageSize)
{
  const u = new URL('/api/issues/search', host)
  u.searchParams.set('componentKeys', projectKey)
  u.searchParams.set('ps', String(pageSize))
  u.searchParams.set('p', String(page))
  u.searchParams.set('severities', 'BLOCKER,CRITICAL,MAJOR,MINOR,INFO')
  u.searchParams.set('types', 'BUG,VULNERABILITY,CODE_SMELL')

  const res = await fetch(u, {
    headers: {
      Accept: 'application/json',
      Authorization: basicAuthHeader(token),
    },
  })
  if (!res.ok)
  {
    const text = await res.text()
    throw new Error(`Sonar API ${ res.status }: ${ text.slice(0, 500) }`)
  }
  return res.json()
}

async function fetchHotspotsPage(page, pageSize)
{
  const u = new URL('/api/hotspots/search', host)
  u.searchParams.set('projectKey', projectKey)
  u.searchParams.set('ps', String(pageSize))
  u.searchParams.set('p', String(page))

  const res = await fetch(u, {
    headers: {
      Accept: 'application/json',
      Authorization: basicAuthHeader(token),
    },
  })
  if (!res.ok)
  {
    const text = await res.text()
    throw new Error(`Sonar hotspots API ${ res.status }: ${ text.slice(0, 500) }`)
  }
  return res.json()
}

function issueLineMd(issue, componentsByKey)
{
  const comp = issue.component && componentsByKey.get(issue.component)
  const path = comp?.longName || comp?.name || issue.component || '—'
  const sev = issue.severity || '—'
  const typ = issue.type || '—'
  const rule = issue.rule || '—'
  const line = issue.line != null ? String(issue.line) : '—'
  const msg = (issue.message || '').replace(/\r?\n/g, ' ')
  return `| ${ sev } | ${ typ } | \`${ path }:${ line }\` | ${ rule } | ${ msg } |`
}

function hotspotLineMd(h, componentsByKey)
{
  const comp = h.component && componentsByKey.get(h.component)
  const path = comp?.longName || comp?.path || comp?.name || h.component || '—'
  const prob = h.vulnerabilityProbability || '—'
  const rule = h.ruleKey || '—'
  const line = h.line != null ? String(h.line) : '—'
  const msg = (h.message || '').replace(/\r?\n/g, ' ')
  const st = h.status || '—'
  return `| ${ prob } | ${ st } | \`${ path }:${ line }\` | ${ rule } | ${ msg } |`
}

async function main()
{
  if (!token || !token.trim())
  {
    console.error('Задайте SONAR_TOKEN (токен пользователя в SonarQube / SonarCloud).')
    process.exit(1)
  }

  await mkdir(outDir, { recursive: true })

  const pageSize = 500
  const allIssues = []
  let page = 1
  let total = 0
  const componentsByKey = new Map()

  for (;;)
  {
    const data = await fetchPage(page, pageSize)
    const issues = data.issues || []
    for (const c of data.components || [])
    {
      if (c.key != null) componentsByKey.set(c.key, c)
    }
    allIssues.push(...issues)
    total = data.paging?.total ?? allIssues.length
    if (issues.length < pageSize || allIssues.length >= total) break
    page += 1
  }

  const allHotspots = []
  page = 1
  for (;;)
  {
    const data = await fetchHotspotsPage(page, pageSize)
    const hotspots = data.hotspots || []
    for (const c of data.components || [])
    {
      if (c.key != null) componentsByKey.set(c.key, c)
    }
    allHotspots.push(...hotspots)
    const hTotal = data.paging?.total ?? allHotspots.length
    if (hotspots.length < pageSize || allHotspots.length >= hTotal) break
    page += 1
  }

  const payload = {
    fetchedAt: new Date().toISOString(),
    host,
    projectKey,
    issueCount: allIssues.length,
    hotspotCount: allHotspots.length,
    issues: allIssues,
    hotspots: allHotspots,
    components: [ ...componentsByKey.values() ],
  }

  const jsonPath = join(outDir, 'issues.json')
  await writeFile(jsonPath, `${ JSON.stringify(payload, null, 2) }\n`, 'utf8')

  const header = [
    '# Sonar: замечания',
    '',
    `- Проект: \`${ projectKey }\``,
    `- Сервер: ${ host }`,
    `- Дата выгрузки: ${ payload.fetchedAt }`,
    `- Issues (BUG / VULNERABILITY / CODE_SMELL): **${ allIssues.length }**`,
    `- Security hotspots: **${ allHotspots.length }**`,
    '',
    '## Issues',
    '',
    '| Severity | Type | Файл:строка | Rule | Сообщение |',
    '| --- | --- | --- | --- | --- |',
  ]

  const lines = allIssues.map((i) => issueLineMd(i, componentsByKey))
  const hotspotSection = [
    '',
    '## Security hotspots',
    '',
    '| Вероятность | Статус | Файл:строка | Rule | Сообщение |',
    '| --- | --- | --- | --- | --- |',
    ...allHotspots.map((h) => hotspotLineMd(h, componentsByKey)),
    '',
  ]
  const mdPath = join(outDir, 'issues.md')
  await writeFile(
    mdPath,
    [ ...header, ...lines, ...hotspotSection ].join('\n'),
    'utf8',
  )

  console.log(`Записано: ${ jsonPath }`)
  console.log(`Записано: ${ mdPath }`)
  console.log(`Issues: ${ allIssues.length }, hotspots: ${ allHotspots.length }`)
}

main().catch((e) =>
{
  console.error(e)
  process.exit(1)
})
