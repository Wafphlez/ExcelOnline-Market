import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type OnChangeFn,
  type SortingFn,
  type SortingState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  HelpCircle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  Store,
  Check,
  AlertCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MarketRow } from '../types/market'
import { COLUMN_DEFS, type ColumnId, COLUMN_DEF_BY_ID } from '../lib/columnLabels'
import {
  numberRangeFilter,
  ratioValueAsPercentRangeFilter,
  textFilter,
  type NumberRange,
} from '../lib/filterFns'
import { marginPercentCellStyle } from '../lib/rowHeatmap'
import { NumberRangeFilterInputs } from './NumberRangeFilterInputs'
import { EntryScoreFillBar } from './EntryScoreFillBar'
import { SpreadPositionBar } from './SpreadPositionBar'
import { marketRowCopyKey } from '../lib/rowCopyKey'
import { typeIconUrl } from '../lib/eve/constants'
import {
  formatIsk,
  formatInteger,
  formatPercent,
  formatRatio,
  formatVolumeM3,
} from '../lib/formatNumber'

const EVE_TYCOON_MARKET = 'https://evetycoon.com/market/'

/** Длинные datalist из тысяч имён сильно тормозят DOM; подсказки достаточно ограничить. */
const DATALIST_SUGGESTION_CAP = 120

const MARKET_ROW_ESTIMATE_PX = 46

function TypeIcon({ typeId }: Readonly<{ typeId: number | null }>) {
  const [failed, setFailed] = useState(false)
  const validTypeId =
    typeof typeId === 'number' &&
    Number.isFinite(typeId) &&
    Number.isInteger(typeId) &&
    typeId > 0
      ? typeId
      : null
  if (validTypeId == null || failed) {
    return (
      <span
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-eve-border/60 bg-eve-bg/55 text-[10px] text-eve-muted/70"
        title="Иконка недоступна"
        aria-hidden
      >
        —
      </span>
    )
  }
  return (
    <img
      src={typeIconUrl(validTypeId, 64)}
      alt=""
      loading="lazy"
      width={32}
      height={32}
      className="h-8 w-8 shrink-0 rounded border border-eve-border/55 bg-eve-bg/55 object-cover"
      onError={() => setFailed(true)}
    />
  )
}

const nameSort: SortingFn<MarketRow> = (rowA, rowB, columnId) =>
  String(rowA.getValue(columnId) ?? '').localeCompare(
    String(rowB.getValue(columnId) ?? ''),
    'ru'
  )

const numberSort: SortingFn<MarketRow> = (rowA, rowB, columnId) => {
  const x = rowA.getValue(columnId) as number | null
  const y = rowB.getValue(columnId) as number | null
  if (x === null && y === null) return 0
  if (x === null) return 1
  if (y === null) return -1
  if (x === y) return 0
  if (x < y) return -1
  return 1
}

function formatByKindString(
  val: unknown,
  kind: (typeof COLUMN_DEFS)[number]['kind'],
  colId: ColumnId
): string {
  if (colId === 'name') return String(val ?? '')
  if (colId === 'packagedVolume') {
    const n = typeof val === 'number' ? val : null
    return formatVolumeM3(n)
  }

  const n = typeof val === 'number' ? val : null
  switch (kind) {
    case 'text':
      return String(val ?? '')
    case 'int':
      return formatInteger(n)
    case 'isk':
      return formatIsk(n)
    case 'percent':
      return formatPercent(n)
    case 'ratio':
      return formatRatio(n)
    case 'score':
      return formatInteger(n)
    case 'spreadBar':
    case 'market':
      return '—'
    default:
      return String(val ?? '—')
  }
}

type MarketTableProps = Readonly<{
  data: MarketRow[]
  columnFilters: ColumnFiltersState
  onColumnFiltersChange: OnChangeFn<ColumnFiltersState>
  emptyMessage?: string
  /** Выше этой цены за ед. (ISK) снижаем «эквивалентную» маржу в цветах и теплоте строки */
  highPriceThresholdIsk: number
  /** Ключи marketRowCopyKey: название копировали в этой сессии файла */
  copiedNameKeys: ReadonlySet<string>
  onNameCopied: (key: string) => void
  /** Переопределение заголовка колонки priceSell (например для межрегионального сравнения) */
  priceSellHeader?: string | null
  /** Переопределение заголовка колонки priceBuy (например для межрегионального сравнения) */
  priceBuyHeader?: string | null
}>

