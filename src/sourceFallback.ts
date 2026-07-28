import type { LxQuality, OnlineSource, Track } from './types'

export const normalizeTrackIdentity = (value: string) => value.toLocaleLowerCase().replace(/[\s·・,.，。'"“”‘’()（）\[\]【】_-]/g, '')
export const artistTokens = (value: string) => value.split(/[、/&，,]+/).map(normalizeTrackIdentity).filter(Boolean)

export const isSameTrackVersion = (left: Track, right: Track) => {
  if (normalizeTrackIdentity(left.title) !== normalizeTrackIdentity(right.title)) return false
  const leftArtists = artistTokens(left.artist)
  const rightArtists = new Set(artistTokens(right.artist))
  if (!leftArtists.some((artist) => rightArtists.has(artist))) return false
  const sameAlbum = normalizeTrackIdentity(left.album) === normalizeTrackIdentity(right.album)
  const sameDuration = left.durationSeconds > 0 && right.durationSeconds > 0 && Math.abs(left.durationSeconds - right.durationSeconds) <= 3
  return sameAlbum || sameDuration
}

const fallbackKey = (track: Track) => `${track.remote?.source ?? 'local'}:${String(track.remote?.musicInfo.songmid ?? track.id)}`

export const findSourceFallbackCandidates = (track: Track, candidates: Track[], attemptedKeys: ReadonlySet<string> = new Set()) => {
  if (!track.remote) return []
  const seen = new Set(attemptedKeys)
  return candidates.filter((candidate) => {
    if (!candidate.remote || candidate.remote.source === track.remote!.source || !isSameTrackVersion(track, candidate)) return false
    const key = fallbackKey(candidate)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const sourceFallbackKey = fallbackKey

type ResolveSourceFallbackOptions<Result> = {
  track: Track
  catalog: Track[]
  availableSources: OnlineSource[]
  search: (query: string, sources: OnlineSource[]) => Promise<Track[]>
  resolve: (track: Track) => Promise<Result>
  preferredQuality?: LxQuality
}

type SourceFallbackStatus = {
  source: OnlineSource
  availability?: 'enabled' | 'limited' | 'disabled'
  catalogStatus: 'unchecked' | 'available' | 'empty' | 'error'
  playbackStatus: 'unchecked' | 'available' | 'error'
  health: { successRate: number | null; averageLatencyMs: number | null }
}

export const rankSourceFallbacks = (sources: OnlineSource[], statuses: SourceFallbackStatus[]) => {
  const statusBySource = new Map(statuses.map((status) => [status.source, status]))
  const originalOrder = new Map(sources.map((source, index) => [source, index]))
  const score = (source: OnlineSource) => {
    const status = statusBySource.get(source)
    if (!status) return 0
    const playback = status.playbackStatus === 'available' ? 30 : status.playbackStatus === 'error' ? -40 : 0
    const catalog = status.catalogStatus === 'available' ? 8 : status.catalogStatus === 'error' ? -15 : 0
    const success = status.health.successRate === null ? 0 : (status.health.successRate - 50) / 2
    const latency = status.health.averageLatencyMs === null ? 0 : Math.min(12, status.health.averageLatencyMs / 250)
    const previewRisk = source === 'kw' && status.playbackStatus !== 'available' ? -12 : 0
    const capability = status.availability === 'limited' ? -18 : status.availability === 'disabled' ? -100 : 0
    return playback + catalog + success - latency + previewRisk + capability
  }
  return [...sources].sort((left, right) => score(right) - score(left) || (originalOrder.get(left) ?? 0) - (originalOrder.get(right) ?? 0))
}

export const resolveSourceFallback = async <Result>({ track, catalog, availableSources, search, resolve, preferredQuality }: ResolveSourceFallbackOptions<Result>) => {
  if (!track.remote) return { match: null, searched: [] as Track[] }
  const enabledSources = new Set(availableSources)
  const attempted = new Set<string>()
  const attempt = async (candidates: Track[]) => {
    const sourceOrder = new Map(availableSources.map((source, index) => [source, index]))
    const ordered = findSourceFallbackCandidates(track, candidates, attempted).sort((left, right) => {
      const leftQuality = preferredQuality && left.remote?.availableQualities.includes(preferredQuality) ? 1 : 0
      const rightQuality = preferredQuality && right.remote?.availableQualities.includes(preferredQuality) ? 1 : 0
      return rightQuality - leftQuality
        || (sourceOrder.get(left.remote!.source) ?? availableSources.length) - (sourceOrder.get(right.remote!.source) ?? availableSources.length)
    })
    for (const candidate of ordered) {
      attempted.add(sourceFallbackKey(candidate))
      try {
        return { track: candidate, value: await resolve(candidate) }
      } catch {
        // A platform can be available while a specific recording is not.
      }
    }
    return null
  }

  const catalogMatch = await attempt(catalog.filter((candidate) => candidate.remote && enabledSources.has(candidate.remote.source)))
  if (catalogMatch) return { match: catalogMatch, searched: [] as Track[] }

  const fallbackSources = availableSources.filter((source) => source !== track.remote!.source)
  const searched = fallbackSources.length ? await search(`${track.title} ${track.artist}`, fallbackSources).catch(() => []) : []
  return { match: await attempt(searched), searched }
}
