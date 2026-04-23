import type { EsiExportProgressState } from './esiExportProgressTypes'

const MIN_P = 0.008
const MAX_ETA_SEC = 6 * 60 * 60

/** 0..1: сколько «отработана» фаза ордеров (sell + buy / 2*max) */
export function esiOrdersProgress01(p: EsiExportProgressState): number {
  const m = p.maxOrderPages
  if (m <= 0) return 0
  return Math.min(1, (p.sellPage + p.buyPage) / (2 * m))
}

/** 0..1: фаза типов */
export function esiTypesProgress01(p: EsiExportProgressState): number {
  if (p.typeTotal <= 0) return 0
  return Math.min(1, p.typesDone / p.typeTotal)
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
