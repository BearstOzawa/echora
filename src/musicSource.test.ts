import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultMusicSourceSettings } from './appSettings'
import { inspectMusicSource, normalizeMusicSourceCapabilities, resolveTrackAudio, updateMusicSourceProviderCatalog, updateMusicSourceProviderPlayback } from './musicSource'
import { initialTracks } from './testFixtures'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('cloud music source', () => {
  it('normalizes Cloud capabilities into one provider status model', () => {
    const providers = normalizeMusicSourceCapabilities({ sources: { tx: { qualitys: ['128k', '320k', 'flac'] }, wy: { qualitys: ['128k', 'unsupported'] } } })
    expect(providers.map(({ source, registered }) => [source, registered])).toEqual([['tx', true], ['wy', true], ['kw', false], ['kg', false], ['mg', false]])
    expect(providers[0].qualities).toEqual(['128k', '320k', 'flac'])
    expect(providers[1].qualities).toEqual(['128k'])
    expect(providers[0].playbackStatus).toBe('unchecked')
    expect(providers[0].catalogStatus).toBe('unchecked')

    const miguProviders = normalizeMusicSourceCapabilities({ sources: { mg: { qualitys: ['128k'] } } })
    expect(miguProviders.find((provider) => provider.source === 'mg')).toMatchObject({ registered: true, qualities: ['128k'] })
  })

  it('tracks real playback health separately from declared script capabilities', () => {
    const providers = normalizeMusicSourceCapabilities({ sources: { kg: { qualitys: ['128k', 'flac'] } } })
    const failed = updateMusicSourceProviderPlayback(providers, 'kg', 'error', '测试歌曲 · 未获取到有效播放链接', 123)
    expect(failed.find((provider) => provider.source === 'kg')).toMatchObject({
      registered: true,
      playbackStatus: 'error',
      playbackMessage: '测试歌曲 · 未获取到有效播放链接',
      playbackCheckedAt: 123,
    })
    expect(failed.find((provider) => provider.source === 'tx')?.playbackStatus).toBe('unchecked')
  })

  it('tracks content availability separately from playback resolution', () => {
    const providers = normalizeMusicSourceCapabilities({ sources: { kw: { qualitys: ['128k', '320k'] } } })
    const checked = updateMusicSourceProviderCatalog(providers, 'kw', 'available', '已返回 1 首', 456)
    expect(checked.find((provider) => provider.source === 'kw')).toMatchObject({
      registered: true,
      catalogStatus: 'available',
      catalogMessage: '已返回 1 首',
      catalogCheckedAt: 456,
      playbackStatus: 'unchecked',
    })
  })

  it('reports capabilities returned by Echora Cloud', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ providers: [{ source: 'kw', enabled: true }, { source: 'tx', enabled: true, availability: 'limited' }, { source: 'wy', enabled: false }], qualities: ['128k', '320k', 'flac'] }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const providers = await inspectMusicSource(defaultMusicSourceSettings, true)
    expect(providers.map((provider) => provider.source)).toEqual(['kw', 'tx', 'wy', 'kg', 'mg'])
    expect(providers.filter((provider) => provider.registered).map((provider) => provider.source)).toEqual(['kw', 'tx'])
    expect(providers.find((provider) => provider.source === 'tx')?.availability).toBe('limited')
    expect(providers.find((provider) => provider.source === 'wy')?.availability).toBe('disabled')
  })

  it('reuses a fresh resolved URL for the same track and quality', async () => {
    let resolveCount = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/v1/music/status')) return Promise.resolve(new Response(JSON.stringify({ providers: [{ source: 'tx', enabled: true }], qualities: ['flac'] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      resolveCount += 1
      return Promise.resolve(new Response(JSON.stringify({ url: 'https://media.example.com/song.flac', expiresAt: Date.now() + 20 * 60_000 }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }))
    await inspectMusicSource(defaultMusicSourceSettings, true)
    const track = {
      ...initialTracks[0],
      remote: {
        source: 'tx' as const,
        musicInfo: { songmid: 'cache-track', name: '测试歌曲', singer: '测试艺人', albumName: '测试专辑', source: 'tx' as const, interval: '03:00', types: [], _types: {}, typeUrl: {} },
        availableQualities: ['flac' as const],
      },
    }
    await expect(resolveTrackAudio(track, defaultMusicSourceSettings, 'flac')).resolves.toEqual({ url: 'https://media.example.com/song.flac', quality: 'flac' })
    await expect(resolveTrackAudio(track, defaultMusicSourceSettings, 'flac')).resolves.toEqual({ url: 'https://media.example.com/song.flac', quality: 'flac' })
    expect(resolveCount).toBe(1)
    await expect(resolveTrackAudio(track, defaultMusicSourceSettings, 'flac', true)).resolves.toEqual({ url: 'https://media.example.com/song.flac', quality: 'flac' })
    expect(resolveCount).toBe(2)
  })

  it('uses the quality actually resolved by Echora Cloud', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(url.includes('/v1/music/status') ? {
      providers: [{ source: 'kg', enabled: true }],
      qualities: ['128k', '320k'],
    } : {
      url: 'https://media.example.com/song.mp3',
      resolvedQuality: '128k',
      expiresAt: Date.now() + 3 * 60_000,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))))
    await inspectMusicSource(defaultMusicSourceSettings, true)
    const track = {
      ...initialTracks[0],
      remote: {
        source: 'kg' as const,
        musicInfo: { songmid: 'downgraded-track', name: '测试歌曲', singer: '测试艺人', albumName: '测试专辑', source: 'kg' as const, interval: '03:00', types: [], _types: {}, typeUrl: {} },
        availableQualities: ['128k' as const, '320k' as const],
      },
    }

    await expect(resolveTrackAudio(track, defaultMusicSourceSettings, '320k')).resolves.toEqual({ url: 'https://media.example.com/song.mp3', quality: '128k' })
  })

  it('rejects an empty resolved URL and falls back to the next playable quality', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/v1/music/status')) return Promise.resolve(new Response(JSON.stringify({ providers: [{ source: 'tx', enabled: true }], qualities: ['128k', '320k'] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      const body = JSON.parse(String(init?.body || '{}')) as { quality?: string }
      return Promise.resolve(new Response(JSON.stringify({ url: body.quality === '320k' ? '' : 'https://media.example.com/song.mp3' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }))
    await inspectMusicSource(defaultMusicSourceSettings, true)
    const track = {
      ...initialTracks[0],
      remote: {
        source: 'tx' as const,
        musicInfo: { songmid: 'fallback-track', name: '测试歌曲', singer: '测试艺人', albumName: '测试专辑', source: 'tx' as const, interval: '03:00', types: [], _types: {}, typeUrl: {} },
        availableQualities: ['128k' as const, '320k' as const],
      },
    }

    await expect(resolveTrackAudio(track, defaultMusicSourceSettings)).resolves.toEqual({ url: 'https://media.example.com/song.mp3', quality: '128k' })
  })

  it('uses the approved direct QQ resolver when Cloudflare egress is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string | URL) => {
      const requestUrl = String(url)
      if (requestUrl.includes('/v1/music/status')) return Promise.resolve(new Response(JSON.stringify({ providers: [{ source: 'tx', enabled: true }], qualities: ['128k'] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      if (requestUrl.includes('/v1/music/resolve')) return Promise.resolve(new Response(JSON.stringify({ directResolver: { provider: 'qq', url: 'https://api-v2.yuafeng.cn/API/qqmusic.php?mid=test&apikey=key' }, expiresAt: Date.now() + 3 * 60_000 }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      return Promise.resolve(new Response(JSON.stringify({ code: 0, msg: '获取成功', data: { cover: 'https://img.example.com/cover.jpg', music: 'http://media.example.com/song.mp3' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }))
    await inspectMusicSource(defaultMusicSourceSettings, true)
    const track = {
      ...initialTracks[0],
      remote: {
        source: 'tx' as const,
        musicInfo: { songmid: 'direct-track', name: '测试歌曲', singer: '测试艺人', albumName: '测试专辑', source: 'tx' as const, interval: '03:00', types: [], _types: {}, typeUrl: {} },
        availableQualities: ['128k' as const],
      },
    }

    await expect(resolveTrackAudio(track, defaultMusicSourceSettings, '128k')).resolves.toEqual({ url: 'https://media.example.com/song.mp3', quality: '128k' })
  })

  it('uses the approved direct Kuwo resolver when Cloudflare egress is region restricted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string | URL) => {
      const requestUrl = String(url)
      if (requestUrl.includes('/v1/music/status')) return Promise.resolve(new Response(JSON.stringify({ providers: [{ source: 'kw', enabled: true }], qualities: ['320k'] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      if (requestUrl.includes('/v1/music/resolve')) return Promise.resolve(new Response(JSON.stringify({ directResolver: { provider: 'kuwo', url: 'https://nmobi.kuwo.cn/mobi.s?type=convert_url_with_sign&rid=567247828&br=320kmp3' }, expiresAt: Date.now() + 3 * 60_000 }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      if (requestUrl.includes('nmobi.kuwo.cn')) return Promise.resolve(new Response(JSON.stringify({ code: 200, data: { url: 'https://media.example.com/kuwo.mp3' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      return Promise.resolve(new Response('{}', { status: 404 }))
    }))
    await inspectMusicSource(defaultMusicSourceSettings, true)
    const track = {
      ...initialTracks[1],
      remote: {
        source: 'kw' as const,
        musicInfo: { songmid: '567247828', name: '测试歌曲', singer: '测试艺人', albumName: '测试专辑', source: 'kw' as const, interval: '03:00', types: [], _types: {}, typeUrl: {} },
        availableQualities: ['320k' as const],
      },
    }

    await expect(resolveTrackAudio(track, defaultMusicSourceSettings, '320k')).resolves.toEqual({ url: 'https://media.example.com/kuwo.mp3', quality: '320k' })
  })

  it('rejects a short Kuwo announcement returned by the direct resolver', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
      const requestUrl = String(url)
      if (requestUrl.includes('/v1/music/status')) return Promise.resolve(new Response(JSON.stringify({ providers: [{ source: 'kw', enabled: true }], qualities: ['128k'] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      if (requestUrl.includes('/v1/music/resolve')) return Promise.resolve(new Response(JSON.stringify({ directResolver: { provider: 'kuwo', url: 'https://nmobi.kuwo.cn/mobi.s?type=convert_url_with_sign&rid=567247828&br=128kmp3' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      if (requestUrl.includes('nmobi.kuwo.cn')) return Promise.resolve(new Response(JSON.stringify({ code: 200, data: { url: 'https://media.example.com/announcement.mp3' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      if (requestUrl.includes('media.example.com') && init?.method === 'HEAD') return Promise.resolve(new Response(null, { status: 200, headers: { 'Content-Length': '181521' } }))
      return Promise.resolve(new Response('{}', { status: 404 }))
    }))
    await inspectMusicSource(defaultMusicSourceSettings, true)
    const track = {
      ...initialTracks[1],
      remote: {
        source: 'kw' as const,
        musicInfo: { songmid: '567247828', name: '测试歌曲', singer: '测试艺人', albumName: '测试专辑', source: 'kw' as const, interval: '04:03', types: [], _types: {}, typeUrl: {} },
        availableQualities: ['128k' as const],
      },
    }

    await expect(resolveTrackAudio(track, defaultMusicSourceSettings, '128k')).rejects.toThrow('短提示音')
  })

  it('uses the approved Kugou JSONP resolver when Cloudflare egress cannot return a URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(url.includes('/v1/music/status') ? {
      providers: [{ source: 'kg', enabled: true }],
      qualities: ['128k'],
    } : {
      directResolver: { provider: 'kugou', url: 'https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=TRACK-HASH' },
      resolvedQuality: '128k',
      expiresAt: Date.now() + 3 * 60_000,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))))
    await inspectMusicSource(defaultMusicSourceSettings, true)
    const appendChild = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      const script = node as HTMLScriptElement
      const callback = new URL(script.src).searchParams.get('callback')!
      queueMicrotask(() => ((window as unknown as Record<string, (data: unknown) => void>)[callback])({
        url: 'http://media.example.com/kugou.mp3',
      }))
      return node
    })
    const track = {
      ...initialTracks[0],
      remote: {
        source: 'kg' as const,
        musicInfo: { songmid: 'kugou-track', hash: 'TRACK-HASH', name: '测试歌曲', singer: '测试艺人', albumName: '测试专辑', source: 'kg' as const, interval: '03:00', types: [], _types: {}, typeUrl: {} },
        availableQualities: ['128k' as const],
      },
    }

    await expect(resolveTrackAudio(track, defaultMusicSourceSettings, '128k')).resolves.toEqual({
      url: 'https://media.example.com/kugou.mp3',
      quality: '128k',
    })
    expect(appendChild).toHaveBeenCalledOnce()
    const script = appendChild.mock.calls[0][0] as HTMLScriptElement
    expect(script.src).toContain('https://m.kugou.com/app/i/getSongInfo.php')
    expect(script.src).toContain('format=jsonp')
  })
})
