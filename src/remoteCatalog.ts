import type { Track } from './types'

export const remoteCatalogStorageKey = 'echora.remoteCatalog.v2'
const maxStoredTracks = 250

const isStoredTrack = (value: unknown): value is Track => {
  if (!value || typeof value !== 'object') return false
  const track = value as Partial<Track>
  return typeof track.id === 'number'
    && typeof track.title === 'string'
    && typeof track.artist === 'string'
    && typeof track.album === 'string'
    && Boolean(track.remote && typeof track.remote === 'object')
}

const persistentTrack = (track: Track): Track => ({
  ...track,
  audioUrl: undefined,
  localFileId: undefined,
  offline: false,
  remote: track.remote ? { ...track.remote, resolvedQuality: undefined, resolvedAt: undefined, playbackToken: undefined } : undefined,
})

export const readRemoteCatalog = (): Track[] => {
  try {
    const value = JSON.parse(localStorage.getItem(remoteCatalogStorageKey) ?? '[]') as unknown
    return Array.isArray(value) ? value.filter(isStoredTrack).map(persistentTrack).slice(-maxStoredTracks) : []
  } catch {
    return []
  }
}

export const writeRemoteCatalog = (tracks: Track[]) => {
  const remoteTracks = tracks.filter((track) => track.remote).map(persistentTrack).slice(-maxStoredTracks)
  if (!remoteTracks.length) {
    localStorage.removeItem(remoteCatalogStorageKey)
    return
  }
  localStorage.setItem(remoteCatalogStorageKey, JSON.stringify(remoteTracks))
}
