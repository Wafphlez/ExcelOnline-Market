import { formatCompactKmb, formatRatio } from '../lib/formatNumber'

type Props = Readonly<{
  ratio: number | null
  /** Сделок за период (шт.) — для разбиения по сторонам спреда */
  tradeCount: number
}>

const SCAN = {
  h: 'repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(0,0,0,0.22) 1px, rgba(0,0,0,0.22) 2px)',
} as const

const TRACK =
  'linear-gradient(90deg, rgb(var(--eve-red-rgb) / 0.82) 0%, rgba(12, 14, 20, 0.98) 50%, rgb(var(--eve-green-rgb) / 0.9) 100%)'

/**
 * Дробит число сделок по оси спреда: ближе к sell → больше «sell»-шт.
 * Сумма всегда равна total (после округления total).
 */
export function splitTradesAlongSpread(
  totalRaw: number,
  ratioTowardsSell: number
): { buy: number; sell: number } | null
{
  if (Number.isFinite(totalRaw) && totalRaw > 0)
  {
    const total = Math.max(0, Math.round(totalRaw))
    if (total <= 0) return null
    const r = Math.max(0, Math.min(1, ratioTowardsSell))
    const sell = Math.round(total * r)
    const buy = total - sell
    return { buy, sell }
  }
  return null
}

/**
 * Ось: 0 = buy, 0,5 = mid, 1 = sell. В стиле EVE: золотая кромка, зоны buy/sell,
 * линия mid, маркер «средняя в спреде».
 */
export function SpreadPositionBar({ ratio, tradeCount }: Props) {
  if (ratio === null || !Number.isFinite(ratio)) {
    return <span className="text-eve-muted">—</span>
  }
  const t = Math.max(0, Math.min(1, ratio))
  const leftPct = t * 100
  const split = splitTradesAlongSpread(tradeCount, t)
  let axisPositionHint: string
  if (t < 0.5) axisPositionHint = 'левее центра'
  else if (t > 0.5) axisPositionHint = 'правее центра'
  else axisPositionHint = 'в центре'

  return (
    <div className="w-full min-w-[140px] max-w-[220px]">
      <div
        className="relative rounded-sm border border-eve-gold/40 bg-eve-bg/95 p-px shadow-[0_0_0_1px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.06)]"
        title={
          split
            ? `Средняя в спреде: ${formatRatio(t, 3)} (0 = buy…1 = sell). Условное разбиение ${split.buy} buy / ${split.sell} sell из ${split.buy + split.sell} сделок.`
            : `Средняя в спреде: ${formatRatio(t, 3)} (0 = buy, 0,5 = mid, 1 = sell)`
        }
        role="img"
        aria-label={
          split
            ? `Позиция средней в спреде: ${formatRatio(t, 3)}. Условно у buy ${split.buy} сделок, у sell ${split.sell}.`
            : `Позиция средней в спреде: ${formatRatio(t, 3)}. Центр оси 0,5, ${axisPositionHint}.`
        }
      >
        <div className="relative h-8 w-full overflow-hidden rounded-sm border border-eve-border/70 bg-eve-elevated">
          <div
            className="absolute inset-0"
            style={{ background: TRACK }}
          />
          <div
            className="pointer-events-none absolute inset-0 opacity-35 mix-blend-overlay"
            style={{ backgroundImage: SCAN.h }}
          />
          <div
            className="pointer-events-none absolute inset-0 opacity-20"
            style={{
              background:
                'repeating-linear-gradient(90deg, transparent, transparent 4px, rgba(0,0,0,0.18) 4px, rgba(0,0,0,0.18) 5px)',
            }}
          />
          <div
            className="absolute bottom-0 left-0 top-0 w-[45%] max-w-[50%]"
            style={{
              background:
                'linear-gradient(90deg, rgb(var(--eve-red-rgb) / 0.42) 0%, transparent 100%)',
            }}
          />
          <div
            className="absolute bottom-0 right-0 top-0 w-[45%] max-w-[50%]"
            style={{
              background:
                'linear-gradient(270deg, rgb(var(--eve-green-rgb) / 0.45) 0%, transparent 100%)',
            }}
          />
          <div
            className="absolute bottom-0 top-0 z-10 w-px -translate-x-1/2 bg-eve-gold/70 shadow-[0_0_4px_rgba(184,150,61,0.5)]"
            style={{ left: '50%' }}
          />
          <div
            className="absolute bottom-0 top-0 z-20 w-0 -translate-x-1/2"
            style={{ left: `${leftPct}%` }}
          >
            <div
              className="absolute -top-px left-1/2 h-0 w-0 -translate-x-1/2 border-l-[4px] border-r-[4px] border-t-[5px] border-l-transparent border-r-transparent border-t-eve-accent"
              style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' }}
            />
            <div
              className="absolute left-1/2 top-[3px] h-[calc(100%-5px)] w-[1.5px] -translate-x-1/2 bg-gradient-to-b from-eve-gold/95 via-eve-accent/90 to-eve-gold/40"
            />
            <div className="absolute -bottom-0.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rotate-45 border border-eve-gold/85 bg-eve-bg shadow-[0_0_5px_rgba(184,150,61,0.45)]" />
          </div>
          {split ? (
            <div
              className="pointer-events-none absolute inset-0 z-[32] flex items-center justify-between px-0 py-1"
              aria-hidden
            >
              <span
                className={
                  'inline-flex min-w-[1rem] shrink-0 items-center justify-start rounded-r-sm bg-eve-bg/90 py-1 px-1 ' +
                  'font-eve text-[10px] font-bold tabular-nums leading-none eve-red ' +
                  'shadow-[0_1px_6px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.06)] ' +
                  '[text-shadow:0_0_10px_rgba(0,0,0,0.95)] backdrop-blur-[2px]'
                }
              >
                {formatCompactKmb(split.buy)}
              </span>
              <span
                className={
                  'inline-flex min-w-[1rem] shrink-0 items-center justify-end rounded-l-sm bg-eve-bg/90 py-1 px-1 ' +
                  'font-eve text-[10px] font-bold tabular-nums leading-none eve-green ' +
                  'shadow-[0_1px_6px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.06)] ' +
                  '[text-shadow:0_0_10px_rgba(0,0,0,0.95)] backdrop-blur-[2px]'
                }
              >
                {formatCompactKmb(split.sell)}
              </span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between px-0.5 font-eve text-[7px] font-bold uppercase leading-none tracking-[0.2em] text-eve-muted/55">
        <span className="eve-red">buy</span>
        <span className="text-eve-gold/60">mid</span>
        <span className="eve-green">sell</span>
      </div>
      {split == null ? (
        <p className="mt-0.5 text-center font-eve text-[10px] font-semibold tabular-nums text-eve-muted/80">
          Нет сделок за период
        </p>
      ) : null}
    </div>
  )
}
