import { useEffect, useRef, useState } from 'react'
import { useInputWheelNudge } from '../hooks/useInputWheelNudge'
import type { ColumnId } from '../lib/columnLabels'
import {
  getFilterColumnWheelBounds,
  getFilterColumnWheelStep,
} from '../lib/numberInputWheel'
import {
  formatFilterNumberDisplay,
  normalizeFilterNumberValue,
  parseNumberInput,
} from '../lib/formatNumber'
import type { NumberRange } from '../lib/filterFns'

type NumberRangeFilterInputsProps = {
  columnId: ColumnId
  range: NumberRange
  onRangeChange: (next: NumberRange | undefined) => void
  isMargin: boolean
  isSpreadAxis: boolean
  ariaLabelFrom: string
  ariaLabelTo: string
}

/**
 * Позволяет вводить 0,05 / 0.05 без сброса на промежуточных «0.» (controlled через локальный draft до blur).
 */
export function NumberRangeFilterInputs({
  columnId,
  range,
  onRangeChange,
  isMargin,
  isSpreadAxis,
  ariaLabelFrom,
  ariaLabelTo,
}: NumberRangeFilterInputsProps) {
  const { min, max } = range
  const [minDraft, setMinDraft] = useState<string | null>(null)
  const [maxDraft, setMaxDraft] = useState<string | null>(null)
  const [minInputEl, setMinInputEl] = useState<HTMLInputElement | null>(null)
  const [maxInputEl, setMaxInputEl] = useState<HTMLInputElement | null>(null)
  const rangeRef = useRef(range)
  rangeRef.current = range

  const wheelStep = getFilterColumnWheelStep(columnId)
  const wheelBounds = getFilterColumnWheelBounds(columnId)

  const formatShownValue = (value: number): string =>
    isMargin ? String(Math.round(value)) : formatFilterNumberDisplay(value, columnId)

  const minRawForNudge =
    minDraft !== null ? minDraft : min === null ? '' : formatShownValue(min)
  const maxRawForNudge =
    maxDraft !== null ? maxDraft : max === null ? '' : formatShownValue(max)
  const minCanNudge = minRawForNudge.trim() !== ''
  const maxCanNudge = maxRawForNudge.trim() !== ''

  const applyRange = (nextMin: number | null, nextMax: number | null) => {
    const normalizedMin =
      nextMin === null ? null : isMargin ? Math.round(nextMin) : nextMin
    const normalizedMax =
      nextMax === null ? null : isMargin ? Math.round(nextMax) : nextMax
    if (nextMin === null && nextMax === null) onRangeChange(undefined)
    else {
      onRangeChange({
        min:
          normalizedMin === null
            ? null
            : normalizeFilterNumberValue(normalizedMin, columnId),
        max:
          normalizedMax === null
            ? null
            : normalizeFilterNumberValue(normalizedMax, columnId),
      })
    }
  }

  useInputWheelNudge(minInputEl, {
    step: wheelStep,
    bounds: wheelBounds,
    getValue: () => {
      const t =
        minDraft !== null
          ? minDraft
          : min === null
            ? ''
            : formatShownValue(min)
      if (t.trim() === '') return 0
      return parseNumberInput(t) ?? 0
    },
    onNudge: (next) => {
      setMinDraft(null)
      applyRange(next, rangeRef.current.max)
    },
    enabled: minCanNudge,
  })

  useInputWheelNudge(maxInputEl, {
    step: wheelStep,
    bounds: wheelBounds,
    getValue: () => {
      const t =
        maxDraft !== null
          ? maxDraft
          : max === null
            ? ''
            : formatShownValue(max)
      if (t.trim() === '') return 0
      return parseNumberInput(t) ?? 0
    },
    onNudge: (next) => {
      setMaxDraft(null)
      applyRange(rangeRef.current.min, next)
    },
    enabled: maxCanNudge,
  })

  useEffect(() => {
    setMinDraft(null)
    setMaxDraft(null)
  }, [min, max])

  const minShown =
    minDraft !== null
      ? minDraft
      : min === null
        ? ''
        : formatShownValue(min)
  const maxShown =
    maxDraft !== null
      ? maxDraft
      : max === null
        ? ''
        : formatShownValue(max)

  return (
    <div className="flex flex-col gap-0.5">
      <input
        ref={setMinInputEl}
        type="text"
        inputMode="decimal"
        className="w-full min-w-0 rounded border border-eve-border/80 bg-eve-bg/80 px-1 py-0.5 text-xs tabular-nums text-eve-text shadow-eve-inset placeholder:text-eve-muted/60 focus:border-eve-accent/70 focus:outline-none"
        placeholder={
          isMargin ? '5' : isSpreadAxis ? '0' : 'min'
        }
        value={minShown}
        onChange={(e) => {
          setMinDraft(e.target.value)
        }}
        onBlur={() => {
          const raw =
            minDraft !== null
              ? minDraft
              : min === null
                ? ''
                : formatShownValue(min)
          setMinDraft(null)
          const n = raw.trim() === '' ? null : parseNumberInput(raw)
          applyRange(n, max)
        }}
        aria-label={ariaLabelFrom}
      />
      <input
        ref={setMaxInputEl}
        type="text"
        inputMode="decimal"
        className="w-full min-w-0 rounded border border-eve-border/80 bg-eve-bg/80 px-1 py-0.5 text-xs tabular-nums text-eve-text shadow-eve-inset placeholder:text-eve-muted/60 focus:border-eve-accent/70 focus:outline-none"
        placeholder={
          isMargin ? '20' : isSpreadAxis ? '100' : 'max'
        }
        value={maxShown}
        onChange={(e) => {
          setMaxDraft(e.target.value)
        }}
        onBlur={() => {
          const raw =
            maxDraft !== null
              ? maxDraft
              : max === null
                ? ''
                : formatShownValue(max)
          setMaxDraft(null)
          const n = raw.trim() === '' ? null : parseNumberInput(raw)
          applyRange(min, n)
        }}
        aria-label={ariaLabelTo}
      />
    </div>
  )
}
