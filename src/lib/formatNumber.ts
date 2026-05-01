import type { ColumnId } from './columnLabels'
import { COLUMN_DEF_BY_ID } from './columnLabels'

const SPACE = /[\s\u00A0]/g

/** Группы по 3 цифры слева направо (без полиномиальных регексов). */
function formatIntDigitsWithSpaces(digits: string): string
{
  const n = digits.length
  if (n <= 3) return digits
  const firstLen = n % 3 || 3
  const parts: string[] = [ digits.slice(0, firstLen) ]
  for (let i = firstLen; i < n; i += 3)
  {
    parts.push(digits.slice(i, i + 3))
  }
  return parts.join(' ')
}

/**
 * Formats a number with space as thousands separator; optional fraction digits.
 */
export function formatWithSpaces(
  n: number | null | undefined,
  fractionDigits: number
): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  const abs = Math.abs(n)
  const intPart = Math.floor(abs)
  const intStr = formatIntDigitsWithSpaces(String(intPart))
  if (fractionDigits === 0) {
    return (n < 0 ? '−' : '') + intStr
  }
  const frac = abs - intPart
  const fracStr = frac
    .toFixed(fractionDigits)
    .slice(2)
    .padEnd(fractionDigits, '0')
  return (n < 0 ? '−' : '') + intStr + ',' + fracStr
}

export function formatIsk(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  const integerDigits = Math.floor(Math.abs(n)).toString().length
  return formatWithSpaces(n, integerDigits >= 4 ? 0 : 2)
}

/**
 * Краткое отображение ISK в миллионах: `650m`, `89,9m` (колонки «Trade profit»).
 */
export function formatIskMillionsShort(isk: number | null | undefined): string
{
  if (isk === null || isk === undefined || !Number.isFinite(isk)) return '—'
  const m = isk / 1_000_000
  const sign = m < 0 ? '−' : ''
  const a = Math.abs(m)
  if (a < 0.0005) return `${ sign }0m`
  const fd = a >= 100 ? 0 : 1
  return `${ sign }${ a.toFixed(fd) }m`
}

export function formatInteger(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return formatWithSpaces(Math.round(n), 0)
}

function trimTrailingZerosAfterComma(s: string): string {
  const i = s.indexOf(',')
  if (i < 0) return s
  const head = s.slice(0, i)
  let tail = s.slice(i + 1)
  while (tail.endsWith('0')) tail = tail.slice(0, -1)
  return tail === '' ? head : `${ head },${ tail }`
}

/** Доля после деления для суффиксов K/M/B (запятая как десятичный разделитель). */
function formatKmbQuotient(q: number): string {
  const absQ = Math.abs(q)
  const fd = absQ >= 100 ? 0 : 2
  const raw = q.toFixed(fd).replace('.', ',')
  return trimTrailingZerosAfterComma(raw)
}

/**
 * Компактные целые для узких бейджей: ≥10³ → K, ≥10⁶ → M, ≥10⁹ → B (латиница).
 * Используется в индикаторе спреда и при необходимости в других микроподписях.
 */
export function formatCompactKmb(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const sign = n < 0 ? '−' : ''
  const x = Math.abs(Math.round(n))
  if (x >= 1_000_000_000) {
    return `${sign}${formatKmbQuotient(x / 1_000_000_000)}B`
  }
  if (x >= 1_000_000) {
    return `${sign}${formatKmbQuotient(x / 1_000_000)}M`
  }
  if (x >= 1000) {
    return `${sign}${formatKmbQuotient(x / 1000)}K`
  }
  return `${sign}${x}`
}

/**
 * min/max в фильтре для маржи и «средняя в спреде» задаются в **процентах**
 * (маржа: 5 = 5 %, спред: 0…100 = позиция buy…sell). Остальные колонки — целые.
 */
export function filterColumnUsesDecimals(columnId: ColumnId): boolean {
  return columnId === 'margin' // ввод с десятичной частью, % (5,5)
}

/** Привязка введённого/прокрученного значения к целому или дробному по правилам колонки. */
export function normalizeFilterNumberValue(
  n: number,
  columnId: ColumnId
): number {
  if (columnId === 'margin') {
    return Math.round(n * 100) / 100
  }
  if (columnId === 'buyToSellRatio') {
    return Math.max(0, Math.min(100, Math.round(n)))
  }
  return Math.round(n)
}

/** Формат чисел в полях min/max фильтра: маржа/спред — проценты; остальное — целые с пробелами. */
export function formatFilterNumberDisplay(
  n: number,
  columnId: ColumnId
): string {
  const kind = COLUMN_DEF_BY_ID[columnId]?.kind
  if (kind === 'text' || kind === 'market') return String(n)
  if (columnId === 'margin') {
    return formatWithSpaces(n, 2) // % в колонке уже подписаны
  }
  if (columnId === 'buyToSellRatio') {
    return formatWithSpaces(Math.round(n), 0) // 0…100
  }
  return formatWithSpaces(Math.round(n), 0)
}

export function formatPercent(
  ratio: number | null | undefined,
  fractionDigits = 2
): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return '—'
  return formatWithSpaces(ratio * 100, fractionDigits) + ' %'
}

export function formatRatio(
  v: number | null | undefined,
  fractionDigits = 3
): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return formatWithSpaces(v, fractionDigits)
}

/**
 * Parse user input: strip spaces and normalize comma to dot
 */
export function parseNumberInput(raw: string): number | null {
  const t = raw.replace(SPACE, '').replace(',', '.').trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
