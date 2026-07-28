import { useCallback, useEffect, useRef } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'

export type LongPressEvent<T extends HTMLElement> = {
  clientX: number
  clientY: number
  currentTarget: T
}

type Options = {
  delay?: number
  movementThreshold?: number
}

export default function useLongPress<T extends HTMLElement>(
  onLongPress: (event: LongPressEvent<T>) => void,
  { delay = 520, movementThreshold = 10 }: Options = {},
) {
  const callbackRef = useRef(onLongPress)
  const timerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const clickSuppressionTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const pointerIdRef = useRef<number | null>(null)
  const startRef = useRef<{ x: number; y: number; target: T } | null>(null)
  const suppressClickRef = useRef(false)

  callbackRef.current = onLongPress

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const reset = useCallback((keepClickSuppression = false) => {
    clearTimer()
    pointerIdRef.current = null
    startRef.current = null
    if (!keepClickSuppression) {
      if (clickSuppressionTimerRef.current !== null) window.clearTimeout(clickSuppressionTimerRef.current)
      clickSuppressionTimerRef.current = null
      suppressClickRef.current = false
    }
  }, [clearTimer])

  useEffect(() => () => reset(), [reset])

  const onPointerDown = useCallback((event: ReactPointerEvent<T>) => {
    if (event.pointerType === 'mouse' || !event.isPrimary || event.button !== 0) return
    reset()
    pointerIdRef.current = event.pointerId
    startRef.current = { x: event.clientX, y: event.clientY, target: event.currentTarget }
    timerRef.current = window.setTimeout(() => {
      const start = startRef.current
      if (!start) return
      timerRef.current = null
      suppressClickRef.current = true
      navigator.vibrate?.(8)
      callbackRef.current({ clientX: start.x, clientY: start.y, currentTarget: start.target })
    }, delay)
  }, [delay, reset])

  const onPointerMove = useCallback((event: ReactPointerEvent<T>) => {
    const start = startRef.current
    if (!start || event.pointerId !== pointerIdRef.current) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > movementThreshold) reset()
  }, [movementThreshold, reset])

  const onPointerUp = useCallback((event: ReactPointerEvent<T>) => {
    if (event.pointerId !== pointerIdRef.current) return
    const shouldSuppressClick = suppressClickRef.current
    reset(shouldSuppressClick)
    if (shouldSuppressClick) {
      clickSuppressionTimerRef.current = window.setTimeout(() => {
        suppressClickRef.current = false
        clickSuppressionTimerRef.current = null
      }, 700)
    }
  }, [reset])

  const onPointerCancel = useCallback(() => reset(), [reset])

  const onClickCapture = useCallback((event: ReactMouseEvent<T>) => {
    if (!suppressClickRef.current) return
    event.preventDefault()
    event.stopPropagation()
    if (clickSuppressionTimerRef.current !== null) window.clearTimeout(clickSuppressionTimerRef.current)
    clickSuppressionTimerRef.current = null
    suppressClickRef.current = false
  }, [])

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture }
}
