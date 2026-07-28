import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialTracks } from './testFixtures'
import { defaultAudioEffects } from './audioEffects'
import type { AudioEffectsSettings } from './audioEffects'
import { playbackProgressTimeoutMs, playbackStartTimeoutMs, readAudioPlaybackDiagnostics, useAudioPlayback } from './useAudioPlayback'
import type { AudioPlaybackIssue } from './useAudioPlayback'
import type { Track } from './types'

class MockAudio extends EventTarget {
  src = ''
  crossOrigin = ''
  currentTime = 0
  duration = 200
  volume = 1
  muted = false
  playbackRate = 1
  loop = false
  paused = true
  preload = ''
  dataset: Record<string, string> = {}
  play = vi.fn(async () => { this.paused = false })
  pause = vi.fn(() => { this.paused = true })
  load = vi.fn()
  removeAttribute = vi.fn((name: string) => {
    if (name === 'src') this.src = ''
  })
}

class MockAudioParam {
  value = 0
  setTargetAtTime = vi.fn((value: number) => { this.value = value })
  cancelScheduledValues = vi.fn()
  setValueAtTime = vi.fn((value: number) => { this.value = value })
  linearRampToValueAtTime = vi.fn((value: number) => { this.value = value })
}

class MockAudioNode {
  connect = vi.fn()
}

class MockBiquadFilter extends MockAudioNode {
  type = ''
  frequency = new MockAudioParam()
  Q = new MockAudioParam()
  gain = new MockAudioParam()
}

class MockAudioContext {
  state = 'suspended'
  currentTime = 1
  sampleRate = 100
  destination = new MockAudioNode()
  filters: MockBiquadFilter[] = []
  gains: Array<MockAudioNode & { gain: MockAudioParam }> = []
  compressor: (MockAudioNode & { threshold: MockAudioParam; knee: MockAudioParam; ratio: MockAudioParam; attack: MockAudioParam; release: MockAudioParam }) | null = null
  resume = vi.fn(async () => { this.state = 'running' })
  suspend = vi.fn(async () => { this.state = 'suspended' })
  close = vi.fn(async () => undefined)
  createMediaElementSource = vi.fn(() => new MockAudioNode())
  createBiquadFilter = vi.fn(() => {
    const filter = new MockBiquadFilter()
    this.filters.push(filter)
    return filter
  })
  createGain = vi.fn(() => {
    const gain = Object.assign(new MockAudioNode(), { gain: new MockAudioParam() })
    this.gains.push(gain)
    return gain
  })
  createChannelSplitter = vi.fn(() => new MockAudioNode())
  createChannelMerger = vi.fn(() => new MockAudioNode())
  createConvolver = vi.fn(() => Object.assign(new MockAudioNode(), { buffer: null }))
  createDynamicsCompressor = vi.fn(() => {
    this.compressor = Object.assign(new MockAudioNode(), {
      threshold: new MockAudioParam(),
      knee: new MockAudioParam(),
      ratio: new MockAudioParam(),
      attack: new MockAudioParam(),
      release: new MockAudioParam(),
    })
    return this.compressor
  })
  createBuffer = vi.fn((channels: number, length: number) => ({ numberOfChannels: channels, getChannelData: () => new Float32Array(length) }))
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  ;(window as Window & { __ECHORA_MEDIA_DIAGNOSTICS__?: unknown[] }).__ECHORA_MEDIA_DIAGNOSTICS__ = []
})

