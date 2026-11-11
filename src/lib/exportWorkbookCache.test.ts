import { describe, expect, it } from 'vitest'
import { pickCacheEvictions, type ExportCacheMeta } from './exportWorkbookCache'

function meta(name: string, size: number, mtime: string): ExportCacheMeta {
  return { name, size, mtime }
}

describe('pickCacheEvictions', () => {
  it('drops the oldest file when the count cap is exceeded', () => {
    const drop = pickCacheEvictions(
      [
        meta('a.xlsx', 10, '2026-01-01T00:00:00.000Z'),
        meta('b.xlsx', 10, '2026-01-02T00:00:00.000Z'),
      ],
      meta('c.xlsx', 10, '2026-01-03T00:00:00.000Z'),
      { maxFiles: 2, maxBytes: 1_000 }
    )
    expect(drop).toEqual(['a.xlsx'])
  })

  it('replaces the same name and does not evict it', () => {
    const drop = pickCacheEvictions(
      [meta('a.xlsx', 10, '2026-01-01T00:00:00.000Z')],
      meta('a.xlsx', 20, '2026-01-02T00:00:00.000Z'),
      { maxFiles: 2, maxBytes: 1_000 }
    )
    expect(drop).toEqual([])
  })

  it('keeps the file just saved even when it alone exceeds the byte cap', () => {
    const drop = pickCacheEvictions(
      [meta('a.xlsx', 10, '2026-01-01T00:00:00.000Z')],
      meta('b.xlsx', 5_000, '2026-01-02T00:00:00.000Z'),
      { maxFiles: 10, maxBytes: 100 }
    )
    expect(drop).toEqual(['a.xlsx'])
  })

  it('stops keeping older files once the byte cap would be exceeded', () => {
    const drop = pickCacheEvictions(
      [
        meta('a.xlsx', 40, '2026-01-01T00:00:00.000Z'),
        meta('b.xlsx', 40, '2026-01-02T00:00:00.000Z'),
      ],
      meta('c.xlsx', 70, '2026-01-03T00:00:00.000Z'),
      { maxFiles: 10, maxBytes: 100 }
    )
    expect(drop).toEqual(['a.xlsx', 'b.xlsx'])
  })
})
