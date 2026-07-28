import type { OnlineSource, Track } from './types'

export type SourceDiscoveryKind = 'trend' | 'fresh' | 'global' | 'mood' | 'live' | 'classic' | 'style' | 'soundtrack' | 'quality'

export type SourceDiscoveryShelf = {
  id: string
  name: string
  eyebrow: string
  description: string
  query: string
  kind: SourceDiscoveryKind
  tracks: Track[]
}

export type SourceProviderLane = {
  source: OnlineSource
  name: string
  tracks: Track[]
  available?: boolean
}

export type SourceChartCategory = 'general' | 'style' | 'scene' | 'quality' | 'platform'
export type SourceDataProvenance = 'live' | 'cached' | 'fallback'

export type SourceChart = {
  id: string
  boardId: string
  source: OnlineSource
  name: string
  eyebrow: string
  description: string
  category: SourceChartCategory
  cover: string
  updateFrequency?: string
  preview: Array<{ title: string; artist: string }>
  tracks: Track[]
  updatedAt?: string
  provenance?: SourceDataProvenance
}

export type SourceDiscoveryCatalog = {
  shelves: SourceDiscoveryShelf[]
  providers: SourceProviderLane[]
  charts: SourceChart[]
  hotTracks: Track[]
  freshTracks: Track[]
  tracks: Track[]
  loadedAt: number
}

const discoveryCacheKey = 'echora.sourceDiscovery.v6'
export const sourceDiscoveryFreshnessMs = 30 * 60 * 1000
export const sourceDiscoveryMaxStaleMs = 24 * 60 * 60 * 1000

type DiscoveryCacheEntry = { signature: string; catalog: SourceDiscoveryCatalog }

const isCachedCatalog = (value: unknown): value is SourceDiscoveryCatalog => {
  if (!value || typeof value !== 'object') return false
  const catalog = value as Partial<SourceDiscoveryCatalog>
  return Array.isArray(catalog.shelves)
    && Array.isArray(catalog.providers)
    && Array.isArray(catalog.charts)
    && Array.isArray(catalog.hotTracks)
    && Array.isArray(catalog.freshTracks)
    && Array.isArray(catalog.tracks)
    && typeof catalog.loadedAt === 'number'
    && Number.isFinite(catalog.loadedAt)
}

export const readSourceDiscoveryCache = (signature: string, storage: Pick<Storage, 'getItem'> = localStorage, now = Date.now(), maxAgeMs = sourceDiscoveryMaxStaleMs): SourceDiscoveryCatalog | null => {
  try {
    const cached = JSON.parse(storage.getItem(discoveryCacheKey) ?? 'null') as Partial<DiscoveryCacheEntry> | null
    if (!cached || cached.signature !== signature || !isCachedCatalog(cached.catalog)) return null
    if (now - cached.catalog.loadedAt > maxAgeMs) return null
    return {
      ...cached.catalog,
      charts: cached.catalog.charts.map((chart) => ({ ...chart, provenance: chart.provenance === 'fallback' ? 'fallback' as const : 'cached' as const })),
    }
  } catch {
    return null
  }
}

export const writeSourceDiscoveryCache = (signature: string, catalog: SourceDiscoveryCatalog, storage: Pick<Storage, 'setItem'> = localStorage) => {
  try {
    storage.setItem(discoveryCacheKey, JSON.stringify({ signature, catalog } satisfies DiscoveryCacheEntry))
  } catch {
    // Cache failure must never make discovery unavailable.
  }
}

type SearchCatalog = (query: string) => Promise<Track[]>
type LoadCharts = () => Promise<SourceChart[]>
type LoadChartDetail = (chart: SourceChart) => Promise<Track[]>

