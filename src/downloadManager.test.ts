import { describe, expect, it, vi } from 'vitest'
import { assertDownloadSpace, createDownloadScheduler, downloadFileName, downloadResponseBlob, downloadResponseWithSingleRetry, downloadStateLabel, readDownloadStates, requiredDownloadSpaceBytes, writeDownloadStates } from './downloadManager'
import { initialTracks } from './testFixtures'

const memoryStorage = () => {
  let value = ''
  return { getItem: () => value || null, setItem: (_key: string, next: string) => { value = next } }
}

describe('download manager', () => {
  it('creates a safe browser download name without storing the audio in the app', () => {
    expect(downloadFileName({ ...initialTracks[0], artist: 'A/B', title: 'Song:One', quality: 'FLAC 无损' })).toBe('A B - Song One.flac')
    expect(downloadFileName({ ...initialTracks[0], quality: 'MP3 320 kbps' })).toMatch(/\.mp3$/)
    expect(downloadFileName({ ...initialTracks[0], artist: 'Artist', title: 'Title' }, 'title-artist')).toBe('Title - Artist.flac')
    expect(downloadFileName({ ...initialTracks[0], artist: 'Artist', title: 'Title', quality: 'MP-4/AAC 256 kbps' }, 'artist-title', 'audio/mp4')).toBe('Artist - Title.m4a')
    expect(downloadFileName({ ...initialTracks[0], artist: 'Artist', title: 'Title', quality: 'AAC 256 kbps' }, 'artist-title', 'audio/aac')).toBe('Artist - Title.aac')
  })

  it('streams audio with bounded progress updates', async () => {
    const onProgress = vi.fn()
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.enqueue(new Uint8Array([3, 4]))
        controller.close()
      },
    }), { headers: { 'content-length': '4', 'content-type': 'audio/mpeg' } })

    const blob = await downloadResponseBlob(response, { onProgress })

    expect(blob.size).toBe(4)
    expect(blob.type).toBe('audio/mpeg')
    expect(onProgress).toHaveBeenLastCalledWith(4, 4)
  })

  it('does not turn a cancelled stream into a completed download', async () => {
    const controller = new AbortController()
    const response = new Response(new ReadableStream({ start() {} }))
    const pendingDownload = downloadResponseBlob(response, { signal: controller.signal })

    controller.abort()

    await expect(pendingDownload).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('reports a stalled response instead of waiting forever', async () => {
    vi.useFakeTimers()
    try {
      const response = new Response(new ReadableStream({ start() {} }))
      const pendingDownload = downloadResponseBlob(response, { stallTimeoutMs: 5_000 })
      const rejection = expect(pendingDownload).rejects.toThrow('下载连接中断')
      await vi.advanceTimersByTimeAsync(5_000)
      await rejection
    } finally {
      vi.useRealTimers()
    }
  })

  it('refreshes the response once after a failed download', async () => {
    const responseForAttempt = vi.fn(async (attempt: 0 | 1) => attempt === 0
      ? new Response('unavailable', { status: 503 })
      : new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } }))
    const onRetry = vi.fn()

    const blob = await downloadResponseWithSingleRetry({ responseForAttempt, onRetry })

    expect(blob.size).toBe(3)
    expect(responseForAttempt).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('does not retry a cancelled download', async () => {
    const controller = new AbortController()
    const responseForAttempt = vi.fn(async () => new Response(new ReadableStream({ start() {} })))
    const pendingDownload = downloadResponseWithSingleRetry({ responseForAttempt, signal: controller.signal })
    controller.abort()

    await expect(pendingDownload).rejects.toMatchObject({ name: 'AbortError' })
    expect(responseForAttempt).toHaveBeenCalledTimes(1)
  })

  it('bounds concurrent downloads and starts the next task after release', async () => {
    const scheduler = createDownloadScheduler(2)
    const first = await scheduler.acquire()
    const second = await scheduler.acquire()
    let thirdStarted = false
    const thirdPromise = scheduler.acquire().then((release) => { thirdStarted = true; return release })

    await Promise.resolve()
    expect(scheduler.snapshot()).toEqual({ active: 2, pending: 1 })
    expect(thirdStarted).toBe(false)
    first()
    const third = await thirdPromise
    expect(scheduler.snapshot()).toEqual({ active: 2, pending: 0 })

    second()
    third()
    expect(scheduler.snapshot()).toEqual({ active: 0, pending: 0 })
  })

  it('removes a cancelled task while it is waiting for a download slot', async () => {
    const scheduler = createDownloadScheduler(1)
    const release = await scheduler.acquire()
    const controller = new AbortController()
    const pending = scheduler.acquire(controller.signal)
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(scheduler.snapshot()).toEqual({ active: 1, pending: 0 })
    release()
  })

  it('keeps concise product labels for each download state', () => {
    const state = { trackId: 1, requestKey: 'tx:1', phase: 'downloading' as const, receivedBytes: 42, totalBytes: 100, progress: 42 }
    expect(downloadStateLabel(state)).toBe('下载中 42%')
    expect(downloadStateLabel({ ...state, phase: 'retrying' })).toBe('正在重试')
    expect(downloadStateLabel({ ...state, phase: 'failed' })).toBe('下载失败')
  })

  it('keeps a reserve before starting a native download', () => {
    const oneGigabyte = 1024 * 1024 * 1024
    expect(requiredDownloadSpaceBytes(oneGigabyte)).toBe(oneGigabyte + 128 * 1024 * 1024)
    expect(() => assertDownloadSpace(oneGigabyte, oneGigabyte)).toThrow('设备存储空间不足')
    expect(() => assertDownloadSpace(oneGigabyte + 128 * 1024 * 1024, oneGigabyte)).not.toThrow()
  })

  it('restores interrupted native tasks as retryable failures', () => {
    const storage = memoryStorage()
    const track = { ...initialTracks[0], remote: { ...initialTracks[0].remote!, playbackToken: 'signed-playback-token' } }
    writeDownloadStates({ [track.id]: { trackId: track.id, requestKey: 'tx:1', phase: 'downloading', receivedBytes: 42, track } }, storage)

    const restored = readDownloadStates(storage)

    expect(restored[track.id]).toMatchObject({ phase: 'failed', receivedBytes: 42, failureReason: '上次下载未完成' })
    expect(restored[track.id].track?.remote?.playbackToken).toBeUndefined()
    expect(downloadStateLabel(restored[track.id])).toBe('下载已中断')
  })

  it('does not persist completed download tasks', () => {
    const storage = memoryStorage()
    const track = initialTracks[0]
    writeDownloadStates({ [track.id]: { trackId: track.id, requestKey: 'tx:1', phase: 'complete', receivedBytes: 100, track } }, storage)
    expect(readDownloadStates(storage)).toEqual({})
  })
})
