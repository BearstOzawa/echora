import { describe, expect, it } from 'vitest'
import { canReusePlaybackResource, claimAutomaticPlaybackRetry, hasSameLocalResource, hasSameRemoteIdentity, localPlaybackTrack, mergePlaybackResource, needsRemotePlaybackRefresh, remotePlaybackRefreshIntervalMs, remoteTrackIdentity, unresolvedPlaybackTrack } from './playbackRecovery'
import { initialTracks } from './testFixtures'

describe('playback recovery', () => {
  it('removes only the expiring remote playback result', () => {
    const resolved = { ...initialTracks[0], audioUrl: 'https://media.example/expired', remote: { ...initialTracks[0].remote!, resolvedQuality: 'flac' as const, resolvedAt: 123, playbackToken: 'expired-playback-token' } }
    expect(unresolvedPlaybackTrack(resolved)).toMatchObject({ audioUrl: undefined, remote: { resolvedQuality: undefined, resolvedAt: undefined, playbackToken: undefined } })
  })

  it('reuses only fresh remote playback resources while keeping local files stable', () => {
    const now = 1_000_000
    const remote = { ...initialTracks[0], audioUrl: 'https://media.example/fresh', remote: { ...initialTracks[0].remote!, resolvedQuality: 'flac' as const, resolvedAt: now - remotePlaybackRefreshIntervalMs + 1 } }
    expect(canReusePlaybackResource(remote, now)).toBe(true)
    expect(needsRemotePlaybackRefresh(remote, now)).toBe(false)
    expect(needsRemotePlaybackRefresh({ ...remote, remote: { ...remote.remote, resolvedAt: now - remotePlaybackRefreshIntervalMs } }, now)).toBe(true)
    expect(needsRemotePlaybackRefresh({ ...remote, remote: { ...remote.remote, resolvedAt: undefined } }, now)).toBe(true)
    expect(canReusePlaybackResource({ ...remote, localFileId: 'download:tx:song-1', remote: { ...remote.remote, resolvedAt: undefined } }, now)).toBe(true)
  })

  it('prefers an existing local file while preserving the queue position', () => {
    const remote = { ...initialTracks[0], x: 73, y: 22 }
    const local = { ...remote, audioUrl: 'asset://local/song.flac', localFileId: 'download:tx:1', offline: true, x: 1, y: 2 }
    expect(localPlaybackTrack(remote, [local])).toMatchObject({ audioUrl: 'asset://local/song.flac', localFileId: 'download:tx:1', x: 73, y: 22 })
  })

  it('uses a downloaded copy when the catalog id changes but the source identity is unchanged', () => {
    const musicInfo = { songmid: 'same-song', name: '歌曲', singer: '歌手', albumName: '专辑', interval: '03:00', source: 'tx' as const, types: [], _types: {}, typeUrl: {} }
    const queueTrack = { ...initialTracks[0], id: 901, remote: { source: 'tx' as const, musicInfo, availableQualities: ['320k' as const] } }
    const downloaded = { ...queueTrack, id: 902, localFileId: 'download:tx:same-song', audioUrl: 'asset://local-song.mp3', offline: true }

    const result = localPlaybackTrack(queueTrack, [downloaded])

    expect(result.id).toBe(queueTrack.id)
    expect(result.audioUrl).toBe(downloaded.audioUrl)
    expect(result.localFileId).toBe(downloaded.localFileId)
  })

  it('retains the active playback resource when a queue is rebuilt', () => {
    const queueTrack = { ...initialTracks[0], x: 81, y: 37, audioUrl: undefined, localFileId: undefined, offline: false }
    const playable = { ...initialTracks[0], x: 4, y: 6, audioUrl: 'asset://local/song.flac', localFileId: 'download:tx:1', offline: true, quality: 'FLAC 无损' }

    expect(mergePlaybackResource(queueTrack, playable)).toMatchObject({
      audioUrl: 'asset://local/song.flac',
      localFileId: 'download:tx:1',
      offline: true,
      quality: 'FLAC 无损',
      x: 81,
      y: 37,
    })
  })

  it('matches catalog variants using the provider song identity', () => {
    const musicInfo = { songmid: 'song-1', name: '歌曲', singer: '歌手', albumName: '专辑', interval: '03:00', source: 'tx' as const, types: [], _types: {}, typeUrl: {} }
    const remote = { source: 'tx' as const, musicInfo, availableQualities: ['320k' as const] }
    const left = { ...initialTracks[0], remote }
    expect(hasSameRemoteIdentity(left, { ...left, id: left.id + 1 })).toBe(true)
    expect(hasSameRemoteIdentity(left, { ...initialTracks[1], remote: { ...remote, musicInfo: { ...musicInfo, songmid: 'song-2' } } })).toBe(false)
    expect(remoteTrackIdentity(left)).toBe('tx:song-1')
    expect(hasSameLocalResource(
      { ...left, localFileId: 'download:tx:song-1' },
      { ...left, id: left.id + 1, localFileId: 'download:tx:song-1' },
    )).toBe(true)
  })

  it('claims at most one automatic retry for a remote playback attempt', () => {
    const musicInfo = { songmid: 'song-1', name: '歌曲', singer: '歌手', albumName: '专辑', interval: '03:00', source: 'tx' as const, types: [], _types: {}, typeUrl: {} }
    const remoteTrack = { ...initialTracks[0], remote: { source: 'tx' as const, musicInfo, availableQualities: ['320k' as const] } }
    const attempts = new Set<number>()
    expect(claimAutomaticPlaybackRetry(remoteTrack, attempts)).toBe(true)
    expect(claimAutomaticPlaybackRetry(remoteTrack, attempts)).toBe(false)
    expect(claimAutomaticPlaybackRetry({ ...remoteTrack, localFileId: 'download:tx:song-1' }, new Set())).toBe(false)
  })
})
