import type { Track } from './types'

export const likedTracksKey = 'echora.likedTracks'

export type LikedTracks = {
  ids: number[]
  tracks: Track[]
}

const legacyDemoLikedTrackIds = [1, 3, 5, 8]
const isLegacyDemoIds = (ids: number[]) => ids.length === legacyDemoLikedTrackIds.length
  && ids.every((id) => legacyDemoLikedTrackIds.includes(id))

const isTrackSnapshot = (value: unknown): value is Track => {
  if (!value || typeof value !== 'object') return false
  const track = value as Partial<Track>
  return typeof track.id === 'number'
    && typeof track.title === 'string'
    && typeof track.artist === 'string'
    && typeof track.album === 'string'
    && typeof track.source === 'string'
}

export const likedTrackSnapshot = (track: Track): Track => ({
  ...track,
  audioUrl: undefined,
  remote: track.remote ? { ...track.remote, resolvedQuality: undefined, resolvedAt: undefined, playbackToken: undefined } : undefined,
})

export const readLikedTracks = (): LikedTracks => {
  try {
    const stored = JSON.parse(localStorage.getItem(likedTracksKey) ?? 'null') as unknown
    if (Array.isArray(stored)) {
      const ids = Array.from(new Set(stored.filter((id): id is number => typeof id === 'number' && Number.isInteger(id))))
      return {
        ids: isLegacyDemoIds(ids) ? [] : ids,
        tracks: [],
      }
    }
    if (!stored || typeof stored !== 'object') return { ids: [], tracks: [] }
    const value = stored as Partial<LikedTracks>
    const ids = Array.isArray(value.ids)
      ? Array.from(new Set(value.ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id))))
      : []
    if (isLegacyDemoIds(ids)) return { ids: [], tracks: [] }
    const tracks = Array.isArray(value.tracks)
      ? value.tracks.filter(isTrackSnapshot).filter((track) => ids.includes(track.id)).map(likedTrackSnapshot)
      : []
    return { ids, tracks }
  } catch {
    return { ids: [], tracks: [] }
  }
}

export const writeLikedTracks = (liked: LikedTracks) => localStorage.setItem(likedTracksKey, JSON.stringify({
  ids: Array.from(new Set(liked.ids)),
  tracks: liked.tracks.filter((track) => liked.ids.includes(track.id)).map(likedTrackSnapshot),
}))
