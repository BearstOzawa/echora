import { beforeEach, describe, expect, it } from 'vitest'
import { initialTracks } from './testFixtures'
import { likedTrackSnapshot, likedTracksKey, readLikedTracks, writeLikedTracks } from './likedTracks'

describe('liked tracks storage', () => {
  beforeEach(() => localStorage.clear())

  it('migrates the legacy id-only format without losing likes', () => {
    localStorage.setItem(likedTracksKey, JSON.stringify([91, 92, 91]))
    expect(readLikedTracks()).toEqual({ ids: [91, 92], tracks: [] })
  })

  it('does not seed a new profile with demo likes', () => {
    expect(readLikedTracks()).toEqual({ ids: [], tracks: [] })
  })

  it('removes the old demo-like seed during migration', () => {
    localStorage.setItem(likedTracksKey, JSON.stringify([1, 3, 5, 8]))
    expect(readLikedTracks()).toEqual({ ids: [], tracks: [] })
  })

  it('removes demo likes that were already upgraded to snapshots', () => {
    localStorage.setItem(likedTracksKey, JSON.stringify({ ids: [1, 3, 5, 8], tracks: [initialTracks[0], initialTracks[2], initialTracks[4], initialTracks[7]] }))
    expect(readLikedTracks()).toEqual({ ids: [], tracks: [] })
  })

  it('persists track snapshots without transient playback urls', () => {
    const track = { ...initialTracks[0], audioUrl: 'blob:temporary' }
    writeLikedTracks({ ids: [track.id], tracks: [likedTrackSnapshot(track)] })
    expect(readLikedTracks()).toEqual({ ids: [track.id], tracks: [{ ...track, audioUrl: undefined }] })
  })

  it('drops snapshots only after the corresponding like is removed', () => {
    writeLikedTracks({ ids: [], tracks: [initialTracks[0]] })
    expect(readLikedTracks()).toEqual({ ids: [], tracks: [] })
  })
})
