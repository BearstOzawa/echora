import { describe, expect, it } from 'vitest'
import { initialTracks } from './testFixtures'
import { getNextTrackId, getPreviousTrackId } from './playbackOrder'

describe('playback order', () => {
  it('advances and wraps in sequence mode', () => {
    expect(getNextTrackId(initialTracks, initialTracks[0].id, 'sequence')).toBe(initialTracks[1].id)
    expect(getNextTrackId(initialTracks, initialTracks.at(-1)!.id, 'sequence')).toBe(initialTracks[0].id)
    expect(getPreviousTrackId(initialTracks, initialTracks[0].id)).toBe(initialTracks.at(-1)!.id)
  })

  it('repeats the current track only on automatic completion', () => {
    expect(getNextTrackId(initialTracks, initialTracks[2].id, 'repeat-one', true)).toBe(initialTracks[2].id)
    expect(getNextTrackId(initialTracks, initialTracks[2].id, 'repeat-one', false)).toBe(initialTracks[3].id)
  })

  it('selects a different track in shuffle mode', () => {
    expect(getNextTrackId(initialTracks, initialTracks[0].id, 'shuffle', false, () => 0)).toBe(initialTracks[1].id)
    expect(getNextTrackId(initialTracks, initialTracks[3].id, 'shuffle', false, () => 0)).toBe(initialTracks[0].id)
  })
})
