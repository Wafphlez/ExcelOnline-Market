import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HIGH_PRICE_THRESHOLD_ISK,
  pricePenaltyFactor,
} from './pricePenalty'

describe('pricePenaltyFactor', () => {
  it('is 1 at or below threshold', () => {
    expect(pricePenaltyFactor(100, DEFAULT_HIGH_PRICE_THRESHOLD_ISK)).toBe(1)
    expect(
      pricePenaltyFactor(DEFAULT_HIGH_PRICE_THRESHOLD_ISK, DEFAULT_HIGH_PRICE_THRESHOLD_ISK)
    ).toBe(1)
  })
  it('reduces above threshold', () => {
    const f = pricePenaltyFactor(
      DEFAULT_HIGH_PRICE_THRESHOLD_ISK * 2,
      DEFAULT_HIGH_PRICE_THRESHOLD_ISK
    )
    expect(f).toBe(0.5)
  })
})
