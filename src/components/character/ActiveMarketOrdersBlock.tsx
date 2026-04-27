import type { ActiveMarketOrderRow, ActiveMarketOrdersData } from '../../lib/eve/activeMarketOrders'
import { formatIsk, formatInteger } from '../../lib/formatNumber'

const EPS_UI = 0.01
const BADGE_BEST = 'bg-[#4ade80] text-black'
const BADGE_UNCUT = 'bg-[#f87171] text-black'
const EVETYPE_HREF = (typeId: number) => `https://everef.net/types/${ typeId }`

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
  { title, rows, mode }: {
    title: string
    rows: ActiveMarketOrderRow[]
    mode: 'sell' | 'buy'
  }
): JSX.Element
{
  return (
    <div>
      <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-eve-bright/90">
        { title }
      </h4>
      { rows.length === 0 ? (
        <p className="text-xs text-eve-muted">Нет активных ордеров.</p>
      ) : (
        <div className="max-h-[min(60vh,420px)] overflow-auto rounded border border-eve-border/40">
          <table className="w-full min-w-[28rem] text-left text-[10px] text-eve-bright/90">
            <thead className="sticky top-0 z-[1] bg-eve-elevated/95 text-eve-muted">
              <tr>
                <th className="px-1.5 py-1.5 pr-0.5 font-semibold">Тип</th>
                <th className="w-[1%] px-1.5 py-1.5 text-right font-semibold whitespace-nowrap">Цена</th>
                <th className="w-[1%] px-1.5 py-1.5 font-semibold whitespace-nowrap">Статус</th>
                <th className="w-[1%] px-1.5 py-1.5 text-right font-semibold whitespace-nowrap">Разница</th>
                <th className="w-[1%] px-1.5 py-1.5 text-right font-semibold whitespace-nowrap">Объём</th>
                <th className="w-[1%] px-1.5 py-1.5 text-right font-semibold whitespace-nowrap">Итого</th>
                { mode === 'buy' && (
                  <>
                    <th className="w-[1%] px-1.5 py-1.5 font-semibold whitespace-nowrap">Радиус</th>
                    <th className="w-[1%] px-1.5 py-1.5 text-right font-semibold whitespace-nowrap">Мин. объём</th>
                  </>
                ) }
                <th className="w-[1%] px-1.5 py-1.5 font-semibold whitespace-nowrap">Владелец</th>
                <th className="w-[1%] px-1.5 py-1.5 font-semibold whitespace-nowrap">Истекает</th>
                { mode === 'buy' && (
                  <th className="w-[1%] px-1.5 py-1.5 text-right font-semibold whitespace-nowrap">Эскроу</th>
                ) }
                <th className="px-1.5 py-1.5 font-semibold">Станция</th>
                <th className="w-[1%] px-1.5 py-1.5 font-semibold whitespace-nowrap">Регион</th>
              </tr>
            </thead>
            <tbody>
              { rows.map((r) => (
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
                  <td className="px-1.5 py-1">
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
                  <td className="px-1.5 py-1 text-right font-mono tabular-nums text-eve-bright/90">
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
                  { mode === 'buy' && (
                    <>
                      <td className="px-1.5 py-1 text-eve-muted/95">{ r.rangeLabel ?? '—' }</td>
                      <td className="px-1.5 py-1 text-right tabular-nums">
                        { r.minVolume != null ? formatInteger(r.minVolume) : '—' }
                      </td>
                    </>
                  ) }
                  <td className="px-1.5 py-1 text-eve-muted/95">{ r.ownerLabel }</td>
                  <td className="px-1.5 py-1 font-mono text-[9px] text-eve-muted/95 whitespace-nowrap">
                    { r.expiresLabel }
                  </td>
                  { mode === 'buy' && (
                    <td className="px-1.5 py-1 text-right font-mono tabular-nums text-eve-bright/90">
                      { r.escrowRemaining != null ? formatIsk(r.escrowRemaining) : '—' }
                    </td>
                  ) }
                  <td className="max-w-[9rem] truncate px-1.5 py-1" title={ r.stationLabel }>
                    { r.stationLabel }
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
}

export function ActiveMarketOrdersBlock(
  { data, errorMessage }: ActiveMarketOrdersBlockProps
): JSX.Element
{
  if (!data)
  {
    return (
      <div className="rounded border border-eve-border/55 bg-eve-bg/35 p-2.5 shadow-eve-inset">
        <h3 className="eve-section-title mb-1">Активные Market Orders</h3>
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
        <h3 className="eve-section-title mb-1">Активные Market Orders</h3>
        <p className="text-xs leading-relaxed text-amber-200/90">
          { data.errorMessage ?? 'Нужен scope рыночных ордеров. Выйдите из сессии и войдите снова, чтобы CCP выдал новые разрешения.' }
        </p>
      </div>
    )
  }
  const sellH = `Ордеров: ${ data.sells.length } · В рынке: ${ formatIskHeader(data.sellTotalExposureIsk) }`
  const buyH = `Ордеров: ${ data.buys.length } · Всего: ${ formatIskHeader(data.buyTotalEscrowIsk) } · Эскроу: ${ formatIskHeader(data.buyTotalEscrowIsk) } · Осталось внести: ${ formatInteger(data.buyRemainingToCover) }`
  return (
    <div className="flex max-h-[min(92vh,720px)] flex-col rounded border border-eve-border/55 bg-eve-bg/35 p-2.5 shadow-eve-inset">
      <h3 className="eve-section-title mb-1 shrink-0">Активные Market Orders</h3>
      { data.errorMessage && !data.scopeMissing && (
        <p className="mb-1.5 text-[10px] text-amber-200/80">{ data.errorMessage }</p>
      ) }
      { errorMessage && (
        <p className="mb-1.5 text-[10px] text-amber-200/80">{ errorMessage }</p>
      ) }
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
        <div>
          <p className="mb-1 text-[10px] text-eve-muted/90">{ sellH }</p>
          <OrderTable
            title="Продажа"
            mode="sell"
            rows={ data.sells }
          />
        </div>
        <div>
          <p className="mb-1 text-[10px] text-eve-muted/90">{ buyH }</p>
          <OrderTable
            title="Покупка"
            mode="buy"
            rows={ data.buys }
          />
        </div>
      </div>
    </div>
  )
}
