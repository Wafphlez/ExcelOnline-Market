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

  const applyRange = (nextMin: number | null, nextMax: number | null) => {
    if (nextMin === null && nextMax === null) onRangeChange(undefined)
    else {
      onRangeChange({
        min:
          nextMin === null
            ? null
            : normalizeFilterNumberValue(nextMin, columnId),
        max:
          nextMax === null
            ? null
            : normalizeFilterNumberValue(nextMax, columnId),
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
            : formatFilterNumberDisplay(min, columnId)
      if (t.trim() === '') return 0
      return parseNumberInput(t) ?? 0
    },
    onNudge: (next) => {
      setMinDraft(null)
      applyRange(next, rangeRef.current.max)
    },
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
            : formatFilterNumberDisplay(max, columnId)
      if (t.trim() === '') return 0
      return parseNumberInput(t) ?? 0
    },
    onNudge: (next) => {
      setMaxDraft(null)
      applyRange(rangeRef.current.min, next)
    },
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
        : formatFilterNumberDisplay(min, columnId)
  const maxShown =
    maxDraft !== null
      ? maxDraft
      : max === null
        ? ''
        : formatFilterNumberDisplay(max, columnId)

  return (
    <div className="flex flex-col gap-0.5">
      <input
        ref={setMinInputEl}
        type="text"
        inputMode="decimal"
        className="w-full min-w-0 rounded border border-eve-border bg-eve-bg px-1 py-0.5 text-xs tabular-nums text-eve-text placeholder:text-eve-muted/70 focus:border-eve-accent focus:outline-none"
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
                : formatFilterNumberDisplay(min, columnId)
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
        className="w-full min-w-0 rounded border border-eve-border bg-eve-bg px-1 py-0.5 text-xs tabular-nums text-eve-text placeholder:text-eve-muted/70 focus:border-eve-accent focus:outline-none"
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
                : formatFilterNumberDisplay(max, columnId)
          setMaxDraft(null)
          const n = raw.trim() === '' ? null : parseNumberInput(raw)
          applyRange(min, n)
        }}
        aria-label={ariaLabelTo}
      />
    </div>
  )
}