const shelfDefinitions: Array<Omit<SourceDiscoveryShelf, 'tracks'>> = [
  {
    id: 'source-trending',
    name: '华语流行',
    eyebrow: '多平台主题',
    description: '熟悉的旋律与当下新声，沿着华语流行继续发现。',
    query: '华语流行',
    kind: 'trend',
  },
  {
    id: 'source-fresh',
    name: '新歌速递',
    eyebrow: '近期新作',
    description: '汇集近期发行与正在被听见的新作品。',
    query: '新歌',
    kind: 'fresh',
  },
  {
    id: 'source-global',
    name: '世界流行',
    eyebrow: '全球视野',
    description: '从欧美流行到全球新声，拓展日常聆听的边界。',
    query: '欧美流行',
    kind: 'global',
  },
  {
    id: 'source-focus',
    name: '安静专注',
    eyebrow: '场景主题',
    description: '低干扰的旋律，为阅读、工作与思考留出空间。',
    query: '轻音乐',
    kind: 'mood',
  },
  {
    id: 'source-night',
    name: '深夜慢听',
    eyebrow: '场景主题',
    description: '让节奏慢下来，陪伴夜晚独处与放松时刻。',
    query: '夜曲',
    kind: 'mood',
  },
  {
    id: 'source-live',
    name: '现场能量',
    eyebrow: '版本主题',
    description: '收录现场录音与舞台版本，重回音乐发生的瞬间。',
    query: '现场',
    kind: 'live',
  },
  {
    id: 'source-classics',
    name: '经典重访',
    eyebrow: '年代主题',
    description: '重听经得起时间的作品，也发现它们的新版本。',
    query: '经典',
    kind: 'classic',
  },
  {
    id: 'source-cantonese',
    name: '粤语金曲',
    eyebrow: '地域与语言',
    description: '从黄金年代到当代新作，延续粤语歌的独特表达。',
    query: '粤语金曲',
    kind: 'style',
  },
  {
    id: 'source-indie-folk',
    name: '独立与民谣',
    eyebrow: '风格主题',
    description: '关注创作本身，听见独立音乐与民谣的真实质感。',
    query: '独立民谣',
    kind: 'style',
  },
  {
    id: 'source-soundtrack',
    name: '电影与原声',
    eyebrow: '影像音乐',
    description: '循着电影、剧集与动画原声，再次走进故事。',
    query: '电影原声',
    kind: 'soundtrack',
  },
]

const providerDefinitions: Array<{ source: OnlineSource; name: string }> = [
  { source: 'tx', name: 'QQ 音乐' },
  { source: 'wy', name: '网易云音乐' },
  { source: 'kw', name: '酷我音乐' },
  { source: 'mg', name: '咪咕音乐' },
  { source: 'kg', name: '酷狗音乐' },
]

const providerDefinitionBySource = new Map(providerDefinitions.map((provider) => [provider.source, provider]))
const discoveryTrackSource = (track: Track) => track.remote?.source ?? track.source

const orderedSources = (charts: SourceChart[], tracks: Track[]) => {
  const discovered = [
    ...charts.map((chart) => chart.source),
    ...tracks.flatMap((track) => track.remote?.source ? [track.remote.source] : []),
  ]
  return [...new Set(discovered)]
}

const uniqueTracks = (tracks: Track[]) => Array.from(new Map(tracks.map((track) => [track.id, track])).values())