const emptyText = ''
const emptyRange: NumberRange = { min: null, max: null }

function getTextValue(v: unknown): string {
  if (v === undefined || v === null) return emptyText
  return String(v)
}

function getRangeValue(v: unknown): NumberRange {
  if (!v || typeof v !== 'object') return { ...emptyRange }
  const o = v as Record<string, unknown>
  return {
    min: typeof o.min === 'number' ? o.min : null,
    max: typeof o.max === 'number' ? o.max : null,
  }
}

function marketRowDataCellClass(columnId: string): string {
  const heat =
    'border-b border-eve-border/50 text-xs text-white transition-colors duration-200 group-hover/market-row:bg-eve-elevated/75'
  if (columnId === 'typeId') {
    return `w-10 min-w-10 max-w-10 ${heat} px-0.5 py-1.5 text-center`
  }
  if (columnId === 'name') {
    return `max-w-[18rem] ${heat} px-2 py-1.5`
  }
  if (columnId === 'entryScore') {
    return `min-w-[8rem] max-w-[10.5rem] ${heat} px-2 py-1.5`
  }
  return `${heat} px-2 py-1.5 font-tabular-nums`
}

export function MarketTable({
  data,
  columnFilters,
  onColumnFiltersChange,
  emptyMessage = 'Ни одна строка не подходит под фильтры',
  highPriceThresholdIsk,
  copiedNameKeys,
  onNameCopied,
  priceSellHeader = null,
  priceBuyHeader = null,
}: MarketTableProps) {
  const [copyToast, setCopyToast] = useState<
    null | { text: string; variant: 'success' | 'error' }
  >(null)
  const copyToastTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(
    null,
  )

  useEffect(() =>
  {
    return () =>
    {
      if (copyToastTimerRef.current != null)
        globalThis.clearTimeout(copyToastTimerRef.current)
    }
  }, [])

  const flashCopyToast = useCallback((text: string, variant: 'success' | 'error') =>
  {
    if (copyToastTimerRef.current != null)
      globalThis.clearTimeout(copyToastTimerRef.current)
    setCopyToast({ text, variant })
    copyToastTimerRef.current = globalThis.setTimeout(() =>
    {
      setCopyToast(null)
      copyToastTimerRef.current = null
    }, 2200)
  }, [])

  const [sorting, setSorting] = useState<SortingState>([
    { id: 'entryScore', desc: true },
  ])
  const nameFilterSuggestions = useMemo(() =>
  {
    const arr = Array.from(
      new Set(
        data
          .map((row) => row.name.trim())
          .filter((value) => value.length > 0)
      )
    ).sort((a, b) => a.localeCompare(b, 'ru'))
    return arr.length <= DATALIST_SUGGESTION_CAP
      ? arr
      : arr.slice(0, DATALIST_SUGGESTION_CAP)
  }, [data])
  const typeFilterSuggestions = useMemo(() =>
  {
    const arr = Array.from(
      new Set(
        data
          .map((row) => row.type.trim())
          .filter((value) => value.length > 0)
      )
    ).sort((a, b) => a.localeCompare(b, 'en'))
    return arr.length <= DATALIST_SUGGESTION_CAP
      ? arr
      : arr.slice(0, DATALIST_SUGGESTION_CAP)
  }, [data])

  const columns = useMemo<ColumnDef<MarketRow>[]>(
    () =>
      COLUMN_DEFS.map((def) => {
        const id = def.id
        const isText = def.kind === 'text'
        const filterAsPercentOfRatio =
          id === 'margin' || id === 'buyToSellRatio'
        return {
          id,
          accessorKey: id,
          enableSorting: def.kind !== 'market',
          header:
            def.kind === 'market'
              ? () => (
                  <span
                    className="inline-flex items-center justify-center"
                    title={def.description}
                  >
                    <ExternalLink
                      className="h-4 w-4 text-eve-gold"
                      aria-hidden
                    />
                    <span className="sr-only">{def.short} — {def.description}</span>
                  </span>
                )
              : id === 'priceSell' && priceSellHeader
                ? priceSellHeader
                : id === 'priceBuy' && priceBuyHeader
                  ? priceBuyHeader
                  : def.short,
          filterFn: isText
            ? textFilter
            : filterAsPercentOfRatio
              ? ratioValueAsPercentRangeFilter
              : numberRangeFilter,
          sortingFn: isText ? nameSort : numberSort,
          cell: (ctx) => {
            const v = ctx.getValue()
            if (id === 'buyToSellRatio') {
              return (
                <SpreadPositionBar
                  ratio={typeof v === 'number' ? v : null}
                  tradeCount={ctx.row.original.dayVolume}
                />
              )
            }
            if (id === 'margin') {
              const m = typeof v === 'number' ? v : null
              const s = formatByKindString(v, def.kind, id)
              const st = marginPercentCellStyle(
                m,
                ctx.row.original.price,
                highPriceThresholdIsk
              )
              return (
                <span
                  className="block min-w-[3.5rem] rounded px-1.5 py-0.5 text-center text-xs font-medium tabular-nums"
                  style={st}
                >
                  {s}
                </span>
              )
            }
            if (id === 'entryScore') {
              return (
                <EntryScoreFillBar
                  score={typeof v === 'number' ? v : null}
                />
              )
            }
            if (id === 'typeId') {
              const tid = typeof v === 'number' ? v : null
              if (tid === null || !Number.isFinite(tid) || tid <= 0) {
                return (
                  <span className="text-eve-muted" title="Нет type id в колонках">
                    —
                  </span>
                )
              }
              const href = `${EVE_TYCOON_MARKET}${Math.floor(tid)}`
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex rounded p-0.5 text-eve-cyan/90 transition-colors hover:text-white focus:outline-none focus:ring-1 focus:ring-eve-accent/60"
                  title={`EVE Tycoon: type ${Math.floor(tid)}`}
                  aria-label={`Открыть type ${Math.floor(tid)} на EVE Tycoon`}
                >
                  <ExternalLink className="h-4 w-4" aria-hidden />
                </a>
              )
            }
            if (id === 'name') {
              const o = ctx.row.original
              const n = String(v ?? '')
              const cKey = marketRowCopyKey(o)
              const copied = copiedNameKeys.has(cKey)
              return (
                <div className="flex min-w-0 items-start gap-2">
                  <TypeIcon typeId={o.typeId} />
                  <button
                    type="button"
                    className={
                      copied
                        ? 'line-clamp-2 max-w-full text-left text-xs font-semibold text-eve-gold-bright underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current'
                        : 'line-clamp-2 max-w-full text-left text-xs font-medium text-white underline decoration-transparent underline-offset-2 transition-colors hover:text-eve-accent hover:decoration-current'
                    }
                    title={
                      copied
                        ? 'Название скопировано (ещё раз — копировать снова)'
                        : 'Клик — копировать название'
                    }
                    onClick={async (e) => {
                      e.stopPropagation()
                      try {
                        await navigator.clipboard.writeText(n)
                        onNameCopied(cKey)
                        flashCopyToast('Скопировано в буфер обмена', 'success')
                      } catch {
                        flashCopyToast(
                          'Не удалось скопировать (разрешите доступ к буферу)',
                          'error'
                        )
                      }
                    }}
                  >
                    {n}
                  </button>
                </div>
              )
            }
            if (id === 'type') {
              const typeText = String(v ?? '').trim()
              if (typeText === '') {
                return <span className="text-eve-muted">—</span>
              }
              return (
                <button
                  type="button"
                  className="line-clamp-2 max-w-full text-left text-xs font-medium text-eve-bright/95 underline decoration-transparent underline-offset-2 transition-colors hover:text-eve-accent hover:decoration-current"
                  title="Клик — подставить в фильтр типа"
                  onClick={(e) => {
                    e.stopPropagation()
                    ctx.table.getColumn('type')?.setFilterValue(typeText)
                  }}
                >
                  {typeText}
                </button>
              )
            }
            return formatByKindString(v, def.kind, id)
          },
          meta: { description: def.description, kind: def.kind },
        } as ColumnDef<MarketRow>
      }),
    [highPriceThresholdIsk, copiedNameKeys, onNameCopied, priceSellHeader, priceBuyHeader, flashCopyToast]
  )

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const scrollParentRef = useRef<HTMLDivElement>(null)
  const rows = table.getRowModel().rows
  const leafColumnCount = table.getVisibleLeafColumns().length

  const rowVirtualizer = useVirtualizer<
    HTMLDivElement,
    HTMLTableRowElement
  >({
    count: rows.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => MARKET_ROW_ESTIMATE_PX,
    overscan: 14,
  })

  const virtualRows = rowVirtualizer.getVirtualItems()
  const padTop =
    virtualRows.length > 0 ? virtualRows[0]?.start ?? 0 : 0
  const padBot =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize()
        - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0

  return (
    <>
      {copyToast ? (
        <div
          role="status"
          aria-live="polite"
          className={
            copyToast.variant === 'success'
              ? 'pointer-events-none fixed bottom-6 left-1/2 z-[100] flex max-w-[min(92vw,22rem)] -translate-x-1/2 items-center gap-2 rounded-md border border-eve-accent/45 bg-eve-elevated/95 px-4 py-2.5 text-sm font-medium text-eve-gold-bright shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-sm'
              : 'pointer-events-none fixed bottom-6 left-1/2 z-[100] flex max-w-[min(92vw,22rem)] -translate-x-1/2 items-center gap-2 rounded-md border border-eve-danger/55 bg-eve-elevated/95 px-4 py-2.5 text-sm font-medium text-eve-danger shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-sm'
          }
        >
          {copyToast.variant === 'success' ? (
            <Check className="h-4 w-4 shrink-0 text-eve-accent" aria-hidden />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          )}
          <span>{copyToast.text}</span>
        </div>
      ) : null}
      <div
        ref={scrollParentRef}
        className="glass-panel h-full w-full overflow-auto"
      >
        <table className="w-full min-w-[1140px] border-separate border-spacing-0 text-left text-sm text-white">
        <thead className="sticky top-0 z-40 bg-eve-elevated/88 text-xs font-semibold uppercase tracking-[0.12em] text-eve-gold/80 backdrop-blur-[6px]">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const canSort = h.column.getCanSort()
                const desc = h.column.columnDef.meta as
                  | { description?: string }
                  | undefined
                const isMarketCol = h.column.id === 'typeId'
                return (
                  <th
                    key={h.id}
                    className={
                      isMarketCol
                        ? 'w-10 min-w-10 max-w-10 border-b border-eve-accent/24 bg-eve-elevated/95 px-0.5 py-2 text-center align-bottom font-semibold normal-case shadow-[inset_0_-1px_0_rgba(120,188,255,0.2)]'
                        : 'max-w-[14rem] border-b border-eve-accent/24 bg-eve-elevated/95 px-2 py-2 align-bottom font-semibold normal-case shadow-[inset_0_-1px_0_rgba(120,188,255,0.2)]'
                    }
                  >
                    <div
                      className={
                        isMarketCol
                          ? 'flex items-center justify-center gap-0.5'
                          : 'flex items-start gap-1'
                      }
                    >
                      {canSort ? (
                        <button
                          type="button"
                          className={
                            isMarketCol
                              ? 'inline-flex items-center justify-center gap-0.5 text-white hover:text-eve-gold-bright'
                              : 'flex min-w-0 flex-1 items-center gap-1 text-left text-white hover:text-eve-gold-bright'
                          }
                          onClick={h.column.getToggleSortingHandler()}
                        >
                          <span className="line-clamp-2 leading-tight">
                            {flexRender(
                              h.column.columnDef.header,
                              h.getContext()
                            )}
                          </span>
                          {h.column.getIsSorted() === 'asc' ? (
                            <ArrowUp className="h-3.5 w-3.5 shrink-0 text-eve-accent" />
                          ) : h.column.getIsSorted() === 'desc' ? (
                            <ArrowDown className="h-3.5 w-3.5 shrink-0 text-eve-accent" />
                          ) : (
                            <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-eve-muted/50" />
                          )}
                        </button>
                      ) : (
                        <span className="line-clamp-2">
                          {flexRender(
                            h.column.columnDef.header,
                            h.getContext()
                          )}
                        </span>
                      )}
                      {desc?.description && !isMarketCol ? (
                        <span
                          className="shrink-0 text-eve-muted"
                          title={desc.description}
                        >
                          <HelpCircle className="h-3.5 w-3.5" aria-hidden />
                          <span className="sr-only">{desc.description}</span>
                        </span>
                      ) : null}
                    </div>
                  </th>
                )
              })}
            </tr>
          ))}
          <tr>
            {table.getAllLeafColumns().map((col) => {
              const def = COLUMN_DEF_BY_ID[col.id as ColumnId]
              const filterThNarrow = col.id === 'typeId'
              if (def.kind === 'market') {
                return (
                  <th
                    key={col.id}
                    className="w-10 min-w-10 max-w-10 border-b border-eve-border/60 bg-eve-elevated p-0.5"
                  >
                    <div className="flex items-center justify-center py-1">
                      <Store
                        className="h-4 w-4 text-eve-gold/65"
                        aria-hidden
                      />
                    </div>
                  </th>
                )
              }
              if (def.kind === 'text') {
                const isNameTextFilter = col.id === 'name'
                const isTypeTextFilter = col.id === 'type'
                return (
                  <th
                    key={col.id}
                    className="border-b border-eve-border bg-eve-elevated p-1"
                  >
                    <input
                      className="w-full min-w-0 rounded-md border border-eve-border/75 bg-eve-surface/65 px-1.5 py-1 text-xs text-white shadow-glass-subtle placeholder:text-eve-muted/60 focus:border-eve-accent/70 focus:outline-none"
                      placeholder={
                        isTypeTextFilter
                          ? 'Введите тип (напр. shi)…'
                          : isNameTextFilter
                            ? 'Введите название…'
                          : 'Содержит…'
                      }
                      value={getTextValue(col.getFilterValue())}
                      onChange={(e) =>
                        col.setFilterValue(e.target.value || undefined)
                      }
                      aria-label={`Фильтр: ${def.short}`}
                      list={
                        isTypeTextFilter
                          ? 'type-filter-suggestions'
                          : isNameTextFilter
                            ? 'name-filter-suggestions'
                            : undefined
                      }
                    />
                    {isNameTextFilter ? (
                      <datalist id="name-filter-suggestions">
                        {nameFilterSuggestions.map((value) => (
                          <option key={value} value={value} />
                        ))}
                      </datalist>
                    ) : null}
                    {isTypeTextFilter ? (
                      <datalist id="type-filter-suggestions">
                        {typeFilterSuggestions.map((value) => (
                          <option key={value} value={value} />
                        ))}
                      </datalist>
                    ) : null}
                  </th>
                )
              }
                const r = getRangeValue(col.getFilterValue())
                const isMargin = col.id === 'margin'
                const isSpreadAxis = col.id === 'buyToSellRatio'
                return (
                  <th
                    key={col.id}
                    className={
                      filterThNarrow
                        ? 'w-10 min-w-10 max-w-10 border-b border-eve-border/60 bg-eve-elevated p-0.5'
                        : 'border-b border-eve-border/60 bg-eve-elevated/92 p-1'
                    }
                  >
                    <NumberRangeFilterInputs
                      columnId={col.id as ColumnId}
                      range={r}
                      onRangeChange={(next) => {
                        col.setFilterValue(next)
                      }}
                      isMargin={isMargin}
                      isSpreadAxis={isSpreadAxis}
                      ariaLabelFrom={`${def.short} от`}
                      ariaLabelTo={`${def.short} до`}
                    />
                  </th>
                )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={leafColumnCount}
                className="p-6 text-center text-eve-muted/90"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            <>
              {padTop > 0 ? (
                <tr className="pointer-events-none">
                  <td
                    colSpan={leafColumnCount}
                    style={{
                      height: padTop,
                      padding: 0,
                      border: 'none',
                      lineHeight: 0,
                    }}
                  />
                </tr>
              ) : null}
              {virtualRows.map((vr) =>
              {
                const row = rows[vr.index]
                if (!row) return null
                return (
                  <tr
                    key={row.id}
                    ref={rowVirtualizer.measureElement}
                    data-index={vr.index}
                    className="group/market-row"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={marketRowDataCellClass(cell.column.id)}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </td>
                    ))}
                  </tr>
                )
              })}
              {padBot > 0 ? (
                <tr className="pointer-events-none">
                  <td
                    colSpan={leafColumnCount}
                    style={{
                      height: padBot,
                      padding: 0,
                      border: 'none',
                      lineHeight: 0,
                    }}
                  />
                </tr>
              ) : null}
            </>
          )}
        </tbody>
        </table>
      </div>
    </>
  )
}
