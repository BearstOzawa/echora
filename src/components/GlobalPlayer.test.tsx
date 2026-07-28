import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlaybackProgressStore } from '../playbackProgress'
import { initialTracks } from '../testFixtures'
import type { Track } from '../types'
import GlobalPlayer from './GlobalPlayer'

afterEach(cleanup)

const renderPlayer = () => {
  const progressStore = createPlaybackProgressStore(30)
  const actions = {
    onTogglePlay: vi.fn(),
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    onSeek: vi.fn(),
    onVolumeChange: vi.fn(),
    onToggleMute: vi.fn(),
    onOpenNowPlaying: vi.fn(),
    onOpenEffects: vi.fn(),
    onOpenArrangement: vi.fn(),
    onPlayTrack: vi.fn(),
    onCyclePlaybackMode: vi.fn(),
    onPlaybackRateChange: vi.fn(),
    onToggleLike: vi.fn(),
    onSourceChange: vi.fn(),
    onQualityChange: vi.fn(),
    onDownloadTrack: vi.fn(),
    onShareTrack: vi.fn(),
  }
  render(<GlobalPlayer track={initialTracks[0]} isPlaying progressStore={progressStore} volume={72} muted={false} queue={initialTracks} playbackMode="sequence" playbackRate={1} liked={false} nowPlayingOpen={false} sourceVariants={[initialTracks[0]]} variantBusy={false} {...actions} />)
  return { ...actions, progressStore }
}