describe('real audio playback', () => {
  it('drives a local file with real media time, volume, rate, and seek', () => {
    const audio = new MockAudio()
    vi.stubGlobal('Audio', function Audio() { return audio })
    const onProgress = vi.fn()
    const localTrack = { ...initialTracks[0], id: -1, source: '本地' as const, audioUrl: 'blob:audio', localFileId: 'local-file' }

    const Harness = ({ playing }: { playing: boolean }) => {
      const { seek } = useAudioPlayback({
        track: localTrack,
        isPlaying: playing,
        progress: 0,
        volume: 64,
        muted: false,
        playbackRate: 1.5,
        playbackMode: 'repeat-one',
        audioEffects: defaultAudioEffects,
        onProgress,
        onEnded: vi.fn(),
        onError: vi.fn(),
      })
      return <button onClick={() => seek(50)}>跳转</button>
    }

    const view = render(<Harness playing />)
    expect(audio.src).toBe('blob:audio')
    expect(audio.play).toHaveBeenCalled()
    expect(audio.volume).toBe(0.64)
    expect(audio.playbackRate).toBe(1.5)
    expect(audio.loop).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '跳转' }))
    expect(audio.currentTime).toBe(100)
    expect(onProgress).toHaveBeenLastCalledWith(50)

    audio.currentTime = 60
    act(() => audio.dispatchEvent(new Event('timeupdate')))
    expect(onProgress).toHaveBeenLastCalledWith(30)

    view.rerender(<Harness playing={false} />)
    expect(audio.pause).toHaveBeenCalled()
  })

  it('routes playback through the live equalizer and returns to neutral when disabled', () => {
    const audios: MockAudio[] = []
    const context = new MockAudioContext()
    vi.stubGlobal('Audio', function Audio() {
      const audio = new MockAudio()
      audios.push(audio)
      return audio
    })
    vi.stubGlobal('AudioContext', function AudioContext() { return context })
    const localTrack = { ...initialTracks[0], id: -2, source: '本地' as const, audioUrl: 'blob:effects', localFileId: 'effects-file' }

    const Harness = ({ effects, playing = true }: { effects: AudioEffectsSettings; playing?: boolean }) => {
      useAudioPlayback({ track: localTrack, isPlaying: playing, progress: 0, volume: 72, muted: false, playbackRate: 1, playbackMode: 'sequence', audioEffects: effects, onProgress: vi.fn(), onEnded: vi.fn(), onError: vi.fn() })
      return null
    }

    const boosted = { ...defaultAudioEffects, enabled: true, intensity: 100, bands: [6, 0, 0, 0, 0, 0, 0, 0, 0, 0] }
    const view = render(<Harness effects={boosted} />)
    expect(audios[0].crossOrigin).toBe('anonymous')
    expect(context.createMediaElementSource).toHaveBeenCalledWith(audios[0])
    expect(context.filters).toHaveLength(11)
    expect(context.createChannelSplitter).toHaveBeenCalledWith(2)
    expect(context.createChannelMerger).toHaveBeenCalledWith(2)
    expect(context.filters[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(6, 1, .025)
    expect(context.gains.some((gain) => gain.gain.setTargetAtTime.mock.calls.some(([value]) => value === .16))).toBe(true)
    expect(context.gains.filter((gain) => gain.gain.setTargetAtTime.mock.calls.some(([value]) => value === -.18))).toHaveLength(2)
    expect(context.compressor?.ratio.setTargetAtTime).toHaveBeenLastCalledWith(2.424, 1, .03)
    expect(context.resume).toHaveBeenCalledOnce()

    view.rerender(<Harness effects={boosted} playing={false} />)
    expect(context.suspend).toHaveBeenCalledOnce()

    view.rerender(<Harness effects={boosted} playing />)
    expect(context.resume).toHaveBeenCalledTimes(2)

    view.rerender(<Harness effects={{ ...boosted, spatial: false, normalize: false }} />)
    expect(context.gains.filter((gain) => gain.gain.setTargetAtTime.mock.calls.some(([value]) => value === -.18)).every((gain) => gain.gain.setTargetAtTime.mock.calls.at(-1)?.[0] === 0)).toBe(true)
    expect(context.compressor?.ratio.setTargetAtTime).toHaveBeenLastCalledWith(1, 1, .03)

    view.rerender(<Harness effects={{ ...boosted, enabled: false }} />)
    expect(context.close).toHaveBeenCalledOnce()
    expect(audios).toHaveLength(2)
    expect(context.createMediaElementSource).toHaveBeenCalledOnce()
    expect(audios[1].src).toBe('blob:effects')
    expect(audios[1].play).toHaveBeenCalledOnce()
  })

  it('does not create Web Audio processing for direct playback', () => {
    const audio = new MockAudio()
    const contextFactory = vi.fn(() => new MockAudioContext())
    vi.stubGlobal('Audio', function Audio() { return audio })
    vi.stubGlobal('AudioContext', contextFactory)
    const localTrack = { ...initialTracks[0], id: -6, source: '本地' as const, audioUrl: 'blob:direct', localFileId: 'direct-file' }

    render(<PlaybackHarness track={localTrack} onError={vi.fn()} />)

    expect(contextFactory).not.toHaveBeenCalled()
    expect(audio.src).toBe('blob:direct')
    expect(audio.play).toHaveBeenCalledOnce()
  })

  it('keeps cross-origin music playable when the remote server does not expose CORS headers', () => {
    const audio = new MockAudio()
    const contextFactory = vi.fn(() => new MockAudioContext())
    vi.stubGlobal('Audio', function Audio() { return audio })
    vi.stubGlobal('AudioContext', contextFactory)
    const remoteTrack = { ...initialTracks[0], audioUrl: 'https://media.example.com/song.flac' }
    const effects = { ...defaultAudioEffects, enabled: true, bands: [3, 0, 0, 0, 0, 0, 0, 0, 0, 0] }

    const Harness = () => {
      useAudioPlayback({ track: remoteTrack, isPlaying: true, progress: 0, volume: 72, muted: false, playbackRate: 1, playbackMode: 'sequence', audioEffects: effects, onProgress: vi.fn(), onEnded: vi.fn(), onError: vi.fn() })
      return null
    }
    render(<Harness />)

    expect(audio.crossOrigin).toBe('')
    expect(contextFactory).not.toHaveBeenCalled()
    expect(audio.play).toHaveBeenCalledOnce()
  })

  it('distinguishes autoplay policy from a recoverable media failure', async () => {
    const audio = new MockAudio()
    audio.play.mockRejectedValue(new DOMException('blocked', 'NotAllowedError'))
    vi.stubGlobal('Audio', function Audio() { return audio })
    const onError = vi.fn()
    const localTrack = { ...initialTracks[0], id: -3, source: '本地' as const, audioUrl: 'blob:policy', localFileId: 'policy-file' }

    render(<PlaybackHarness track={localTrack} onError={onError} />)
    await act(async () => { await Promise.resolve() })
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'policy', message: '浏览器阻止了自动播放，请再次点击播放' }))

    act(() => audio.dispatchEvent(new Event('error')))
    expect(onError).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'media', message: '无法播放这首歌曲，播放地址可能已失效或格式不受支持' }))
    expect(readAudioPlaybackDiagnostics().at(-1)).toMatchObject({
      playbackKey: `${localTrack.id}:${localTrack.audioUrl}`,
      url: localTrack.audioUrl,
      lastEvent: 'error',
    })
  })

  it('turns a stalled playback start into a recoverable media failure', async () => {
    vi.useFakeTimers()
    const audio = new MockAudio()
    audio.play.mockReturnValue(new Promise<undefined>(() => undefined))
    vi.stubGlobal('Audio', function Audio() { return audio })
    const onError = vi.fn()
    const remoteTrack = { ...initialTracks[0], id: -7, audioUrl: 'https://media.example.com/stalled.mp3', localFileId: 'remote-test' }

    render(<PlaybackHarness track={remoteTrack} onError={onError} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(playbackStartTimeoutMs) })

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'media', message: '播放源响应超时' }))
  })

  it('recovers when playback reports success without advancing media time', async () => {
    vi.useFakeTimers()
    const audio = new MockAudio()
    vi.stubGlobal('Audio', function Audio() { return audio })
    const onError = vi.fn()
    const remoteTrack = { ...initialTracks[0], id: -8, audioUrl: 'https://media.example.com/frozen.mp3', localFileId: 'remote-test' }

    render(<PlaybackHarness track={remoteTrack} onError={onError} />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(playbackProgressTimeoutMs) })

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'media', message: '播放没有正常进行' }))
  })

  it('continues monitoring after playback advances and later stalls', async () => {
    vi.useFakeTimers()
    const audio = new MockAudio()
    vi.stubGlobal('Audio', function Audio() { return audio })
    const onError = vi.fn()
    const remoteTrack = { ...initialTracks[0], id: -9, audioUrl: 'https://media.example.com/eventually-stalled.mp3', localFileId: 'remote-test' }

    render(<PlaybackHarness track={remoteTrack} onError={onError} />)
    await act(async () => { await Promise.resolve() })
    await act(async () => {
      audio.currentTime = 1
      audio.dispatchEvent(new Event('timeupdate'))
      await vi.advanceTimersByTimeAsync(playbackProgressTimeoutMs - 1)
    })
    expect(onError).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'media', message: '播放没有正常进行' }))
  })

  it('reports playback started only after media time advances', async () => {
    vi.useFakeTimers()
    const audio = new MockAudio()
    vi.stubGlobal('Audio', function Audio() { return audio })
    const onStarted = vi.fn()
    const remoteTrack = { ...initialTracks[0], id: -10, audioUrl: 'https://media.example.com/started.mp3', localFileId: 'remote-test' }

    const Harness = () => {
      useAudioPlayback({
        track: remoteTrack,
        isPlaying: true,
        progress: 0,
        volume: 72,
        muted: false,
        playbackRate: 1,
        playbackMode: 'sequence',
        audioEffects: defaultAudioEffects,
        onProgress: vi.fn(),
        onEnded: vi.fn(),
        onStarted,
        onError: vi.fn(),
      })
      return null
    }
    render(<Harness />)
    await act(async () => { await Promise.resolve(); await vi.advanceTimersByTimeAsync(420) })
    expect(onStarted).not.toHaveBeenCalled()

    act(() => {
      audio.currentTime = 1
      audio.dispatchEvent(new Event('timeupdate'))
      audio.currentTime = 2
      audio.dispatchEvent(new Event('timeupdate'))
    })

    expect(onStarted).toHaveBeenCalledOnce()
    expect(onStarted).toHaveBeenCalledWith({ latencyMs: 420 })
  })

  it('ignores a stale play rejection after the selected track changes', async () => {
    let rejectFirstPlay: (reason: unknown) => void = () => undefined
    const firstPlay = new Promise<void>((_resolve, reject) => { rejectFirstPlay = reject })
    const audio = new MockAudio()
    audio.play.mockImplementationOnce(() => firstPlay).mockResolvedValue(undefined)
    vi.stubGlobal('Audio', function Audio() { return audio })
    const onError = vi.fn()
    const firstTrack = { ...initialTracks[0], id: -4, source: '本地' as const, audioUrl: 'blob:first', localFileId: 'first-file' }
    const secondTrack = { ...initialTracks[1], id: -5, source: '本地' as const, audioUrl: 'blob:second', localFileId: 'second-file' }

    const view = render(<PlaybackHarness track={firstTrack} onError={onError} />)
    view.rerender(<PlaybackHarness track={secondTrack} onError={onError} />)
    await act(async () => { rejectFirstPlay(new DOMException('superseded', 'NotSupportedError')); await Promise.resolve() })

    expect(audio.dataset.playbackKey).toBe(`${secondTrack.id}:${secondTrack.audioUrl}`)
    expect(onError).not.toHaveBeenCalled()
  })
})

const PlaybackHarness = ({ track, onError }: { track: Track & { audioUrl: string; localFileId: string }; onError: (issue: AudioPlaybackIssue) => void }) => {
  useAudioPlayback({ track, isPlaying: true, progress: 0, volume: 72, muted: false, playbackRate: 1, playbackMode: 'sequence', audioEffects: defaultAudioEffects, onProgress: vi.fn(), onEnded: vi.fn(), onError })
  return null
}