const normalizedTrackIdentity = (value: string) => value.toLocaleLowerCase().replace(/[\s·・,.，。'"“”‘’()（）\[\]【】_-]/g, '')
const crossPlatformTrackKey = (track: Track) => `${normalizedTrackIdentity(track.title)}:${normalizedTrackIdentity(track.artist.split(/[、/&，,]+/)[0] ?? track.artist)}`
const uniqueCrossPlatformTracks = (tracks: Track[]) => {
  const seen = new Set<string>()
  return tracks.filter((track) => {
    const key = crossPlatformTrackKey(track)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const interleaveTracks = (groups: Track[][]) => {
  const tracks: Track[] = []
  const max = Math.max(0, ...groups.map((group) => group.length))
  for (let index = 0; index < max; index += 1) {
    groups.forEach((group) => {
      if (group[index]) tracks.push(group[index])
    })
  }
  return tracks
}

const balanceTracksBySource = (tracks: Track[], preferredSources: OnlineSource[] = []) => {
  const groups = new Map<string, Track[]>()
  tracks.forEach((track) => {
    const source = discoveryTrackSource(track)
    groups.set(source, [...(groups.get(source) ?? []), track])
  })
  const ordered = [
    ...preferredSources.flatMap((source) => groups.has(source) ? [groups.get(source)!] : []),
    ...[...groups.entries()].flatMap(([source, group]) => preferredSources.includes(source as OnlineSource) ? [] : [group]),
  ]
  return interleaveTracks(ordered)
}

const hotChartScore = (chart: SourceChart) => {
  const name = chart.name.toLocaleLowerCase()
  if (/top\s*500|热歌|热听/.test(name)) return 500
  if (/流行指数|流行趋势|趋势/.test(name)) return 420
  if (/飙升/.test(name)) return 360
  if (/新歌|新声/.test(name)) return 280
  if (/原创/.test(name)) return 220
  return 100
}

const selectPlatformHotCharts = (charts: SourceChart[]) => orderedSources(charts, []).flatMap((source) => {
  const candidates = charts.filter((chart) => chart.source === source).sort((left, right) => hotChartScore(right) - hotChartScore(left))
  return candidates[0] ? [candidates[0]] : []
})

const freshChartScore = (chart: SourceChart) => {
  const name = chart.name.toLocaleLowerCase()
  if (/新歌|新声|最新/.test(name)) return 500
  if (/飙升/.test(name)) return 280
  return 0
}

const selectPlatformFreshCharts = (charts: SourceChart[]) => orderedSources(charts, []).flatMap((source) => {
  const candidates = charts
    .filter((chart) => chart.source === source && freshChartScore(chart) > 0)
    .sort((left, right) => freshChartScore(right) - freshChartScore(left))
  return candidates[0] ? [candidates[0]] : []
})

const stableHash = (value: string) => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
const normalizedArtist = (value: string) => value.trim().toLocaleLowerCase()
const recommendationSource = discoveryTrackSource

export const buildDailyRecommendations = (shelves: SourceDiscoveryShelf[], likedTracks: Track[], date = new Date(), limit = 20, preferredSources: OnlineSource[] = []) => {
  const likedArtists = new Set(likedTracks.map((track) => normalizedArtist(track.artist)))
  const likedSources = new Set(likedTracks.map((track) => track.source))
  const likedAlbums = new Set(likedTracks.map((track) => track.album.trim().toLocaleLowerCase()).filter(Boolean))
  const candidates = uniqueTracks(shelves.filter((shelf) => shelf.kind !== 'quality').flatMap((shelf) => shelf.tracks))
    .map((track) => ({
      track,
      preference: (likedArtists.has(normalizedArtist(track.artist)) ? 5 : 0)
        + (likedAlbums.has(track.album.trim().toLocaleLowerCase()) ? 3 : 0)
        + (likedSources.has(track.source) ? 1 : 0),
      order: stableHash(`${dayKey(date)}:${track.id}:${track.title}:${track.artist}`),
    }))
    .sort((left, right) => right.preference - left.preference || left.order - right.order)

  const groups = new Map<string, Track[]>()
  candidates.forEach(({ track }) => {
    const source = recommendationSource(track)
    groups.set(source, [...(groups.get(source) ?? []), track])
  })
  const sourceOrder = [
    ...preferredSources.filter((source) => groups.has(source)),
    ...[...groups.keys()].filter((source) => !preferredSources.includes(source as OnlineSource)),
  ]
  return interleaveTracks(sourceOrder.map((source) => groups.get(source) ?? [])).slice(0, limit)
}

const rotateByDay = <T,>(items: T[], offset = 0) => {
  if (items.length < 2) return [...items]
  const day = Math.floor(Date.now() / 86_400_000)
  const start = (day + offset) % items.length
  return [...items.slice(start), ...items.slice(0, start)]
}

const isLossless = (track: Track) => track.remote?.availableQualities.some((quality) => quality === 'flac' || quality === 'flac24bit')

const settleSearches = async (definitions: typeof shelfDefinitions, searchCatalog: SearchCatalog) => {
  const settled: PromiseSettledResult<Track[]>[] = []
  for (let index = 0; index < definitions.length; index += 5) {
    const batch = definitions.slice(index, index + 5)
    settled.push(...await Promise.allSettled(batch.map((definition) => searchCatalog(definition.query))))
  }
  return settled
}

export const loadSourceDiscovery = async (searchCatalog: SearchCatalog, loadCharts?: LoadCharts, loadChartDetail?: LoadChartDetail, trackLimit = 20, providerSources: OnlineSource[] = []): Promise<SourceDiscoveryCatalog> => {
  const boundedTrackLimit = Math.min(50, Math.max(1, Math.round(trackLimit)))
  const dailyDefinitions = rotateByDay(shelfDefinitions)
  const [settled, chartResult] = await Promise.all([
    settleSearches(dailyDefinitions, searchCatalog),
    loadCharts ? loadCharts().catch(() => []) : Promise.resolve([]),
  ])
  const shelves = dailyDefinitions.flatMap((definition, index): SourceDiscoveryShelf[] => {
    const result = settled[index]
    if (result.status !== 'fulfilled') return []
    const tracks = balanceTracksBySource(rotateByDay(uniqueCrossPlatformTracks(result.value), index + 1), providerSources).slice(0, boundedTrackLimit)
    return tracks.length ? [{ ...definition, tracks }] : []
  })
  if (!shelves.length) throw new Error('音乐内容暂时无法加载')

  const charts = chartResult
  const hotCharts = selectPlatformHotCharts(charts)
  const freshCharts = selectPlatformFreshCharts(charts)
  const aggregateCharts = Array.from(new Map([...hotCharts, ...freshCharts].map((chart) => [chart.id, chart])).values())
  const aggregateResults = loadChartDetail
    ? await Promise.allSettled(aggregateCharts.map((chart) => loadChartDetail(chart)))
    : []
  const loadedChartTracks = new Map(aggregateCharts.flatMap((chart, index): Array<[string, Track[]]> => {
    const result = aggregateResults[index]
    return result?.status === 'fulfilled' && result.value.length ? [[chart.id, result.value]] : []
  }))
  const hotGroups = hotCharts.flatMap((chart): Track[][] => loadedChartTracks.has(chart.id) ? [loadedChartTracks.get(chart.id)!] : [])
  const freshGroups = freshCharts.flatMap((chart): Track[][] => loadedChartTracks.has(chart.id) ? [loadedChartTracks.get(chart.id)!] : [])
  const fallbackHotTracks = shelves.find((shelf) => shelf.kind === 'trend')?.tracks ?? []
  const fallbackFreshTracks = shelves.find((shelf) => shelf.kind === 'fresh')?.tracks ?? []
  const hotTracks = uniqueCrossPlatformTracks(hotGroups.length ? interleaveTracks(hotGroups) : fallbackHotTracks).slice(0, boundedTrackLimit)
  const freshTracks = uniqueCrossPlatformTracks(freshGroups.length ? interleaveTracks(freshGroups) : fallbackFreshTracks).slice(0, boundedTrackLimit)
  const tracks = uniqueTracks([...shelves.flatMap((shelf) => shelf.tracks), ...charts.flatMap((chart) => chart.tracks), ...hotTracks, ...freshTracks])
  const losslessTracks = tracks.filter(isLossless).slice(0, boundedTrackLimit)
  if (losslessTracks.length) shelves.push({
    id: 'source-lossless',
    name: '无损优选',
    eyebrow: '高规格音质',
    description: '优先呈现支持无损或 Hi-Res 版本的作品。',
    query: '',
    kind: 'quality',
    tracks: losslessTracks,
  })

  const providers = [...new Set([...providerSources, ...orderedSources(charts, tracks)])].flatMap((source): SourceProviderLane[] => {
    const provider = providerDefinitionBySource.get(source)
    if (!provider) return []
    const providerTracks = tracks.filter((track) => track.remote?.source === provider.source).slice(0, 8)
    return [{ ...provider, tracks: providerTracks, available: providerTracks.length > 0 }]
  })

  return { shelves, providers, charts, hotTracks, freshTracks, tracks, loadedAt: Date.now() }
}

export const sourceDiscoveryDefinitions = shelfDefinitions
