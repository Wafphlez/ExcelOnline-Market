import type { EsiExportProgressState } from '../lib/esiExportProgressTypes'
import {
  esiAllRequestsProgress01,
  esiOrdersProgress01,
  esiTypesProgress01,
  formatEsiEtaRemaining,
  formatEsiStopwatch,
  linearEtaRemaining,
} from '../lib/esiExportEta'

function barWidth(current: number, max: number): number {
  if (max <= 0) return 0
  return Math.min(100, Math.round((current / max) * 100))
}

function ProgressRow({
  label,
  current,
  max,
  accentClass,
}: Readonly<{
  label: string
  current: number
  max: number
  accentClass?: string
}>) {
  const w = barWidth(current, max)
  return (
    <div className="min-w-0">
      <div className="mb-0.5 flex justify-between gap-2 text-[10px] text-eve-muted">
        <span className="truncate">{label}</span>
        <span className="shrink-0 tabular-nums text-white">
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

type EsiExportProgressPanelProps = Readonly<{
  progress: EsiExportProgressState
  /** Секунд с начала ESI-выгрузки (таймер) */
  elapsedSec: number
  /** Секунд в фазе «типы»; null, пока фаза не types или нет отметки старта */
  typesPhaseElapsedSec: number | null
  /** Показывать snapshot-прогресс (когда включена опция выгрузки snapshot) */
  includeSnapshotProgress?: boolean
}>

/**
 * Прогресс ESI, секундомер (прошло) и оценка ETA по текущей фазе.
 */
export function EsiExportProgressPanel({
  progress,
  elapsedSec,
  typesPhaseElapsedSec,
  includeSnapshotProgress = false,
}: EsiExportProgressPanelProps) {
  const m = progress.maxOrderPages
  const sellM =
    m > 0 && progress.orderSellPageBarMax > 0
      ? progress.orderSellPageBarMax
      : m
  const buyM =
    m > 0 && progress.orderBuyPageBarMax > 0
      ? progress.orderBuyPageBarMax
      : m

  const p = progress
  const op = esiOrdersProgress01(p)
  const tp = esiTypesProgress01(p)
  const allReqP = esiAllRequestsProgress01(p)
  const showUnifiedEta =
    (p.phase === 'orders' || p.phase === 'types') && p.maxOrderPages > 0

  let etaValue: number | null = null
  if (showUnifiedEta) {
    etaValue = linearEtaRemaining(allReqP, Math.max(0, elapsedSec))
  } else if (p.phase === 'types' && p.typeTotal > 0) {
    // Фолбэк для редких состояний: если общий ETA недоступен, оставляем старую логику по типам.
    etaValue =
      typesPhaseElapsedSec != null && typesPhaseElapsedSec > 0
        ? linearEtaRemaining(tp, typesPhaseElapsedSec)
        : null
  } else if (p.phase === 'orders' && p.maxOrderPages > 0) {
    etaValue = linearEtaRemaining(op, Math.max(0, elapsedSec))
  }

  const etaText = formatEsiEtaRemaining(etaValue)
  const showEta =
    showUnifiedEta ||
    (p.phase === 'types' && p.typeTotal > 0) ||
    (p.phase === 'orders' && p.maxOrderPages > 0)
  const sw = formatEsiStopwatch(elapsedSec)

  return (
    <div className="mt-3 rounded border border-eve-border/60 bg-eve-elevated/50 p-3 shadow-eve-inset">
      <div className="mb-2.5 flex flex-col gap-2 border-b border-eve-accent/15 pb-2.5">
        <div className="min-w-0">
          <span className="font-eve text-[11px] font-bold uppercase tracking-[0.12em] text-eve-gold">
            ESI — загрузка
          </span>
        </div>
        <div className="grid w-full shrink-0 grid-cols-[minmax(7.5rem,1fr)_minmax(9.5rem,1fr)] gap-x-3 gap-y-0.5 text-[10px] tabular-nums sm:w-[min(100%,19.5rem)]">
          <div
            className="flex min-h-[2.25rem] min-w-0 flex-col justify-center rounded border border-eve-border/35 bg-eve-bg/35 px-2 py-1 shadow-eve-inset"
            title="Прошло с начала выгрузки"
          >
            <span className="text-[9px] uppercase tracking-wide text-eve-muted">
              Прошло
            </span>
            <span className="font-semibold leading-tight text-eve-bright/95">
              {sw}
            </span>
          </div>
          <div
            className="flex min-h-[2.25rem] min-w-0 flex-col justify-center rounded border border-eve-border/35 bg-eve-bg/35 px-2 py-1 shadow-eve-inset"
            title={
              showEta
                ? 'Линейная оценка по скорости текущей фазы'
                : 'Оценка появится, когда будет достаточно данных'
            }
          >
            <span className="truncate text-[9px] uppercase tracking-wide text-eve-muted">
              ETA
            </span>
            <span
              className={`font-semibold leading-tight ${showEta ? 'text-eve-accent/95' : 'text-eve-muted/50'}`}
            >
              {showEta ? etaText : '—'}
            </span>
          </div>
        </div>
      </div>

      {m > 0 && (
        <div className="space-y-2.5">
          <p className="text-[10px] text-eve-muted/90">
            Поиск завершится досрочно если в evetech закончатся записи
          </p>
          <ProgressRow
            label="Sell"
            current={p.sellPage}
            max={sellM}
            accentClass="bg-eve-green"
          />
          <ProgressRow
            label="Buy"
            current={p.buyPage}
            max={buyM}
            accentClass="bg-eve-red"
          />
        </div>
      )}

      {(p.phase === 'orders' || p.phase === 'types') && p.typeTotal > 0 && (
        <div className="mt-3 space-y-2 border-t border-eve-border/40 pt-3">
          <ProgressRow
            label="Обработано типов"
            current={p.typesDone}
            max={p.typeTotal}
            accentClass="bg-eve-accent/85"
          />
          <ProgressRow
            label="History запросы"
            current={p.historyDone}
            max={p.historyTotal}
            accentClass="bg-eve-cyan/70"
          />
          {includeSnapshotProgress && (
            <ProgressRow
              label="Snapshot ордеров"
              current={p.snapshotDone}
              max={p.snapshotTotal}
              accentClass="bg-eve-accent/75"
            />
          )}
        </div>
      )}
    </div>
  )
}
