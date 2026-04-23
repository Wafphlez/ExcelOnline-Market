import { formatRatio } from '../lib/formatNumber'

type Props = {
  ratio: number | null
}

/**
 * Ось: 0 = bid, 0,5 = центр, 1 = ask. Фон — градиент фиолетовый → голубой → розовый.
 * Линия в центре (0,5); круг + штрих — положение средней цены.
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
        className="relative h-7 w-full overflow-hidden rounded border border-slate-500/50 shadow-inner"
        title={`Средняя в спреде: ${t.toFixed(4)} (0 = bid, 0,5 = центр, 1 = ask)`}
        role="img"
        aria-label={`Позиция средней в спреде: ${formatRatio(t, 3)}. Центр оси 0,5${t < 0.5 ? ', левее центра' : t > 0.5 ? ', правее центра' : ', в центре'}.`}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(90deg, #9333ea 0%, #22d3ee 50%, #ec4899 100%)',
          }}
        />
        {/* Индикатор центра (0,5) */}
        <div
          className="absolute bottom-0 top-0 z-10 w-px bg-white/85 shadow-[0_0_1px_rgba(0,0,0,0.8)]"
          style={{ left: '50%' }}
        />
        {/* Индикатор значения: метка + вертикаль на оси */}
        <div
          className="absolute bottom-0 top-0 z-20 w-0"
          style={{ left: `${leftPct}%`, transform: 'translateX(-50%)' }}
        >
          <div className="absolute -top-0.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-white bg-slate-900 shadow-md ring-1 ring-slate-950/50" />
          <div className="absolute bottom-0 left-1/2 top-2 w-0.5 -translate-x-1/2 bg-slate-950" />
        </div>
      </div>
      <p className="mt-0.5 text-center text-[10px] leading-tight text-slate-300 tabular-nums">
        {formatRatio(t, 3)}
      </p>
    </div>
  )
}
