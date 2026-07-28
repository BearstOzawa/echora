import { ALargeSmall, AudioLines, Check, ChevronDown, CloudDownload, Download, ListMusic, ListOrdered, LoaderCircle, MoreHorizontal, RadioTower, Repeat1, Share2, Shuffle, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { PlaybackProgressStore } from '../playbackProgress'
import type { LxQuality, OnlineSource, PlaybackMode, PlaybackRate, Track } from '../types'
import { defaultPlaybackContext } from '../playbackContext'
import type { PlaybackContext } from '../playbackContext'
import { sourceBrandKey } from '../sourceBrand'
import PlaybackTransport from './PlaybackTransport'
import ArtworkImage from './ArtworkImage'
import ContextMenu from './ContextMenu'
import type { ContextMenuItem } from './ContextMenu'
import TrackSharePanel from './TrackSharePanel'
import { downloadStateLabel } from '../downloadManager'
import type { TrackDownloadState } from '../downloadManager'

type Props = {
  track: Track
  isPlaying: boolean
  progressStore: PlaybackProgressStore
  volume: number
  muted: boolean
  queue: Track[]
  playbackContext?: PlaybackContext
  playbackMode: PlaybackMode
  playbackRate: PlaybackRate
  liked: boolean
  nowPlayingOpen: boolean
  effectsOpen?: boolean
  sourceVariants: Track[]
  variantBusy: boolean
  enhancedQualityEnabled?: boolean
  onTogglePlay: () => void
  onNext: () => void
  onPrevious: () => void
  onSeek: (progress: number) => void
  onVolumeChange: (volume: number) => void
  onToggleMute: () => void
  onOpenNowPlaying: () => void
  onOpenEffects?: () => void
  onOpenArrangement: () => void
  onPlayTrack: (id: number) => void
  onCyclePlaybackMode: () => void
  onPlaybackRateChange: (rate: PlaybackRate) => void
  onToggleLike: () => void
  onSourceChange: (source: OnlineSource) => void
  onQualityChange: (quality: LxQuality) => void
  onDownloadTrack?: () => void
  onCancelDownload?: () => void
  onExportTrack?: () => void
  onShareTrack?: (method: 'system' | 'copy') => Promise<void> | void
  onOpenLyricSettings?: () => void
  downloadBusy?: boolean
  downloadState?: TrackDownloadState
}

const qualityLabels: Record<LxQuality, string> = { '128k': '标准 128K', '320k': '高品 320K', flac: '无损 FLAC', flac24bit: 'Hi-Res' }

export default function GlobalPlayer({ track, isPlaying, progressStore, volume, muted, queue, playbackContext = defaultPlaybackContext, playbackMode, playbackRate, liked, nowPlayingOpen, effectsOpen = false, sourceVariants, variantBusy, onTogglePlay, onNext, onPrevious, onSeek, onVolumeChange, onToggleMute, onOpenNowPlaying, onOpenEffects, onOpenArrangement, onPlayTrack, onCyclePlaybackMode, onPlaybackRateChange, onToggleLike, onSourceChange, onQualityChange, onDownloadTrack, onCancelDownload, onExportTrack, onShareTrack, onOpenLyricSettings, downloadBusy = false, downloadState }: Props) {
  const [queueOpen, setQueueOpen] = useState(false)
  const [variantOpen, setVariantOpen] = useState(false)
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const queueRef = useRef<HTMLDivElement>(null)
  const variantRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!queueOpen && !variantOpen) return
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (queueOpen && !queueRef.current?.contains(target)) setQueueOpen(false)
      if (variantOpen && !variantRef.current?.contains(target)) setVariantOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setQueueOpen(false)
        setVariantOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [queueOpen, variantOpen])

  const currentQuality = track.remote?.resolvedQuality
  const qualityOptions = track.remote?.availableQualities ?? []
  const currentQualityLabel = currentQuality ? qualityLabels[currentQuality] : track.remote ? '播放时解析' : track.quality
  const trackQualityLabel = (item: Track) => item.remote?.resolvedQuality ? qualityLabels[item.remote.resolvedQuality] : item.remote ? '播放时解析' : item.quality
  const activeOutsideQueue = !queue.some((item) => item.id === track.id)
  const QueueModeIcon = playbackMode === 'shuffle' ? Shuffle : playbackMode === 'repeat-one' ? Repeat1 : ListOrdered
  const queueModeLabel = playbackMode === 'shuffle' ? '随机播放' : playbackMode === 'repeat-one' ? '单曲循环' : '顺序播放'
  const moreItems: ContextMenuItem[] = []
  if (nowPlayingOpen && onOpenLyricSettings) moreItems.push({ label: '歌词字号', icon: ALargeSmall, onSelect: onOpenLyricSettings })
  if (track.localFileId && onExportTrack) moreItems.push({ label: '导出歌曲', icon: Download, separatorBefore: moreItems.length > 0, onSelect: onExportTrack })
  else if (downloadBusy && onCancelDownload) moreItems.push({ label: `${downloadStateLabel(downloadState)} · 取消`, icon: X, separatorBefore: moreItems.length > 0, onSelect: onCancelDownload })
  else if (onDownloadTrack) moreItems.push({ label: downloadState?.phase === 'failed' ? '重试下载' : '下载到本地', icon: CloudDownload, separatorBefore: moreItems.length > 0, onSelect: onDownloadTrack })
  if (onShareTrack) moreItems.push({ label: '分享歌曲', icon: Share2, separatorBefore: moreItems.length > 0, onSelect: () => setShareOpen(true) })

  return (
    <footer className="global-player" aria-label="全局播放器" data-music-source={sourceBrandKey(track.source)}>
      <div className="global-player-track-area">
        <button className="global-player-track" onClick={onOpenNowPlaying} onPointerUp={(event) => event.currentTarget.blur()} title={nowPlayingOpen ? '收起歌曲模式' : '进入歌曲模式'}>
          <span className="global-player-cover"><ArtworkImage src={track.cover} alt="" loading="eager" /><i className={`global-player-motion ${isPlaying ? 'is-playing' : ''}`} aria-hidden="true"><b /><b /><b /></i></span>
          <span><strong>{track.title}</strong><small>{track.artist} · {track.album}</small></span>
        </button>
      </div>

      <div className="global-player-center">
        <PlaybackTransport variant="compact" track={track} isPlaying={isPlaying} progressStore={progressStore} volume={volume} muted={muted} playbackMode={playbackMode} playbackRate={playbackRate} liked={liked} onTogglePlay={onTogglePlay} onNext={onNext} onPrevious={onPrevious} onSeek={onSeek} onVolumeChange={onVolumeChange} onToggleMute={onToggleMute} onCyclePlaybackMode={onCyclePlaybackMode} onPlaybackRateChange={onPlaybackRateChange} onToggleLike={onToggleLike} />
      </div>

      <div className="global-player-tools">
        {onOpenEffects && <button className={`global-player-effects ${effectsOpen ? 'is-active' : ''}`} onClick={onOpenEffects} title="声音空间" data-tooltip="声音空间" aria-label="打开声音空间" aria-expanded={effectsOpen}><AudioLines size={18} /></button>}
        <div className="global-player-variant-wrap" ref={variantRef}>
          <button
            className={`global-player-variant ${variantOpen ? 'is-active' : ''}`}
            onClick={() => { setVariantOpen(!variantOpen); setQueueOpen(false) }}
            aria-expanded={variantOpen}
            aria-label={`播放版本：${track.source}，${currentQualityLabel}`}
            title="切换音源与音质"
            data-tooltip="音源与音质"
            data-music-source={sourceBrandKey(track.source)}
          >
            {variantBusy ? <LoaderCircle className="is-spinning" size={16} /> : <RadioTower size={16} />}
            <span><small>{track.source}</small><strong>{currentQualityLabel}</strong></span>
            <ChevronDown size={14} />
          </button>
          {variantOpen && (
            <>
              <button className="mobile-playback-sheet-backdrop" onClick={() => setVariantOpen(false)} aria-label="关闭播放版本弹层" />
              <div className="playback-variant-panel" role="dialog" aria-label="播放版本">
                <header><span><strong>播放版本</strong><small>切换后重新获取播放地址</small></span><button className="playback-variant-close" onClick={() => setVariantOpen(false)} aria-label="关闭播放版本"><X size={17} /></button></header>
                <section>
                  <span className="playback-variant-label"><RadioTower size={13} /> 音源</span>
                  <div className="playback-source-options">
                    {sourceVariants.map((variant) => { const active = variant.remote?.source === track.remote?.source; return <button key={variant.remote?.source ?? variant.source} data-music-source={sourceBrandKey(variant.source)} className={active ? 'is-active' : ''} onClick={() => { if (variant.remote) onSourceChange(variant.remote.source); setVariantOpen(false) }} disabled={variantBusy || !variant.remote}><span><strong>{variant.source}</strong><small>{variant.album}</small></span>{active && <Check size={14} />}</button> })}
                  </div>
                </section>
                <section>
                  <span className="playback-variant-label"><SlidersHorizontal size={13} /> 音质</span>
                  {qualityOptions.length ? <div className="playback-quality-options">{qualityOptions.map((option) => <button key={option} className={option === currentQuality ? 'is-active' : ''} onClick={() => { onQualityChange(option); setVariantOpen(false) }} disabled={variantBusy}><span>{qualityLabels[option]}</span>{option === currentQuality && <Check size={13} />}</button>)}</div> : <p>本地歌曲使用文件原始音质</p>}
                </section>
              </div>
            </>
          )}
        </div>
        {moreItems.length > 0 && <button className={`global-player-more ${moreMenu ? 'is-active' : ''}`} onClick={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); setMoreMenu({ x: bounds.right - 210, y: bounds.top - 8 }); setQueueOpen(false); setVariantOpen(false) }} title="更多" data-tooltip="更多" aria-label="更多播放操作" aria-expanded={Boolean(moreMenu)}><MoreHorizontal size={18} /></button>}
        <div className="global-player-queue-wrap" ref={queueRef}>
          <button className={`global-player-queue ${queueOpen ? 'is-active' : ''}`} onClick={() => { setQueueOpen(!queueOpen); setVariantOpen(false) }} aria-expanded={queueOpen} title="展开播放队列" data-tooltip="播放队列" aria-label={`播放队列，共 ${queue.length} 首`}><ListMusic size={18} /><span className="global-queue-count">{queue.length}</span></button>
          {queueOpen && (
            <>
              <button className="mobile-playback-sheet-backdrop" onClick={() => setQueueOpen(false)} aria-label="关闭播放队列弹层" />
              <div className="global-queue-panel" role="dialog" aria-label="播放队列">
                <header><span><strong>播放队列</strong><small>{queue.length} 首</small></span><div className="global-queue-header-actions"><button className="global-queue-mobile-arrangement" aria-label="编排队列" onClick={() => { onOpenArrangement(); setQueueOpen(false) }}><ListMusic size={15} /> 编排</button><button onClick={() => setQueueOpen(false)} title="关闭" aria-label="关闭播放队列"><X size={17} /></button></div></header>
                <nav className="global-queue-toolbar" aria-label="队列选项"><button onClick={onCyclePlaybackMode} title={queueModeLabel}><QueueModeIcon size={15} />{queueModeLabel}</button><span>{activeOutsideQueue ? '当前歌曲结束后进入此队列' : '正在播放此队列'}</span></nav>
                <div className="global-queue-list">
                  {queue.map((item, index) => (
                    <button key={item.id} data-music-source={sourceBrandKey(item.source)} className={item.id === track.id ? 'is-active' : ''} onClick={() => { onPlayTrack(item.id); setQueueOpen(false) }}>
                      <span className="global-queue-index">{item.id === track.id ? <span className={`mini-levels ${isPlaying ? 'is-playing' : ''}`} aria-hidden="true"><i /><i /><i /></span> : String(index + 1).padStart(2, '0')}</span>
                      <ArtworkImage src={item.cover} alt="" />
                      <span><strong>{item.title}</strong><small>{item.artist} · {trackQualityLabel(item)}</small></span>
                      <span>{item.duration}</span>
                    </button>
                  ))}
                </div>
                <footer><button onClick={() => { onOpenArrangement(); setQueueOpen(false) }} aria-label="编排"><ListMusic size={16} /> 编排</button></footer>
              </div>
            </>
          )}
        </div>
      </div>
      {moreMenu && <ContextMenu x={moreMenu.x} y={moreMenu.y} items={moreItems} onClose={() => setMoreMenu(null)} />}
      {shareOpen && onShareTrack && <TrackSharePanel track={track} systemShareAvailable={Boolean(navigator.share)} onSystemShare={() => onShareTrack('system')} onCopy={() => onShareTrack('copy')} onClose={() => setShareOpen(false)} />}
    </footer>
  )
}
