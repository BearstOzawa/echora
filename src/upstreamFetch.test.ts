// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { fetchJsonWithRetry } from './upstreamFetch'

describe('upstream JSON requests', () => {
  it('retries one transient upstream failure', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    await expect(fetchJsonWithRetry(fetcher, 'https://music.example/catalog', {}, { retryDelayMs: 0 })).resolves.toEqual({ ok: true })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not retry deterministic client errors', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }))

    await expect(fetchJsonWithRetry(fetcher, 'https://music.example/catalog', {}, { retryDelayMs: 0 })).rejects.toThrow('内容服务未授权')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not retry after the caller cancels the request', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(async () => {
      controller.abort()
      throw new DOMException('cancelled', 'AbortError')
    })

    await expect(fetchJsonWithRetry(fetcher, 'https://music.example/catalog', { signal: controller.signal }, { retryDelayMs: 0 })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
