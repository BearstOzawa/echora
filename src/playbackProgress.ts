import { useSyncExternalStore } from 'react'

export type PlaybackProgressStore = {
  getSnapshot: () => number
  set: (progress: number) => void
  subscribe: (listener: () => void) => () => void
}

const normalizeProgress = (progress: number) => Number.isFinite(progress)
  ? Math.min(100, Math.max(0, progress))
  : 0

export const createPlaybackProgressStore = (initialProgress = 0): PlaybackProgressStore => {
  let progress = normalizeProgress(initialProgress)
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => progress,
    set: (nextProgress) => {
      const normalized = normalizeProgress(nextProgress)
      if (Object.is(progress, normalized)) return
      progress = normalized
      listeners.forEach((listener) => listener())
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export const usePlaybackProgress = (store: PlaybackProgressStore) => useSyncExternalStore(
  store.subscribe,
  store.getSnapshot,
  store.getSnapshot,
)

export const usePlaybackProgressSelector = <T,>(store: PlaybackProgressStore, selector: (progress: number) => T) => useSyncExternalStore(
  store.subscribe,
  () => selector(store.getSnapshot()),
  () => selector(store.getSnapshot()),
)
