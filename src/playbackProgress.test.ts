import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createPlaybackProgressStore, usePlaybackProgressSelector } from './playbackProgress'

describe('playback progress store', () => {
  it('normalizes progress and notifies subscribers only when the value changes', () => {
    const store = createPlaybackProgressStore(20)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.set(20)
    store.set(130)
    store.set(Number.NaN)
    unsubscribe()
    store.set(50)

    expect(listener).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot()).toBe(50)
  })

  it('lets components subscribe to a derived value instead of every progress tick', () => {
    const store = createPlaybackProgressStore(0)
    const selector = vi.fn((progress: number) => Math.floor(progress / 10))
    const view = renderHook(() => usePlaybackProgressSelector(store, selector))

    act(() => store.set(4))
    expect(view.result.current).toBe(0)

    act(() => store.set(12))
    expect(view.result.current).toBe(1)
  })
})
