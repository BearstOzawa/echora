import { beforeEach, describe, expect, it } from 'vitest'
import { initialTracks } from './testFixtures'
import { clearPlaybackSession, playbackSessionKey, readPlaybackSession, writePlaybackSession } from './playbackSession'
import type { PlaybackSession } from './playbackSession'
import { defaultPlaybackContext, restoredPlaybackContext } from './playbackContext'

const sessionTracks = initialTracks.map((track, index) => ({
  ...track,
  remote: {
    source: 'tx' as const,
    musicInfo: { songmid: `fixture-${index}`, name: track.title, singer: track.artist, albumName: track.album, source: 'tx' as const, interval: track.duration, types: [], _types: {}, typeUrl: {} },
    availableQualities: ['flac' as const],
  },
}))

const session: PlaybackSession = {
  tracks: sessionTracks,
  detachedTrack: null,
  downloadedTrackIds: [1, 3],
  activeTrackId: 3,
  isPlaying: false,
  playbackMode: 'sequence',
  playbackRate: 1.25,
  playProgress: 42,
  volume: 68,
  muted: false,
  quality: '无损',
  intensity: 64,
  novelty: 38,
  intent: '保持安静，之后逐渐明亮。',
  sessionName: '深夜专注',
  playbackContext: defaultPlaybackContext,
}

describe('playback session storage', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips a complete session', () => {
    writePlaybackSession(session)
    const restored = readPlaybackSession()
    expect(restored).toEqual(session)
  })

  it('always resumes a saved session in the paused state', () => {
    writePlaybackSession({ ...session, isPlaying: true })
    expect(JSON.parse(localStorage.getItem(playbackSessionKey)!).isPlaying).toBe(false)
    expect(readPlaybackSession()?.isPlaying).toBe(false)
  })

  it('migrates older sessions and clamps unsafe values', () => {
    localStorage.setItem(playbackSessionKey, JSON.stringify({
      ...session,
      isPlaying: undefined,
      playbackMode: 'unsupported',
      playbackRate: 3,
      activeTrackId: 999,
      playProgress: 140,
      volume: -12,
      quality: 'studio master',
      playbackContext: undefined,
    }))

    const restored = readPlaybackSession()
    expect(restored).toMatchObject({
      activeTrackId: initialTracks[0].id,
      isPlaying: false,
      playbackMode: 'sequence',
      playbackRate: 1,
      playProgress: 100,
      volume: 0,
      quality: '无损',
      playbackContext: restoredPlaybackContext,
    })
  })

  it('rejects malformed or empty track data', () => {
    localStorage.setItem(playbackSessionKey, JSON.stringify({ ...session, tracks: [] }))
    expect(readPlaybackSession()).toBeNull()
    localStorage.setItem(playbackSessionKey, '{broken')
    expect(readPlaybackSession()).toBeNull()
  })

  it('clears the saved session', () => {
    writePlaybackSession(session)
    clearPlaybackSession()
    expect(localStorage.getItem(playbackSessionKey)).toBeNull()
  })

  it('does not persist session-only blob URLs for local tracks', () => {
    const localTrack = { ...initialTracks[0], id: -1, source: '本地' as const, localFileId: 'local-file', audioUrl: 'blob:audio', cover: 'blob:cover' }
    writePlaybackSession({ ...session, tracks: [localTrack], activeTrackId: localTrack.id, downloadedTrackIds: [localTrack.id] })
    const stored = JSON.parse(localStorage.getItem(playbackSessionKey)!)
    expect(stored.tracks[0].audioUrl).toBeUndefined()
    expect(stored.tracks[0].cover).toBe('/echora-mark-v2.svg')
  })

  it('does not persist expiring playback URLs or resolved qualities for remote tracks', () => {
    const remoteTrack = {
      ...sessionTracks[0],
      audioUrl: 'https://music.example/temporary.flac',
      quality: '无损',
      remote: { ...sessionTracks[0].remote, resolvedQuality: 'flac' as const, resolvedAt: Date.now(), playbackToken: 'signed-playback-token' },
    }
    writePlaybackSession({ ...session, tracks: [remoteTrack], activeTrackId: remoteTrack.id })

    const stored = JSON.parse(localStorage.getItem(playbackSessionKey)!)
    expect(stored.tracks[0].audioUrl).toBeUndefined()
    expect(stored.tracks[0].remote.resolvedQuality).toBeUndefined()
    expect(stored.tracks[0].remote.resolvedAt).toBeUndefined()
    expect(stored.tracks[0].remote.playbackToken).toBeUndefined()
    expect(readPlaybackSession()?.tracks[0]).toMatchObject({ id: remoteTrack.id, audioUrl: undefined })
  })

  it('sanitizes expiring remote playback data from older sessions', () => {
    localStorage.setItem(playbackSessionKey, JSON.stringify({
      ...session,
      tracks: [{
        ...sessionTracks[0],
        audioUrl: 'https://music.example/expired.flac',
        remote: { ...sessionTracks[0].remote, resolvedQuality: 'flac', resolvedAt: Date.now() - 60_000, playbackToken: 'expired-playback-token' },
      }],
      activeTrackId: sessionTracks[0].id,
    }))

    const restored = readPlaybackSession()!
    expect(restored.tracks[0].audioUrl).toBeUndefined()
    expect(restored.tracks[0].remote?.resolvedQuality).toBeUndefined()
    expect(restored.tracks[0].remote?.resolvedAt).toBeUndefined()
    expect(restored.tracks[0].remote?.playbackToken).toBeUndefined()
    expect(restored.playProgress).toBe(session.playProgress)
  })

  it('restores a current track that is intentionally outside the active queue', () => {
    const detachedTrack = {
      ...sessionTracks[2],
      audioUrl: 'https://music.example/temporary.flac',
      remote: { ...sessionTracks[2].remote, resolvedQuality: 'flac' as const },
    }
    writePlaybackSession({
      ...session,
      tracks: sessionTracks.slice(0, 2),
      detachedTrack,
      activeTrackId: detachedTrack.id,
      playProgress: 37,
    })

    const restored = readPlaybackSession()!
    expect(restored.activeTrackId).toBe(detachedTrack.id)
    expect(restored.playProgress).toBe(37)
    expect(restored.detachedTrack).toMatchObject({ id: detachedTrack.id, audioUrl: undefined })
    expect(restored.detachedTrack?.remote?.resolvedQuality).toBeUndefined()
  })
})
