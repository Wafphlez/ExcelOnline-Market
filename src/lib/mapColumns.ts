import type { MarketRow } from '../types/market'
import { excelMillionsToIsk } from './scaleTurnover'

function normalizeKey(key: string): string {
  return String(key)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

const ALIAS_TO_FIELD: Record<
  string,
  keyof Pick<
    MarketRow,
    | 'name'
    | 'typeId'
    | 'dayVolume'
    | 'dayTurnover'
    | 'price'
    | 'priceSell'
    | 'priceBuy'
  >
> = {
  bame: 'name',
  name: 'name',
  item: 'name',
  item_name: 'name',
  type_id: 'typeId',
  typeid: 'typeId',
  type: 'typeId',
  item_id: 'typeId',
  itemid: 'typeId',
  eve_type_id: 'typeId',
  'id_предмета': 'typeId',
  'id_predmeta': 'typeId',
  day_volume: 'dayVolume',
  dayvolume: 'dayVolume',
  day_turnover: 'dayTurnover',
  dayturnover: 'dayTurnover',
  price: 'price',
  avg_price: 'price',
  price_sell: 'priceSell',
  pricesell: 'priceSell',
  sell: 'priceSell',
  ask: 'priceSell',
  price_bay: 'priceBuy',
  price_buy: 'priceBuy',
  pricebuy: 'priceBuy',
  bid: 'priceBuy',
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' && !Number.isNaN(v) && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const t = v.replace(/[\s\u00A0]/g, '').replace(',', '.')
    if (t === '') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }
  if (typeof v === 'boolean') return v ? 1 : 0
  return null
}

const REQUIRED: (keyof MarketRow)[] = [
  'name',
  'dayVolume',
  'dayTurnover',
  'price',
  'priceSell',
  'priceBuy',
]

export type MapError = { kind: 'missing'; column: string }

export function mapRawRow(
  row: Record<string, unknown>
): { ok: true; value: MarketRow } | { ok: false; error: MapError } {
  const out: Partial<Record<keyof MarketRow, unknown>> = {}

  for (const [k, val] of Object.entries(row)) {
    const nk = normalizeKey(k)
    const field = ALIAS_TO_FIELD[nk]
    if (!field) continue
    if (field === 'name') {
      out.name = val === null || val === undefined ? '' : String(val)
    } else if (field === 'typeId') {
      const n = toNumber(val)
      out.typeId =
        n !== null && Number.isFinite(n) && n > 0 ? Math.floor(n) : null
    } else {
      out[field] = toNumber(val)
    }
  }

  const missing: string[] = []
  for (const key of REQUIRED) {
    if (key === 'name') {
      if (out.name === undefined) missing.push('name (или bame)')
    } else {
      if (out[key] === null || out[key] === undefined) {
        missing.push(String(key))
      }
    }
  }
  if (missing.length) {
    return {
      ok: false,
      error: { kind: 'missing', column: missing.join(', ') },
    }
  }

  const typeIdVal = out.typeId
  const typeId: number | null =
    typeof typeIdVal === 'number' && Number.isFinite(typeIdVal) && typeIdVal > 0
      ? Math.floor(typeIdVal)
      : null

  return {
    ok: true,
    value: {
      typeId: typeId,
      name: String(out.name),
      dayVolume: out.dayVolume as number,
      dayTurnover: excelMillionsToIsk(out.dayTurnover as number),
      price: out.price as number,
      priceSell: out.priceSell as number,
      priceBuy: out.priceBuy as number,
      margin: null,
      buyToSellRatio: null,
      spreadIsk: null,
      entryScore: null,
    },
  }
}

function isRowEmptyish(row: Record<string, unknown>): boolean {
  const vals = Object.values(row)
  if (vals.length === 0) return true
  return vals.every(
    (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
  )
}

export function mapRawRows(
  rows: Record<string, unknown>[]
):
  | { ok: true; rows: MarketRow[] }
  | { ok: false; error: MapError; rowIndex: number } {
  const result: MarketRow[] = []
  let i = 0
  for (const r of rows) {
    if (!r || typeof r !== 'object') {
      i++
      continue
    }
    if (isRowEmptyish(r as Record<string, unknown>)) {
      i++
      continue
    }
    const m = mapRawRow(r)
    if (!m.ok) {
      return { ok: false, error: m.error, rowIndex: i }
    }
    result.push(m.value)
    i++
  }
  if (result.length === 0) {
    return {
      ok: false,
      error: { kind: 'missing', column: 'ни одной валидной строки' },
      rowIndex: 0,
    }
  }
  return { ok: true, rows: result }
}
