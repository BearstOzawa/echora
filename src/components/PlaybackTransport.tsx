import { Heart, ListOrdered, Pause, Play, Repeat1, Shuffle, SkipBack, SkipForward } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { PlaybackProgressStore } from '../playbackProgress'
import type { PlaybackMode, PlaybackRate, Track } from '../types'
import VolumeControl from './VolumeControl'
import PlaybackSpeedControl from './PlaybackSpeedControl'

type Props = {
  variant: 'compact'
  track: Track
  isPlaying: boolean
  progressStore: PlaybackProgressStore
  volume: number
  muted: boolean
  playbackMode: PlaybackMode
  playbackRate: PlaybackRate
  liked: boolean
  onTogglePlay: () => void
  onNext: () => void
  onPrevious: () => void
  onSeek: (progress: number) => void
  onVolumeChange: (volume: number) => void
  onToggleMute: () => void
  onCyclePlaybackMode: () => void
  onPlaybackRateChange: (rate: PlaybackRate) => void
  onToggleLike: () => void
}

export default function PlaybackTransport({ variant, track, isPlaying, progressStore, volume, muted, playbackMode, playbackRate, liked, onTogglePlay, onNext, onPrevious, onSeek, onVolumeChange, onToggleMute, onCyclePlaybackMode, onPlaybackRateChange, onToggleLike }: Props) {
  const initialProgress = progressStore.getSnapshot()
  const initialSeconds = Math.floor((track.durationSeconds * initialProgress) / 100)
  const currentTimeRef = useRef<HTMLSpanElement>(null)
  const scrubberRef = useRef<HTMLDivElement>(null)
  const progressInputRef = useRef<HTMLInputElement>(null)
  const playButtonRef = useRef<HTMLButtonElement>(null)
  const PlaybackModeIcon = playbackMode === 'shuffle' ? Shuffle : playbackMode === 'repeat-one' ? Repeat1 : ListOrdered
  const playbackModeLabel = playbackMode === 'shuffle' ? '随机播放' : playbackMode === 'repeat-one' ? '单曲循环' : '顺序播放'

  useEffect(() => {
    let renderedSecond = -1
    let renderedProgress = -1
    const updateProgress = () => {
      const progress = progressStore.getSnapshot()
      const currentSeconds = Math.floor((track.durationSeconds * progress) / 100)
      const isSeekJump = renderedProgress < 0 || Math.abs(progress - renderedProgress) >= 1
      if (currentSeconds === renderedSecond && !isSeekJump) return
      renderedSecond = currentSeconds
      renderedProgress = progress
      scrubberRef.current?.style.setProperty('--playback-progress', `${progress}%`)
      playButtonRef.current?.style.setProperty('--player-progress', `${progress}%`)
      if (progressInputRef.current && document.activeElement !== progressInputRef.current) progressInputRef.current.value = String(progress)
      if (currentTimeRef.current) currentTimeRef.current.textContent = `${Math.floor(currentSeconds / 60)}:${String(currentSeconds % 60).padStart(2, '0')}`
    }
    updateProgress()
    return progressStore.subscribe(updateProgress)
  }, [progressStore, track.durationSeconds])

  return (
    <div
      className={`playback-transport is-${variant}`}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('button')) event.preventDefault()
      }}
      onPointerUp={(event) => {
        (event.target as HTMLElement).closest<HTMLButtonElement>('button')?.blur()
      }}
    >
      <div className="playback-progress">
        <span ref={currentTimeRef}>{`${Math.floor(initialSeconds / 60)}:${String(initialSeconds % 60).padStart(2, '0')}`}</span>
        <div ref={scrubberRef} className="playback-scrubber" style={{ '--playback-progress': `${initialProgress}%` } as CSSProperties}>
          <span className="playback-scrubber-visual" aria-hidden="true">
            <i className="playback-scrubber-fill" />
            <i className="playback-scrubber-thumb" />
          </span>
          <input ref={progressInputRef} name="playback-progress" type="range" min="0" max="100" step="0.01" defaultValue={initialProgress} onChange={(event) => onSeek(Number(event.target.value))} aria-label="播放进度" />
        </div>
        <span>{track.duration}</span>
      </div>

      <div className="playback-toolbar">
        <div className="playback-secondary">
          <button className={playbackMode === 'sequence' ? '' : 'is-active'} onClick={onCyclePlaybackMode} title={playbackModeLabel} data-tooltip={playbackModeLabel} aria-label={`播放模式：${playbackModeLabel}`}><PlaybackModeIcon size={18} /></button>
          <PlaybackSpeedControl rate={playbackRate} onChange={onPlaybackRateChange} />
          <button className={liked ? 'is-liked' : ''} onClick={onToggleLike} title={liked ? '取消喜欢' : '喜欢'} data-tooltip={liked ? '取消喜欢' : '喜欢'} aria-label={liked ? '取消喜欢' : '喜欢'} aria-pressed={liked}><Heart size={18} fill={liked ? 'currentColor' : 'none'} /></button>
        </div>
        <div className="playback-primary">
          <button onClick={onPrevious} title="上一首" data-tooltip="上一首" aria-label="上一首"><SkipBack size={19} fill="currentColor" /></button>
          <button ref={playButtonRef} className="playback-play" onClick={onTogglePlay} title={isPlaying ? '暂停' : '播放'} data-tooltip={isPlaying ? '暂停' : '播放'} aria-label={isPlaying ? '暂停' : '播放'} style={{ '--player-progress': `${initialProgress}%` } as CSSProperties}>
            {isPlaying ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}
          </button>
          <button onClick={onNext} title="下一首" data-tooltip="下一首" aria-label="下一首"><SkipForward size={19} fill="currentColor" /></button>
        </div>
        <VolumeControl className="playback-volume" volume={volume} muted={muted} onVolumeChange={onVolumeChange} onToggleMute={onToggleMute} />
      </div>
    </div>
  )
}
