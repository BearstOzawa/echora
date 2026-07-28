import type { PlaybackMode, Track } from './types'

export const getNextTrackId = (tracks: Track[], activeTrackId: number, mode: PlaybackMode, automatic = false, random = Math.random): number | null => {
  if (!tracks.length) return null
  const activeIndex = Math.max(0, tracks.findIndex((track) => track.id === activeTrackId))
  if (automatic && mode === 'repeat-one') return tracks[activeIndex].id
  if (mode === 'shuffle' && tracks.length > 1) {
    const candidate = Math.floor(random() * (tracks.length - 1))
    const nextIndex = candidate >= activeIndex ? candidate + 1 : candidate
    return tracks[nextIndex].id
  }
  return tracks[(activeIndex + 1) % tracks.length].id
}

export const getPreviousTrackId = (tracks: Track[], activeTrackId: number): number | null => {
  if (!tracks.length) return null
  const activeIndex = Math.max(0, tracks.findIndex((track) => track.id === activeTrackId))
  return tracks[(activeIndex - 1 + tracks.length) % tracks.length].id
}
