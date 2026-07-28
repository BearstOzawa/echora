import { describe, expect, it } from 'vitest'
import { artworkLoadQueueSnapshot, finishArtworkLoad, scheduleArtworkLoad } from './artworkLoading'

describe('artwork loading queue', () => {
  it('caps concurrent artwork requests and releases queued work', () => {
    const started: number[] = []
    const tokens = Array.from({ length: 8 }, (_, index) => scheduleArtworkLoad(() => started.push(index)))

    expect(started).toEqual([0, 1, 2, 3, 4, 5])
    expect(artworkLoadQueueSnapshot()).toEqual({ active: 6, pending: 2, limit: 6 })

    finishArtworkLoad(tokens[0])
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6])

    tokens.slice(1).forEach(finishArtworkLoad)
    expect(artworkLoadQueueSnapshot()).toEqual({ active: 0, pending: 0, limit: 6 })
  })
})
