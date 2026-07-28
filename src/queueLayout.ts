import type { Track } from './types'
import type { AgentTrackPosition } from './agentSessions'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export const layoutQueueTracks = (items: Track[], intensity = 64, novelty = 38): Track[] => {
  if (!items.length) return []
  const laneCount = items.length <= 7 ? 1 : items.length <= 14 ? 2 : 3
  const columnCount = Math.ceil(items.length / laneCount)
  const laneOffsets = laneCount === 1 ? [0] : laneCount === 2 ? [-17, 17] : [-24, 0, 24]

  return items.map((track, index) => {
    const column = Math.floor(index / laneCount)
    const lane = index % laneCount
    const columnProgress = column / Math.max(1, columnCount - 1)
    const x = 9 + columnProgress * 82
    const energyLift = (intensity - 50) * 0.16
    const noveltyOffset = ((track.id * 13 + novelty) % 9) - 4
    const energyPath = 64 - columnProgress * 38 - energyLift + noveltyOffset
    const laneCenter = laneCount === 3 ? clamp(energyPath, 40, 52) : laneCount === 2 ? clamp(energyPath, 33, 59) : energyPath
    const y = clamp(laneCenter + laneOffsets[lane], 16, 76)
    return { ...track, x, y }
  })
}

export const captureTrackLayout = (items: Track[]): AgentTrackPosition[] => items.map(({ id, x, y }) => ({ id, x, y }))

export const applyTrackLayout = (items: Track[], savedLayout: AgentTrackPosition[] | undefined, intensity = 64, novelty = 38): Track[] => {
  const fallback = layoutQueueTracks(items, intensity, novelty)
  if (!savedLayout?.length) return fallback
  const positions = new Map(savedLayout.map((position) => [position.id, position]))
  return fallback.map((track) => {
    const saved = positions.get(track.id)
    return saved ? { ...track, x: clamp(saved.x, 9, 91), y: clamp(saved.y, 15, 76) } : track
  })
}
