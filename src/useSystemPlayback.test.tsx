import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlaybackProgressStore } from './playbackProgress'
import type { Track } from './types'
import { parseIosMediaCommand, usePlaybackWakeLock, useSystemMediaSession } from './useSystemPlayback'

const track: Track = {
  id: 7,
  title: '海屿你',
  artist: '马也',
  album: '海屿你',
  duration: '04:00',
  durationSeconds: 240,
  source: '网易云',
  quality: '高品质',
  cover: 'https://example.com/cover.jpg',
  bpm: 96,
  musicalKey: 'C',
  x: 0,
  y: 0,
  offline: false,
  verified: true,
  sizeMb: 8,
}

const defaultUserAgent = navigator.userAgent

afterEach(() => {
  Reflect.deleteProperty(navigator, 'mediaSession')
  Reflect.deleteProperty(navigator, 'wakeLock')
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
  Reflect.deleteProperty(window, 'EchoraMediaSession')
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: defaultUserAgent })
  vi.unstubAllGlobals()
})

describe('system playback integration', () => {
  it('validates native iOS media commands before dispatch', () => {
    expect(parseIosMediaCommand('{"type":"seek-to","position":48}')).toEqual({ type: 'seek-to', position: 48 })
    expect(parseIosMediaCommand('{"type":"interruption-ended","shouldResume":true}')).toEqual({ type: 'interruption-ended', shouldResume: true })
    expect(parseIosMediaCommand('{"type":"toggle-playback"}')).toEqual({ type: 'toggle-playback' })
    expect(parseIosMediaCommand('{"type":"toggle-like"}')).toEqual({ type: 'toggle-like' })
    expect(parseIosMediaCommand('{"type":"seek-forward","offset":"10"}')).toBeNull()
    expect(parseIosMediaCommand('not-json')).toBeNull()
  })

  it('publishes track state and routes system media actions', () => {
    const handlers = new Map<string, MediaSessionActionHandler | null>()
    const mediaSession = {
      metadata: null,
      playbackState: 'none',
      setActionHandler: vi.fn((action: string, handler: MediaSessionActionHandler | null) => handlers.set(action, handler)),
      setPositionState: vi.fn(),
    }
    Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: mediaSession })
    vi.stubGlobal('MediaMetadata', class { constructor(init: MediaMetadataInit) { Object.assign(this, init) } })
    const actions = { onPlay: vi.fn(), onPause: vi.fn(), onPrevious: vi.fn(), onNext: vi.fn(), onToggleLike: vi.fn(), onSeek: vi.fn() }
    const progressStore = createPlaybackProgressStore(25)

    const view = renderHook((props: { enabled: boolean; isPlaying: boolean }) => useSystemMediaSession({
      enabled: props.enabled,
      track,
      isPlaying: props.isPlaying,
      liked: false,
      progressStore,
      playbackRate: 1.25,
      ...actions,
    }), { initialProps: { enabled: true, isPlaying: true } })

    expect(mediaSession.metadata).toMatchObject({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: [{ src: track.cover }],
    })
    expect(mediaSession.playbackState).toBe('playing')
    expect(mediaSession.setPositionState).toHaveBeenCalledWith({ duration: 240, playbackRate: 1.25, position: 60 })
    act(() => handlers.get('play')?.({ action: 'play' }))
    act(() => handlers.get('nexttrack')?.({ action: 'nexttrack' }))
    act(() => handlers.get('seekforward')?.({ action: 'seekforward', seekOffset: 12 }))
    expect(actions.onPlay).toHaveBeenCalledOnce()
    expect(actions.onNext).toHaveBeenCalledOnce()
    expect(actions.onSeek).toHaveBeenCalledWith(30)

    view.rerender({ enabled: true, isPlaying: false })
    expect(mediaSession.playbackState).toBe('paused')
    view.unmount()
    expect(mediaSession.metadata).toBeNull()
  })

  it('synchronizes Android native media state and accepts system controls', () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 Android' })
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    const bridge = { updateMetadata: vi.fn(), updateState: vi.fn(), clear: vi.fn() }
    Object.defineProperty(window, 'EchoraMediaSession', { configurable: true, value: bridge })
    const actions = { onPlay: vi.fn(), onPause: vi.fn(), onPrevious: vi.fn(), onNext: vi.fn(), onToggleLike: vi.fn(), onSeek: vi.fn() }
    const progressStore = createPlaybackProgressStore(25)

    const view = renderHook(({ enabled, isPlaying }) => useSystemMediaSession({
      enabled,
      track,
      isPlaying,
      liked: true,
      progressStore,
      playbackRate: 1,
      ...actions,
    }), { initialProps: { enabled: true, isPlaying: true } })

    expect(JSON.parse(bridge.updateMetadata.mock.calls[0][0])).toMatchObject({
      title: track.title,
      artist: track.artist,
      coverUrl: track.cover,
    })
    expect(JSON.parse(bridge.updateState.mock.calls[0][0])).toMatchObject({ isPlaying: true, isLiked: true, elapsed: 60 })
    act(() => progressStore.set(30))
    expect(bridge.updateState).toHaveBeenCalledTimes(1)
    act(() => progressStore.set(32))
    expect(bridge.updateState).toHaveBeenCalledTimes(2)

    act(() => window.dispatchEvent(new CustomEvent('echora-android-media-command', { detail: '{"type":"pause"}' })))
    act(() => window.dispatchEvent(new CustomEvent('echora-android-media-command', { detail: '{"type":"next"}' })))
    expect(actions.onPause).toHaveBeenCalledOnce()
    expect(actions.onNext).toHaveBeenCalledOnce()

    act(() => window.dispatchEvent(new CustomEvent('echora-android-media-command', { detail: '{"type":"interruption-began"}' })))
    act(() => window.dispatchEvent(new CustomEvent('echora-android-media-command', { detail: '{"type":"interruption-ended","shouldResume":true}' })))
    act(() => window.dispatchEvent(new CustomEvent('echora-android-media-command', { detail: '{"type":"route-disconnected"}' })))
    expect(actions.onPause).toHaveBeenCalledTimes(3)
    expect(actions.onPlay).toHaveBeenCalledOnce()

    view.rerender({ enabled: false, isPlaying: false })
    expect(bridge.clear).toHaveBeenCalled()
    const updatesBeforeRestore = bridge.updateState.mock.calls.length
    view.rerender({ enabled: true, isPlaying: false })
    expect(bridge.updateState).toHaveBeenCalledTimes(updatesBeforeRestore + 1)
  })

  it('holds a wake lock only while requested', async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    const request = vi.fn().mockResolvedValue({ released: false, release, addEventListener: vi.fn() })
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })

    const view = renderHook(({ enabled }) => usePlaybackWakeLock(enabled), { initialProps: { enabled: true } })
    await waitFor(() => expect(request).toHaveBeenCalledWith('screen'))
    view.rerender({ enabled: false })
    await waitFor(() => expect(release).toHaveBeenCalledOnce())
  })
})
