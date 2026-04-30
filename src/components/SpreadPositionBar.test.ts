import { describe, expect, it } from 'vitest'
import { splitTradesAlongSpread } from './SpreadPositionBar'

describe('splitTradesAlongSpread', () => {
  it('splits evenly at mid spread', () =>
  {
    expect(splitTradesAlongSpread(44, 0.5)).toEqual({ buy: 22, sell: 22 })
  })

  it('returns null when no trades', () =>
  {
    expect(splitTradesAlongSpread(0, 0.5)).toBeNull()
    expect(splitTradesAlongSpread(-1, 0.5)).toBeNull()
  })

  it('all buy when ratio 0', () =>
  {
    expect(splitTradesAlongSpread(10, 0)).toEqual({ buy: 10, sell: 0 })
  })

  it('all sell when ratio 1', () =>
  {
    expect(splitTradesAlongSpread(10, 1)).toEqual({ buy: 0, sell: 10 })
  })

  it('clamps ratio', () =>
  {
    expect(splitTradesAlongSpread(100, -1)).toEqual({ buy: 100, sell: 0 })
    expect(splitTradesAlongSpread(100, 2)).toEqual({ buy: 0, sell: 100 })
  })
})
