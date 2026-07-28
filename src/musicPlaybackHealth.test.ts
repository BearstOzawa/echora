import { describe, expect, it, vi } from 'vitest'
import { initialTracks } from './testFixtures'
import { playbackHealthReason, reportMusicPlaybackHealth } from './musicPlaybackHealth'
import type { PlatformBridge } from './platformBridge'
import type { AudioPlaybackIssue } from './useAudioPlayback'
import type { LxMusicInfo, Track } from './types'

const bridge = (requestJson = vi.fn().mockResolvedValue({ ok: true, status: 202, data: { accepted: 1 } })) => ({
  transport: 'web-bff' as const,
  requestJson,
  mediaUrl: (url: string) => url,
}) satisfies PlatformBridge

const remoteTrack = (overrides: Partial<Track> = {}): Track => ({
  ...initialTracks[0],
  offline: false,
  remote: {
    source: 'wy',
    musicInfo: {} as LxMusicInfo,
    availableQualities: ['128k', '320k', 'flac'],
    playbackToken: 'signed-playback-token',
  },
  ...overrides,
})

const issue = (message: string, code: number | null = null): AudioPlaybackIssue => ({
  kind: 'media',
  message,
  latencyMs: 1200,
  diagnostics: {
    playbackKey: '1:url',
    url: 'https://media.example/song.mp3',
    currentTime: 0,
    duration: null,
    paused: true,
    readyState: 0,
    networkState: 3,
    lastEvent: 'error',
    error: code == null ? null : { code, message: '' },
    events: [],
  },
})

describe('music playback health', () => {
  it('maps media failures to bounded reasons', () => {
    expect(playbackHealthReason(issue('播放源响应超时'))).toBe('start_timeout')
    expect(playbackHealthReason(issue('播放没有正常进行'))).toBe('stalled')
    expect(playbackHealthReason(issue('无法开始播放这首歌曲'))).toBe('start_failed')
    expect(playbackHealthReason(issue('媒体失败', 4))).toBe('format_unsupported')
    expect(playbackHealthReason(issue('媒体失败', 2))).toBe('network')
    expect(playbackHealthReason(issue('媒体失败', 3))).toBe('media_error')
  })

  it('reports only provider outcome timing and quality fields', async () => {
    const requestJson = vi.fn().mockResolvedValue({ ok: true, status: 202, data: { accepted: 1 } })
    const track = remoteTrack({
      title: '不会上传的标题',
      audioUrl: 'https://media.example/secret.mp3',
      remote: {
        ...remoteTrack().remote!,
        requestedQuality: 'flac' as const,
        resolvedQuality: '320k' as const,
        playbackToken: 'signed-playback-token',
      },
    })

    await reportMusicPlaybackHealth({ track, outcome: 'success', latencyMs: 329.6 }, bridge(requestJson))

    expect(requestJson).toHaveBeenCalledWith('music.playbackHealth', {
      method: 'POST',
      body: { events: [{ source: 'wy', outcome: 'success', latencyMs: 330, requestedQuality: 'flac', resolvedQuality: '320k', playbackToken: 'signed-playback-token' }] },
    })
    const payload = requestJson.mock.calls[0][1].body as { events: Array<Record<string, unknown>> }
    expect(Object.keys(payload.events[0]).sort()).toEqual(['latencyMs', 'outcome', 'playbackToken', 'requestedQuality', 'resolvedQuality', 'source'])
  })

  it('skips unsigned remote tracks', async () => {
    const requestJson = vi.fn()
    await reportMusicPlaybackHealth({
      track: remoteTrack({ remote: { ...remoteTrack().remote!, playbackToken: undefined } }),
      outcome: 'success',
      latencyMs: 240,
    }, bridge(requestJson))
    expect(requestJson).not.toHaveBeenCalled()
  })

  it('skips local files and absorbs transport failures', async () => {
    const requestJson = vi.fn().mockRejectedValue(new Error('offline'))
    const nativeBridge = bridge(requestJson)
    await expect(reportMusicPlaybackHealth({
      track: remoteTrack({ localFileId: 'download-1', audioUrl: 'blob:local' }),
      outcome: 'success',
      latencyMs: 10,
    }, nativeBridge)).resolves.toBeUndefined()
    expect(requestJson).not.toHaveBeenCalled()

    await expect(reportMusicPlaybackHealth({
      track: remoteTrack({ audioUrl: 'https://media.example/song.mp3' }),
      outcome: 'error',
      latencyMs: 800,
      reason: 'network',
    }, nativeBridge)).resolves.toBeUndefined()
    expect(requestJson).toHaveBeenCalledOnce()
  })
})
