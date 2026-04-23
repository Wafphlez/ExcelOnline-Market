import { formatRatio } from '../lib/formatNumber'

type Props = {
  ratio: number | null
}

const SCAN = {
  h: 'repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(0,0,0,0.22) 1px, rgba(0,0,0,0.22) 2px)',
} as const

const TRACK =
  'linear-gradient(90deg, rgba(22, 58, 50, 0.85) 0%, rgba(12, 14, 20, 0.98) 50%, rgba(75, 32, 32, 0.78) 100%)'

/**
 * Ось: 0 = buy, 0,5 = mid, 1 = sell. В стиле EVE: золотая кромка, зоны buy/sell,
 * линия mid, маркер «средняя в спреде».
 */
export function SpreadPositionBar({ ratio }: Props) {
  if (ratio === null || !Number.isFinite(ratio)) {
    return <span className="text-eve-muted">—</span>
  }
  const t = Math.max(0, Math.min(1, ratio))
  const leftPct = t * 100

  return (
    <div className="w-full min-w-[140px] max-w-[220px]">
      <div
        className="relative rounded-sm border border-eve-gold/40 bg-eve-bg/95 p-px shadow-[0_0_0_1px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.06)]"
        title={`Средняя в спреде: ${t.toFixed(4)} (0 = buy, 0,5 = mid, 1 = sell)`}
        role="img"
        aria-label={`Позиция средней в спреде: ${formatRatio(t, 3)}. Центр оси 0,5${t < 0.5 ? ', левее центра' : t > 0.5 ? ', правее центра' : ', в центре'}.`}
      >
        <div className="relative h-7 w-full overflow-hidden rounded-sm border border-eve-border/70 bg-eve-elevated">
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
                'linear-gradient(90deg, rgba(50, 130, 95, 0.45) 0%, transparent 100%)',
            }}
          />
          <div
            className="absolute bottom-0 right-0 top-0 w-[45%] max-w-[50%]"
            style={{
              background:
                'linear-gradient(270deg, rgba(150, 55, 50, 0.42) 0%, transparent 100%)',
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
              className="absolute left-1/2 top-[3px] h-[calc(100%-3px)] w-[1.5px] -translate-x-1/2 bg-gradient-to-b from-eve-gold/95 via-eve-accent/90 to-eve-gold/40"
            />
            <div className="absolute -bottom-0.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rotate-45 border border-eve-gold/85 bg-eve-bg shadow-[0_0_5px_rgba(184,150,61,0.45)]" />
          </div>
        </div>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between px-0.5 font-eve text-[7px] font-bold uppercase leading-none tracking-[0.2em] text-eve-muted/55">
        <span className="text-eve-cyan/60">buy</span>
        <span className="text-eve-gold/60">mid</span>
        <span className="text-eve-danger/70">sell</span>
      </div>
      <p className="mt-0.5 text-center font-eve text-[10px] font-bold tabular-nums tracking-wide text-eve-gold-bright/95 [text-shadow:0_0_8px_rgba(184,150,61,0.35)]">
        {formatRatio(t, 3)}
      </p>
    </div>
  )
}
