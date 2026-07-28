import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  GripVertical,
  ChevronDown,
  ChevronUp,
  ListMusic,
  Orbit,
  Play,
  RotateCcw,
  Trash2,
  Waypoints,
} from 'lucide-react'
import type { Track } from '../types'
import useCanvasZoom from '../useCanvasZoom'
import useLongPress from '../useLongPress'
import WorkspaceHeader from './WorkspaceHeader'
import ContextMenu from './ContextMenu'
import ArtworkImage from './ArtworkImage'

type Props = {
  embedded?: boolean
  tracks: Track[]
  activeTrackId: number
  isPlaying: boolean
  onPlayTrack: (id: number) => void
  onMoveTrack: (id: number, x: number, y: number) => void
  onReorderTrack: (id: number, direction: -1 | 1) => void
  onReorderTrackTo: (id: number, targetIndex: number) => void
  onRemoveTrack: (id: number) => void
  onOpenNowPlaying: (id: number) => void
  initialZoom?: number
  onZoomChange?: (zoom: number) => void
  title: string
  durationMinutes: number
  commandBar: ReactNode
}

export default function FieldCanvas({
  embedded = false,
  tracks,
  activeTrackId,
  isPlaying,
  onPlayTrack,
  onMoveTrack,
  onReorderTrack,
  onReorderTrackTo,
  onRemoveTrack,
  onOpenNowPlaying,
  initialZoom = 100,
  onZoomChange,
  title,
  durationMinutes,
  commandBar,
}: Props) {
  const planeRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const movedRef = useRef(false)
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [trackMenu, setTrackMenu] = useState<{ x: number; y: number; track: Track } | null>(null)
  const [layoutMode, setLayoutMode] = useState<'map' | 'list'>(() => tracks.length > 18 ? 'list' : 'map')
  const manualLayoutRef = useRef(false)
  const previousTrackCountRef = useRef(tracks.length)
  const listScrollRef = useRef<HTMLDivElement>(null)
  const listDragRef = useRef<{ id: number; originIndex: number; targetIndex: number; startY: number; rowHeight: number; order: number[]; initialScrollTop: number } | null>(null)
  const listDragCleanupRef = useRef<(() => void) | null>(null)
  const { zoom, zoomLabel, isDefaultZoom, viewportRef, resetZoom } = useCanvasZoom(initialZoom, onZoomChange)
  const orderedTracks = useMemo(() => [...tracks].sort((a, b) => a.x - b.x), [tracks])
  const orderedTrackKey = orderedTracks.map((track) => track.id).join(',')
  const trackById = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks])
  const [listDraftOrder, setListDraftOrder] = useState(() => orderedTracks.map((track) => track.id))
  const draftedListTracks = listDraftOrder.map((id) => trackById.get(id)).filter((track): track is Track => Boolean(track))
  const displayedListTracks = draftedListTracks.length === orderedTracks.length ? draftedListTracks : orderedTracks
  const nodeLongPress = useLongPress<HTMLButtonElement>(({ clientX, clientY, currentTarget }) => {
    const track = tracks.find((item) => item.id === Number(currentTarget.dataset.trackId))
    if (track) setTrackMenu({ x: clientX, y: clientY, track })
  }, { movementThreshold: 6 })
  const route = orderedTracks.map((track) => `${track.x},${track.y}`).join(' ')
  const densityScale = tracks.length > 14 ? .82 : tracks.length > 7 ? .92 : 1

  useEffect(() => {
    const previousCount = previousTrackCountRef.current
    previousTrackCountRef.current = tracks.length
    if (manualLayoutRef.current) return
    if (tracks.length > 18 && previousCount <= 18) setLayoutMode('list')
    if (tracks.length <= 18 && previousCount > 18) setLayoutMode('map')
  }, [tracks.length])

  useEffect(() => {
    if (!listDragRef.current) setListDraftOrder(orderedTracks.map((track) => track.id))
  }, [orderedTrackKey])

  useEffect(() => () => listDragCleanupRef.current?.(), [])

  const selectLayout = (mode: 'map' | 'list') => {
    manualLayoutRef.current = true
    setLayoutMode(mode)
  }

  const moveNode = (event: React.PointerEvent<HTMLButtonElement>, id: number) => {
    if (draggingId !== id || !planeRef.current) return
    if (dragStartRef.current && Math.hypot(event.clientX - dragStartRef.current.x, event.clientY - dragStartRef.current.y) > 4) movedRef.current = true
    if (!movedRef.current) return
    const bounds = planeRef.current.getBoundingClientRect()
    const x = Math.max(10, Math.min(90, ((event.clientX - bounds.left) / bounds.width) * 100))
    const y = Math.max(15, Math.min(76, ((event.clientY - bounds.top) / bounds.height) * 100))
    onMoveTrack(id, x, y)
  }

  const beginListDrag = (event: React.PointerEvent<HTMLButtonElement>, id: number, index: number) => {
    if (event.button !== 0 || !listScrollRef.current) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const row = event.currentTarget.closest<HTMLElement>('article')
    const order = displayedListTracks.map((track) => track.id)
    listDragRef.current = {
      id,
      originIndex: index,
      targetIndex: index,
      startY: event.clientY,
      rowHeight: Math.max(58, row?.getBoundingClientRect().height ?? 68),
      order,
      initialScrollTop: listScrollRef.current.scrollTop,
    }
    setDraggingId(id)

    const move = (pointerEvent: PointerEvent) => {
      const drag = listDragRef.current
      const scrollElement = listScrollRef.current
      if (!drag || !scrollElement) return
      pointerEvent.preventDefault()
      const bounds = scrollElement.getBoundingClientRect()
      const edgeDistance = 56
      if (bounds.height > edgeDistance * 2) {
        if (pointerEvent.clientY < bounds.top + edgeDistance) scrollElement.scrollTop -= Math.max(5, (bounds.top + edgeDistance - pointerEvent.clientY) * .2)
        if (pointerEvent.clientY > bounds.bottom - edgeDistance) scrollElement.scrollTop += Math.max(5, (pointerEvent.clientY - (bounds.bottom - edgeDistance)) * .2)
      }
      const scrollShift = scrollElement.scrollTop - drag.initialScrollTop
      const shift = Math.round((pointerEvent.clientY - drag.startY + scrollShift) / drag.rowHeight)
      const targetIndex = Math.max(0, Math.min(drag.order.length - 1, drag.originIndex + shift))
      if (targetIndex === drag.targetIndex) return
      drag.targetIndex = targetIndex
      const next = [...drag.order]
      const [moved] = next.splice(drag.originIndex, 1)
      next.splice(targetIndex, 0, moved)
      setListDraftOrder(next)
    }
    const finish = (cancelled: boolean) => {
      const drag = listDragRef.current
      listDragCleanupRef.current?.()
      if (!drag) return
      listDragRef.current = null
      setDraggingId(null)
      if (cancelled) {
        setListDraftOrder(drag.order)
        return
      }
      if (drag.targetIndex !== drag.originIndex) onReorderTrackTo(drag.id, drag.targetIndex)
    }
    const pointerUp = () => finish(false)
    const pointerCancel = () => finish(true)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', pointerUp)
    window.addEventListener('pointercancel', pointerCancel)
    listDragCleanupRef.current = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', pointerUp)
      window.removeEventListener('pointercancel', pointerCancel)
      listDragCleanupRef.current = null
    }
  }

  const timeMarks = [0, .25, .5, .75, 1].map((part) => Math.round(durationMinutes * part))

  return (
    <section className={`field-workspace ${embedded ? 'is-embedded' : ''}`} data-playing={isPlaying ? 'true' : 'false'}>
      {!embedded && <WorkspaceHeader
        icon={Orbit}
        eyebrow={`当前编排 · ${tracks.length} 首`}
        title={title}
        actions={<>
          <div className="field-legend">
            <span><i className="legend-path" /> 播放顺序</span>
            <span><i className="legend-active" /> 当前歌曲</span>
          </div>
          <div className="field-tools">
            <div className="field-layout-switch" aria-label="编排布局"><button className={layoutMode === 'map' ? 'is-active' : ''} onClick={() => selectLayout('map')} title="图谱布局"><Waypoints size={15} /></button><button className={layoutMode === 'list' ? 'is-active' : ''} onClick={() => selectLayout('list')} title="顺序列表"><ListMusic size={15} /></button></div>
            {layoutMode === 'map' && <button className="canvas-reset-button" onClick={resetZoom} disabled={isDefaultZoom} title={`恢复默认大小 · 当前 ${zoomLabel}%`} aria-label={`恢复默认大小，当前 ${zoomLabel}%`}><RotateCcw size={15} /></button>}
          </div>
        </>}
      />}

      {!embedded && commandBar}

      <div className="field-canvas">
        {embedded && (
          <div className="field-floating-tools" aria-label="编排视图控制">
            <div className="field-layout-switch" aria-label="编排布局"><button className={layoutMode === 'map' ? 'is-active' : ''} onClick={() => selectLayout('map')} title="图谱布局" aria-label="使用图谱布局"><Waypoints size={15} /></button><button className={layoutMode === 'list' ? 'is-active' : ''} onClick={() => selectLayout('list')} title="顺序列表" aria-label="使用顺序列表"><ListMusic size={15} /></button></div>
            {layoutMode === 'map' && <><span>{zoomLabel}%</span><button className="canvas-reset-button" onClick={resetZoom} disabled={isDefaultZoom} title="恢复默认大小" aria-label={`恢复默认大小，当前 ${zoomLabel}%`}><RotateCcw size={15} /></button></>}
          </div>
        )}
        {layoutMode === 'map' ? <div className="composition-area" ref={viewportRef}>
          <div className="composition-plane" ref={planeRef} data-density={zoom < 75 ? 'compact' : zoom < 90 ? 'dense' : 'normal'} style={{ '--node-scale': (zoom / 100) * densityScale } as React.CSSProperties}>
            <div className="energy-axis" aria-hidden="true">
              <span>高强度</span>
              <i />
              <span>低强度</span>
            </div>
            <div className="time-axis" aria-hidden="true">
              {timeMarks.map((minute, index) => <span key={`${minute}-${index}`}>{index === 0 ? '开始' : `${minute} 分`}</span>)}
            </div>

            <svg className="route-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <polyline points={route} />
              {orderedTracks.map((track) => <circle key={track.id} cx={track.x} cy={track.y} r=".65" />)}
            </svg>

            {orderedTracks.map((track, index) => {
              const isActive = track.id === activeTrackId
              return (
                <button
                  key={track.id}
                  className={`track-node supports-long-press ${isActive ? 'is-active' : ''} ${draggingId === track.id ? 'is-dragging' : ''}`}
                  data-track-id={track.id}
                  style={{ left: `${track.x}%`, top: `${track.y}%` }}
                  onPointerDown={(event) => {
                    nodeLongPress.onPointerDown(event)
                    if (event.button !== 0) return
                    event.currentTarget.setPointerCapture(event.pointerId)
                    dragStartRef.current = { x: event.clientX, y: event.clientY }
                    movedRef.current = false
                    setDraggingId(track.id)
                  }}
                  onPointerMove={(event) => { nodeLongPress.onPointerMove(event); moveNode(event, track.id) }}
                  onPointerUp={(event) => { nodeLongPress.onPointerUp(event); setDraggingId(null); dragStartRef.current = null }}
                  onPointerCancel={() => { nodeLongPress.onPointerCancel(); setDraggingId(null); dragStartRef.current = null; movedRef.current = false }}
                  onClickCapture={nodeLongPress.onClickCapture}
                  onClick={() => {
                    if (movedRef.current) {
                      movedRef.current = false
                      return
                    }
                    onPlayTrack(track.id)
                  }}
                  onContextMenu={(event) => { event.preventDefault(); event.currentTarget.focus(); setTrackMenu({ x: event.clientX, y: event.clientY, track }) }}
                  onKeyDown={(event) => {
                    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
                    event.preventDefault()
                    const bounds = event.currentTarget.getBoundingClientRect()
                    setTrackMenu({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2, track })
                  }}
                  aria-label={`${track.title}, ${track.artist}`}
                >
                  <span className="node-cover-wrap">
                    <ArtworkImage src={track.cover} alt="" />
                    {isActive && <span className="node-playing"><span className={`mini-levels ${isPlaying ? 'is-playing' : ''}`} aria-hidden="true"><i /><i /><i /></span></span>}
                  </span>
                  <span className="node-copy">
                    <span className="node-title-line"><span className="node-order">{String(index + 1).padStart(2, '0')}</span><strong>{track.title}</strong></span>
                    <small>{track.bpm > 0 ? `${track.bpm} BPM${track.musicalKey !== '待分析' && track.musicalKey !== '未知' ? ` · ${track.musicalKey}` : ''}` : `${track.source} · ${track.duration}`}</small>
                  </span>
                </button>
              )
            })}
          </div>
        </div> : <div className={`field-sequence-list ${tracks.length > 24 ? 'is-long' : ''}`} role="list" aria-label={`当前编排，共 ${tracks.length} 首`}>
          <header><span><strong>播放顺序</strong><small>{tracks.length > 18 ? '长编排已切换为列表，调整时不会挤压歌曲信息' : '按播放顺序排列'}</small></span><em>{tracks.length} 首 · 约 {durationMinutes} 分钟</em></header>
          <div ref={listScrollRef}>
            {displayedListTracks.map((track, index) => {
              const isActive = track.id === activeTrackId
              return <article key={track.id} className={`${isActive ? 'is-active' : ''} ${draggingId === track.id ? 'is-dragging' : ''}`} role="listitem" onContextMenu={(event) => { event.preventDefault(); setTrackMenu({ x: event.clientX, y: event.clientY, track }) }}>
                <button className="field-sequence-drag-handle" onPointerDown={(event) => beginListDrag(event, track.id, index)} onKeyDown={(event) => {
                  if (event.key === 'ArrowUp' && index > 0) onReorderTrack(track.id, -1)
                  if (event.key === 'ArrowDown' && index < displayedListTracks.length - 1) onReorderTrack(track.id, 1)
                }} title="拖动调整顺序" aria-label={`拖动调整 ${track.title} 的顺序`}><GripVertical size={17} /></button>
                <button className="field-sequence-main" onClick={() => onPlayTrack(track.id)} aria-label={`播放 ${track.title}`}>
                  <span className="field-sequence-order">{String(index + 1).padStart(2, '0')}</span>
                  <span className="field-sequence-cover"><ArtworkImage src={track.cover} alt="" />{isActive && <span className={`mini-levels ${isPlaying ? 'is-playing' : ''}`} aria-hidden="true"><i /><i /><i /></span>}</span>
                  <span className="field-sequence-copy"><strong>{track.title}</strong><small>{track.artist} · {track.album}</small></span>
                  <span className="field-sequence-meta">{track.bpm > 0 ? `${track.bpm} BPM` : track.source}<small>{track.duration}</small></span>
                </button>
                <span className="field-sequence-actions">
                  <button onClick={() => onReorderTrack(track.id, -1)} disabled={index === 0} title="提前一位" aria-label={`将 ${track.title} 提前一位`}><ChevronUp size={16} /></button>
                  <button onClick={() => onReorderTrack(track.id, 1)} disabled={index === displayedListTracks.length - 1} title="后移一位" aria-label={`将 ${track.title} 后移一位`}><ChevronDown size={16} /></button>
                  <button className="is-danger" onClick={() => onRemoveTrack(track.id)} disabled={tracks.length <= 1} title="移出编排" aria-label={`将 ${track.title} 移出编排`}><Trash2 size={15} /></button>
                </span>
              </article>
            })}
          </div>
        </div>}

      </div>
      {trackMenu && (() => {
        const trackIndex = orderedTracks.findIndex((track) => track.id === trackMenu.track.id)
        return <ContextMenu x={trackMenu.x} y={trackMenu.y} onClose={() => setTrackMenu(null)} items={[
          { label: '立即播放', icon: Play, onSelect: () => onPlayTrack(trackMenu.track.id) },
          { label: '提前一位', icon: ArrowLeft, disabled: trackIndex <= 0, onSelect: () => onReorderTrack(trackMenu.track.id, -1) },
          { label: '后移一位', icon: ArrowRight, disabled: trackIndex < 0 || trackIndex >= orderedTracks.length - 1, onSelect: () => onReorderTrack(trackMenu.track.id, 1) },
          { label: '进入歌曲模式', icon: ExternalLink, onSelect: () => onOpenNowPlaying(trackMenu.track.id) },
          { label: '移出当前编排', icon: Trash2, danger: true, disabled: tracks.length <= 1, onSelect: () => onRemoveTrack(trackMenu.track.id) },
        ]} />
      })()}
    </section>
  )
}
