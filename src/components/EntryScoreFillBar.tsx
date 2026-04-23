type EntryScoreFillBarProps = {
  /** 0–100, null — нет данных */
  score: number | null
}

/**
 * Индикатор выгодности: золотая рамка на всю длину; внутри слева золотая
 * заливка на (score / 100) ширины трека.
 */
export function EntryScoreFillBar({ score }: EntryScoreFillBarProps) {
  if (score === null || !Number.isFinite(score)) {
    return <span className="text-eve-muted/90">—</span>
  }

  const pct = Math.max(0, Math.min(100, Math.round(score)))

  return (
    <div
      className="flex w-full min-w-[5.5rem] max-w-[9.5rem] items-center gap-2"
      title={`Выгодность входа: ${pct} % (0 = нет смысла, 100 = сильный вход по марже, ликвидности и спреду)`}
    >
      <div
        className="relative box-border h-3.5 min-w-0 flex-1 overflow-hidden rounded-sm border-2 border-eve-accent bg-eve-bg/95 shadow-eve-inset"
        role="img"
        aria-label={`Выгодность ${pct} из 100 процентов`}
      >
        <div
          className="absolute bottom-0 left-0 top-0 overflow-hidden"
          style={{ width: `${pct}%` }}
        >
          <div
            className={
              pct > 0
                ? 'h-full w-full min-w-[2px] bg-gradient-to-b from-eve-gold-bright/85 via-eve-accent to-eve-gold/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]'
                : 'h-full w-0'
            }
          />
        </div>
      </div>
      <span className="w-8 shrink-0 text-right font-eve text-[10px] font-bold tabular-nums leading-none text-eve-accent [text-shadow:0_0_6px_rgba(184,150,61,0.25)]">
        {pct}%
      </span>
    </div>
  )
}
