import type { LxMusicInfo, LxQuality, OnlineSource, Source, Track } from './types'
import type { SourceChart, SourceDataProvenance } from './sourceDiscovery'
import { platformBridge } from './platformBridge'
import type { MediaUrlOptions } from './platformBridge'
import { brandMarkPath } from './brandAssets'

type GatewayTrack = {
  source: OnlineSource
  title: string
  artist: string
  album: string
  durationSeconds: number
  cover: string | null
  qualities: LxQuality[]
  sizeBytesByQuality: Partial<Record<LxQuality, number>>
  musicInfo: LxMusicInfo
}

type GatewayResponse = {
  tracks?: unknown
  message?: unknown
  sourceStatuses?: unknown
}

export type MusicCatalogSourceStatus = {
  source: OnlineSource
  status: 'available' | 'empty' | 'error'
  message: string
}

type GatewayChart = {
  id: string
  name: string
  description: string
  source: OnlineSource
  updatedAt: string
  tracks: unknown[]
}

type GatewayChartSummary = Omit<GatewayChart, 'tracks'> & {
  cover: string | null
  updateFrequency: string
  preview: unknown[]
  provenance?: SourceDataProvenance
}

const sourceLabels: Record<OnlineSource, Source> = {
  tx: 'QQ',
  wy: '网易云',
  kw: '酷我',
  mg: '咪咕',
  kg: '酷狗',
}

const qualityLabels: Record<LxQuality, string> = {
  '128k': 'MP3 128 kbps',
  '320k': 'MP3 320 kbps',
  flac: 'FLAC 无损',
  flac24bit: 'FLAC Hi-Res',
}

const qualityOrder: LxQuality[] = ['flac24bit', 'flac', '320k', '128k']

const stableTrackId = (source: OnlineSource, songmid: string | number) => {
  const value = `${source}:${songmid}`
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return 100_000 + (hash >>> 0) % 2_000_000_000
}

const formatDuration = (durationSeconds: number) => {
  const seconds = Math.max(0, Math.round(durationSeconds))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const isOnlineSource = (value: unknown): value is OnlineSource => value === 'tx' || value === 'wy' || value === 'kw' || value === 'mg' || value === 'kg'
const isQuality = (value: unknown): value is LxQuality => value === '128k' || value === '320k' || value === 'flac' || value === 'flac24bit'
const isCatalogSourceStatus = (value: unknown): value is MusicCatalogSourceStatus => {
  if (!value || typeof value !== 'object') return false
  const status = value as Partial<MusicCatalogSourceStatus>
  return isOnlineSource(status.source)
    && (status.status === 'available' || status.status === 'empty' || status.status === 'error')
    && typeof status.message === 'string'
}

const isGatewayTrack = (value: unknown): value is GatewayTrack => {
  if (!value || typeof value !== 'object') return false
  const track = value as Partial<GatewayTrack>
  return isOnlineSource(track.source)
    && typeof track.title === 'string'
    && typeof track.artist === 'string'
    && typeof track.album === 'string'
    && typeof track.durationSeconds === 'number'
    && Array.isArray(track.qualities)
    && track.qualities.every(isQuality)
    && Boolean(track.musicInfo && typeof track.musicInfo === 'object')
}

export const mapGatewayTrack = (item: GatewayTrack, index: number): Track => {
  const bestQuality = qualityOrder.find((quality) => item.qualities.includes(quality)) ?? '128k'
  const sizeBytes = item.sizeBytesByQuality[bestQuality] ?? 0
  return {
    id: stableTrackId(item.source, item.musicInfo.songmid),
    title: item.title,
    artist: item.artist || '未知艺人',
    album: item.album || '未知专辑',
    duration: formatDuration(item.durationSeconds),
    durationSeconds: Math.max(0, Math.round(item.durationSeconds)),
    source: sourceLabels[item.source],
    quality: qualityLabels[bestQuality],
    cover: item.cover ? createMediaBridgeUrl(item.cover, { purpose: 'artwork' }) : brandMarkPath,
    bpm: 0,
    musicalKey: '待分析',
    x: 10 + (index % 7) * 13,
    y: 50,
    offline: false,
    verified: true,
    sizeMb: Number((sizeBytes / 1024 / 1024).toFixed(1)),
    remote: {
      source: item.source,
      musicInfo: item.musicInfo,
      availableQualities: item.qualities,
    },
  }
}

export const searchMusicCatalog = async (query: string, sources?: OnlineSource[], signal?: AbortSignal, limit = 20, onSourceStatus?: (statuses: MusicCatalogSourceStatus[]) => void): Promise<Track[]> => {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return []
  if (sources && !sources.length) throw new Error('音乐服务暂时不可用')
  const params = new URLSearchParams({ query: normalizedQuery })
  if (sources) params.set('sources', Array.from(new Set(sources)).join(','))
  params.set('limit', String(Math.min(50, Math.max(1, Math.round(limit)))))
  const response = await platformBridge.requestJson<GatewayResponse>('music.search', { query: params, signal })
  const data = response.data
  const sourceStatuses = Array.isArray(data.sourceStatuses) ? data.sourceStatuses.filter(isCatalogSourceStatus) : []
  if (sourceStatuses.length) onSourceStatus?.(sourceStatuses)
  if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '音乐搜索服务暂时不可用')
  const items = Array.isArray(data.tracks) ? data.tracks.filter(isGatewayTrack) : []
  return items.map(mapGatewayTrack)
}

