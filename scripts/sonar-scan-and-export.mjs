#!/usr/bin/env node
/**
 * 1) Запускает sonar-scanner (нужен SONAR_TOKEN и доступный SonarQube / SonarCloud).
 * 2) Вызывает scripts/sonar-fetch-issues.mjs для сохранения списка замечаний.
 *
 * Для SonarCloud дополнительно:
 *   SONAR_HOST_URL=https://sonarcloud.io
 *   SONAR_ORGANIZATION=your_org
 *
 * Для локального сервера: docker compose -f docker-compose.sonar.yml up -d
 * Затем в UI создайте проект с ключом excel-online-market (или смените sonar.projectKey).
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

function run(cmd, args, env)
{
  return new Promise((resolve, reject) =>
  {
    const child = spawn(cmd, args, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.on('error', reject)
    child.on('close', (code) =>
    {
      if (code === 0) resolve()
      else reject(new Error(`${ cmd } exited with ${ code }`))
    })
  })
}

async function main()
{
  if (!process.env.SONAR_TOKEN?.trim())
  {
    console.error('Нужен SONAR_TOKEN.')
    process.exit(1)
  }

  const extra = []
  if (process.env.SONAR_HOST_URL)
  {
    extra.push(`-Dsonar.host.url=${ process.env.SONAR_HOST_URL }`)
  }
  if (process.env.SONAR_ORGANIZATION)
  {
    extra.push(`-Dsonar.organization=${ process.env.SONAR_ORGANIZATION }`)
  }

  const scannerJs = path.join(root, 'node_modules', 'sonarqube-scanner', 'bin', 'sonar-scanner.js')
  await run(process.execPath, [ scannerJs, ...extra ], {})

  const fetchScript = path.join(__dirname, 'sonar-fetch-issues.mjs')
  await run(process.execPath, [ fetchScript ], {})
}

main().catch((e) =>
{
  console.error(e)
  process.exit(1)
})
