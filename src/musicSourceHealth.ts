import type { LxQuality, OnlineSource } from './types'

export type MusicSourceHealthEvent = {
  source: OnlineSource
  outcome: 'success' | 'error'
  latencyMs: number
  requestedQuality?: LxQuality
  resolvedQuality?: LxQuality
  reason?: string
  at?: number
}

export type MusicSourceHealthSummary = {
  sampleCount: number
  successCount: number
  errorCount: number
  successRate: number | null
  averageLatencyMs: number | null
  downgradeCount: number
  latestDowngrade: string
  latestFailure: string
  updatedAt: number | null
}

type StoredHealth = Partial<Record<OnlineSource, MusicSourceHealthEvent[]>>

const storageKey = 'echora.music-source-health.v1'
const maxEventsPerSource = 40
const maxEventAgeMs = 7 * 24 * 60 * 60 * 1000

export const emptyMusicSourceHealth = (): MusicSourceHealthSummary => ({
  sampleCount: 0,
  successCount: 0,
  errorCount: 0,
  successRate: null,
  averageLatencyMs: null,
  downgradeCount: 0,
  latestDowngrade: '',
  latestFailure: '',
  updatedAt: null,
})

const resolveStorage = (storage?: Pick<Storage, 'getItem' | 'setItem'>) => storage
  ?? (typeof localStorage === 'undefined' ? undefined : localStorage)

const readStoredHealth = (storage?: Pick<Storage, 'getItem'>, now = Date.now()): StoredHealth => {
  const target = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage)
  if (!target) return {}
  try {
    const value = JSON.parse(target.getItem(storageKey) ?? '{}') as StoredHealth
    return Object.fromEntries(Object.entries(value).map(([source, events]) => [
      source,
      Array.isArray(events) ? events.filter((event) => event && now - Number(event.at ?? 0) <= maxEventAgeMs).slice(-maxEventsPerSource) : [],
    ])) as StoredHealth
  } catch {
    return {}
  }
}

export const summarizeMusicSourceHealth = (events: MusicSourceHealthEvent[]): MusicSourceHealthSummary => {
  if (!events.length) return emptyMusicSourceHealth()
  const successCount = events.filter((event) => event.outcome === 'success').length
  const errorCount = events.length - successCount
  const measured = events.filter((event) => Number.isFinite(event.latencyMs) && event.latencyMs >= 0)
  const latestFailure = [...events].reverse().find((event) => event.outcome === 'error')?.reason ?? ''
  const latestDowngradeEvent = [...events].reverse().find((event) => event.outcome === 'success' && event.requestedQuality && event.resolvedQuality && event.requestedQuality !== event.resolvedQuality)
  return {
    sampleCount: events.length,
    successCount,
    errorCount,
    successRate: Math.round(successCount / events.length * 100),
    averageLatencyMs: measured.length ? Math.round(measured.reduce((sum, event) => sum + event.latencyMs, 0) / measured.length) : null,
    downgradeCount: events.filter((event) => event.outcome === 'success' && event.requestedQuality && event.resolvedQuality && event.requestedQuality !== event.resolvedQuality).length,
    latestDowngrade: latestDowngradeEvent ? `${latestDowngradeEvent.requestedQuality} → ${latestDowngradeEvent.resolvedQuality}` : '',
    latestFailure,
    updatedAt: Math.max(...events.map((event) => Number(event.at ?? 0))),
  }
}

export const readMusicSourceHealth = (storage?: Pick<Storage, 'getItem'>, now = Date.now()) => {
  const stored = readStoredHealth(storage, now)
  return Object.fromEntries(Object.entries(stored).map(([source, events]) => [source, summarizeMusicSourceHealth(events ?? [])])) as Partial<Record<OnlineSource, MusicSourceHealthSummary>>
}

export const recordMusicSourceHealth = (event: MusicSourceHealthEvent, storage?: Pick<Storage, 'getItem' | 'setItem'>) => {
  const target = resolveStorage(storage)
  const at = event.at ?? Date.now()
  const stored = readStoredHealth(target, at)
  const events = [...(stored[event.source] ?? []), { ...event, latencyMs: Math.max(0, Math.round(event.latencyMs)), at }].slice(-maxEventsPerSource)
  stored[event.source] = events
  if (target) {
    try { target.setItem(storageKey, JSON.stringify(stored)) } catch { /* Health telemetry must never block playback. */ }
  }
  return summarizeMusicSourceHealth(events)
}
