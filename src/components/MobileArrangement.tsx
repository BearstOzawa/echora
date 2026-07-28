import { GripVertical, LocateFixed } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, TouchEvent as ReactTouchEvent } from 'react'
import type { Track } from '../types'
import ArtworkImage from './ArtworkImage'

type Props = {
  tracks: Track[]
  activeTrackId: number
  isPlaying: boolean
  durationMinutes: number
  onPlayTrack: (id: number) => void
  onReorderTrack: (id: number, direction: -1 | 1) => void
  onReorderTrackTo: (id: number, targetIndex: number) => void
  onRemoveTrack: (id: number) => void
}

type DragState = {
  id: number
  originIndex: number
  targetIndex: number
  startY: number
  rowHeight: number
  order: number[]
  scrollElement: HTMLElement
  initialScrollTop: number
}

type SwipeState = {
  id: number
  startX: number
  startY: number
  originOffset: number
  offset: number
  moved: boolean
}

const swipeActionWidth = 72

const moveItem = (order: number[], from: number, to: number) => {
  const next = [...order]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export default function MobileArrangement({ tracks, activeTrackId, isPlaying, durationMinutes, onPlayTrack, onReorderTrack, onReorderTrackTo, onRemoveTrack }: Props) {
  const orderedTracks = useMemo(() => [...tracks].sort((left, right) => left.x - right.x), [tracks])
  const orderKey = orderedTracks.map((track) => track.id).join(',')
  const trackMap = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks])
  const [draftOrder, setDraftOrder] = useState(() => orderedTracks.map((track) => track.id))
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [revealedId, setRevealedId] = useState<number | null>(null)
  const [swipeOffset, setSwipeOffset] = useState<{ id: number; offset: number } | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const dragListenersRef = useRef<(() => void) | null>(null)
  const swipeRef = useRef<SwipeState | null>(null)
  const suppressClickRef = useRef<number | null>(null)
  const scrollRef = useRef<HTMLElement>(null)

  useEffect(() => {
    setDraftOrder(orderedTracks.map((track) => track.id))
    setRevealedId((current) => current !== null && orderedTracks.some((track) => track.id === current) ? current : null)
  }, [orderKey])

  useEffect(() => () => dragListenersRef.current?.(), [])

  const displayedTracks = draftOrder
    .map((id) => trackMap.get(id))
    .filter((track): track is Track => Boolean(track))
  const activeTrack = orderedTracks.find((track) => track.id === activeTrackId)
  const activeIndex = displayedTracks.findIndex((track) => track.id === activeTrackId)
  const longArrangement = tracks.length > 18
  const energySegments = useMemo(() => {
    const segmentCount = Math.min(36, orderedTracks.length)
    if (!segmentCount) return []
    return Array.from({ length: segmentCount }, (_, segmentIndex) => {
      const start = Math.floor(segmentIndex * orderedTracks.length / segmentCount)
      const end = Math.max(start + 1, Math.floor((segmentIndex + 1) * orderedTracks.length / segmentCount))
      const segmentTracks = orderedTracks.slice(start, end)
      return {
        key: `${start}-${end}`,
        height: segmentTracks.reduce((total, track) => total + Math.max(22, Math.min(90, 100 - track.y)), 0) / segmentTracks.length,
        active: segmentTracks.some((track) => track.id === activeTrackId),
      }
    })
  }, [activeTrackId, orderedTracks])

  const locateActiveTrack = () => {
    if (activeTrackId < 0) return
    scrollRef.current?.querySelector<HTMLElement>(`[data-arrangement-row="${activeTrackId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: number, index: number) => {
    event.preventDefault()
    setRevealedId(null)
    setSwipeOffset(null)
    const row = event.currentTarget.closest<HTMLElement>('.mobile-arrangement-track')
    const scrollElement = scrollRef.current
    if (!scrollElement) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = {
      id,
      originIndex: index,
      targetIndex: index,
      startY: event.clientY,
      rowHeight: Math.max(58, row?.getBoundingClientRect().height ?? 68),
      order: [...draftOrder],
      scrollElement,
      initialScrollTop: scrollElement.scrollTop,
    }
    setDraggingId(id)
    const move = (pointerEvent: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      pointerEvent.preventDefault()
      const bounds = drag.scrollElement.getBoundingClientRect()
      const edgeDistance = 68
      if (bounds.height > edgeDistance * 2) {
        if (pointerEvent.clientY < bounds.top + edgeDistance) drag.scrollElement.scrollTop -= Math.max(5, (bounds.top + edgeDistance - pointerEvent.clientY) * .18)
        if (pointerEvent.clientY > bounds.bottom - edgeDistance) drag.scrollElement.scrollTop += Math.max(5, (pointerEvent.clientY - (bounds.bottom - edgeDistance)) * .18)
      }
      const scrollShift = drag.scrollElement.scrollTop - drag.initialScrollTop
      const shift = Math.round((pointerEvent.clientY - drag.startY + scrollShift) / drag.rowHeight)
      const targetIndex = Math.max(0, Math.min(drag.order.length - 1, drag.originIndex + shift))
      if (targetIndex === drag.targetIndex) return
      drag.targetIndex = targetIndex
      setDraftOrder(moveItem(drag.order, drag.originIndex, targetIndex))
    }
    const finish = (cancelled: boolean) => {
      const drag = dragRef.current
      dragListenersRef.current?.()
      if (!drag) return
      dragRef.current = null
      setDraggingId(null)
      if (cancelled) {
        setDraftOrder(drag.order)
        return
      }
      if (drag.targetIndex !== drag.originIndex) onReorderTrackTo(drag.id, drag.targetIndex)
    }
    const pointerUp = () => finish(false)
    const pointerCancel = () => finish(true)
    document.addEventListener('pointermove', move, { passive: false })
    document.addEventListener('pointerup', pointerUp)
    document.addEventListener('pointercancel', pointerCancel)
    dragListenersRef.current = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', pointerUp)
      document.removeEventListener('pointercancel', pointerCancel)
      dragListenersRef.current = null
    }
  }

  const beginSwipeAt = (id: number, startX: number, startY: number) => {
    if (tracks.length <= 1) return
    if (revealedId !== null && revealedId !== id) setRevealedId(null)
    const originOffset = revealedId === id ? swipeActionWidth : 0
    swipeRef.current = { id, startX, startY, originOffset, offset: originOffset, moved: false }
  }

  const updateSwipeAt = (id: number, clientX: number, clientY: number, preventDefault: () => void) => {
    const swipe = swipeRef.current
    if (!swipe || swipe.id !== id) return
    const deltaX = clientX - swipe.startX
    const deltaY = clientY - swipe.startY
    if (!swipe.moved) {
      if (Math.abs(deltaX) < 7) return
      if (Math.abs(deltaY) > Math.abs(deltaX)) return
      swipe.moved = true
    }
    preventDefault()
    swipe.offset = Math.max(0, Math.min(swipeActionWidth, swipe.originOffset - deltaX))
    setSwipeOffset({ id: swipe.id, offset: swipe.offset })
  }

  const finishSwipe = (cancelled = false) => {
    const swipe = swipeRef.current
    if (!swipe) return
    swipeRef.current = null
    if (cancelled) {
      setRevealedId(swipe.originOffset ? swipe.id : null)
      setSwipeOffset(null)
      return
    }
    const reveal = swipe.moved && swipe.offset >= swipeActionWidth * .45
    setRevealedId(reveal ? swipe.id : null)
    setSwipeOffset(null)
    if (swipe.moved) suppressClickRef.current = swipe.id
  }

  return (
    <section ref={scrollRef} className={`mobile-arrangement ${longArrangement ? 'is-long' : ''}`} aria-label="移动编排">
      <header className="mobile-arrangement-header">
        <span><strong>播放顺序</strong><small>{tracks.length} 首 · 约 {durationMinutes} 分钟</small></span>
        {activeTrack && <button type="button" onClick={locateActiveTrack} aria-label={`定位正在播放的 ${activeTrack.title}`}><LocateFixed size={15} /><span>{activeIndex + 1} / {tracks.length}</span></button>}
      </header>

      <div className="mobile-arrangement-energy" aria-label="编排能量走向">
        <span>能量走向</span>
        <div aria-hidden="true">
          {energySegments.map((segment) => <i key={segment.key} className={segment.active ? 'is-active' : ''} style={{ height: `${segment.height}%` }} />)}
        </div>
        <small>{activeTrack ? `正在播放 · ${activeTrack.title}` : '当前会话编排'}</small>
      </div>

      {displayedTracks.length ? (
        <div className="mobile-arrangement-list">
          {displayedTracks.map((track, index) => {
            const active = track.id === activeTrackId
            const offset = swipeOffset?.id === track.id ? swipeOffset.offset : revealedId === track.id ? swipeActionWidth : 0
            const swiping = swipeRef.current?.id === track.id && swipeRef.current.moved
            return (
              <article key={track.id} data-arrangement-row={track.id} className={`mobile-arrangement-track ${active ? 'is-active' : ''} ${draggingId === track.id ? 'is-dragging' : ''} ${revealedId === track.id ? 'is-revealed' : ''} ${swiping ? 'is-swiping' : ''}`}>
                {(swiping || revealedId === track.id) && <button type="button" className="mobile-arrangement-swipe-delete" onClick={() => { onRemoveTrack(track.id); setRevealedId(null) }} disabled={tracks.length <= 1} tabIndex={revealedId === track.id ? 0 : -1} aria-hidden={revealedId !== track.id} aria-label={`移除 ${track.title}`}>移除</button>}
                <div className={`mobile-arrangement-track-content ${swiping ? 'is-swiping' : ''}`} style={{ transform: `translateX(${-offset}px)` }}>
                  <button
                    type="button"
                    className="mobile-arrangement-track-main"
                    data-track-id={track.id}
                    onPointerDown={(event) => {
                      if (event.pointerType === 'touch') return
                      event.currentTarget.setPointerCapture?.(event.pointerId)
                      beginSwipeAt(track.id, event.clientX, event.clientY)
                    }}
                    onPointerMove={(event) => {
                      if (event.pointerType === 'touch') return
                      updateSwipeAt(track.id, event.clientX, event.clientY, () => event.preventDefault())
                    }}
                    onPointerUp={(event) => {
                      if (event.pointerType === 'touch') return
                      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId)
                      finishSwipe()
                    }}
                    onPointerCancel={(event) => {
                      if (event.pointerType === 'touch') return
                      finishSwipe(true)
                    }}
                    onTouchStart={(event: ReactTouchEvent<HTMLButtonElement>) => {
                      const touch = event.touches[0]
                      if (touch) beginSwipeAt(track.id, touch.clientX, touch.clientY)
                    }}
                    onTouchMove={(event: ReactTouchEvent<HTMLButtonElement>) => {
                      const touch = event.touches[0]
                      if (touch) updateSwipeAt(track.id, touch.clientX, touch.clientY, () => event.preventDefault())
                    }}
                    onTouchEnd={() => finishSwipe()}
                    onTouchCancel={() => finishSwipe(true)}
                    onClick={() => {
                      if (suppressClickRef.current === track.id) {
                        suppressClickRef.current = null
                        return
                      }
                      if (revealedId !== null) {
                        setRevealedId(null)
                        return
                      }
                      onPlayTrack(track.id)
                    }}
                    aria-label={`播放 ${track.title}`}
                  >
                    <span className="mobile-arrangement-order">{String(index + 1).padStart(2, '0')}</span>
                    <span className="mobile-arrangement-cover"><ArtworkImage src={track.cover} alt="" />{active && <span className={`mini-levels ${isPlaying ? 'is-playing' : ''}`} aria-hidden="true"><i /><i /><i /></span>}</span>
                    <span className="mobile-arrangement-copy"><strong>{track.title}</strong><small>{track.artist} · {track.source}</small></span>
                    <time>{track.duration}</time>
                  </button>
                  <button
                    type="button"
                    className="mobile-arrangement-handle"
                    data-track-id={track.id}
                    aria-label={`拖动调整 ${track.title} 的顺序`}
                    onPointerDown={(event) => beginDrag(event, track.id, index)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowUp' && index > 0) onReorderTrack(track.id, -1)
                      if (event.key === 'ArrowDown' && index < displayedTracks.length - 1) onReorderTrack(track.id, 1)
                    }}
                  ><GripVertical size={19} /></button>
                </div>
              </article>
            )
          })}
        </div>
      ) : <div className="mobile-arrangement-empty"><strong>还没有可调整的歌曲</strong><p>回到对话，描述场景或想听的内容，生成第一份编排。</p></div>}
    </section>
  )
}
