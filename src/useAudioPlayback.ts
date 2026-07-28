import { useCallback, useEffect, useRef } from 'react'
import { deriveAudioEffectParameters, equalizerFrequencies, requiresAudioProcessing } from './audioEffects'
import type { AudioEffectsSettings } from './audioEffects'
import type { PlaybackMode, PlaybackRate, Track } from './types'

type Options = {
  track: Track | null
  isPlaying: boolean
  progress: number
  volume: number
  muted: boolean
  playbackRate: PlaybackRate
  playbackMode: PlaybackMode
  audioEffects: AudioEffectsSettings
  onProgress: (progress: number) => void
  onEnded: () => void
  onStarted?: (event: AudioPlaybackStarted) => void
  onError: (issue: AudioPlaybackIssue) => void
}

export type AudioPlaybackStarted = {
  latencyMs: number
}

export type AudioPlaybackIssue = {
  kind: 'media' | 'policy' | 'interrupted'
  message: string
  latencyMs: number
  diagnostics: AudioPlaybackDiagnostics
}

export type AudioPlaybackDiagnostics = {
  playbackKey: string
  url: string
  currentTime: number
  duration: number | null
  paused: boolean
  readyState: number
  networkState: number
  lastEvent: string
  error: { code: number; message: string } | null
  events: Array<{ type: string; at: number; currentTime: number; readyState: number; networkState: number }>
}

export const playbackStartTimeoutMs = 12_000
export const playbackProgressTimeoutMs = 8_000
const playbackStartTimeoutMessage = 'playback_start_timeout'
const mediaEventNames = ['loadstart', 'loadedmetadata', 'durationchange', 'loadeddata', 'canplay', 'canplaythrough', 'play', 'playing', 'pause', 'waiting', 'stalled', 'suspend', 'abort', 'emptied'] as const
const mediaEventHistoryLimit = 16
const playbackDiagnosticHistoryLimit = 8

type DiagnosticWindow = Window & { __ECHORA_MEDIA_DIAGNOSTICS__?: AudioPlaybackDiagnostics[] }

const retainPlaybackDiagnostics = (diagnostics: AudioPlaybackDiagnostics) => {
  if (typeof window === 'undefined') return
  const target = window as DiagnosticWindow
  target.__ECHORA_MEDIA_DIAGNOSTICS__ = [...(target.__ECHORA_MEDIA_DIAGNOSTICS__ ?? []), diagnostics].slice(-playbackDiagnosticHistoryLimit)
}

export const readAudioPlaybackDiagnostics = () => typeof window === 'undefined'
  ? []
  : [...((window as DiagnosticWindow).__ECHORA_MEDIA_DIAGNOSTICS__ ?? [])]

const mediaNumber = (value: number | undefined, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback

const playbackDiagnostics = (audio: HTMLAudioElement, events: AudioPlaybackDiagnostics['events']): AudioPlaybackDiagnostics => ({
  playbackKey: audio.dataset.playbackKey ?? '',
  url: audio.currentSrc || audio.src || '',
  currentTime: mediaNumber(audio.currentTime),
  duration: Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null,
  paused: Boolean(audio.paused),
  readyState: mediaNumber(audio.readyState),
  networkState: mediaNumber(audio.networkState),
  lastEvent: audio.dataset.mediaState ?? '',
  error: audio.error ? { code: audio.error.code, message: audio.error.message } : null,
  events: [...events],
})

type EffectsGraph = {
  context: AudioContext
  preamp: GainNode
  filters: BiquadFilterNode[]
  bass: BiquadFilterNode
  stereoCrossfeed: GainNode[]
  dry: GainNode
  wet: GainNode
  compressor: DynamicsCompressorNode
  output: GainNode
}

const createRoomImpulse = (context: AudioContext) => {
  const length = Math.max(1, Math.floor(context.sampleRate * .38))
  const impulse = context.createBuffer(2, length, context.sampleRate)
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel)
    for (let index = 0; index < length; index += 1) data[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / length, 3.4)
  }
  return impulse
}

