import { describe, expect, it } from 'vitest'
import { nudgeByWheel, getFilterColumnWheelStep } from './numberInputWheel'

describe('nudgeByWheel', () => {
  it('steps margin in filter by 0,1 (процентный пункт)', () => {
    expect(nudgeByWheel(5, 1, 0.1, {})).toBeCloseTo(5.1, 5)
  })
  it('clamps buyToSell 0-100 in %', () => {
    expect(nudgeByWheel(99, 1, 1, { min: 0, max: 100 })).toBe(100)
    expect(nudgeByWheel(1, -1, 1, { min: 0, max: 100 })).toBe(0)
  })
})

describe('getFilterColumnWheelStep', () => {
  it('gives 1M for ISK columns', () => {
    expect(getFilterColumnWheelStep('dayTurnover')).toBe(1_000_000)
  })
})
