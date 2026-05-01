#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const path = join(root, 'reports', 'sonar', 'issues.md')

function smDone(line)
{
  const tests = [
    /useCharacterDashboardData\.ts:(27|28)\|.*S3863/,
    /useCharacterDashboardData\.ts:288\|.*S7763/,
    /base64url\.ts/,
    /constants\.ts:(91|92)\|.*S7764/,
    /eveSso\.ts\|.*S7764/,
    /eveSso\.ts:145\|.*S6582/,
    /devExportApi\.ts/,
    /MarketTable\.tsx:(184|191|193)\|.*S7764/,
    /TradingView\.tsx:(368|431|432|435|436|882|883|886|887)\|.*S7764/,
    /ExportBar\.tsx:(324|369|551|592|593|628|629)\|.*S7764/,
    /ExportBar\.tsx:(798|833|923)\|.*S6853/,
    /ExportBar\.tsx:(337|343)\|.*S3735/,
    /formatNumber\.ts:(16|57)\|.*S5852/,
    /base64url\.ts:8\|.*S5852/,
  ]
  return tests.some((re) => re.test(line))
}

const lines = readFileSync(path, 'utf8').split('\n')
const out = []
for (const line of lines)
{
  if (line === '| Severity | Type | Файл:строка | Rule | Сообщение |')
  {
    out.push('| ✓ | Severity | Type | Файл:строка | Rule | Сообщение |')
    continue
  }
  if (line === '| Вероятность | Статус | Файл:строка | Rule | Сообщение |')
  {
    out.push('| ✓ | Вероятность | Статус | Файл:строка | Rule | Сообщение |')
    continue
  }
  if (line === '| --- | --- | --- | --- | --- |')
  {
    out.push('| --- | --- | --- | --- | --- | --- |')
    continue
  }
  if (
    line.startsWith('| ')
    && / \| (CODE_SMELL|TO_REVIEW) \| /.test(line)
  )
  {
    const ok = smDone(line)
    out.push(
      ok
        ? line.replace(/^\| /, '| ✓ | ')
        : line.replace(/^\| /, '|   | '),
    )
    continue
  }
  out.push(line)
}

let joined = out.join('\n')
if (!joined.includes('**Статус отметок:**'))
{
  joined = joined.replace(
    '# Sonar: замечания\n',
    `# Sonar: замечания\n\n> **Статус отметок:** «✓» — правка внесена в код; повторный скан Sonar не запускался. Пустая ячейка — не закрыто или нужен отдельный рефакторинг.\n>\n`,
  )
}

writeFileSync(path, joined, 'utf8')
console.log('Updated', path)