const createEffectsGraph = (audio: HTMLAudioElement): EffectsGraph | null => {
  const Context = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Context) return null
  try {
    const context = new Context()
    const source = context.createMediaElementSource(audio)
    const preamp = context.createGain()
    const bass = context.createBiquadFilter()
    bass.type = 'lowshelf'
    bass.frequency.value = 90
    const filters = equalizerFrequencies.map((frequency) => {
      const filter = context.createBiquadFilter()
      filter.type = 'peaking'
      filter.frequency.value = frequency
      filter.Q.value = frequency < 100 ? .7 : 1.05
      return filter
    })
    const dry = context.createGain()
    const convolver = context.createConvolver()
    convolver.buffer = createRoomImpulse(context)
    const wet = context.createGain()
    const compressor = context.createDynamicsCompressor()
    const output = context.createGain()
    const splitter = context.createChannelSplitter(2)
    const merger = context.createChannelMerger(2)
    const leftDirect = context.createGain()
    const rightDirect = context.createGain()
    const leftCross = context.createGain()
    const rightCross = context.createGain()

    source.connect(preamp)
    preamp.connect(bass)
    let previous: AudioNode = bass
    filters.forEach((filter) => {
      previous.connect(filter)
      previous = filter
    })
    previous.connect(splitter)
    splitter.connect(leftDirect, 0)
    splitter.connect(rightDirect, 1)
    splitter.connect(leftCross, 0)
    splitter.connect(rightCross, 1)
    leftDirect.connect(merger, 0, 0)
    rightDirect.connect(merger, 0, 1)
    leftCross.connect(merger, 0, 1)
    rightCross.connect(merger, 0, 0)
    merger.connect(dry)
    merger.connect(convolver)
    convolver.connect(wet)
    dry.connect(compressor)
    wet.connect(compressor)
    compressor.connect(output)
    output.connect(context.destination)
    return { context, preamp, filters, bass, stereoCrossfeed: [leftCross, rightCross], dry, wet, compressor, output }
  } catch {
    return null
  }
}

const applyAudioEffects = (graph: EffectsGraph, settings: AudioEffectsSettings) => {
  const parameters = deriveAudioEffectParameters(settings)
  const now = graph.context.currentTime
  graph.preamp.gain.setTargetAtTime(parameters.preampGain, now, .025)
  graph.filters.forEach((filter, index) => filter.gain.setTargetAtTime(parameters.bandGains[index] ?? 0, now, .025))
  graph.bass.gain.setTargetAtTime(parameters.bassGain, now, .025)
  graph.dry.gain.setTargetAtTime(1, now, .025)
  graph.wet.gain.setTargetAtTime(parameters.wetGain, now, .04)
  graph.stereoCrossfeed.forEach((gain) => gain.gain.setTargetAtTime(parameters.stereoCrossfeed, now, .04))
  graph.compressor.threshold.setTargetAtTime(parameters.compressor ? -12 - parameters.compressorAmount * 12 : 0, now, .03)
  graph.compressor.knee.setTargetAtTime(parameters.compressor ? 8 + parameters.compressorAmount * 14 : 0, now, .03)
  graph.compressor.ratio.setTargetAtTime(parameters.compressor ? 1.4 + parameters.compressorAmount * 3.2 : 1, now, .03)
  graph.compressor.attack.setTargetAtTime(parameters.compressor ? .012 : 0, now, .03)
  graph.compressor.release.setTargetAtTime(parameters.compressor ? .24 : .01, now, .03)
}

