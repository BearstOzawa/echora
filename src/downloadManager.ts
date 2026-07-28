import type { Track } from './types'
import type { DownloadFileNameFormat } from './appSettings'

export type TrackDownloadPhase = 'queued' | 'downloading' | 'retrying' | 'failed' | 'complete'

export type TrackDownloadState = {
  trackId: number
  requestKey: string
  phase: TrackDownloadPhase
  receivedBytes: number
  totalBytes?: number
  progress?: number
  track?: Track
  failureReason?: string
}

type DownloadBlobOptions = {
  signal?: AbortSignal
  stallTimeoutMs?: number
  onProgress?: (receivedBytes: number, totalBytes?: number) => void
}

type DownloadWithRetryOptions = DownloadBlobOptions & {
  responseForAttempt: (attempt: 0 | 1) => Promise<Response>
  onRetry?: () => void
}

type DownloadSlotWaiter = {
  signal?: AbortSignal
  resolve: (release: () => void) => void
  reject: (error: DOMException) => void
  onAbort?: () => void
}

const invalidFileNameCharacters = /[\\/:*?"<>|\u0000-\u001f]/g
const downloadStateStorageKey = 'echora.download-tasks.v1'

export const createDownloadScheduler = (concurrency = 2) => {
  const limit = Math.max(1, Math.round(concurrency))
  const queue: DownloadSlotWaiter[] = []
  let active = 0

  const drain = () => {
    while (active < limit && queue.length) {
      const waiter = queue.shift()!
      if (waiter.signal?.aborted) {
        waiter.reject(new DOMException('Download cancelled', 'AbortError'))
        continue
      }
      if (waiter.onAbort) waiter.signal?.removeEventListener('abort', waiter.onAbort)
      active += 1
      let released = false
      waiter.resolve(() => {
        if (released) return
        released = true
        active -= 1
        drain()
      })
    }
  }

  return {
    acquire(signal?: AbortSignal) {
      if (signal?.aborted) return Promise.reject(new DOMException('Download cancelled', 'AbortError'))
      return new Promise<() => void>((resolve, reject) => {
        const waiter: DownloadSlotWaiter = { signal, resolve, reject }
        waiter.onAbort = () => {
          const index = queue.indexOf(waiter)
          if (index >= 0) queue.splice(index, 1)
          reject(new DOMException('Download cancelled', 'AbortError'))
        }
        signal?.addEventListener('abort', waiter.onAbort, { once: true })
        queue.push(waiter)
        drain()
      })
    },
    snapshot: () => ({ active, pending: queue.length }),
  }
}

export const readDownloadStates = (storage: Pick<Storage, 'getItem'> = localStorage): Record<number, TrackDownloadState> => {
  try {
    const parsed = JSON.parse(storage.getItem(downloadStateStorageKey) ?? '{}') as Record<string, Partial<TrackDownloadState>>
    return Object.fromEntries(Object.entries(parsed).flatMap(([key, state]) => {
      const trackId = Number(state.trackId ?? key)
      if (!Number.isFinite(trackId) || state.phase === 'complete' || !state.requestKey || !state.track) return []
      const interrupted = state.phase === 'queued' || state.phase === 'downloading' || state.phase === 'retrying'
      return [[trackId, {
        ...state,
        trackId,
        phase: 'failed',
        receivedBytes: Number(state.receivedBytes ?? 0),
        failureReason: interrupted ? '上次下载未完成' : state.failureReason,
      } as TrackDownloadState]]
    }))
  } catch {
    return {}
  }
}

export const writeDownloadStates = (states: Record<number, TrackDownloadState>, storage: Pick<Storage, 'setItem'> = localStorage) => {
  const pending = Object.fromEntries(Object.entries(states)
    .filter(([, state]) => state.phase !== 'complete')
    .map(([trackId, state]) => [trackId, {
      ...state,
      track: state.track ? {
        ...state.track,
        remote: state.track.remote ? { ...state.track.remote, playbackToken: undefined } : undefined,
      } : undefined,
    }]))
  try { storage.setItem(downloadStateStorageKey, JSON.stringify(pending)) } catch { /* Download persistence must not block playback. */ }
}

export const requiredDownloadSpaceBytes = (expectedBytes: number) => {
  const normalized = Math.max(0, Math.round(expectedBytes))
  return normalized + Math.max(128 * 1024 * 1024, Math.round(normalized * 0.1))
}

export const assertDownloadSpace = (availableBytes: number, expectedBytes: number) => {
  if (availableBytes < requiredDownloadSpaceBytes(expectedBytes)) throw new Error('设备存储空间不足，请释放空间后重试')
}

export const downloadStateLabel = (state: TrackDownloadState | undefined) => {
  if (!state) return ''
  if (state.phase === 'queued') return '等待下载'
  if (state.phase === 'retrying') return '正在重试'
  if (state.phase === 'failed') return state.failureReason === '上次下载未完成' ? '下载已中断' : '下载失败'
  if (state.phase === 'complete') return '已下载'
  return state.progress === undefined ? '下载中' : `下载中 ${state.progress}%`
}

export const downloadResponseBlob = async (response: Response, options: DownloadBlobOptions = {}) => {
  if (!response.ok) throw new Error(`下载服务返回 ${response.status}`)
  const totalHeader = Number(response.headers.get('content-length') ?? 0)
  const totalBytes = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : undefined
  if (!response.body) {
    const blob = await response.blob()
    options.onProgress?.(blob.size, totalBytes ?? blob.size)
    return blob
  }
  const reader = response.body.getReader()
  const chunks: ArrayBuffer[] = []
  let receivedBytes = 0
  let stallTimer = 0
  let stalled = false
  const stallTimeoutMs = Math.max(5_000, options.stallTimeoutMs ?? 20_000)
  const cancelForStall = () => {
    stalled = true
    void reader.cancel('download stalled')
  }
  const armStallTimer = () => {
    window.clearTimeout(stallTimer)
    stallTimer = window.setTimeout(cancelForStall, stallTimeoutMs)
  }
  const abort = () => { void reader.cancel(options.signal?.reason) }
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    armStallTimer()
    while (true) {
      if (options.signal?.aborted) throw new DOMException('Download cancelled', 'AbortError')
      const { done, value } = await reader.read()
      if (done) {
        if (options.signal?.aborted) throw new DOMException('Download cancelled', 'AbortError')
        if (stalled) throw new Error('下载连接中断，正在重试')
        break
      }
      if (!value?.length) continue
      const chunk = new Uint8Array(value.length)
      chunk.set(value)
      chunks.push(chunk.buffer)
      receivedBytes += value.length
      options.onProgress?.(receivedBytes, totalBytes)
      armStallTimer()
    }
  } finally {
    window.clearTimeout(stallTimer)
    options.signal?.removeEventListener('abort', abort)
  }
  return new Blob(chunks, { type: response.headers.get('content-type') ?? 'application/octet-stream' })
}

