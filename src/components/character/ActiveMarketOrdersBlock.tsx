import { RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ActiveMarketOrderRow, ActiveMarketOrdersData } from '../../lib/eve/activeMarketOrders'
import { formatIsk, formatInteger } from '../../lib/formatNumber'

const EPS_UI = 0.01
const BADGE_BEST = 'bg-[#4ade80] text-black'
const BADGE_UNCUT = 'bg-[#f87171] text-black'
const EVETYPE_HREF = (typeId: number) => `https://everef.net/types/${ typeId }`
type SortKey = 'type' | 'price' | 'status' | 'diff' | 'volume' | 'total' | 'region'
type SortDirection = 'asc' | 'desc'

function formatIskHeader(n: number): string
{
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0'
  const a = Math.abs(n)
  const s = n < 0 ? '−' : ''
  if (a >= 1e9) return `${ s }${ (a / 1e9).toFixed(a >= 100e9 ? 0 : 2) }b`
  if (a >= 1e6)
  {
    const m = a / 1e6
    return `${ s }${ m.toFixed(m >= 100 ? 0 : 1) }m`
  }
  return formatIsk(n)
}

function OrderTable(
  { title, rows }: {
    title: string
    rows: ActiveMarketOrderRow[]
  }
): JSX.Element
{
  const [sortKey, setSortKey] = useState<SortKey>('type')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  const sortedRows = useMemo(() =>
  {
    const dir = sortDirection === 'asc' ? 1 : -1
    const statusScore = (row: ActiveMarketOrderRow): number =>
    {
      if (row.isBest) return 2
      if (row.isUndercut) return 1
      return 0
    }
    const diffValue = (row: ActiveMarketOrderRow): number =>
      row.priceDiff != null && row.priceDiff > EPS_UI ? row.priceDiff : -1

    const sorted = [...rows]
    sorted.sort((a, b) =>
    {
      switch (sortKey)
      {
        case 'type':
          return dir * a.typeName.localeCompare(b.typeName, 'ru', { sensitivity: 'base' })
        case 'price':
          return dir * (a.price - b.price)
        case 'status':
          return dir * (statusScore(a) - statusScore(b))
        case 'diff':
          return dir * (diffValue(a) - diffValue(b))
        case 'volume':
          return dir * (a.volumeTotal - b.volumeTotal || a.volumeDone - b.volumeDone)
        case 'total':
          return dir * (a.lineTotal - b.lineTotal)
        case 'region':
          return dir * a.regionName.localeCompare(b.regionName, 'ru', { sensitivity: 'base' })
        default:
          return 0
      }
    })
    return sorted
  }, [rows, sortDirection, sortKey])

  const toggleSort = (key: SortKey): void =>
  {
    if (sortKey === key)
    {
      setSortDirection((prev) => prev === 'asc' ? 'desc' : 'asc')
      return
    }
    setSortKey(key)
    setSortDirection('desc')
  }

  const sortIndicator = (key: SortKey): string =>
  {
    if (sortKey !== key) return '↕'
    return sortDirection === 'asc' ? '▲' : '▼'
  }

  const sortAria = (key: SortKey): 'ascending' | 'descending' | 'none' =>
  {
    if (sortKey !== key) return 'none'
    return sortDirection === 'asc' ? 'ascending' : 'descending'
  }

  const sortableHeaderClass = 'inline-flex w-full items-center gap-1 whitespace-nowrap hover:text-eve-bright'

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <h4 className="mb-1.5 shrink-0 text-[11px] font-bold uppercase tracking-wider text-eve-bright/90">
        { title }
      </h4>
      { rows.length === 0 ? (
        <p className="shrink-0 text-xs text-eve-muted">Нет активных ордеров.</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded border border-eve-border/40">
          <table className="w-full min-w-[28rem] text-left text-[10px] text-eve-bright/90">
            <thead className="sticky top-0 z-[1] bg-eve-elevated/95 text-eve-muted">
              <tr>
                <th className="px-1.5 py-1.5 pr-0.5 font-semibold" aria-sort={ sortAria('type') }>
                  <button type="button" className={ sortableHeaderClass } onClick={ () => toggleSort('type') }>
                    Тип
                    <span className="text-[9px] text-eve-muted">{ sortIndicator('type') }</span>
                  </button>
                </th>
                <th className="w-[1%] px-1.5 py-1.5 text-right font-semibold whitespace-nowrap" aria-sort={ sortAria('price') }>
                  <button type="button" className={ `justify-end ${ sortableHeaderClass }` } onClick={ () => toggleSort('price') }>
                    Цена
                    <span className="text-[9px] text-eve-muted">{ sortIndicator('price') }</span>
                  </button>
                </th>
                <th className="w-[1%] px-1.5 py-1.5 font-semibold whitespace-nowrap" aria-sort={ sortAria('status') }>
                  <button type="button" className={ sortableHeaderClass } onClick={ () => toggleSort('status') }>
                    Статус
                    <span className="text-[9px] text-eve-muted">{ sortIndicator('status') }</span>
                  </button>
                </th>
                <th className="w-[1%] px-1.5 py-1.5 text-right font-semibold whitespace-nowrap" aria-sort={ sortAria('diff') }>
                  <button type="button" className={ `justify-end ${ sortableHeaderClass }` } onClick={ () => toggleSort('diff') }>
                    Разница
                    <span className="text-[9px] text-eve-muted">{ sortIndicator('diff') }</span>
                  </button>
                </th>
                <th className="w-[1%] px-1.5 py-1.5 text-right font-semibold whitespace-nowrap" aria-sort={ sortAria('volume') }>
                  <button type="button" className={ `justify-end ${ sortableHeaderClass }` } onClick={ () => toggleSort('volume') }>
                    Объём
                    <span className="text-[9px] text-eve-muted">{ sortIndicator('volume') }</span>
                  </button>
                </th>
                <th className="w-[1%] px-1.5 py-1.5 text-right font-semibold whitespace-nowrap" aria-sort={ sortAria('total') }>
                  <button type="button" className={ `justify-end ${ sortableHeaderClass }` } onClick={ () => toggleSort('total') }>
                    Итого
                    <span className="text-[9px] text-eve-muted">{ sortIndicator('total') }</span>
                  </button>
                </th>
                <th className="w-[1%] px-1.5 py-1.5 font-semibold whitespace-nowrap" aria-sort={ sortAria('region') }>
                  <button type="button" className={ sortableHeaderClass } onClick={ () => toggleSort('region') }>
                    Регион
                    <span className="text-[9px] text-eve-muted">{ sortIndicator('region') }</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              { sortedRows.map((r) => (
                <tr
                  key={ r.orderId }
                  className="border-t border-eve-border/25 odd:bg-eve-bg/15"
                >
                  <td className="max-w-[10rem] px-1.5 py-1 pr-0.5">
                    <a
                      href={ EVETYPE_HREF(r.typeId) }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-eve-cyan/95 underline-offset-2 hover:underline"
                    >
                      { r.typeName }
                    </a>
                  </td>
                  <td className="px-1.5 py-1 text-right font-mono tabular-nums whitespace-nowrap">
                    { formatIsk(r.price) }
                    { ' ' }ISK
                  </td>
                  <td className="px-1.5 py-1 whitespace-nowrap">
                    { r.isBest && (
                      <span
                        className={ `inline-block rounded px-1.5 py-0.5 text-[9px] font-bold ${ BADGE_BEST }` }
                      >
                        Лучшая цена
                      </span>
                    ) }
                    { r.isUndercut && (
                      <span
                        className={ `inline-block rounded px-1.5 py-0.5 text-[9px] font-bold ${ BADGE_UNCUT }` }
                      >
                        Перебит
                      </span>
                    ) }
                    { !r.isBest && !r.isUndercut && (
                      <span className="text-eve-muted" title="Нет сравнения с книгой (локация или ESI)">
                        —
                      </span>
                    ) }
                  </td>
                  <td className="px-1.5 py-1 text-right font-mono tabular-nums text-eve-bright/90 whitespace-nowrap">
                    { r.priceDiff != null && r.priceDiff > EPS_UI
                      ? `−${ formatIsk(r.priceDiff) }`
                      : '—' }
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums">
                    { formatInteger(r.volumeDone) }/{ formatInteger(r.volumeTotal) }
                  </td>
                  <td className="px-1.5 py-1 text-right font-mono tabular-nums whitespace-nowrap">
                    { formatIsk(r.lineTotal) }
                  </td>
                  <td className="px-1.5 py-1 text-eve-muted/95 whitespace-nowrap">{ r.regionName }</td>
                </tr>
              )) }
            </tbody>
          </table>
        </div>
      ) }
    </div>
  )
}

