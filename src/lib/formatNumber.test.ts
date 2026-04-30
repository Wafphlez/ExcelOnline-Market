import { describe, expect, it } from 'vitest'
import {
  formatCompactKmb,
  formatFilterNumberDisplay,
  formatIsk,
  formatIskMillionsShort,
  formatPercent,
  normalizeFilterNumberValue,
  formatWithSpaces,
  parseNumberInput,
} from './formatNumber'

describe('formatFilterNumberDisplay', () => {
  it('formats int / ISK filters as whole numbers', () => {
    expect(formatFilterNumberDisplay(1_000_000_000, 'dayTurnover')).toBe(
      '1 000 000 000'
    )
    expect(formatFilterNumberDisplay(20000, 'dayVolume')).toBe('20 000')
  })
  it('formats margin and spread in percent (0–100) for filter fields', () => {
    expect(formatFilterNumberDisplay(5, 'margin')).toBe('5,00') // 5 % 
    expect(formatFilterNumberDisplay(50, 'buyToSellRatio')).toBe('50') // 50 % оси
  })
})

describe('normalizeFilterNumberValue', () => {
  it('rounds non-decimal filter columns to integer', () => {
    expect(normalizeFilterNumberValue(1.7, 'dayVolume')).toBe(2)
    expect(normalizeFilterNumberValue(1.2e9, 'dayTurnover')).toBe(1_200_000_000)
  })
  it('normalizes margin % and spread 0..100', () => {
    expect(normalizeFilterNumberValue(5.128, 'margin')).toBe(5.13)
    expect(normalizeFilterNumberValue(50.3, 'buyToSellRatio')).toBe(50)
    expect(normalizeFilterNumberValue(150, 'buyToSellRatio')).toBe(100)
    expect(normalizeFilterNumberValue(-0.1, 'buyToSellRatio')).toBe(0)
  })
})

describe('formatWithSpaces', () => {
  it('adds space thousands separator', () => {
    expect(formatWithSpaces(1234567.89, 2)).toBe('1 234 567,89')
  })
  it('returns em dash for null', () => {
    expect(formatWithSpaces(null, 0)).toBe('—')
  })
})

describe('formatPercent', () => {
  it('multiplies by 100', () => {
    expect(formatPercent(0.03125, 2)).toBe('3,13 %')
  })
})

describe('formatIsk', () => {
  it('uses two fraction digits for values up to 3 integer digits', () => {
    expect(formatIsk(999)).toBe('999,00')
    expect(formatIsk(637.1)).toBe('637,10')
  })
  it('hides fraction digits for values with 4+ integer digits', () => {
    expect(formatIsk(7_925)).toBe('7 925')
    expect(formatIsk(11_520_000)).toBe('11 520 000')
  })
})

describe('formatCompactKmb', () => {
  it('leaves values under 1000 as integers', () => {
    expect(formatCompactKmb(71)).toBe('71')
    expect(formatCompactKmb(999)).toBe('999')
  })
  it('uses K with comma decimals', () => {
    expect(formatCompactKmb(1000)).toBe('1K')
    expect(formatCompactKmb(1500)).toBe('1,5K')
    expect(formatCompactKmb(12_340)).toBe('12,34K')
  })
  it('uses M and B', () => {
    expect(formatCompactKmb(1_000_000)).toBe('1M')
    expect(formatCompactKmb(2_500_000)).toBe('2,5M')
    expect(formatCompactKmb(3_000_000_000)).toBe('3B')
  })
})

describe('formatIskMillionsShort', () => {
  it('prints millions with m suffix', () => {
    expect(formatIskMillionsShort(650_000_000)).toBe('650m')
    expect(formatIskMillionsShort(89_900_000)).toBe('89.9m')
  })
  it('handles negative', () => {
    expect(formatIskMillionsShort(-10_200_000)).toBe('−10.2m')
  })
})

describe('parseNumberInput', () => {
  it('strips spaces and uses comma as decimal', () => {
    expect(parseNumberInput('1 234,5')).toBe(1234.5)
  })
  it('returns null for empty', () => {
    expect(parseNumberInput('  ')).toBeNull()
  })
  it('parses decimal fractions', () => {
    expect(parseNumberInput('0.05')).toBe(0.05)
    expect(parseNumberInput('0,05')).toBe(0.05)
  })
})