export const downloadResponseWithSingleRetry = async (options: DownloadWithRetryOptions) => {
  for (const attempt of [0, 1] as const) {
    if (options.signal?.aborted) throw new DOMException('Download cancelled', 'AbortError')
    if (attempt === 1) options.onRetry?.()
    try {
      const response = await options.responseForAttempt(attempt)
      return await downloadResponseBlob(response, options)
    } catch (error) {
      if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError') || attempt === 1) throw error
    }
  }
  throw new Error('下载未完成，请重试')
}

const extensionFromMimeType = (mimeType: string | null | undefined) => {
  if (/flac/i.test(mimeType ?? '')) return 'flac'
  if (/mp4|m4a/i.test(mimeType ?? '')) return 'm4a'
  if (/aac/i.test(mimeType ?? '')) return 'aac'
  if (/ogg|opus/i.test(mimeType ?? '')) return 'ogg'
  if (/wav/i.test(mimeType ?? '')) return 'wav'
  if (/aiff/i.test(mimeType ?? '')) return 'aiff'
  if (/mpeg|mp3/i.test(mimeType ?? '')) return 'mp3'
  return null
}

export const downloadFileName = (track: Track, format: DownloadFileNameFormat = 'artist-title', mimeType?: string | null) => {
  const extension = extensionFromMimeType(mimeType)
    ?? (track.remote?.resolvedQuality === 'flac24bit' || track.remote?.resolvedQuality === 'flac' || /FLAC|无损|Hi-Res/i.test(track.quality) ? 'flac' : 'mp3')
  const identity = format === 'title-artist' ? `${track.title} - ${track.artist}` : `${track.artist} - ${track.title}`
  const base = identity.replace(invalidFileNameCharacters, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Echora Music'
  return `${base}.${extension}`
}

export const triggerBrowserDownload = (audio: Blob, track: Track, format: DownloadFileNameFormat = 'artist-title') => {
  const url = URL.createObjectURL(audio)
  const link = document.createElement('a')
  link.href = url
  link.download = downloadFileName(track, format, audio.type)
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
