import { describe, expect, it } from 'vitest'
import { reconcileQueuePlaybackState } from './playbackContext'

describe('playback queue application', () => {
  it('continues the current track without inserting it into a new queue', () => {
    expect(reconcileQueuePlaybackState([9, 7], 3, true, 42, 'continue-current')).toEqual({
      activeTrackId: 3,
      isPlaying: true,
      playProgress: 42,
      detached: true,
    })
  })

  it('keeps an included current track attached to the queue', () => {
    expect(reconcileQueuePlaybackState([9, 3, 7], 3, true, 42, 'continue-current')).toEqual({
      activeTrackId: 3,
      isPlaying: true,
      playProgress: 42,
      detached: false,
    })
  })

  it('supports explicit start-first and queue-only application modes', () => {
    expect(reconcileQueuePlaybackState([9, 7], 3, true, 42, 'play-first')).toEqual({ activeTrackId: 9, isPlaying: true, playProgress: 0, detached: false })
    expect(reconcileQueuePlaybackState([9, 7], 3, true, 42, 'pause-first')).toEqual({ activeTrackId: 9, isPlaying: false, playProgress: 0, detached: false })
  })
})