export const useAudioPlayback = ({ track, isPlaying, progress, volume, muted, playbackRate, playbackMode, audioEffects, onProgress, onEnded, onStarted, onError }: Options) => {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const effectsGraphRef = useRef<EffectsGraph | null>(null)
  const mediaEventsRef = useRef<AudioPlaybackDiagnostics['events']>([])
  const audioEffectsRef = useRef(audioEffects)
  const callbacksRef = useRef({ onProgress, onEnded, onStarted, onError })
  const playbackAttemptRef = useRef<{ playbackKey: string; startedAt: number } | null>(null)
  const reportedStartKeyRef = useRef('')
  const hasRealAudio = Boolean(track?.audioUrl)
  const processingRequired = requiresAudioProcessing(audioEffects)
  const processingUrl = track?.audioUrl ?? ''
  const canProcessAudio = processingRequired && Boolean(processingUrl) && (() => {
    if (!/^https?:\/\//i.test(processingUrl)) return true
    try { return new URL(processingUrl).origin === window.location.origin } catch { return false }
  })()
  callbacksRef.current = { onProgress, onEnded, onStarted, onError }
  audioEffectsRef.current = audioEffects

  const reportIssue = useCallback((kind: AudioPlaybackIssue['kind'], message: string) => {
    const audio = audioRef.current
    if (!audio) return
    const diagnostics = playbackDiagnostics(audio, mediaEventsRef.current)
    const attempt = playbackAttemptRef.current
    const latencyMs = attempt?.playbackKey === diagnostics.playbackKey
      ? Math.max(0, performance.now() - attempt.startedAt)
      : 0
    retainPlaybackDiagnostics(diagnostics)
    callbacksRef.current.onError({ kind, message, latencyMs, diagnostics })
  }, [])

  useEffect(() => {
    if (!hasRealAudio) return
    const audio = new Audio()
    if (canProcessAudio) audio.crossOrigin = 'anonymous'
    audio.preload = 'metadata'
    if (audio instanceof Node) {
      audio.hidden = true
      audio.setAttribute('aria-hidden', 'true')
      audio.dataset.echoraPlayer = 'true'
      document.body.appendChild(audio)
    }
    audioRef.current = audio
    effectsGraphRef.current = canProcessAudio ? createEffectsGraph(audio) : null
    if (effectsGraphRef.current) applyAudioEffects(effectsGraphRef.current, audioEffectsRef.current)
    mediaEventsRef.current = []

    const recordMediaState = (event: Event) => {
      audio.dataset.mediaState = event.type
      mediaEventsRef.current.push({
        type: event.type,
        at: Date.now(),
        currentTime: mediaNumber(audio.currentTime),
        readyState: mediaNumber(audio.readyState),
        networkState: mediaNumber(audio.networkState),
      })
      if (mediaEventsRef.current.length > mediaEventHistoryLimit) {
        mediaEventsRef.current.splice(0, mediaEventsRef.current.length - mediaEventHistoryLimit)
      }
    }

    const updateProgress = () => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return
      callbacksRef.current.onProgress((audio.currentTime / audio.duration) * 100)
    }
    const handleEnded = () => callbacksRef.current.onEnded()
    const handleError = (event: Event) => {
      recordMediaState(event)
      reportIssue('media', '无法播放这首歌曲，播放地址可能已失效或格式不受支持')
    }
    audio.addEventListener('timeupdate', updateProgress)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', handleError)
    for (const event of mediaEventNames) {
      audio.addEventListener(event, recordMediaState)
    }
    return () => {
      audio.pause()
      audio.removeEventListener('timeupdate', updateProgress)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', handleError)
      for (const event of mediaEventNames) {
        audio.removeEventListener(event, recordMediaState)
      }
      audio.removeAttribute('src')
      if (audio instanceof Node) audio.remove()
      audioRef.current = null
      if (effectsGraphRef.current) void effectsGraphRef.current.context.close()
      effectsGraphRef.current = null
    }
  }, [canProcessAudio, hasRealAudio, reportIssue])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (!track?.audioUrl) {
      audio.pause()
      audio.removeAttribute('src')
      audio.dataset.playbackKey = ''
      return
    }
    const playbackKey = `${track.id}:${track.audioUrl}`
    if (audio.dataset.playbackKey === playbackKey) return
    audio.pause()
    audio.src = track.audioUrl
    audio.dataset.playbackKey = playbackKey
    audio.load()
    const graph = effectsGraphRef.current
    if (graph) {
      const { fadeSeconds } = deriveAudioEffectParameters(audioEffectsRef.current)
      const now = graph.context.currentTime
      graph.output.gain.cancelScheduledValues(now)
      graph.output.gain.setValueAtTime(fadeSeconds > 0 ? 0 : 1, now)
      if (fadeSeconds > 0) graph.output.gain.linearRampToValueAtTime(1, now + fadeSeconds)
    }
    if (progress > 0 && track.durationSeconds > 0) audio.currentTime = track.durationSeconds * progress / 100
  }, [canProcessAudio, progress, track?.audioUrl, track?.durationSeconds, track?.id])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !track?.audioUrl) return
    if (!isPlaying) {
      audio.pause()
      const context = effectsGraphRef.current?.context
      if (context?.state === 'running') void context.suspend().catch(() => undefined)
      return
    }
    let cancelled = false
    let watchdogFailed = false
    let progressTimeoutId: ReturnType<typeof setTimeout> | undefined
    const playbackKey = audio.dataset.playbackKey ?? ''
    playbackAttemptRef.current = { playbackKey, startedAt: performance.now() }
    let lastObservedTime = audio.currentTime
    const armProgressWatchdog = () => {
      if (watchdogFailed) return
      if (progressTimeoutId !== undefined) clearTimeout(progressTimeoutId)
      progressTimeoutId = setTimeout(() => {
        if (cancelled || audioRef.current !== audio || audio.dataset.playbackKey !== playbackKey || audio.paused) return
        if (audio.currentTime > lastObservedTime + .05) {
          lastObservedTime = audio.currentTime
          armProgressWatchdog()
          return
        }
        watchdogFailed = true
        reportIssue('media', '播放没有正常进行')
      }, playbackProgressTimeoutMs)
    }
    const handlePlaybackProgress = () => {
      if (watchdogFailed) return
      if (audio.currentTime <= lastObservedTime + .05) return
      lastObservedTime = audio.currentTime
      if (reportedStartKeyRef.current !== playbackKey) {
        reportedStartKeyRef.current = playbackKey
        const attempt = playbackAttemptRef.current
        callbacksRef.current.onStarted?.({
          latencyMs: attempt && attempt.playbackKey === playbackKey ? Math.max(0, performance.now() - attempt.startedAt) : 0,
        })
      }
      armProgressWatchdog()
    }
    audio.addEventListener('timeupdate', handlePlaybackProgress)
    const startPlayback = async () => {
      const context = effectsGraphRef.current?.context
      if (context?.state === 'suspended') await context.resume()
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          audio.play(),
          new Promise<void>((_resolve, reject) => {
            timeoutId = setTimeout(() => reject(new Error(playbackStartTimeoutMessage)), playbackStartTimeoutMs)
          }),
        ])
        lastObservedTime = audio.currentTime
        armProgressWatchdog()
      } catch (error: unknown) {
        if (audioRef.current !== audio || audio.dataset.playbackKey !== playbackKey) return
        if (error instanceof Error && error.message === playbackStartTimeoutMessage) {
          reportIssue('media', '播放源响应超时')
          return
        }
        if (error instanceof DOMException && error.name === 'AbortError') {
          reportIssue('interrupted', '播放请求已被新的操作替换')
          return
        }
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          reportIssue('policy', '浏览器阻止了自动播放，请再次点击播放')
          return
        }
        reportIssue('media', '无法开始播放这首歌曲')
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId)
      }
    }
    void startPlayback()
    return () => {
      cancelled = true
      if (progressTimeoutId !== undefined) clearTimeout(progressTimeoutId)
      audio.removeEventListener('timeupdate', handlePlaybackProgress)
    }
  }, [canProcessAudio, isPlaying, reportIssue, track?.audioUrl, track?.id])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = Math.min(1, Math.max(0, volume / 100))
    audio.muted = muted
  }, [muted, volume])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate
  }, [playbackRate])

  useEffect(() => {
    if (audioRef.current) audioRef.current.loop = playbackMode === 'repeat-one'
  }, [playbackMode])

  useEffect(() => {
    if (effectsGraphRef.current) applyAudioEffects(effectsGraphRef.current, audioEffects)
  }, [audioEffects])

  const seek = useCallback((nextProgress: number) => {
    const boundedProgress = Math.min(100, Math.max(0, nextProgress))
    const audio = audioRef.current
    if (audio?.src && Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = audio.duration * boundedProgress / 100
    callbacksRef.current.onProgress(boundedProgress)
  }, [])

  return { isRealAudio: hasRealAudio, seek }
}
