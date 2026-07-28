import { useEffect, useRef } from 'react'
import { platformBridge } from './platformBridge'
import type { PlaybackProgressStore } from './playbackProgress'
import type { Track } from './types'

type MediaSessionOptions = {
  enabled: boolean
  track: Track | null
  isPlaying: boolean
  liked: boolean
  progressStore: PlaybackProgressStore
  playbackRate: number
  onPlay: () => void
  onPause: () => void
  onPrevious: () => void
  onNext: () => void
  onToggleLike: () => void
  onSeek: (progress: number) => void
}

type IosMediaCommand =
  | { type: 'play' | 'pause' | 'toggle-playback' | 'previous' | 'next' | 'toggle-like' | 'interruption-began' | 'route-disconnected' }
  | { type: 'seek-to'; position: number }
  | { type: 'seek-forward' | 'seek-backward'; offset: number }
  | { type: 'interruption-ended'; shouldResume: boolean }

type AndroidMediaSessionBridge = {
  updateMetadata: (payload: string) => void
  updateState: (payload: string) => void
  clear: () => void
}

type WakeLockLike = {
  released?: boolean
  release: () => Promise<void>
  addEventListener?: (type: 'release', listener: () => void) => void
}

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockLike> }
}

const setMediaAction = (session: MediaSession, action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
  try {
    session.setActionHandler(action, handler)
  } catch {
    // Some WebViews expose Media Session but omit individual actions.
  }
}

const systemArtworkCache = new Map<string, string>()
const emptyNativePlaybackState = () => ({ trackId: 0, elapsed: -1, playbackRate: 0, isPlaying: false, liked: false })

const isIosNativeRuntime = () => typeof window !== 'undefined'
  && '__TAURI_INTERNALS__' in window
  && /iPad|iPhone|iPod/i.test(navigator.userAgent)

const isAndroidNativeRuntime = () => typeof window !== 'undefined'
  && '__TAURI_INTERNALS__' in window
  && /Android/i.test(navigator.userAgent)

const androidMediaSessionBridge = () => (window as typeof window & { EchoraMediaSession?: AndroidMediaSessionBridge }).EchoraMediaSession

export const parseIosMediaCommand = (payload: unknown): IosMediaCommand | null => {
  if (typeof payload !== 'string') return null
  try {
    const command = JSON.parse(payload) as Record<string, unknown>
    if (['play', 'pause', 'toggle-playback', 'previous', 'next', 'toggle-like', 'interruption-began', 'route-disconnected'].includes(String(command.type))) {
      return { type: command.type as 'play' | 'pause' | 'toggle-playback' | 'previous' | 'next' | 'toggle-like' | 'interruption-began' | 'route-disconnected' }
    }
    if (command.type === 'seek-to' && typeof command.position === 'number' && Number.isFinite(command.position)) {
      return { type: 'seek-to', position: Math.max(0, command.position) }
    }
    if ((command.type === 'seek-forward' || command.type === 'seek-backward') && typeof command.offset === 'number' && Number.isFinite(command.offset)) {
      return { type: command.type, offset: Math.max(0, command.offset) }
    }
    if (command.type === 'interruption-ended' && typeof command.shouldResume === 'boolean') {
      return { type: 'interruption-ended', shouldResume: command.shouldResume }
    }
  } catch {
    return null
  }
  return null
}

const invokeIosNowPlaying = async (command: 'update_ios_now_playing_metadata' | 'update_ios_now_playing_state' | 'clear_ios_now_playing', payload?: unknown) => {
  if (!isIosNativeRuntime()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke(command, payload === undefined ? undefined : { payload }).catch(() => undefined)
}

const invokeAndroidMediaSession = (command: 'updateMetadata' | 'updateState' | 'clear', payload?: unknown) => {
  if (!isAndroidNativeRuntime()) return
  const bridge = androidMediaSessionBridge()
  if (!bridge) return
  try {
    if (command === 'clear') bridge.clear()
    else bridge[command](JSON.stringify(payload ?? {}))
  } catch {
    // Android system integration is supplementary; playback remains usable.
  }
}

const blobAsDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.addEventListener('load', () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid artwork result')), { once: true })
  reader.addEventListener('error', () => reject(reader.error ?? new Error('Unable to read artwork')), { once: true })
  reader.readAsDataURL(blob)
})

