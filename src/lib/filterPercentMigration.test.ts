import { describe, expect, it } from 'vitest'
import { ratioValueAsPercentRangeFilter } from './filterFns'
import { migrateColumnFiltersRatioToPercent } from './filterPercentMigration'

describe('migrateColumnFiltersRatioToPercent', () => {
  it('converts 0.05 to 5', () => {
    const next = migrateColumnFiltersRatioToPercent([
      { id: 'margin', value: { min: 0.05, max: null } },
    ])
    expect(next[0].value).toEqual({ min: 5, max: null })
  })
})

describe('ratioValueAsPercentRangeFilter', () => {
  const mockRow = (margin: number) =>
    ({ getValue: (id: string) => (id === 'margin' ? margin : null) }) as Parameters<
      typeof ratioValueAsPercentRangeFilter
    >[0]

  it('compares cell ratio to filter in percent', () => {
    const filter = { min: 5, max: null }
    expect(
      ratioValueAsPercentRangeFilter(
        mockRow(0.07),
        'margin',
        filter,
        () => undefined
      )
    ).toBe(true)
    expect(
      ratioValueAsPercentRangeFilter(
        mockRow(0.03),
        'margin',
        filter,
        () => undefined
      )
    ).toBe(false)
  })
})
