import { useEffect, useRef } from 'react'
import { nudgeByWheel } from '../lib/numberInputWheel'

type Options = {
  step: number
  getValue: () => number
  onNudge: (next: number) => void
  bounds?: { min?: number; max?: number }
  enabled?: boolean
}

/**
 * Колёсико с шагом `step` при наведении на поле или при фокусе; стрелки ↑/↓ с тем же шагом при фокусе.
 * `passive: false` на wheel для preventDefault.
 */
export function useInputWheelNudge(
  element: HTMLInputElement | null,
  {
    step,
    getValue,
    onNudge,
    bounds,
    enabled = true,
  }: Options
): void {
  const optRef = useRef({ getValue, onNudge, bounds, step })
  optRef.current = { getValue, onNudge, bounds, step }
  const hoveredRef = useRef(false)

  useEffect(() => {
    if (!enabled || !element) return
    const onEnter = () => {
      hoveredRef.current = true
    }
    const onLeave = () => {
      hoveredRef.current = false
    }
    const nudge = (dir: 1 | -1) => {
      const { getValue, onNudge, bounds: b, step: s } = optRef.current
      const next = nudgeByWheel(getValue(), dir, s, b)
      onNudge(next)
    }
    const onWheel = (e: WheelEvent) => {
      const canNudge =
        hoveredRef.current || document.activeElement === element
      if (!canNudge) return
      e.preventDefault()
      e.stopPropagation()
      const dir: 1 | -1 = e.deltaY < 0 ? 1 : -1
      nudge(dir)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      e.preventDefault()
      const dir: 1 | -1 = e.key === 'ArrowUp' ? 1 : -1
      nudge(dir)
    }
    element.addEventListener('mouseenter', onEnter)
    element.addEventListener('mouseleave', onLeave)
    element.addEventListener('wheel', onWheel, { passive: false })
    element.addEventListener('keydown', onKeyDown)
    return () => {
      element.removeEventListener('mouseenter', onEnter)
      element.removeEventListener('mouseleave', onLeave)
      element.removeEventListener('wheel', onWheel)
      element.removeEventListener('keydown', onKeyDown)
    }
  }, [element, enabled, step])
}
