import { describe, expect, it, vi } from 'vitest'
import { requestNativePlatform } from './nativePlatformGateway'

describe('native platform gateway', () => {
  it('normalizes native QQ search responses', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({
      data: {
        song: {
          list: [{
            mid: 'song-mid',
            name: '测试歌曲',
            interval: 213,
            singer: [{ name: '测试歌手' }],
            album: { id: 1, mid: 'album-mid', name: '测试专辑' },
            file: { media_mid: 'media-mid', size_128mp3: 1_000, size_320mp3: 2_000, size_flac: 3_000 },
          }],
        },
      },
    }), { status: 200 })) as typeof globalThis.fetch

    const result = await requestNativePlatform<{ tracks: Array<Record<string, any>> }>(fetcher, 'music.search', {
      query: new URLSearchParams({ query: '测试', sources: 'tx', limit: '20' }),
    })

    expect(result).toMatchObject({ ok: true, status: 200 })
    expect(result.data.tracks[0]).toMatchObject({
      source: 'tx',
      title: '测试歌曲',
      artist: '测试歌手',
      album: '测试专辑',
      qualities: ['128k', '320k', 'flac'],
    })
  })

  it('blocks private music-source requests', async () => {
    const fetcher = vi.fn() as unknown as typeof globalThis.fetch
    const result = await requestNativePlatform<{ message: string }>(fetcher, 'music.sourceRequest', {
      method: 'POST',
      body: { url: 'http://127.0.0.1/internal', options: {} },
    })

    expect(result).toMatchObject({ ok: false, status: 502 })
    expect(result.data.message).toBe('远端地址不受支持')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('loads a live chart catalog in the native client', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { topList: [{ id: 26, topTitle: '巅峰榜·热歌', picUrl: 'https://img.example/chart.jpg', songList: [{ songname: '歌曲', singername: '歌手' }] }] } }), { status: 200 }))
    const result = await requestNativePlatform<{ charts: Array<Record<string, any>> }>(fetcher as typeof globalThis.fetch, 'music.chartCatalog', {
      query: new URLSearchParams({ sources: 'tx' }),
    })
    expect(result).toMatchObject({ ok: true, status: 200 })
    expect(result.data.charts[0]).toMatchObject({ id: 'tx:26', name: '巅峰榜·热歌', source: 'tx', provenance: 'live' })
  })

  it('loads chart tracks in the native client', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      topinfo: { ListName: '巅峰榜·热歌' },
      date: '2026-07-21',
      songlist: [{ data: { songmid: 'chart-song', songname: '榜单歌曲', interval: 180, singer: [{ name: '榜单歌手' }], albumname: '榜单专辑', albummid: 'album-mid', size128: 1, size320: 2, strMediaMid: 'media-mid' } }],
    }), { status: 200 }))
    const result = await requestNativePlatform<{ chart: { tracks: Array<Record<string, any>> } }>(fetcher as typeof globalThis.fetch, 'music.chartDetail', {
      params: { source: 'tx', boardId: '26' },
      query: new URLSearchParams({ limit: '50' }),
    })
    expect(result).toMatchObject({ ok: true, status: 200 })
    expect(result.data.chart.tracks[0]).toMatchObject({ source: 'tx', title: '榜单歌曲', artist: '榜单歌手', qualities: ['128k', '320k'] })
  })

  it('loads synchronized lyrics through the native gateway', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({
      lrc: { lyric: '[00:01.00]第一句' },
      tlyric: { lyric: '[00:01.00]First line' },
    }), { status: 200 }))

    const result = await requestNativePlatform<{ lyric: string; translation: string }>(fetcher as typeof globalThis.fetch, 'music.lyrics', {
      method: 'POST',
      body: { source: 'wy', musicInfo: { songmid: 123 } },
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: { lyric: '[00:01.00]第一句', translation: '[00:01.00]First line' },
    })
    expect(String(fetcher.mock.calls[0][0])).toContain('id=123')
  })

  it('decodes Kugou lyrics with the playable track hash', async () => {
    const encoded = btoa(unescape(encodeURIComponent('[00:02.00]酷狗歌词')))
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/search')
      ? new Response(JSON.stringify({ candidates: [{ id: 'lyric-id', accesskey: 'key' }] }), { status: 200 })
      : new Response(JSON.stringify({ content: encoded }), { status: 200 }))

    const result = await requestNativePlatform<{ lyric: string }>(fetcher as typeof globalThis.fetch, 'music.lyrics', {
      method: 'POST',
      body: { source: 'kg', musicInfo: { songmid: 'audio-id', hash: 'TRACK-HASH' } },
    })

    expect(result).toMatchObject({ ok: true, status: 200, data: { lyric: '[00:02.00]酷狗歌词' } })
    expect(String(fetcher.mock.calls[0][0])).toContain('hash=TRACK-HASH')
  })

  it('allows a local Ollama endpoint without opening other private hosts', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ model: 'local-model' }), { status: 200 })) as typeof globalThis.fetch
    const result = await requestNativePlatform(fetcher, 'ai.request', {
      method: 'POST',
      body: { url: 'http://127.0.0.1:11434/api/chat', provider: 'ollama', body: { messages: [] } },
    })

    expect(result).toMatchObject({ ok: true, status: 200, data: { model: 'local-model' } })
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
