import { Gauge } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { PlaybackRate } from '../types'

type Props = {
  rate: PlaybackRate
  onChange: (rate: PlaybackRate) => void
}

const rates: PlaybackRate[] = [0.5, 0.75, 1, 1.25, 1.5, 2]
const rateLabel = (rate: PlaybackRate) => `${rate}×`

export default function PlaybackSpeedControl({ rate, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const controlRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!controlRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div className="playback-speed-control" ref={controlRef}>
      <button className={`playback-speed-trigger ${open || rate !== 1 ? 'is-active' : ''}`} onClick={() => setOpen(!open)} title={`播放速度 ${rateLabel(rate)}`} data-tooltip={`播放速度 ${rateLabel(rate)}`} aria-label={`播放速度：${rateLabel(rate)}`} aria-expanded={open}>{rateLabel(rate)}</button>
      {open && (
        <div className="playback-speed-popover" role="dialog" aria-label="播放速度">
          <header><Gauge size={15} /><strong>播放速度</strong></header>
          <div>{rates.map((option) => <button key={option} className={option === rate ? 'is-active' : ''} onClick={() => { onChange(option); setOpen(false) }} aria-label={`设置播放速度为 ${rateLabel(option)}`}>{rateLabel(option)}</button>)}</div>
        </div>
      )}
    </div>
  )
}