type ActiveMarketOrdersBlockProps = {
  data: ActiveMarketOrdersData | null
  errorMessage: string | null
  onRefresh?: () => void
  refreshing?: boolean
}

export function ActiveMarketOrdersBlock(
  { data, errorMessage, onRefresh, refreshing = false }: ActiveMarketOrdersBlockProps
): JSX.Element
{
  const refreshButton = onRefresh && (
    <button
      type="button"
      onClick={ onRefresh }
      disabled={ refreshing }
      className="inline-flex h-7 w-7 items-center justify-center rounded border border-eve-border/80 text-eve-muted shadow-eve-inset transition-colors hover:border-eve-accent/50 hover:text-eve-accent disabled:opacity-50"
      title="Обновить Active Market Orders"
    >
      <RefreshCw
        className={ `h-3.5 w-3.5 ${ refreshing ? 'animate-spin' : '' }` }
      />
    </button>
  )

  if (!data)
  {
    return (
      <div className="rounded border border-eve-border/55 bg-eve-bg/35 p-2.5 shadow-eve-inset">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="eve-section-title">Активные Market Orders</h3>
          { refreshButton }
        </div>
        { errorMessage && (
          <p className="text-xs text-rose-300/90">{ errorMessage }</p>
        ) }
        { !errorMessage && <p className="text-xs text-eve-muted">Нет данных.</p> }
      </div>
    )
  }
  if (data.scopeMissing)
  {
    return (
      <div className="rounded border border-amber-500/35 bg-eve-bg/35 p-2.5 shadow-eve-inset">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="eve-section-title">Активные Market Orders</h3>
          { refreshButton }
        </div>
        <p className="text-xs leading-relaxed text-amber-200/90">
          { data.errorMessage ?? 'Нужен scope рыночных ордеров. Выйдите из сессии и войдите снова, чтобы CCP выдал новые разрешения.' }
        </p>
      </div>
    )
  }
  const sellH = `Ордеров: ${ data.sells.length } · В рынке: ${ formatIskHeader(data.sellTotalExposureIsk) }`
  const buyH = `Ордеров: ${ data.buys.length } · Всего: ${ formatIskHeader(data.buyTotalEscrowIsk) } · Эскроу: ${ formatIskHeader(data.buyTotalEscrowIsk) } · Осталось внести: ${ formatInteger(data.buyRemainingToCover) }`
  return (
    <div className="flex h-[min(92vh,720px)] min-h-0 flex-col rounded border border-eve-border/55 bg-eve-bg/35 p-2.5 shadow-eve-inset">
      <div className="mb-1 flex shrink-0 items-center justify-between gap-2">
        <h3 className="eve-section-title">Активные Market Orders</h3>
        { refreshButton }
      </div>
      { data.errorMessage && !data.scopeMissing && (
        <p className="mb-1.5 shrink-0 text-[10px] text-amber-200/80">{ data.errorMessage }</p>
      ) }
      { errorMessage && (
        <p className="mb-1.5 shrink-0 text-[10px] text-amber-200/80">{ errorMessage }</p>
      ) }
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col gap-1">
          <p className="shrink-0 text-[10px] text-eve-muted/90">{ sellH }</p>
          <OrderTable
            title="Продажа"
            rows={ data.sells }
          />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col gap-1">
          <p className="shrink-0 text-[10px] text-eve-muted/90">{ buyH }</p>
          <OrderTable
            title="Покупка"
            rows={ data.buys }
          />
        </div>
      </div>
    </div>
  )
}