export const inspectMusicCatalogSources = async (sources: OnlineSource[], signal?: AbortSignal) => {
  let statuses: MusicCatalogSourceStatus[] = []
  try {
    await searchMusicCatalog('热门', sources, signal, 1, (nextStatuses) => { statuses = nextStatuses })
  } catch (error) {
    if (!statuses.length) throw error
  }
  return statuses
}

export const loadMusicCharts = async (sources?: OnlineSource[], signal?: AbortSignal): Promise<SourceChart[]> => {
  if (sources && !sources.length) throw new Error('音乐服务暂时不可用')
  const params = new URLSearchParams()
  if (sources) params.set('sources', Array.from(new Set(sources)).join(','))
  const response = await platformBridge.requestJson<{ charts?: unknown; message?: unknown }>('music.chartCatalog', { query: params, signal })
  const data = response.data
  if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '音乐平台榜单暂时不可用')
  if (!Array.isArray(data.charts)) return []
  return data.charts.flatMap((value): SourceChart[] => {
    if (!value || typeof value !== 'object') return []
    const chart = value as Partial<GatewayChartSummary>
    if (typeof chart.id !== 'string' || typeof chart.name !== 'string' || typeof chart.description !== 'string' || !isOnlineSource(chart.source)) return []
    const boardId = chart.id.startsWith(`${chart.source}:`) ? chart.id.slice(chart.source.length + 1) : chart.id
    if (!boardId) return []
    const preview = Array.isArray(chart.preview) ? chart.preview.flatMap((item): Array<{ title: string; artist: string }> => {
      if (!item || typeof item !== 'object') return []
      const entry = item as { title?: unknown; artist?: unknown }
      return typeof entry.title === 'string' && typeof entry.artist === 'string' ? [{ title: entry.title, artist: entry.artist }] : []
    }) : []
    return [{
      id: `official:${chart.id}`,
      boardId,
      source: chart.source,
      name: chart.name,
      eyebrow: sourceLabels[chart.source],
      description: chart.description,
      category: 'platform',
      cover: typeof chart.cover === 'string' && chart.cover ? createMediaBridgeUrl(chart.cover, { purpose: 'artwork' }) : brandMarkPath,
      updateFrequency: typeof chart.updateFrequency === 'string' && chart.updateFrequency ? chart.updateFrequency : undefined,
      preview,
      tracks: [],
      updatedAt: typeof chart.updatedAt === 'string' ? chart.updatedAt : undefined,
      provenance: chart.provenance === 'cached' || chart.provenance === 'fallback' ? chart.provenance : 'live',
    }]
  })
}

export const loadMusicChartDetail = async (chart: Pick<SourceChart, 'source' | 'boardId'>, limit = 50, signal?: AbortSignal): Promise<Track[]> => {
  const boundedLimit = Math.min(50, Math.max(1, Math.round(limit)))
  const response = await platformBridge.requestJson<{ chart?: unknown; message?: unknown }>('music.chartDetail', {
    params: { source: chart.source, boardId: chart.boardId },
    query: new URLSearchParams({ limit: String(boundedLimit) }),
    signal,
  })
  const data = response.data
  if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '榜单歌曲暂时不可用')
  if (!data.chart || typeof data.chart !== 'object') return []
  const detail = data.chart as Partial<GatewayChart>
  if (!Array.isArray(detail.tracks)) return []
  return detail.tracks.filter(isGatewayTrack).slice(0, boundedLimit).map(mapGatewayTrack)
}

export const createMediaBridgeUrl = (remoteUrl: string, options?: MediaUrlOptions) => platformBridge.mediaUrl(remoteUrl, options)
