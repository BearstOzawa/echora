import { platformBridge, type PlatformBridge } from './platformBridge'
import type { AudioPlaybackIssue } from './useAudioPlayback'
import type { Track } from './types'

export type PlaybackHealthReason =
  | 'start_timeout'
  | 'stalled'
  | 'media_error'
  | 'start_failed'
  | 'format_unsupported'
  | 'network'
  | 'unknown'

type PlaybackHealthInput = {
  track: Track | null
  outcome: 'success' | 'error'
  latencyMs: number
  reason?: PlaybackHealthReason
}

export const playbackHealthReason = (issue: AudioPlaybackIssue): PlaybackHealthReason => {
  if (issue.message === '播放源响应超时') return 'start_timeout'
  if (issue.message === '播放没有正常进行') return 'stalled'
  if (issue.message === '无法开始播放这首歌曲') return 'start_failed'
  if (issue.diagnostics.error?.code === 4) return 'format_unsupported'
  if (issue.diagnostics.error?.code === 2) return 'network'
  return 'media_error'
}

export const reportMusicPlaybackHealth = async (
  { track, outcome, latencyMs, reason }: PlaybackHealthInput,
  bridge: PlatformBridge = platformBridge,
) => {
  if (!track?.remote?.playbackToken || track.localFileId) return
  const event = {
    source: track.remote.source,
    outcome,
    latencyMs: Math.max(0, Math.round(latencyMs)),
    requestedQuality: track.remote.requestedQuality,
    resolvedQuality: track.remote.resolvedQuality,
    playbackToken: track.remote.playbackToken,
    ...(outcome === 'error' ? { reason: reason ?? 'unknown' } : {}),
  }
  try {
    await bridge.requestJson('music.playbackHealth', { method: 'POST', body: { events: [event] } })
  } catch {
    // Playback health is diagnostic only and must never interrupt listening.
  }
}
