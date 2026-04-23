import { describe, expect, it } from 'vitest'
import {
  esiOrdersProgress01,
  formatEsiEtaRemaining,
  formatEsiStopwatch,
  linearEtaRemaining,
} from './esiExportEta'
import { ESI_EXPORT_PROGRESS_IDLE } from './esiExportProgressTypes'

describe('esiExportEta', () => {
  it('orders progress 01', () => {
    expect(esiOrdersProgress01({ ...ESI_EXPORT_PROGRESS_IDLE, maxOrderPages: 10, sellPage: 5, buyPage: 5, phase: 'orders' })).toBe(0.5)
  })

  it('linear eta: half done in 100s => ~100s left', () => {
    const r = linearEtaRemaining(0.5, 100)
    expect(r).toBe(100)
  })

  it('format stopwatch', () => {
    expect(formatEsiStopwatch(65)).toBe('1:05')
    expect(formatEsiStopwatch(0)).toBe('0:00')
  })

  it('format eta', () => {
    expect(formatEsiEtaRemaining(90)).toBe('≈ 1м 30с')
  })
})
