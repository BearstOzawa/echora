import { CloudApiError, cloudRequest } from './cloudApi'

export type PlatformOperation =
  | 'music.search'
  | 'music.status'
  | 'music.chartCatalog'
  | 'music.chartDetail'
  | 'music.lyrics'
  | 'music.resolve'
  | 'music.playbackHealth'
  | 'music.sourceRequest'
  | 'ai.managed'
  | 'ai.request'

export type PlatformRequest = {
  method?: 'GET' | 'POST'
  query?: URLSearchParams
  params?: Record<string, string>
  body?: unknown
  signal?: AbortSignal
}

export type PlatformResponse<T> = {
  ok: boolean
  status: number
  data: T
}

export type MediaUrlOptions = {
  cacheKey?: string
  cacheLimitMb?: number
  purpose?: 'artwork' | 'playback'
}

export interface PlatformBridge {
  readonly transport: 'web-bff' | 'tauri-native'
  requestJson<T>(operation: PlatformOperation, request?: PlatformRequest): Promise<PlatformResponse<T>>
  mediaUrl(remoteUrl: string, options?: MediaUrlOptions): string
}

export class TauriPlatformBridge implements PlatformBridge {
  readonly transport = 'tauri-native' as const

  async requestJson<T>(operation: PlatformOperation, request: PlatformRequest = {}): Promise<PlatformResponse<T>> {
    if (cloudOperations.has(operation)) return requestCloudPlatform<T>(operation, request)
    const [{ fetch }, { requestNativePlatform }] = await Promise.all([
      import('@tauri-apps/plugin-http'),
      import('./nativePlatformGateway'),
    ])
    return requestNativePlatform(fetch as typeof globalThis.fetch, operation, request)
  }

  mediaUrl(remoteUrl: string, options: MediaUrlOptions = {}) {
    if (!/^https?:\/\//i.test(remoteUrl)) return remoteUrl
    const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
    // Android WebView does not consistently dispatch custom-protocol image
    // subresources. Artwork needs no CORS access, so load it directly.
    if (isAndroid && options.purpose === 'artwork') return remoteUrl
    const query = new URLSearchParams({ url: remoteUrl })
    if (options.cacheKey) query.set('cacheKey', options.cacheKey)
    if (options.cacheLimitMb) query.set('cacheLimitMb', String(options.cacheLimitMb))
    // Wry exposes custom protocols through an HTTP localhost origin on Android
    // and Windows. Other native WebViews use the registered scheme directly.
    const usesHttpCustomProtocol = typeof navigator !== 'undefined'
      && /Android|Windows/i.test(navigator.userAgent)
    const origin = usesHttpCustomProtocol
      ? 'http://echora-media.localhost'
      : 'echora-media://localhost'
    return `${origin}/media?${query}`
  }
}

const webRoutes: Record<Exclude<PlatformOperation, 'music.chartDetail'>, string> = {
  'music.search': '/__echora/music/search',
  'music.status': '/__echora/music/status',
  'music.chartCatalog': '/__echora/music/charts/catalog',
  'music.lyrics': '/__echora/music/lyrics',
  'music.resolve': '/__echora/music/resolve',
  'music.playbackHealth': '/__echora/music/playback-events',
  'music.sourceRequest': '/__echora/music/request',
  'ai.managed': '/__echora/ai/managed',
  'ai.request': '/__echora/ai/request',
}

const cloudOperations = new Set<PlatformOperation>(['music.search', 'music.status', 'music.chartCatalog', 'music.chartDetail', 'music.lyrics', 'music.resolve', 'music.playbackHealth', 'ai.managed'])

const cloudRouteFor = (operation: PlatformOperation, params?: Record<string, string>) => {
  if (operation === 'music.search') return '/v1/music/search'
  if (operation === 'music.status') return '/v1/music/status'
  if (operation === 'music.chartCatalog') return '/v1/music/charts'
  if (operation === 'music.lyrics') return '/v1/music/lyrics'
  if (operation === 'music.resolve') return '/v1/music/resolve'
  if (operation === 'music.playbackHealth') return '/v1/music/playback-events'
  if (operation === 'ai.managed') return '/v1/ai/request'
  if (operation === 'ai.request') return '/v1/ai/custom/request'
  if (operation === 'music.chartDetail') {
    if (!params?.source || !params.boardId) throw new Error('榜单请求缺少平台或榜单标识')
    return `/v1/music/charts/${encodeURIComponent(params.source)}/${encodeURIComponent(params.boardId)}`
  }
  throw new Error('这项能力不使用 Echora Cloud')
}

const requestCloudPlatform = async <T>(operation: PlatformOperation, request: PlatformRequest): Promise<PlatformResponse<T>> => {
  try {
    const query = request.query?.toString()
    const path = `${cloudRouteFor(operation, request.params)}${query ? `?${query}` : ''}`
    const data = await cloudRequest<T>(path, {
      method: request.method,
      body: request.method === 'POST' ? JSON.stringify(request.body ?? {}) : undefined,
      signal: request.signal,
    }, { authenticated: operation === 'ai.managed' || operation === 'ai.request' })
    return { ok: true, status: 200, data }
  } catch (error) {
    const status = error instanceof CloudApiError ? error.status : 0
    const payload = error instanceof CloudApiError && error.data && typeof error.data === 'object'
      ? { ...error.data as Record<string, unknown>, message: error.message }
      : { message: error instanceof Error ? error.message : 'Echora Cloud 请求失败' }
    return { ok: false, status, data: payload as T }
  }
}

const routeFor = (operation: PlatformOperation, params?: Record<string, string>) => {
  if (operation !== 'music.chartDetail') return webRoutes[operation]
  const source = params?.source
  const boardId = params?.boardId
  if (!source || !boardId) throw new Error('榜单请求缺少平台或榜单标识')
  return `/__echora/music/charts/${encodeURIComponent(source)}/${encodeURIComponent(boardId)}`
}

export class WebPlatformBridge implements PlatformBridge {
  readonly transport = 'web-bff' as const

  async requestJson<T>(operation: PlatformOperation, request: PlatformRequest = {}): Promise<PlatformResponse<T>> {
    if (cloudOperations.has(operation)) return requestCloudPlatform<T>(operation, request)
    if (operation === 'ai.request') return requestCloudPlatform<T>(operation, request)
    const query = request.query?.toString()
    const url = `${routeFor(operation, request.params)}${query ? `?${query}` : ''}`
    const init: RequestInit = { signal: request.signal }
    if (request.method === 'POST') {
      init.method = 'POST'
      init.headers = { 'Content-Type': 'application/json' }
      init.body = JSON.stringify(request.body ?? {})
    }
    const response = await fetch(url, init)
    const data = await response.json().catch(() => ({})) as T
    return { ok: response.ok, status: response.status, data }
  }

  mediaUrl(remoteUrl: string, _options?: MediaUrlOptions) {
    return remoteUrl
  }
}

// Product modules share the Cloud control plane. Native media still goes through
// an on-device bridge for range requests and cache management.
export const platformBridge: PlatformBridge = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  ? new TauriPlatformBridge()
  : new WebPlatformBridge()
