import type { MusicSourceQuality, MusicSourceSettings } from './appSettings'
import type { LxMusicInfo, LxQuality, OnlineSource, Track } from './types'
import { platformBridge } from './platformBridge'
import { emptyMusicSourceHealth, readMusicSourceHealth } from './musicSourceHealth'
import type { MusicSourceHealthSummary } from './musicSourceHealth'

export type RuntimeCapabilities = {
  sources?: Partial<Record<string, { qualitys?: string[]; availability?: MusicSourceProviderAvailability }>>
}

export type MusicSourceProviderAvailability = 'enabled' | 'limited' | 'disabled'

export type MusicSourceProviderStatus = {
  source: OnlineSource
  name: string
  qualities: LxQuality[]
  registered: boolean
  availability: MusicSourceProviderAvailability
  catalogStatus: 'unchecked' | 'available' | 'empty' | 'error'
  catalogMessage: string
  catalogCheckedAt: number | null
  playbackStatus: 'unchecked' | 'available' | 'error'
  playbackMessage: string
  playbackCheckedAt: number | null
  health: MusicSourceHealthSummary
}

export type MusicSourceStatus = {
  phase: 'checking' | 'ready' | 'degraded' | 'error'
  providers: MusicSourceProviderStatus[]
  message: string
  checkedAt: number | null
  activity: { kind: 'success' | 'error'; message: string; at: number } | null
}

type ResolveResult = { url: string; quality: LxQuality; playbackToken?: string }
type DirectResolver = { provider: 'qq' | 'kuwo' | 'kugou'; url: string }

const isLxQuality = (value: string): value is LxQuality => value === '128k' || value === '320k' || value === 'flac' || value === 'flac24bit'

const playableUrl = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

const qualityFallbacks: Record<MusicSourceQuality, LxQuality[]> = {
  high: ['320k', '128k'],
  lossless: ['flac', '320k', '128k'],
  hires: ['flac24bit', 'flac', '320k', '128k'],
}

const resolvedCache = new Map<string, { result: ResolveResult; expiresAt: number }>()
const resolutionRequests = new Map<string, Promise<ResolveResult>>()

let kugouJsonpSequence = 0

const resolveKugouJsonp = (endpoint: URL) => new Promise<string>((resolve, reject) => {
  const callback = `__echoraKugou${Date.now()}${kugouJsonpSequence += 1}`
  const script = document.createElement('script')
  const timeoutId = window.setTimeout(() => finish(new Error('酷狗播放地址解析超时')), 12_000)
  const finish = (value: string | Error) => {
    window.clearTimeout(timeoutId)
    script.remove()
    delete (window as unknown as Record<string, unknown>)[callback]
    if (value instanceof Error) reject(value)
    else resolve(value)
  }
  ;(window as unknown as Record<string, unknown>)[callback] = (data: unknown) => {
    const record = data && typeof data === 'object' ? data as Record<string, any> : {}
    const url = playableUrl(String(record.url || record.data?.url || '').replace(/^http:\/\//i, 'https://'))
    finish(url || new Error(String(record.error || record.message || '未获取到有效播放链接')))
  }
  endpoint.searchParams.set('format', 'jsonp')
  endpoint.searchParams.set('callback', callback)
  script.async = true
  script.referrerPolicy = 'no-referrer'
  script.onerror = () => finish(new Error('酷狗播放地址解析失败'))
  script.src = endpoint.toString()
  document.head.appendChild(script)
})

const expectedDurationSeconds = (musicInfo: LxMusicInfo) => {
  const match = String(musicInfo.interval || '').match(/^(\d+):(\d{2})$/)
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0
}

const validateDirectKuwoMedia = async (url: string, musicInfo: LxMusicInfo) => {
  if (expectedDurationSeconds(musicInfo) < 60) return
  try {
    const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8_000) })
    const contentLength = Number(response.headers.get('Content-Length') || 0)
    if (response.ok && contentLength > 0 && contentLength < 512 * 1024) throw new Error('这首歌在酷我仅返回了短提示音')
  } catch (error) {
    if (error instanceof Error && error.message.includes('短提示音')) throw error
  }
}