describe('GlobalPlayer', () => {
  it('keeps playback and queue actions available outside playback space', () => {
    const actions = renderPlayer()
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    fireEvent.click(screen.getByRole('button', { name: /播放队列/ }))
    expect(screen.getByRole('button', { name: /播放队列，共/ }).getAttribute('data-tooltip')).toBe('播放队列')
    expect(screen.getByRole('dialog', { name: '播放队列' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '编排' }))
    fireEvent.click(screen.getByRole('button', { name: /Slow Satellites/ }))
    expect(actions.onTogglePlay).toHaveBeenCalledOnce()
    expect(actions.onOpenArrangement).toHaveBeenCalledOnce()
    expect(actions.onOpenNowPlaying).toHaveBeenCalledOnce()
  })

  it('opens sound controls from the global player', () => {
    const actions = renderPlayer()
    const trigger = screen.getByRole('button', { name: '打开声音空间' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(actions.onOpenEffects).toHaveBeenCalledOnce()
  })

  it('offers current-track download and sharing from the player menu', () => {
    const actions = renderPlayer()
    fireEvent.click(screen.getByRole('button', { name: '更多播放操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '下载到本地' }))
    expect(actions.onDownloadTrack).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: '更多播放操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '分享歌曲' }))
    expect(screen.getByRole('dialog', { name: /分享 Slow Satellites/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /复制分享内容/ }))
    expect(actions.onShareTrack).toHaveBeenCalledWith('copy')
  })

  it('opens lyric sizing from More only while song mode is open', () => {
    const onOpenLyricSettings = vi.fn()
    const props = {
      track: initialTracks[0], isPlaying: true, progressStore: createPlaybackProgressStore(30), volume: 72, muted: false,
      queue: initialTracks, playbackMode: 'sequence' as const, playbackRate: 1 as const, liked: false,
      sourceVariants: [initialTracks[0]], variantBusy: false,
      onTogglePlay: vi.fn(), onNext: vi.fn(), onPrevious: vi.fn(), onSeek: vi.fn(),
      onVolumeChange: vi.fn(), onToggleMute: vi.fn(), onOpenNowPlaying: vi.fn(), onOpenArrangement: vi.fn(),
      onPlayTrack: vi.fn(), onCyclePlaybackMode: vi.fn(), onPlaybackRateChange: vi.fn(), onToggleLike: vi.fn(),
      onSourceChange: vi.fn(), onQualityChange: vi.fn(), onShareTrack: vi.fn(), onOpenLyricSettings,
    }
    const { rerender } = render(<GlobalPlayer {...props} nowPlayingOpen />)
    fireEvent.click(screen.getByRole('button', { name: '更多播放操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '歌词字号' }))
    expect(onOpenLyricSettings).toHaveBeenCalledOnce()

    rerender(<GlobalPlayer {...props} nowPlayingOpen={false} />)
    fireEvent.click(screen.getByRole('button', { name: '更多播放操作' }))
    expect(screen.queryByRole('menuitem', { name: '歌词字号' })).toBeNull()
  })

  it('forwards progress changes to the application playback state', () => {
    const actions = renderPlayer()
    fireEvent.change(screen.getByRole('slider', { name: '播放进度' }), { target: { value: '64' } })
    expect(actions.onSeek).toHaveBeenCalledWith(64)
  })

  it('plays a selected item from the expanded queue', () => {
    const actions = renderPlayer()
    fireEvent.click(screen.getByRole('button', { name: /播放队列/ }))
    fireEvent.click(screen.getByRole('button', { name: /Glass Hours/ }))
    expect(actions.onPlayTrack).toHaveBeenCalledWith(initialTracks[1].id)
  })

  it('exposes playback mode and current-track favorite controls', () => {
    const actions = renderPlayer()
    const mode = screen.getByRole('button', { name: '播放模式：顺序播放' })
    expect(mode.getAttribute('data-tooltip')).toBe('顺序播放')
    expect(screen.getByRole('button', { name: '播放速度：1×' }).getAttribute('data-tooltip')).toBe('播放速度 1×')
    expect(screen.getByRole('button', { name: '音量' }).getAttribute('data-tooltip')).toBe('音量 72%')
    fireEvent.click(mode)
    fireEvent.click(screen.getByRole('button', { name: '喜欢' }))
    expect(actions.onCyclePlaybackMode).toHaveBeenCalledOnce()
    expect(actions.onToggleLike).toHaveBeenCalledOnce()
  })

  it('changes playback speed from a secondary control', () => {
    const actions = renderPlayer()
    fireEvent.click(screen.getByRole('button', { name: '播放速度：1×' }))
    fireEvent.click(screen.getByRole('button', { name: '设置播放速度为 1.5×' }))
    expect(actions.onPlaybackRateChange).toHaveBeenCalledWith(1.5)
  })

  it('drives the visible track and thumb from one shared progress value', () => {
    const { progressStore } = renderPlayer()
    const slider = screen.getByRole('slider', { name: '播放进度' })
    const scrubber = slider.closest('.playback-scrubber')
    expect(slider.getAttribute('step')).toBe('0.01')
    expect(scrubber?.getAttribute('style')).toContain('--playback-progress: 30%')
    expect(scrubber?.querySelector('.playback-scrubber-fill')).toBeTruthy()
    expect(scrubber?.querySelector('.playback-scrubber-thumb')).toBeTruthy()

    act(() => progressStore.set(50))
    expect((slider as HTMLInputElement).value).toBe('50')
    expect(scrubber?.getAttribute('style')).toContain('--playback-progress: 50%')
  })

  it('clears pointer focus that can corrupt the native glass compositor', () => {
    renderPlayer()
    const modeButton = screen.getByRole('button', { name: '播放模式：顺序播放' })
    modeButton.focus()
    expect(document.activeElement).toBe(modeButton)
    fireEvent.pointerUp(modeButton)
    expect(document.activeElement).not.toBe(modeButton)
  })

  it('switches between real source variants and advertised qualities', () => {
    const musicInfo = { songmid: 'song-1', name: 'Glass Hours', singer: 'Mira Vale', albumName: 'Night Transit', source: 'kw' as const, interval: '04:18', types: [], _types: {}, typeUrl: {} }
    const kuwo: Track = { ...initialTracks[0], id: 901, source: '酷我', quality: 'FLAC 无损', remote: { source: 'kw', musicInfo, availableQualities: ['128k', 'flac'], resolvedQuality: 'flac' } }
    const qq: Track = { ...kuwo, id: 902, source: 'QQ', remote: { ...kuwo.remote!, source: 'tx', musicInfo: { ...musicInfo, source: 'tx', songmid: 'song-2' } } }
    const onSourceChange = vi.fn()
    const onQualityChange = vi.fn()
    render(<GlobalPlayer track={kuwo} isPlaying progressStore={createPlaybackProgressStore(30)} volume={72} muted={false} queue={[kuwo]} playbackMode="sequence" playbackRate={1} liked={false} nowPlayingOpen={false} sourceVariants={[kuwo, qq]} variantBusy={false} onTogglePlay={vi.fn()} onNext={vi.fn()} onPrevious={vi.fn()} onSeek={vi.fn()} onVolumeChange={vi.fn()} onToggleMute={vi.fn()} onOpenNowPlaying={vi.fn()} onOpenArrangement={vi.fn()} onPlayTrack={vi.fn()} onCyclePlaybackMode={vi.fn()} onPlaybackRateChange={vi.fn()} onToggleLike={vi.fn()} onSourceChange={onSourceChange} onQualityChange={onQualityChange} />)
    fireEvent.click(screen.getByRole('button', { name: /播放版本：酷我/ }))
    expect(screen.getByRole('button', { name: /播放版本：酷我/ }).getAttribute('data-tooltip')).toBe('音源与音质')
    expect(screen.getByRole('dialog', { name: '播放版本' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭播放版本' }))
    expect(screen.queryByRole('dialog', { name: '播放版本' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /播放版本：酷我/ }))
    fireEvent.click(screen.getByRole('button', { name: /标准 128K/ }))
    expect(onQualityChange).toHaveBeenCalledWith('128k')
    fireEvent.click(screen.getByRole('button', { name: /播放版本：酷我/ }))
    fireEvent.click(screen.getByRole('button', { name: /QQ/ }))
    expect(onSourceChange).toHaveBeenCalledWith('tx')
  })

  it('uses Cloud-provided qualities without a local credential gate', () => {
    const musicInfo = { songmid: 'song-1', name: 'Glass Hours', singer: 'Mira Vale', albumName: 'Night Transit', source: 'kw' as const, interval: '04:18', types: [], _types: {}, typeUrl: {} }
    const track: Track = { ...initialTracks[0], id: 903, source: '酷我', quality: 'FLAC 无损', remote: { source: 'kw', musicInfo, availableQualities: ['320k', 'flac', 'flac24bit'] } }
    const onQualityChange = vi.fn()
    render(<GlobalPlayer track={track} isPlaying progressStore={createPlaybackProgressStore(30)} volume={72} muted={false} queue={[track]} playbackMode="sequence" playbackRate={1} liked={false} nowPlayingOpen={false} sourceVariants={[track]} variantBusy={false} enhancedQualityEnabled={false} onTogglePlay={vi.fn()} onNext={vi.fn()} onPrevious={vi.fn()} onSeek={vi.fn()} onVolumeChange={vi.fn()} onToggleMute={vi.fn()} onOpenNowPlaying={vi.fn()} onOpenArrangement={vi.fn()} onPlayTrack={vi.fn()} onCyclePlaybackMode={vi.fn()} onPlaybackRateChange={vi.fn()} onToggleLike={vi.fn()} onSourceChange={vi.fn()} onQualityChange={onQualityChange} />)
    const variantButton = screen.getByRole('button', { name: /播放版本：酷我，播放时解析/ })
    expect(variantButton).toBeTruthy()
    fireEvent.click(variantButton)
    expect(screen.getByRole('button', { name: /无损 FLAC/ }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: /Hi-Res/ }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /高品 320K/ }))
    expect(onQualityChange).toHaveBeenCalledWith('320k')
  })
})
