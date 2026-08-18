import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode, TouchEvent as ReactTouchEvent } from 'react'

type Gesture = {
  startX: number
  startY: number
  origin: number
  offset: number
  horizontal: boolean
}

type Props = {
  children: ReactNode
  enabled?: boolean
  actionLabel?: string
  ariaLabel: string
  onAction: () => void
  className?: string
}

const actionWidth = 72

export default function SwipeActionRow({ children, enabled = true, actionLabel = '移除', ariaLabel, onAction, className = '' }: Props) {
  const [revealed, setRevealed] = useState(false)
  const [offset, setOffset] = useState(0)
  const gestureRef = useRef<Gesture | null>(null)
  const suppressClickRef = useRef(false)

  const begin = (x: number, y: number) => {
    if (!enabled) return
    gestureRef.current = { startX: x, startY: y, origin: revealed ? actionWidth : 0, offset: revealed ? actionWidth : 0, horizontal: false }
  }
  const move = (x: number, y: number, preventDefault: () => void) => {
    const gesture = gestureRef.current
    if (!gesture) return
    const deltaX = x - gesture.startX
    const deltaY = y - gesture.startY
    if (!gesture.horizontal) {
      if (Math.abs(deltaX) < 7) return
      if (Math.abs(deltaY) >= Math.abs(deltaX)) {
        gestureRef.current = null
        return
      }
      gesture.horizontal = true
    }
    preventDefault()
    gesture.offset = Math.max(0, Math.min(actionWidth, gesture.origin - deltaX))
    setOffset(gesture.offset)
  }
  const finish = (cancelled = false) => {
    const gesture = gestureRef.current
    gestureRef.current = null
    if (!gesture) return
    const nextRevealed = cancelled ? gesture.origin > 0 : gesture.horizontal && gesture.offset >= actionWidth * .45
    if (gesture.horizontal) suppressClickRef.current = true
    setRevealed(nextRevealed)
    setOffset(nextRevealed ? actionWidth : 0)
  }
  const pointer = (event: ReactPointerEvent<HTMLDivElement>) => event.pointerType !== 'touch'
  const translate = gestureRef.current?.horizontal ? offset : revealed ? actionWidth : offset
  const actionVisible = translate > 1

  return <div className={`swipe-action-row ${revealed ? 'is-revealed' : ''} ${className}`}>
    <button
      type="button"
      className="swipe-action-button"
      style={{ opacity: Math.min(1, translate / 24), visibility: actionVisible ? 'visible' : 'hidden', pointerEvents: revealed ? 'auto' : 'none' }}
      onClick={() => { onAction(); setRevealed(false); setOffset(0) }}
      disabled={!enabled}
      tabIndex={revealed ? 0 : -1}
      aria-hidden={!actionVisible}
      aria-label={ariaLabel}
    >{actionLabel}</button>
    <div
      className="swipe-action-content"
      style={{ transform: `translateX(${-translate}px)` }}
      onPointerDown={(event) => { if (pointer(event)) begin(event.clientX, event.clientY) }}
      onPointerMove={(event) => { if (pointer(event)) move(event.clientX, event.clientY, () => event.preventDefault()) }}
      onPointerUp={(event) => { if (pointer(event)) finish() }}
      onPointerCancel={(event) => { if (pointer(event)) finish(true) }}
      onTouchStart={(event: ReactTouchEvent<HTMLDivElement>) => { const touch = event.touches[0]; if (touch) begin(touch.clientX, touch.clientY) }}
      onTouchMove={(event: ReactTouchEvent<HTMLDivElement>) => { const touch = event.touches[0]; if (touch) move(touch.clientX, touch.clientY, () => event.preventDefault()) }}
      onTouchEnd={() => finish()}
      onTouchCancel={() => finish(true)}
      onClickCapture={(event) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (revealed) {
          setRevealed(false)
          setOffset(0)
          event.preventDefault()
          event.stopPropagation()
        }
      }}
    >{children}</div>
  </div>
}