const resolveDirectProvider = async (resolver: DirectResolver, musicInfo: LxMusicInfo) => {
  const endpoint = new URL(resolver.url)
  const isApprovedQq = resolver.provider === 'qq' && endpoint.hostname === 'api-v2.yuafeng.cn'
  const isApprovedKuwo = resolver.provider === 'kuwo' && endpoint.hostname === 'nmobi.kuwo.cn' && endpoint.pathname === '/mobi.s'
  const isApprovedKugou = resolver.provider === 'kugou' && endpoint.hostname === 'm.kugou.com' && endpoint.pathname === '/app/i/getSongInfo.php'
  if (endpoint.protocol !== 'https:' || (!isApprovedQq && !isApprovedKuwo && !isApprovedKugou)) {
    throw new Error('解析服务地址无效')
  }
  if (isApprovedKugou) return resolveKugouJsonp(endpoint)
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(20_000) })
  const data = await response.json().catch(() => ({})) as any
  if (!response.ok) throw new Error(String(data?.msg || data?.message || '解析服务暂时不可用'))
  const directUrl = playableUrl(String(isApprovedKuwo ? data?.data?.url || data?.url || '' : data?.data?.music || data?.data?.url || data?.url || '').replace(/^http:\/\//i, 'https://'))
  if (!directUrl) throw new Error(String(data?.msg || '未获取到有效播放链接'))
  if (isApprovedKuwo) await validateDirectKuwoMedia(directUrl, musicInfo)
  return directUrl
}

const resolveThroughCloud = async (track: Track, quality: LxQuality, forceRefresh = false) => {
  if (!track.remote) throw new Error('这首歌曲没有远端音源信息')
  const cacheKey = `${track.remote.source}:${track.remote.musicInfo.songmid}:${quality}`
  if (forceRefresh) resolvedCache.delete(cacheKey)
  const cached = resolvedCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.result
  if (cached) resolvedCache.delete(cacheKey)
  const existing = resolutionRequests.get(cacheKey)
  if (existing && !forceRefresh) return existing
  const request = platformBridge.requestJson<{ message?: string; url?: string; resolvedQuality?: string; expiresAt?: number; directResolver?: DirectResolver; playbackToken?: string }>('music.resolve', {
    method: 'POST',
    body: { source: track.remote.source, quality, musicInfo: track.remote.musicInfo },
  }).then(async (response) => {
    if (!response.ok) throw new Error(response.data.message || '播放地址解析失败')
    const url = response.data.directResolver
      ? await resolveDirectProvider(response.data.directResolver, track.remote!.musicInfo)
      : playableUrl(response.data.url)
    if (!url) throw new Error('未获取到有效播放链接')
    const now = Date.now()
    const serverExpiry = Number(response.data.expiresAt || 0) || now + 3 * 60_000
    const responseQuality = response.data.resolvedQuality
    const actualQuality: LxQuality = responseQuality && isLxQuality(responseQuality) ? responseQuality : quality
    const result: ResolveResult = {
      url,
      quality: actualQuality,
      ...(response.data.playbackToken ? { playbackToken: response.data.playbackToken } : {}),
    }
    resolvedCache.set(cacheKey, { result, expiresAt: Math.max(now, Math.min(serverExpiry - 15_000, now + 3 * 60_000)) })
    return result
  }).finally(() => resolutionRequests.delete(cacheKey))
  resolutionRequests.set(cacheKey, request)
  return request
}

const providerNames: Record<OnlineSource, string> = {
  tx: 'QQ 音乐',
  wy: '网易云音乐',
  kw: '酷我音乐',
  mg: '咪咕音乐',
  kg: '酷狗音乐',
}

const providerOrder: OnlineSource[] = ['tx', 'wy', 'kw', 'kg', 'mg']

export const normalizeMusicSourceCapabilities = (capabilities: RuntimeCapabilities, preferredOrder: OnlineSource[] = providerOrder): MusicSourceProviderStatus[] => {
  const order = [...new Set([...preferredOrder.filter((source) => providerOrder.includes(source)), ...providerOrder])]
  return order.map((source) => {
    const provider = { source, name: providerNames[source] }
    const savedHealth = readMusicSourceHealth()[source]
    const qualities = capabilities.sources?.[provider.source]?.qualitys?.filter(isLxQuality) ?? []
    const availability = qualities.length ? capabilities.sources?.[provider.source]?.availability ?? 'enabled' : 'disabled'
    return {
      ...provider,
      qualities,
      registered: qualities.length > 0,
      availability,
      catalogStatus: 'unchecked',
      catalogMessage: '',
      catalogCheckedAt: null,
      playbackStatus: 'unchecked',
      playbackMessage: '',
      playbackCheckedAt: null,
      health: savedHealth ?? emptyMusicSourceHealth(),
    }
  })
}

export const updateMusicSourceProviderHealth = (
  providers: MusicSourceProviderStatus[],
  source: OnlineSource,
  health: MusicSourceHealthSummary,
) => providers.map((provider) => provider.source === source ? { ...provider, health } : provider)

export const updateMusicSourceProviderCatalog = (
  providers: MusicSourceProviderStatus[],
  source: OnlineSource,
  catalogStatus: MusicSourceProviderStatus['catalogStatus'],
  catalogMessage: string,
  catalogCheckedAt = Date.now(),
) => providers.map((provider) => provider.source === source
  ? { ...provider, catalogStatus, catalogMessage, catalogCheckedAt }
  : provider)

export const updateMusicSourceProviderPlayback = (
  providers: MusicSourceProviderStatus[],
  source: OnlineSource,
  playbackStatus: MusicSourceProviderStatus['playbackStatus'],
  playbackMessage: string,
  playbackCheckedAt = Date.now(),
) => providers.map((provider) => provider.source === source
  ? { ...provider, playbackStatus, playbackMessage, playbackCheckedAt }
  : provider)

export const inspectMusicSource = async (_settings: MusicSourceSettings, restartRuntime = false) => {
  if (restartRuntime) resolvedCache.clear()
  const response = await platformBridge.requestJson<{ message?: string; providers?: Array<{ source: OnlineSource; enabled: boolean; availability?: MusicSourceProviderAvailability }>; qualities?: LxQuality[] }>('music.status')
  if (!response.ok) throw new Error(response.data.message || '音乐服务当前不可用')
  const remoteProviders = response.data.providers ?? []
  const preferredOrder = remoteProviders.map((provider) => provider.source)
  const capabilities: RuntimeCapabilities = {
    sources: Object.fromEntries(remoteProviders.filter((provider) => provider.enabled).map((provider) => [provider.source, {
      qualitys: response.data.qualities ?? ['128k', '320k', 'flac', 'flac24bit'],
      availability: provider.availability === 'limited' ? 'limited' : 'enabled',
    }])),
  }
  const providers = normalizeMusicSourceCapabilities(capabilities, preferredOrder)
  if (!providers.some((provider) => provider.registered)) throw new Error('音乐服务没有返回可用平台')
  return providers
}

export const resolveTrackAudio = async (track: Track, settings: MusicSourceSettings, requestedQuality?: LxQuality, forceRefresh = false): Promise<ResolveResult> => {
  if (!track.remote) throw new Error('这首内容没有真实的音源标识')
  const available = new Set(track.remote.availableQualities)
  const preferred = qualityFallbacks[settings.preferredQuality]
  const candidates = requestedQuality ? [requestedQuality] : settings.autoFallback ? preferred : preferred.slice(0, 1)
  const supportedCandidates = candidates.filter((quality) => available.has(quality))
  const qualities = supportedCandidates.length ? supportedCandidates : candidates
  let lastError: Error | null = null
  for (const quality of qualities) {
    try {
      return await resolveThroughCloud(track, quality, forceRefresh)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('播放地址解析失败')
    }
  }
  throw lastError ?? new Error('当前音质没有可用的播放地址')
}
