import { Volume1, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

type Props = {
  volume: number
  muted: boolean
  onVolumeChange: (volume: number) => void
  onToggleMute: () => void
  inline?: boolean
  className?: string
}

export default function VolumeControl({ volume, muted, onVolumeChange, onToggleMute, inline = false, className = '' }: Props) {
  const level = muted ? 0 : volume
  const VolumeIcon = level === 0 ? VolumeX : level < 45 ? Volume1 : Volume2
  const [open, setOpen] = useState(false)
  const controlRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!controlRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  if (inline) {
    return (
      <div className={`volume-control is-inline ${className}`} style={{ '--volume-level': `${level}%` } as CSSProperties}>
        <button onClick={onToggleMute} title={muted ? '取消静音' : '静音'} aria-label={muted ? '取消静音' : '静音'}><VolumeIcon size={17} /></button>
        <input type="range" min="0" max="100" value={level} onChange={(event) => onVolumeChange(Number(event.target.value))} aria-label="音量" />
        <strong>{level}%</strong>
      </div>
    )
  }

  return (
    <div className={`volume-control is-popup ${className}`} ref={controlRef} style={{ '--volume-level': `${level}%` } as CSSProperties}>
      <button className={open ? 'is-active' : ''} onClick={() => setOpen(!open)} title="音量" data-tooltip={muted ? '已静音' : `音量 ${level}%`} aria-label="音量"><VolumeIcon size={18} /></button>
      {open && (
        <div className="volume-popover" role="dialog" aria-label="音量控制">
          <button onClick={onToggleMute} title={muted ? '取消静音' : '静音'} aria-label={muted ? '取消静音' : '静音'}><VolumeIcon size={17} /></button>
          <input type="range" min="0" max="100" value={level} onChange={(event) => onVolumeChange(Number(event.target.value))} aria-label="音量" />
          <strong>{level}%</strong>
        </div>
      )}
    </div>
  )
}
