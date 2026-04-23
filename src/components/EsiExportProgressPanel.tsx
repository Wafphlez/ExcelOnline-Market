import type { EsiExportProgressState } from '../lib/esiExportProgressTypes'

function barWidth(current: number, max: number): number {
  if (max <= 0) return 0
  return Math.min(100, Math.round((current / max) * 100))
}

function ProgressRow({
  label,
  current,
  max,
  accentClass,
}: {
  label: string
  current: number
  max: number
  accentClass?: string
}) {
  const w = barWidth(current, max)
  return (
    <div className="min-w-0">
      <div className="mb-0.5 flex justify-between gap-2 text-[10px] text-eve-muted">
        <span className="truncate">{label}</span>
        <span className="shrink-0 tabular-nums text-eve-text/90">
          {current}/{max}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full border border-eve-border/40 bg-eve-bg/60 shadow-eve-inset">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ease-out ${accentClass ?? 'bg-eve-accent/80'}`}
          style={{ width: `${w}%` }}
        />
      </div>
    </div>
  )
}

type EsiExportProgressPanelProps = {
  progress: EsiExportProgressState
}

/**
 * Прогресс ESI: параллельные sell/buy и батчи типов.
 */
export function EsiExportProgressPanel({ progress }: EsiExportProgressPanelProps) {
  const m = progress.maxOrderPages
  if (progress.phase === 'idle' && m <= 0) {
    return null
  }

  return (
    <div className="mt-3 rounded border border-eve-border/60 bg-eve-elevated/50 p-3 shadow-eve-inset">
      <div className="mb-2.5 flex items-center justify-between gap-2 border-b border-eve-accent/15 pb-2">
        <span className="font-eve text-[11px] font-bold uppercase tracking-[0.12em] text-eve-gold/90">
          ESI — загрузка
        </span>
        <span className="text-[10px] text-eve-muted">
          {progress.phase === 'orders' && 'ордера sell ‖ buy'}
          {progress.phase === 'types' && 'типы (батч)'}
          {progress.phase === 'idle' && '…'}
        </span>
      </div>

      {m > 0 && (
        <div className="space-y-2.5">
          <p className="text-[10px] text-eve-muted/90">
            Книга ордеров — стороны{' '}
            <span className="font-semibold text-eve-accent/95">параллельно</span>
          </p>
          <ProgressRow
            label="Sell"
            current={progress.sellPage}
            max={m}
            accentClass="bg-eve-cyan/80"
          />
          <ProgressRow
            label="Buy"
            current={progress.buyPage}
            max={m}
            accentClass="bg-eve-danger/70"
          />
        </div>
      )}

      {progress.phase === 'types' && progress.typeTotal > 0 && (
        <div className="mt-3 space-y-2 border-t border-eve-border/40 pt-3">
          <p className="text-[10px] text-eve-muted/90">
            Топ-типов: имя и история —{' '}
            <span className="font-semibold text-eve-accent/95">
              до {progress.typeConcurrency || 1} типов параллельно
            </span>
          </p>
          <ProgressRow
            label="Обработано типов"
            current={progress.typesDone}
            max={progress.typeTotal}
            accentClass="bg-eve-accent/85"
          />
        </div>
      )}
    </div>
  )
}
