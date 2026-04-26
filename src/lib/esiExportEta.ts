import type { EsiExportProgressState } from './esiExportProgressTypes'

const MIN_P = 0.008
const MAX_ETA_SEC = 6 * 60 * 60

/** 0..1: фаза ордеров; при `order*PageBarMax` — по фактическому max по стороне, иначе 2*m */
export function esiOrdersProgress01(p: EsiExportProgressState): number {
  const m = p.maxOrderPages
  if (m <= 0) return 0
  const sellM = p.orderSellPageBarMax > 0 ? p.orderSellPageBarMax : m
  const buyM = p.orderBuyPageBarMax > 0 ? p.orderBuyPageBarMax : m
  return Math.min(
    1,
    (p.sellPage / sellM + p.buyPage / buyM) / 2
  )
}

/** 0..1: фаза типов */
export function esiTypesProgress01(p: EsiExportProgressState): number {
  if (p.typeTotal <= 0) return 0
  return Math.min(1, p.typesDone / p.typeTotal)
}

/** 0..1: общий прогресс по всем ESI-запросам, нужным для выгрузки */
export function esiAllRequestsProgress01(p: EsiExportProgressState): number {
  const m = p.maxOrderPages
  const sellM = m > 0 ? (p.orderSellPageBarMax > 0 ? p.orderSellPageBarMax : m) : 0
  const buyM = m > 0 ? (p.orderBuyPageBarMax > 0 ? p.orderBuyPageBarMax : m) : 0
  const ordersTotal = sellM + buyM
  const ordersDone =
    Math.min(Math.max(0, p.sellPage), sellM) + Math.min(Math.max(0, p.buyPage), buyM)

  const historyTotal = Math.max(0, p.historyTotal)
  const historyDone = Math.min(Math.max(0, p.historyDone), historyTotal)

  const typesTotal = Math.max(0, p.universeTypesTotal)
  const typesDone = Math.min(Math.max(0, p.universeTypesDone), typesTotal)

  const groupsTotal = Math.max(0, p.universeGroupsTotal)
  const groupsDone = Math.min(Math.max(0, p.universeGroupsDone), groupsTotal)

  const categoriesTotal = Math.max(0, p.universeCategoriesTotal)
  const categoriesDone = Math.min(Math.max(0, p.universeCategoriesDone), categoriesTotal)

  const total =
    ordersTotal + historyTotal + typesTotal + groupsTotal + categoriesTotal
  if (total <= 0) return 0

  const done = ordersDone + historyDone + typesDone + groupsDone + categoriesDone
  return Math.min(1, done / total)
}

/**
 * Оставшееся время (сек) по линейной экстраполяции: elapsed * (1/p - 1).
 * При p < MIN_P — null (не показывать дичь).
 */
export function linearEtaRemaining(
  progress01: number,
  elapsedSec: number
): number | null {
  if (elapsedSec <= 0 || !Number.isFinite(elapsedSec)) return null
  if (!Number.isFinite(progress01) || progress01 < MIN_P || progress01 >= 0.999) {
    return null
  }
  const rem = (elapsedSec / progress01) * (1 - progress01)
  if (!Number.isFinite(rem) || rem < 0 || rem > MAX_ETA_SEC) return null
  return Math.round(rem)
}

/**
 * m:ss, подходит для секундомера (от 0:00)
 */
export function formatEsiStopwatch(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

/**
 * Кратко «≈ 2м 10с» / «≈ 45 с»
 */
export function formatEsiEtaRemaining(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) {
    return '—'
  }
  const t = Math.round(seconds)
  if (t < 1) return '≈ <1 с'
  if (t < 60) return `≈ ${t} с`
  const m = Math.floor(t / 60)
  const r = t % 60
  if (m >= 60) {
    const h = Math.floor(m / 60)
    const km = m % 60
    return `≈ ${h}ч ${km}м`
  }
  if (r === 0) return `≈ ${m}м`
  return `≈ ${m}м ${r}с`
}
