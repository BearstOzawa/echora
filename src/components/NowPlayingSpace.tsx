import { AudioLines, ChevronDown, LoaderCircle, RotateCcw } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { LyricLine } from '../lyrics'
import { usePlaybackProgressSelector } from '../playbackProgress'
import type { PlaybackProgressStore } from '../playbackProgress'
import type { Track } from '../types'
import { sourceBrandKey } from '../sourceBrand'
import ArtworkImage from './ArtworkImage'

type Props = {
  track: Track
  isPlaying: boolean
  progressStore: PlaybackProgressStore
  lyrics: LyricLine[]
  lyricsStatus: 'idle' | 'loading' | 'ready' | 'unavailable'
  lyricsMessage: string
  relatedTracks: Track[]
  reducedMotion: boolean
  mobile?: boolean
  onSeek: (progress: number) => void
  onPlayTrack: (track: Track) => void
  onOpenArtist: (track: Track) => void
  onOpenAlbum: (track: Track) => void
  onClose?: () => void
  fontControlsOpen?: boolean
  onFontControlsOpenChange?: (open: boolean) => void
}

type ContentView = 'lyrics' | 'info' | 'related'
type DisplayMode = 'record' | 'lyrics' | 'split'

const getActiveLine = (lyrics: LyricLine[], currentTime: number) => {
  let low = 0
  let high = lyrics.length - 1
  let activeLine = -1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (lyrics[middle].time <= currentTime) {
      activeLine = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return activeLine
}

const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
const lyricFontStorageKey = 'echora.lyricFontLevel'
const readLyricFontLevel = () => {
  const stored = Number(localStorage.getItem(lyricFontStorageKey) ?? 0)
  return Number.isInteger(stored) ? Math.min(5, Math.max(-5, stored)) : 0
}

const AmbientArtwork = memo(({ track }: { track: Track }) => (
  <div className="now-playing-ambient" aria-hidden="true"><ArtworkImage src={track.cover} alt="" loading="eager" /></div>
))

const RecordArtwork = memo(({ track, mobile, onShowLyrics }: { track: Track; mobile: boolean; onShowLyrics: () => void }) => (
  <div className="song-display-control is-record-control">
    {mobile ? <button className="now-playing-record-button" onClick={onShowLyrics} aria-label="显示歌词">
      <span className="now-playing-cover-stage"><span className="now-playing-cover-disc"><ArtworkImage src={track.cover} alt={`${track.title} 封面`} loading="eager" /></span></span>
    </button> : <span className="now-playing-record-button">
      <span className="now-playing-cover-stage"><span className="now-playing-cover-disc"><ArtworkImage src={track.cover} alt={`${track.title} 封面`} loading="eager" /></span></span>
    </span>}
  </div>
))

const PlaybackClock = ({ store, duration, total }: { store: PlaybackProgressStore; duration: number; total: string }) => {
  const elapsed = usePlaybackProgressSelector(store, (progress) => Math.floor(duration * progress / 100))
  return <time>{formatTime(elapsed)} / {total}</time>
}

const LyricLineButton = memo(({ line, index, active, near, onSelect }: { line: LyricLine; index: number; active: boolean; near: boolean; onSelect: (line: LyricLine) => void }) => (
  <button
    className={`lyric-line ${active ? 'is-active' : near ? 'is-near' : ''}`}
    data-lyric-index={index}
    onClick={() => onSelect(line)}
    aria-label={`${formatTime(line.time)} ${line.text}`}
    aria-current={active ? 'true' : undefined}
  >
    <span><strong>{line.text}</strong>{line.translation && <small>{line.translation}</small>}</span>
  </button>
))

export default function NowPlayingSpace({ track, isPlaying, progressStore, lyrics, lyricsStatus, lyricsMessage, relatedTracks, reducedMotion, mobile = false, onSeek, onPlayTrack, onOpenArtist, onOpenAlbum, onClose, fontControlsOpen: controlledFontControlsOpen, onFontControlsOpenChange }: Props) {
  const [fontLevel, setFontLevel] = useState(readLyricFontLevel)
  const [internalFontControlsOpen, setInternalFontControlsOpen] = useState(false)
  const [contentView, setContentView] = useState<ContentView>('lyrics')
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => mobile ? 'record' : 'split')
  const [mobileLandscape, setMobileLandscape] = useState(false)
  const activeLine = usePlaybackProgressSelector(progressStore, (progress) => getActiveLine(lyrics, track.durationSeconds * progress / 100))
  const lyricStyle = useMemo(() => ({
    '--lyric-font-size': `${16 + fontLevel * .8}px`,
    '--lyric-active-size': `${23 + fontLevel * 1.4}px`,
    '--lyric-translation-size': `${12 + fontLevel * .4}px`,
    '--lyric-line-height': `${56 + fontLevel * 4}px`,
    '--lyric-line-padding': `${7 + Math.max(0, fontLevel) * .8}px`,
    '--lyric-scale-position': `${(fontLevel + 5) * 10}%`,
  }) as CSSProperties, [fontLevel])
  const lyricsScrollRef = useRef<HTMLDivElement | null>(null)
  const fontControlsRef = useRef<HTMLDivElement | null>(null)
  const fontControlsOpen = controlledFontControlsOpen ?? internalFontControlsOpen
  const setFontControlsOpen = useCallback((open: boolean) => {
    if (controlledFontControlsOpen === undefined) setInternalFontControlsOpen(open)
    onFontControlsOpenChange?.(open)
  }, [controlledFontControlsOpen, onFontControlsOpenChange])

  useEffect(() => {
    setContentView('lyrics')
    setFontControlsOpen(false)
    setDisplayMode(mobile ? 'record' : 'split')
  }, [mobile, track.id])

  useEffect(() => {
    if (!mobile || typeof window.matchMedia !== 'function') {
      setMobileLandscape(false)
      return
    }
    const query = window.matchMedia('(orientation: landscape) and (max-height: 600px)')
    const update = () => setMobileLandscape(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [mobile])

  useEffect(() => {
    if (!fontControlsOpen) return
    const closeOutside = (event: PointerEvent) => {
      if (!fontControlsRef.current?.contains(event.target as Node)) setFontControlsOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFontControlsOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [fontControlsOpen])

  const changeFontLevel = (nextLevel: number) => {
    const boundedLevel = Math.min(5, Math.max(-5, nextLevel))
    setFontLevel(boundedLevel)
    localStorage.setItem(lyricFontStorageKey, String(boundedLevel))
  }

  const changeDisplayMode = (mode: DisplayMode) => {
    setDisplayMode(mode)
  }
  const showLyrics = useCallback(() => changeDisplayMode('lyrics'), [])

  useEffect(() => {
    if (activeLine < 0) return
    const scroller = lyricsScrollRef.current
    const line = scroller?.querySelector<HTMLButtonElement>(`[data-lyric-index="${activeLine}"]`)
    if (!scroller || !line) return
    const followLine = (behavior: ScrollBehavior) => {
      const scrollerRect = scroller.getBoundingClientRect()
      const lineRect = line.getBoundingClientRect()
      const readingOffset = activeLine <= 0 ? Math.min(72, scroller.clientHeight * .12) : Math.min(112, scroller.clientHeight * .18)
      const nextTop = scroller.scrollTop + lineRect.top - scrollerRect.top - readingOffset
      scroller.scrollTo?.({ top: Math.max(0, nextTop), behavior })
    }
    followLine(reducedMotion ? 'auto' : 'smooth')
    const followAfterResize = () => followLine('auto')
    window.addEventListener('resize', followAfterResize)
    return () => window.removeEventListener('resize', followAfterResize)
  }, [activeLine, displayMode, fontLevel, reducedMotion])

  const selectLyricLine = useCallback((line: LyricLine) => {
    if (mobile && !mobileLandscape) {
      changeDisplayMode('record')
      return
    }
    if (track.durationSeconds <= 0) return
    onSeek(Math.min(100, Math.max(0, (line.time / track.durationSeconds) * 100)))
  }, [mobile, mobileLandscape, onSeek, track.durationSeconds])
  const lyricsStatusTitle = lyricsStatus === 'loading' ? '正在载入歌词' : '暂无同步歌词'
  const fontControlsPortalTarget = typeof document === 'undefined' ? null : document.querySelector('.client-shell')
  const fontControls = fontControlsOpen ? <div ref={fontControlsRef} className="lyrics-type-controls is-open is-menu-open">
    <div className="lyrics-type-popover" role="toolbar" aria-label="歌词字号">
      <header><span><strong>歌词大小</strong><output>{fontLevel === 0 ? '默认' : fontLevel > 0 ? `+${fontLevel}` : fontLevel}</output></span><button className="lyrics-type-reset" onClick={() => changeFontLevel(0)} title="恢复默认歌词排版" aria-label="恢复默认歌词排版" disabled={fontLevel === 0}><RotateCcw size={14} /></button></header>
      <label className="lyrics-size-slider">
        <span aria-hidden="true">A</span>
        <input type="range" min="-5" max="5" step="1" value={fontLevel} onChange={(event) => changeFontLevel(Number(event.target.value))} aria-label="歌词字号级别" />
        <strong aria-hidden="true">A</strong>
      </label>
    </div>
  </div> : null
  return (
    <section className="now-playing-workspace" data-playing={isPlaying ? 'true' : 'false'} data-display-mode={displayMode}>
      {onClose && <button className="mobile-now-playing-dismiss" onClick={onClose} aria-label="收起歌曲页"><ChevronDown size={22} /></button>}
      <AmbientArtwork track={track} />
      <div className="now-playing-layout">
        {(mobileLandscape || displayMode !== 'lyrics') && <div className="now-playing-visual" key={`visual-${track.id}`}>
          <RecordArtwork track={track} mobile={mobile && !mobileLandscape} onShowLyrics={showLyrics} />
          {(mobileLandscape || displayMode === 'record') && <header className="now-playing-record-meta selectable-copy">
            <span className="now-playing-state">{isPlaying && <span className="mini-levels is-playing" aria-hidden="true"><i /><i /><i /></span>}{isPlaying ? '正在播放' : '已暂停'}</span>
            <h1>{track.title}</h1>
            <p className="now-playing-entities"><button onClick={() => onOpenArtist(track)}>{track.artist}</button><span>·</span><button onClick={() => onOpenAlbum(track)}>{track.album}</button></p>
          </header>}
        </div>}

        {(mobileLandscape || displayMode !== 'record') && <section className="lyrics-pane" aria-label="同步歌词" key={`lyrics-${track.id}`} style={lyricStyle}>
          <header className="now-playing-song-header selectable-copy">
            <span className="now-playing-state">{isPlaying && <span className="mini-levels is-playing" aria-hidden="true"><i /><i /><i /></span>}{isPlaying ? '正在播放' : '已暂停'}</span>
            <h1>{track.title}</h1>
            <p className="now-playing-entities"><button onClick={() => onOpenArtist(track)}>{track.artist}</button><span>·</span><button onClick={() => onOpenAlbum(track)}>{track.album}</button></p>
            <div className="lyrics-heading">
              <nav className="song-content-tabs" aria-label="歌曲内容">
                <button className={contentView === 'lyrics' ? 'is-active' : ''} onClick={() => setContentView('lyrics')}>歌词</button>
                <button className={contentView === 'info' ? 'is-active' : ''} onClick={() => setContentView('info')}>歌曲信息</button>
                <button className={contentView === 'related' ? 'is-active' : ''} onClick={() => setContentView('related')}>相关歌曲</button>
              </nav>
              <PlaybackClock store={progressStore} duration={track.durationSeconds} total={track.duration} />
            </div>
          </header>
          {contentView === 'lyrics' && lyricsStatus === 'ready' ? (
            <div className="lyrics-scroll" ref={lyricsScrollRef}>
              <div className="lyrics-spacer is-start" aria-hidden="true" />
              {lyrics.map((line, index) => (
                <LyricLineButton
                  key={`${line.time}-${index}`}
                  line={line}
                  index={index}
                  active={index === activeLine}
                  near={Math.abs(index - activeLine) === 1}
                  onSelect={selectLyricLine}
                />
              ))}
              <div className="lyrics-spacer is-end" aria-hidden="true" />
            </div>
          ) : contentView === 'lyrics' ? (
            <div className={`lyrics-status is-${lyricsStatus}`} role="status" aria-live="polite" onClick={() => { if (mobile) changeDisplayMode('record') }}>
              {lyricsStatus === 'loading' ? <LoaderCircle size={24} /> : <AudioLines size={24} />}
              <strong>{lyricsStatusTitle}</strong>
              {lyricsMessage !== lyricsStatusTitle && <span>{lyricsMessage || '播放真实歌曲后会显示对应歌词'}</span>}
            </div>
          ) : contentView === 'info' ? (
            <div className="song-info-view" role="tabpanel" aria-label="歌曲信息">
              <dl>
                <div><dt>艺人</dt><dd><button className="song-info-entity" onClick={() => onOpenArtist(track)}>{track.artist}</button></dd></div>
                <div><dt>专辑</dt><dd><button className="song-info-entity" onClick={() => onOpenAlbum(track)}>{track.album}</button></dd></div>
                <div><dt>时长</dt><dd>{track.duration}</dd></div>
                <div><dt>音源</dt><dd><span className="song-source-mark" data-music-source={sourceBrandKey(track.source)}><i />{track.source}</span></dd></div>
                <div><dt>当前音质</dt><dd>{track.quality}</dd></div>
                <div><dt>可选音质</dt><dd>{track.remote?.availableQualities.map((quality) => quality === 'flac24bit' ? 'Hi-Res' : quality === 'flac' ? 'FLAC' : quality === '320k' ? '320K' : '128K').join(' · ') || '文件原始音质'}</dd></div>
                {track.bpm > 0 && <div><dt>节奏</dt><dd>{track.bpm} BPM</dd></div>}
                {track.musicalKey !== '待分析' && <div><dt>调性</dt><dd>{track.musicalKey}</dd></div>}
              </dl>
            </div>
          ) : (
            <div className="song-related-view" role="tabpanel" aria-label="相关歌曲">
              {relatedTracks.length ? relatedTracks.map((related) => (
                <button key={related.id} data-music-source={sourceBrandKey(related.source)} onClick={() => onPlayTrack(related)}>
                  <ArtworkImage src={related.cover} alt="" />
                  <span><strong>{related.title}</strong><small>{related.artist} · {related.album}</small></span>
                  <span><small>{related.source}</small><time>{related.duration}</time></span>
                </button>
              )) : <div className="song-related-empty"><strong>暂无相关歌曲</strong><span>搜索或收藏更多同艺人作品后会显示在这里</span></div>}
            </div>
          )}
        </section>}
      </div>
      {fontControls && (fontControlsPortalTarget ? createPortal(fontControls, fontControlsPortalTarget) : fontControls)}
    </section>
  )
}
