import { Copy, Share2, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useEffect, useRef } from 'react'
import type { Track } from '../types'
import ArtworkImage from './ArtworkImage'
import BrandMark from './BrandMark'

type Props = {
  track: Track
  systemShareAvailable: boolean
  onSystemShare: () => Promise<void> | void
  onCopy: () => Promise<void> | void
  onClose: () => void
}

export default function TrackSharePanel({ track, systemShareAvailable, onSystemShare, onCopy, onClose }: Props) {
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    panelRef.current?.focus({ preventScroll: true })
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const share = async (action: () => Promise<void> | void) => {
    await action()
    onClose()
  }

  const panel = (
    <div className="track-share-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={panelRef} className="track-share-panel" role="dialog" aria-modal="true" aria-label={`分享 ${track.title}`} tabIndex={-1} onPointerDown={(event) => event.stopPropagation()}>
        <header><span><BrandMark /><span><strong>分享歌曲</strong><small>从 Echora 分享正在播放的音乐</small></span></span><button onClick={onClose} aria-label="关闭分享"><X size={18} /></button></header>
        <div className="track-share-preview">
          <ArtworkImage src={track.cover} alt="" />
          <span><strong>{track.title}</strong><small>{track.artist}</small><em>{track.album} · {track.source}</em></span>
        </div>
        <p>分享内容包含歌曲、艺人和专辑信息，不会包含服务凭据或播放地址。</p>
        <div className="track-share-actions">
          {systemShareAvailable && <button className="is-primary" onClick={() => void share(onSystemShare)}><Share2 size={18} /><span><strong>系统分享</strong><small>选择设备上的应用或联系人</small></span></button>}
          <button className={systemShareAvailable ? '' : 'is-primary'} onClick={() => void share(onCopy)}><Copy size={18} /><span><strong>复制分享内容</strong><small>粘贴到消息或其他应用</small></span></button>
        </div>
      </section>
    </div>
  )
  const host = document.querySelector('.client-shell') ?? document.body
  return createPortal(panel, host)
}
