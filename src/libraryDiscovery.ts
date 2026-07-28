import type { Track } from './types'

export type AlbumGroup = {
  id: string
  name: string
  artist: string
  cover: string
  tracks: Track[]
}

export type ArtistGroup = {
  id: string
  name: string
  cover: string
  tracks: Track[]
}

const normalizeIdentity = (value: string) => value.toLocaleLowerCase().replace(/[\s·・,.，。'"“”‘’()（）\[\]【】_-]/g, '')
const artistIdentities = (value: string) => value.split(/[、/&，,]+/).map(normalizeIdentity).filter(Boolean)
const qualityOrder = ['128k', '320k', 'flac', 'flac24bit'] as const

const isSameTrackVersion = (left: Track, right: Track) => {
  if (normalizeIdentity(left.title) !== normalizeIdentity(right.title)) return false
  const rightArtists = new Set(artistIdentities(right.artist))
  if (!artistIdentities(left.artist).some((artist) => rightArtists.has(artist))) return false
  const sameDuration = left.durationSeconds > 0 && right.durationSeconds > 0 && Math.abs(left.durationSeconds - right.durationSeconds) <= 3
  return sameDuration || normalizeIdentity(left.album) === normalizeIdentity(right.album)
}

const qualityScore = (track: Track) => Math.max(0, ...qualityOrder.map((quality, index) => track.remote?.availableQualities.includes(quality) ? index + 1 : 0))

export const collapseTrackVariants = (tracks: Track[]): Track[] => tracks.reduce((collapsed, track) => {
  const index = collapsed.findIndex((candidate) => isSameTrackVersion(candidate, track))
  if (index < 0) return [...collapsed, track]
  if (qualityScore(track) > qualityScore(collapsed[index])) collapsed[index] = track
  return collapsed
}, [] as Track[])

export const groupAlbums = (tracks: Track[]): AlbumGroup[] => Array.from(tracks.reduce((groups, track) => {
  const id = `${track.artist}\u0000${track.album}`
  const group = groups.get(id) ?? { id, name: track.album, artist: track.artist, cover: track.cover, tracks: [] as Track[] }
  group.tracks.push(track)
  groups.set(id, group)
  return groups
}, new Map<string, AlbumGroup>()).values())

export const groupArtists = (tracks: Track[]): ArtistGroup[] => Array.from(tracks.reduce((groups, track) => {
  const group = groups.get(track.artist) ?? { id: track.artist, name: track.artist, cover: track.cover, tracks: [] as Track[] }
  group.tracks.push(track)
  groups.set(track.artist, group)
  return groups
}, new Map<string, ArtistGroup>()).values())
