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
import {
  HelpCircle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  Store,
} from 'lucide-react'
import { useMemo, useState } from 'react'
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
import {
  formatIsk,
  formatInteger,
  formatPercent,
  formatRatio,
} from '../lib/formatNumber'

const EVE_TYCOON_MARKET = 'https://evetycoon.com/market/'

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
  return x === y ? 0 : x < y ? -1 : 1
}

function formatByKindString(
  val: unknown,
  kind: (typeof COLUMN_DEFS)[number]['kind'],
  colId: ColumnId
): string {
  if (colId === 'name') return String(val ?? '')

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

type MarketTableProps = {
  data: MarketRow[]
  columnFilters: ColumnFiltersState
  onColumnFiltersChange: OnChangeFn<ColumnFiltersState>
  emptyMessage?: string
  /** Выше этой цены за ед. (ISK) снижаем «эквивалентную» маржу в цветах и теплоте строки */
  highPriceThresholdIsk: number
  /** Ключи marketRowCopyKey: название копировали в этой сессии файла */
  copiedNameKeys: ReadonlySet<string>
  onNameCopied: (key: string) => void
}

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

export function MarketTable({
  data,
  columnFilters,
  onColumnFiltersChange,
  emptyMessage = 'Ни одна строка не подходит под фильтры',
  highPriceThresholdIsk,
  copiedNameKeys,
  onNameCopied,
}: MarketTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'entryScore', desc: true },
  ])

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
                <button
                  type="button"
                  className={
                    copied
                      ? 'line-clamp-2 max-w-full text-left text-xs font-semibold text-eve-gold-bright transition-colors hover:underline'
                      : 'line-clamp-2 max-w-full text-left text-xs font-medium text-white transition-colors hover:text-eve-accent hover:underline'
                  }
                  title="Клик — копировать название"
                  onClick={async (e) => {
                    e.stopPropagation()
                    try {
                      await navigator.clipboard.writeText(n)
                      onNameCopied(cKey)
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  {n}
                </button>
              )
            }
            return formatByKindString(v, def.kind, id)
          },
          meta: { description: def.description, kind: def.kind },
        } as ColumnDef<MarketRow>
      }),
    [highPriceThresholdIsk, copiedNameKeys, onNameCopied]
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

  return (
    <div className="h-full w-full overflow-auto rounded border border-eve-border/70 bg-eve-bg/25 shadow-eve-inset">
      <table className="w-full min-w-[1140px] border-separate border-spacing-0 text-left text-sm text-white">
        <thead className="sticky top-0 z-40 bg-eve-elevated/90 text-xs font-semibold uppercase tracking-[0.12em] text-eve-gold/75">
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
                        ? 'w-10 min-w-10 max-w-10 border-b border-eve-accent/25 bg-eve-elevated px-0.5 py-2 text-center align-bottom font-semibold normal-case shadow-[inset_0_-1px_0_rgba(184,150,61,0.25)]'
                        : 'max-w-[14rem] border-b border-eve-accent/25 bg-eve-elevated px-2 py-2 align-bottom font-semibold normal-case shadow-[inset_0_-1px_0_rgba(184,150,61,0.25)]'
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
                return (
                  <th
                    key={col.id}
                    className="border-b border-eve-border bg-eve-elevated p-1"
                  >
                    <input
                      className="w-full min-w-0 rounded border border-eve-border/80 bg-eve-bg/80 px-1.5 py-1 text-xs text-white shadow-eve-inset placeholder:text-eve-muted/60 focus:border-eve-accent/70 focus:outline-none"
                      placeholder="Содержит…"
                      value={getTextValue(col.getFilterValue())}
                      onChange={(e) =>
                        col.setFilterValue(e.target.value || undefined)
                      }
                      aria-label={`Фильтр: ${def.short}`}
                    />
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
                        : 'border-b border-eve-border/60 bg-eve-elevated p-1'
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
          {table.getRowModel().rows.length === 0 ? (
            <tr>
                <td
                colSpan={columns.length}
                className="p-6 text-center text-eve-muted/90"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => {
              return (
              <tr key={row.id} className="group/market-row">
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={
                      cell.column.id === 'typeId'
                        ? 'w-10 min-w-10 max-w-10 border-b border-eve-border/50 px-0.5 py-1.5 text-center text-xs text-white transition-colors duration-200 group-hover/market-row:bg-eve-elevated/75'
                        : cell.column.id === 'name'
                          ? 'max-w-[18rem] border-b border-eve-border/50 px-2 py-1.5 text-xs text-white transition-colors duration-200 group-hover/market-row:bg-eve-elevated/75'
                          : cell.column.id === 'entryScore'
                            ? 'min-w-[8rem] max-w-[10.5rem] border-b border-eve-border/50 px-2 py-1.5 text-xs text-white transition-colors duration-200 group-hover/market-row:bg-eve-elevated/75'
                            : 'border-b border-eve-border/50 px-2 py-1.5 font-tabular-nums text-xs text-white transition-colors duration-200 group-hover/market-row:bg-eve-elevated/75'
                    }
                  >
                    {flexRender(
                      cell.column.columnDef.cell,
                      cell.getContext()
                    )}
                  </td>
                ))}
              </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
