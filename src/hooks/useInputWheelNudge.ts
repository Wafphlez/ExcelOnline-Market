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
 * Колёсико с шагом `step` при наведении на поле или при фокусе; `passive: false` для preventDefault.
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
    const handler = (e: WheelEvent) => {
      const canNudge =
        hoveredRef.current || document.activeElement === element
      if (!canNudge) return
      e.preventDefault()
      e.stopPropagation()
      const { getValue, onNudge, bounds: b, step: s } = optRef.current
      const dir = (e.deltaY < 0 ? 1 : -1) as 1 | -1
      const next = nudgeByWheel(getValue(), dir, s, b)
      onNudge(next)
    }
    element.addEventListener('mouseenter', onEnter)
    element.addEventListener('mouseleave', onLeave)
    element.addEventListener('wheel', handler, { passive: false })
    return () => {
      element.removeEventListener('mouseenter', onEnter)
      element.removeEventListener('mouseleave', onLeave)
      element.removeEventListener('wheel', handler)
    }
  }, [element, enabled, step])
}
