import type { ColumnId } from './columnLabels'
import { COLUMN_DEF_BY_ID } from './columnLabels'

const SPACE = /[\s\u00A0]/g

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
  const intStr = String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
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
  return formatWithSpaces(n, 2)
}

export function formatInteger(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return formatWithSpaces(Math.round(n), 0)
}

/**
 * min/max в фильтре для маржи и «средняя в спреде» задаются в **процентах**
 * (маржа: 5 = 5 %, спред: 0…100 = позиция bid…ask). Остальные колонки — целые.
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
