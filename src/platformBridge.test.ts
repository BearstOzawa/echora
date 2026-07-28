import { afterEach, describe, expect, it, vi } from 'vitest'
import { TauriPlatformBridge, WebPlatformBridge } from './platformBridge'

afterEach(() => vi.unstubAllGlobals())

describe('web platform bridge', () => {
  it('keeps gateway routes out of product modules', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ tracks: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const bridge = new WebPlatformBridge()
    const query = new URLSearchParams({ query: '测试歌曲', sources: 'tx,kw', limit: '20' })

    await expect(bridge.requestJson('music.search', { query })).resolves.toMatchObject({ ok: true, status: 200, data: { tracks: [] } })
    expect(fetchMock).toHaveBeenCalledWith('https://echora-cloud.lili.uno/v1/music/search?query=%E6%B5%8B%E8%AF%95%E6%AD%8C%E6%9B%B2&sources=tx%2Ckw&limit=20', expect.objectContaining({ signal: undefined }))
  })

  it('builds Cloud chart routes while artwork remains direct', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const bridge = new WebPlatformBridge()

    await bridge.requestJson('music.chartDetail', {
      params: { source: 'wy', boardId: '3778678' },
      query: new URLSearchParams({ limit: '30' }),
    })
    expect(fetchMock).toHaveBeenCalledWith('https://echora-cloud.lili.uno/v1/music/charts/wy/3778678?limit=30', expect.objectContaining({ signal: undefined }))
    expect(bridge.mediaUrl('https://img.example.com/a b.jpg')).toBe('https://img.example.com/a b.jpg')
  })

  it('routes custom AI through the authenticated Cloud endpoint', async () => {
    localStorage.setItem('echora.cloudSession.v1', JSON.stringify({ token: 'session-token', user: { id: 'user-1', username: 'listener' } }))
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const bridge = new WebPlatformBridge()

    await bridge.requestJson('ai.request', { method: 'POST', body: { body: '{"model":"client-model"}' } })

    expect(fetchMock).toHaveBeenCalledWith('https://echora-cloud.lili.uno/v1/ai/custom/request', expect.objectContaining({
      method: 'POST',
      headers: expect.any(Headers),
    }))
    const headers = fetchMock.mock.calls[0][1]?.headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer session-token')
    localStorage.clear()
  })

  it('sends final playback health directly to Cloud without account authentication', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: 1 }), { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)
    const bridge = new WebPlatformBridge()

    await bridge.requestJson('music.playbackHealth', {
      method: 'POST',
      body: { events: [{ source: 'wy', outcome: 'success', latencyMs: 320 }] },
    })

    expect(fetchMock).toHaveBeenCalledWith('https://echora-cloud.lili.uno/v1/music/playback-events', expect.objectContaining({ method: 'POST' }))
    const headers = fetchMock.mock.calls[0][1]?.headers as Headers
    expect(headers.get('Authorization')).toBeNull()
    expect(headers.get('X-Echora-Device')).toBeTruthy()
  })
})

describe('native platform bridge', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('routes remote media through the native streaming protocol', () => {
    const bridge = new TauriPlatformBridge()
    expect(bridge.mediaUrl('https://cdn.example.com/audio file.flac')).toBe('echora-media://localhost/media?url=https%3A%2F%2Fcdn.example.com%2Faudio+file.flac')
    expect(bridge.mediaUrl('https://cdn.example.com/song.flac', { cacheKey: 'wy:123:flac', cacheLimitMb: 2048 }))
      .toBe('echora-media://localhost/media?url=https%3A%2F%2Fcdn.example.com%2Fsong.flac&cacheKey=wy%3A123%3Aflac&cacheLimitMb=2048')
    expect(bridge.mediaUrl('blob:local-track')).toBe('blob:local-track')
  })

  it('uses the Android WebView custom-protocol origin', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36' })
    const bridge = new TauriPlatformBridge()

    expect(bridge.mediaUrl('https://img.example.com/cover.jpg'))
      .toBe('http://echora-media.localhost/media?url=https%3A%2F%2Fimg.example.com%2Fcover.jpg')
    expect(bridge.mediaUrl('https://img.example.com/cover.jpg', { purpose: 'artwork' }))
      .toBe('https://img.example.com/cover.jpg')
  })

  it('uses Cloud for playback health instead of the native gateway', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: 1 }), { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)
    const bridge = new TauriPlatformBridge()

    await bridge.requestJson('music.playbackHealth', {
      method: 'POST',
      body: { events: [{ source: 'tx', outcome: 'error', latencyMs: 1200, reason: 'network' }] },
    })

    expect(fetchMock).toHaveBeenCalledWith('https://echora-cloud.lili.uno/v1/music/playback-events', expect.objectContaining({ method: 'POST' }))
  })
})
