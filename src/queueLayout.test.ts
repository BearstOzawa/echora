import { describe, expect, it } from 'vitest'
import { searchCatalog } from './testFixtures'
import { applyTrackLayout, captureTrackLayout, layoutQueueTracks } from './queueLayout'

describe('queue field layout', () => {
  it('keeps short queues on a single readable path', () => {
    const tracks = layoutQueueTracks(searchCatalog.slice(0, 6))
    expect(new Set(tracks.map((track) => track.x)).size).toBe(6)
    expect(tracks.every((track) => track.y >= 16 && track.y <= 76)).toBe(true)
  })

  it('splits larger queues into lanes instead of overlapping every node', () => {
    const source = Array.from({ length: 18 }, (_, index) => ({ ...searchCatalog[index % searchCatalog.length], id: index + 1 }))
    const tracks = layoutQueueTracks(source)
    const columns = tracks.reduce((groups, track) => {
      groups.set(track.x, [...(groups.get(track.x) ?? []), track])
      return groups
    }, new Map<number, typeof tracks>())
    expect(columns.size).toBe(6)
    expect(Array.from(columns.values()).every((column) => column.length <= 3)).toBe(true)
    expect(Array.from(columns.values()).every((column) => Math.max(...column.map((track) => track.y)) - Math.min(...column.map((track) => track.y)) >= 40)).toBe(true)
  })

  it('restores manually saved positions over automatic layout', () => {
    const tracks = layoutQueueTracks(searchCatalog.slice(0, 3))
    const saved = captureTrackLayout(tracks).map((position, index) => index === 1 ? { ...position, x: 72, y: 20 } : position)
    const restored = applyTrackLayout(searchCatalog.slice(0, 3), saved)
    expect(restored[1]).toMatchObject({ id: tracks[1].id, x: 72, y: 20 })
  })
})
