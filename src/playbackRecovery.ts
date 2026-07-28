import type { Track } from './types'

export const remotePlaybackRefreshIntervalMs = 2 * 60_000

export const unresolvedPlaybackTrack = (track: Track): Track => ({
  ...track,
  audioUrl: undefined,
  remote: track.remote ? { ...track.remote, resolvedQuality: undefined, resolvedAt: undefined, playbackToken: undefined } : undefined,
})

export const canReusePlaybackResource = (track: Track, now = Date.now()) => {
  if (!track.audioUrl) return false
  if (track.localFileId || !track.remote) return true
  const resolvedAt = track.remote.resolvedAt
  return typeof resolvedAt === 'number'
    && Number.isFinite(resolvedAt)
    && resolvedAt <= now
    && now - resolvedAt < remotePlaybackRefreshIntervalMs
}

export const needsRemotePlaybackRefresh = (track: Track, now = Date.now()) => Boolean(
  track.remote
  && !track.localFileId
  && !canReusePlaybackResource(track, now),
)

export const mergePlaybackResource = (queueTrack: Track, playableTrack: Track): Track => ({
  ...queueTrack,
  ...playableTrack,
  id: queueTrack.id,
  x: queueTrack.x,
  y: queueTrack.y,
})

export const localPlaybackTrack = (track: Track, localTracks: Track[]): Track => {
  const local = localTracks.find((candidate) => candidate.localFileId
    && candidate.audioUrl
    && (candidate.id === track.id || hasSameRemoteIdentity(candidate, track)))
  return local ? mergePlaybackResource(track, local) : track
}

export const hasSameRemoteIdentity = (left: Track, right: Track) => Boolean(
  remoteTrackIdentity(left)
  && remoteTrackIdentity(left) === remoteTrackIdentity(right),
)

export const remoteTrackIdentity = (track: Track) => track.remote
  ? `${track.remote.source}:${String(track.remote.musicInfo.songmid)}`
  : null

export const hasSameLocalResource = (left: Track, right: Track) => Boolean(
  (left.localFileId && right.localFileId && left.localFileId === right.localFileId)
  || hasSameRemoteIdentity(left, right),
)

export const claimAutomaticPlaybackRetry = (track: Track, attemptedTrackIds: Set<number>) => {
  if (!track.remote || track.localFileId || attemptedTrackIds.has(track.id)) return false
  attemptedTrackIds.add(track.id)
  return true
}