const cacheSystemArtwork = async (source: string, signal: AbortSignal) => {
  const cached = systemArtworkCache.get(source)
  if (cached) return cached
  const response = await fetch(platformBridge.mediaUrl(source), { signal })
  if (!response.ok) throw new Error('Unable to load system artwork')
  const blob = await response.blob()
  if (!blob.type.startsWith('image/') || blob.size > 4 * 1024 * 1024) throw new Error('Unsupported system artwork')
  const dataUrl = await blobAsDataUrl(blob)
  if (systemArtworkCache.size >= 8) systemArtworkCache.delete(systemArtworkCache.keys().next().value!)
  systemArtworkCache.set(source, dataUrl)
  return dataUrl
}

const compactLiveArtwork = (dataUrl: string) => new Promise<string | null>((resolve) => {
  const image = new Image()
  image.addEventListener('load', () => {
    const canvas = document.createElement('canvas')
    // Dynamic Island renders this artwork at 23 pt. Keeping the encoded image
    // compact also leaves enough room in ActivityKit's content-state budget.
    canvas.width = 36
    canvas.height = 36
    const context = canvas.getContext('2d')
    if (!context) {
      resolve(null)
      return
    }
    const sourceSize = Math.min(image.naturalWidth, image.naturalHeight)
    const sourceX = (image.naturalWidth - sourceSize) / 2
    const sourceY = (image.naturalHeight - sourceSize) / 2
    context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, 36, 36)
    resolve(canvas.toDataURL('image/jpeg', .58).split(',')[1] ?? null)
  }, { once: true })
  image.addEventListener('error', () => resolve(null), { once: true })
  image.src = dataUrl
})

const publishMediaMetadata = (session: MediaSession, track: Track, artwork?: string) => {
  const metadata: MediaMetadataInit = {
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: artwork ? [{ src: artwork }] : undefined,
  }
  session.metadata = typeof MediaMetadata === 'function' ? new MediaMetadata(metadata) : metadata as MediaMetadata
}

export const supportsSystemMediaControls = () => typeof navigator !== 'undefined' && 'mediaSession' in navigator
export const supportsPlaybackWakeLock = () => typeof navigator !== 'undefined' && Boolean((navigator as WakeLockNavigator).wakeLock?.request)

export const useSystemMediaSession = ({ enabled, track, isPlaying, liked, progressStore, playbackRate, onPlay, onPause, onPrevious, onNext, onToggleLike, onSeek }: MediaSessionOptions) => {
  const callbacksRef = useRef({ onPlay, onPause, onPrevious, onNext, onToggleLike, onSeek })
  const playbackRef = useRef({ progress: progressStore.getSnapshot(), duration: track?.durationSeconds ?? 0 })
  const playingRef = useRef(isPlaying)
  const wasPlayingBeforeInterruptionRef = useRef(false)
  const nativeStateRef = useRef(emptyNativePlaybackState())
  callbacksRef.current = { onPlay, onPause, onPrevious, onNext, onToggleLike, onSeek }
  playbackRef.current = { progress: progressStore.getSnapshot(), duration: track?.durationSeconds ?? 0 }
  playingRef.current = isPlaying

  useEffect(() => {
    if (!enabled || !supportsSystemMediaControls()) return
    if (isIosNativeRuntime() || isAndroidNativeRuntime()) return
    const session = navigator.mediaSession
    const seekBy = (seconds: number) => {
      const { progress: currentProgress, duration } = playbackRef.current
      if (!duration) return
      callbacksRef.current.onSeek(currentProgress + (seconds / duration) * 100)
    }
    const seekTo = (details: MediaSessionActionDetails) => {
      const { duration } = playbackRef.current
      if (!duration || typeof details.seekTime !== 'number') return
      callbacksRef.current.onSeek((details.seekTime / duration) * 100)
    }

    setMediaAction(session, 'play', () => callbacksRef.current.onPlay())
    setMediaAction(session, 'pause', () => callbacksRef.current.onPause())
    setMediaAction(session, 'previoustrack', () => callbacksRef.current.onPrevious())
    setMediaAction(session, 'nexttrack', () => callbacksRef.current.onNext())
    setMediaAction(session, 'seekbackward', (details) => seekBy(-(details.seekOffset ?? 10)))
    setMediaAction(session, 'seekforward', (details) => seekBy(details.seekOffset ?? 10))
    setMediaAction(session, 'seekto', seekTo)

    return () => {
      setMediaAction(session, 'play', null)
      setMediaAction(session, 'pause', null)
      setMediaAction(session, 'previoustrack', null)
      setMediaAction(session, 'nexttrack', null)
      setMediaAction(session, 'seekbackward', null)
      setMediaAction(session, 'seekforward', null)
      setMediaAction(session, 'seekto', null)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled || !isAndroidNativeRuntime()) return
    const handleCommand = (event: Event) => {
      const command = parseIosMediaCommand((event as CustomEvent<unknown>).detail)
      if (!command) return
      const { progress: currentProgress, duration } = playbackRef.current
      const seekBy = (seconds: number) => {
        if (duration > 0) callbacksRef.current.onSeek(currentProgress + (seconds / duration) * 100)
      }
      switch (command.type) {
        case 'play': callbacksRef.current.onPlay(); break
        case 'pause': callbacksRef.current.onPause(); break
        case 'toggle-playback':
          if (playingRef.current) callbacksRef.current.onPause()
          else callbacksRef.current.onPlay()
          break
        case 'previous': callbacksRef.current.onPrevious(); break
        case 'next': callbacksRef.current.onNext(); break
        case 'toggle-like': callbacksRef.current.onToggleLike(); break
        case 'seek-to':
          if (duration > 0) callbacksRef.current.onSeek((command.position / duration) * 100)
          break
        case 'seek-forward': seekBy(command.offset); break
        case 'seek-backward': seekBy(-command.offset); break
        case 'interruption-began':
          wasPlayingBeforeInterruptionRef.current = playingRef.current
          if (playingRef.current) callbacksRef.current.onPause()
          break
        case 'interruption-ended':
          if (command.shouldResume && wasPlayingBeforeInterruptionRef.current) callbacksRef.current.onPlay()
          wasPlayingBeforeInterruptionRef.current = false
          break
        case 'route-disconnected':
          wasPlayingBeforeInterruptionRef.current = false
          if (playingRef.current) callbacksRef.current.onPause()
          break
        default: break
      }
    }
    window.addEventListener('echora-android-media-command', handleCommand)
    return () => window.removeEventListener('echora-android-media-command', handleCommand)
  }, [enabled])

  useEffect(() => {
    if (!enabled || !isIosNativeRuntime()) return
    let cancelled = false
    let unlisten: (() => void) | undefined
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const stop = await listen<string>('echora://ios-media-command', ({ payload }) => {
        const command = parseIosMediaCommand(payload)
        if (!command) return
        const { progress: currentProgress, duration } = playbackRef.current
        const seekBy = (seconds: number) => {
          if (duration > 0) callbacksRef.current.onSeek(currentProgress + (seconds / duration) * 100)
        }
        switch (command.type) {
          case 'play': callbacksRef.current.onPlay(); break
          case 'pause': callbacksRef.current.onPause(); break
          case 'toggle-playback':
            if (playingRef.current) callbacksRef.current.onPause()
            else callbacksRef.current.onPlay()
            break
          case 'previous': callbacksRef.current.onPrevious(); break
          case 'next': callbacksRef.current.onNext(); break
          case 'toggle-like': callbacksRef.current.onToggleLike(); break
          case 'seek-to':
            if (duration > 0) callbacksRef.current.onSeek((command.position / duration) * 100)
            break
          case 'seek-forward': seekBy(command.offset); break
          case 'seek-backward': seekBy(-command.offset); break
          case 'interruption-began':
            wasPlayingBeforeInterruptionRef.current = playingRef.current
            if (playingRef.current) callbacksRef.current.onPause()
            break
          case 'interruption-ended':
            if (command.shouldResume && wasPlayingBeforeInterruptionRef.current) callbacksRef.current.onPlay()
            wasPlayingBeforeInterruptionRef.current = false
            break
          case 'route-disconnected':
            if (playingRef.current) callbacksRef.current.onPause()
            break
        }
      })
      if (cancelled) stop()
      else unlisten = stop
    }).catch(() => undefined)
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [enabled])

  useEffect(() => {
    const session = supportsSystemMediaControls() ? navigator.mediaSession : null
    if (!enabled) {
      nativeStateRef.current = emptyNativePlaybackState()
      if (session) session.metadata = null
      void invokeIosNowPlaying('clear_ios_now_playing')
      invokeAndroidMediaSession('clear')
      return
    }
    if (!track) {
      nativeStateRef.current = emptyNativePlaybackState()
      if (session) session.metadata = null
      void invokeIosNowPlaying('clear_ios_now_playing')
      invokeAndroidMediaSession('clear')
      return
    }

    const controller = new AbortController()
    const initialArtwork = track.cover ? platformBridge.mediaUrl(track.cover) : undefined
    if (session) publishMediaMetadata(session, track, initialArtwork)
    void invokeIosNowPlaying('update_ios_now_playing_metadata', {
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.durationSeconds,
      artworkDataUrl: null,
      liveArtworkBase64: null,
    })
    invokeAndroidMediaSession('updateMetadata', {
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.durationSeconds,
      coverUrl: track.cover ?? '',
    })
    if (track.cover) {
      void cacheSystemArtwork(track.cover, controller.signal)
        .then(async (artwork) => {
          if (controller.signal.aborted) return
          if (session) publishMediaMetadata(session, track, artwork)
          const liveArtworkBase64 = isIosNativeRuntime() ? await compactLiveArtwork(artwork) : null
          if (controller.signal.aborted) return
          void invokeIosNowPlaying('update_ios_now_playing_metadata', {
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration: track.durationSeconds,
            artworkDataUrl: artwork,
            liveArtworkBase64,
          })
        })
        .catch(() => undefined)
    }
    return () => {
      controller.abort()
      if (session) session.metadata = null
    }
  }, [enabled, track?.album, track?.artist, track?.cover, track?.durationSeconds, track?.id, track?.title])

  useEffect(() => {
    if (!enabled || !supportsSystemMediaControls()) return
    const session = navigator.mediaSession
    session.playbackState = track ? (isPlaying ? 'playing' : 'paused') : 'none'
    return () => { session.playbackState = 'none' }
  }, [enabled, isPlaying, track?.id])

  useEffect(() => {
    const syncPosition = () => {
      const progress = progressStore.getSnapshot()
      const duration = track?.durationSeconds ?? 0
      playbackRef.current = { progress, duration }
      if (!enabled || !track || !duration || !Number.isFinite(duration)) return

      if (supportsSystemMediaControls() && !isIosNativeRuntime() && !isAndroidNativeRuntime()) {
        try {
          navigator.mediaSession.setPositionState({
            duration,
            playbackRate,
            position: Math.min(duration, Math.max(0, duration * progress / 100)),
          })
        } catch {
          // Metadata remains useful when a host does not support position state.
        }
      }

      const elapsed = Math.min(duration, Math.max(0, duration * progress / 100))
      const previous = nativeStateRef.current
      const nativeSyncInterval = isIosNativeRuntime() ? 10 : 15
      const shouldSync = previous.trackId !== track.id
        || previous.isPlaying !== isPlaying
        || previous.liked !== liked
        || previous.playbackRate !== playbackRate
        || Math.abs(previous.elapsed - elapsed) >= nativeSyncInterval
      if (!shouldSync) return
      nativeStateRef.current = { trackId: track.id, elapsed, playbackRate, isPlaying, liked }
      void invokeIosNowPlaying('update_ios_now_playing_state', {
        elapsed,
        duration,
        playbackRate,
        isPlaying,
        isLiked: liked,
      })
      invokeAndroidMediaSession('updateState', {
        elapsed,
        duration,
        playbackRate,
        isPlaying,
        isLiked: liked,
      })
    }

    syncPosition()
    return progressStore.subscribe(syncPosition)
  }, [enabled, isPlaying, liked, playbackRate, progressStore, track?.durationSeconds, track?.id])
}

export const usePlaybackWakeLock = (enabled: boolean) => {
  const lockRef = useRef<WakeLockLike | null>(null)

  useEffect(() => {
    if (!enabled || !supportsPlaybackWakeLock()) return
    let cancelled = false
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || lockRef.current && !lockRef.current.released) return
      try {
        const lock = await (navigator as WakeLockNavigator).wakeLock!.request('screen')
        if (cancelled) {
          await lock.release()
          return
        }
        lockRef.current = lock
        lock.addEventListener?.('release', () => { if (lockRef.current === lock) lockRef.current = null })
      } catch {
        lockRef.current = null
      }
    }
    const handleVisibility = () => { if (document.visibilityState === 'visible') void acquire() }
    document.addEventListener('visibilitychange', handleVisibility)
    void acquire()
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibility)
      const lock = lockRef.current
      lockRef.current = null
      if (lock && !lock.released) void lock.release()
    }
  }, [enabled])
}
