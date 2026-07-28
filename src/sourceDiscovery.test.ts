import { describe, expect, it, vi } from 'vitest'
import { initialTracks } from './testFixtures'
import { buildDailyRecommendations, loadSourceDiscovery, readSourceDiscoveryCache, sourceDiscoveryDefinitions, sourceDiscoveryMaxStaleMs, writeSourceDiscoveryCache, type SourceChart } from './sourceDiscovery'

describe('source discovery', () => {
  it('builds a stable daily mix from live shelves and personal signals', () => {
    const preferred = { ...initialTracks[4], id: 501, artist: initialTracks[0].artist, source: initialTracks[0].source }
    const shelves = [{ id: 'daily', name: '动态主题', eyebrow: '测试', description: '测试', query: '测试', kind: 'trend' as const, tracks: [initialTracks[1], initialTracks[2], preferred, initialTracks[3]] }]
    const date = new Date(2026, 6, 15)
    const first = buildDailyRecommendations(shelves, [initialTracks[0]], date, 4)
    expect(first).toEqual(buildDailyRecommendations(shelves, [initialTracks[0]], date, 4))
    expect(first[0].id).toBe(preferred.id)
    expect(first.slice(1).every((track, index) => track.source !== first[index].source)).toBe(true)
  })

  it('uses the configured provider order before repeating a daily source', () => {
    const makeTrack = (id: number, source: 'tx' | 'wy' | 'kg') => ({
      ...initialTracks[id % initialTracks.length],
      id: 6000 + id,
      title: `推荐歌曲 ${id}`,
      artist: `推荐艺人 ${id}`,
      remote: {
        source,
        musicInfo: { songmid: `daily-${id}`, name: `推荐歌曲 ${id}`, singer: `推荐艺人 ${id}`, albumName: '推荐专辑', source, interval: '03:00', types: [], _types: {}, typeUrl: {} },
        availableQualities: ['128k' as const],
      },
    })
    const tracks = [makeTrack(1, 'kg'), makeTrack(2, 'kg'), makeTrack(3, 'tx'), makeTrack(4, 'tx'), makeTrack(5, 'wy'), makeTrack(6, 'wy')]
    const shelves = [{ id: 'daily-order', name: '每日推荐', eyebrow: '测试', description: '测试', query: '测试', kind: 'trend' as const, tracks }]

    expect(buildDailyRecommendations(shelves, [], new Date(2026, 6, 27), 6, ['wy', 'tx', 'kg']).map((track) => track.remote?.source)).toEqual(['wy', 'tx', 'kg', 'wy', 'tx', 'kg'])
  })

  it('loads every editorial dimension from the source catalog instead of personal collections', async () => {
    const search = vi.fn(async (query: string) => Array.from({ length: 24 }, (_, index) => ({ ...initialTracks[index % initialTracks.length], id: query.length * 10_000 + index + 1, title: `${query} ${index + 1}`, artist: `测试艺人 ${index + 1}` })))
    const discovery = await loadSourceDiscovery(search, async () => [{
      id: 'official:tx:26', boardId: '26', source: 'tx', name: 'QQ 热歌榜', eyebrow: 'QQ 音乐', description: '官方榜单', category: 'platform', cover: initialTracks[0].cover, preview: [], tracks: initialTracks.slice(0, 3), updatedAt: '2026-07-14',
    }])

    expect(search.mock.calls.map(([query]) => query).sort()).toEqual(sourceDiscoveryDefinitions.map((definition) => definition.query).sort())
    expect(sourceDiscoveryDefinitions).toHaveLength(10)
    expect(discovery.shelves.some((shelf) => shelf.name === '新歌速递')).toBe(true)
    expect(discovery.shelves.some((shelf) => shelf.name === '粤语金曲')).toBe(true)
    expect(discovery.shelves.some((shelf) => shelf.name === '独立与民谣')).toBe(true)
    expect(discovery.shelves.some((shelf) => shelf.name === '电影与原声')).toBe(true)
    expect(discovery.shelves.find((shelf) => shelf.name === '华语流行')?.tracks).toHaveLength(20)
    expect(discovery.hotTracks.length).toBeGreaterThan(0)
    expect(discovery.freshTracks.length).toBeGreaterThan(0)
    expect(discovery.tracks.length).toBeGreaterThan(3)
    expect(discovery.charts.some((chart) => chart.name === 'QQ 热歌榜')).toBe(true)
    expect(discovery.charts.every((chart) => chart.id.startsWith('official:'))).toBe(true)
  })

  it('keeps useful source dimensions when one upstream request fails', async () => {
    const discovery = await loadSourceDiscovery(async (query) => {
      if (query === '现场') throw new Error('provider unavailable')
      return initialTracks
    })

    expect(discovery.shelves.some((shelf) => shelf.name === '现场能量')).toBe(false)
    expect(discovery.shelves.length).toBeGreaterThan(1)
  })

  it('limits concurrent discovery searches while keeping the Cloud first load responsive', async () => {
    let active = 0
    let maximum = 0
    await loadSourceDiscovery(async () => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => window.setTimeout(resolve, 1))
      active -= 1
      return initialTracks
    })
    expect(maximum).toBe(5)
  })

  it('uses the configured size for source-backed featured collections', async () => {
    const search = vi.fn(async (query: string) => Array.from({ length: 36 }, (_, index) => ({ ...initialTracks[index % initialTracks.length], id: query.length * 100_000 + index, title: `${query} ${index + 1}`, artist: `测试艺人 ${index + 1}` })))
    const discovery = await loadSourceDiscovery(search, undefined, undefined, 10)
    expect(discovery.shelves.every((shelf) => shelf.tracks.length <= 10)).toBe(true)
    expect(discovery.shelves[0].tracks).toHaveLength(10)
    expect(discovery.hotTracks.length).toBeGreaterThan(0)
    expect(discovery.hotTracks.length).toBeLessThanOrEqual(10)
    expect(discovery.freshTracks.length).toBeGreaterThan(0)
    expect(discovery.freshTracks.length).toBeLessThanOrEqual(10)
  })

  it('interleaves official hot charts across platforms and removes duplicate versions', async () => {
    const shared = { ...initialTracks[0], id: 7001, title: '共同热歌', artist: '同一艺人', source: 'QQ' as const }
    const charts = [
      { id: 'official:tx:26', boardId: '26', source: 'tx' as const, name: 'QQ 热歌榜', eyebrow: 'QQ 音乐', description: '官方榜单', category: 'platform' as const, cover: initialTracks[0].cover, preview: [], tracks: [] },
      { id: 'official:tx:27', boardId: '27', source: 'tx' as const, name: 'QQ 新歌榜', eyebrow: 'QQ 音乐', description: '官方榜单', category: 'platform' as const, cover: initialTracks[1].cover, preview: [], tracks: [] },
      { id: 'official:wy:1', boardId: '1', source: 'wy' as const, name: '网易云热歌榜', eyebrow: '网易云音乐', description: '官方榜单', category: 'platform' as const, cover: initialTracks[1].cover, preview: [], tracks: [] },
      { id: 'official:wy:2', boardId: '2', source: 'wy' as const, name: '网易云新歌榜', eyebrow: '网易云音乐', description: '官方榜单', category: 'platform' as const, cover: initialTracks[2].cover, preview: [], tracks: [] },
    ]
    const loadDetail = vi.fn(async (chart: SourceChart) => {
      if (/新歌/.test(chart.name)) return chart.source === 'tx'
        ? [{ ...initialTracks[3], id: 7101 }, { ...initialTracks[4], id: 7102 }]
        : [{ ...initialTracks[3], id: 7103, source: '网易云' as const }, { ...initialTracks[5], id: 7104 }]
      return chart.source === 'tx'
        ? [shared, { ...initialTracks[1], id: 7002 }]
        : [{ ...shared, id: 7003, source: '网易云' as const }, { ...initialTracks[2], id: 7004 }]
    })
    const discovery = await loadSourceDiscovery(async () => initialTracks, async () => charts, loadDetail)

    expect(loadDetail).toHaveBeenCalledTimes(4)
    expect(discovery.hotTracks.map((track) => track.id)).toEqual([7001, 7002, 7004])
    expect(discovery.freshTracks.map((track) => track.id)).toEqual([7101, 7102, 7104])
    expect(new Set(discovery.hotTracks.map((track) => `${track.title}:${track.artist}`)).size).toBe(discovery.hotTracks.length)
  })

  it('uses the Cloud chart order for aggregate tracks and platform lanes', async () => {
    const sources = ['wy', 'kg', 'tx'] as const
    const charts: SourceChart[] = sources.map((source, index) => ({
      id: `official:${source}:hot`, boardId: 'hot', source, name: `${source} 热歌榜`, eyebrow: source, description: '官方榜单', category: 'platform', cover: initialTracks[index].cover, preview: [], tracks: [],
    }))
    const remoteTracks = sources.map((source, index) => ({
      ...initialTracks[index],
      id: 8000 + index,
      title: `平台歌曲 ${source}`,
      artist: `平台艺人 ${source}`,
      remote: {
        source,
        musicInfo: { songmid: `song-${source}`, name: `平台歌曲 ${source}`, singer: `平台艺人 ${source}`, albumName: '测试专辑', source, interval: '03:00', types: [], _types: {}, typeUrl: {} },
        availableQualities: ['128k' as const],
      },
    }))
    const discovery = await loadSourceDiscovery(async () => remoteTracks, async () => charts, async (chart) => [remoteTracks[sources.indexOf(chart.source as typeof sources[number])]])

    expect(discovery.hotTracks.map((track) => track.remote?.source)).toEqual(['wy', 'kg', 'tx'])
    expect(discovery.providers.map((provider) => provider.source)).toEqual(['wy', 'kg', 'tx'])
    expect(discovery.providers.every((provider) => provider.available)).toBe(true)
  })

  it('balances featured shelves and keeps configured platforms visible during partial failures', async () => {
    const makeTrack = (id: number, source: 'wy' | 'tx' | 'mg') => ({
      ...initialTracks[id % initialTracks.length],
      id: 9000 + id,
      title: `歌曲 ${id}`,
      artist: `艺人 ${id}`,
      remote: {
        source,
        musicInfo: { songmid: `song-${id}`, name: `歌曲 ${id}`, singer: `艺人 ${id}`, albumName: '测试专辑', source, interval: '03:00', types: [], _types: {}, typeUrl: {} },
        availableQualities: ['128k' as const],
      },
    })
    const grouped = [makeTrack(1, 'wy'), makeTrack(2, 'wy'), makeTrack(3, 'wy'), makeTrack(4, 'tx'), makeTrack(5, 'tx'), makeTrack(6, 'mg')]
    const configured = ['wy', 'tx', 'kg', 'kw', 'mg'] as const
    const discovery = await loadSourceDiscovery(async () => grouped, undefined, undefined, 6, [...configured])

    expect(new Set(discovery.shelves[0].tracks.slice(0, 3).map((track) => track.remote?.source))).toEqual(new Set(['wy', 'tx', 'mg']))
    expect(discovery.providers.map((provider) => provider.source)).toEqual(configured)
    expect(discovery.providers.find((provider) => provider.source === 'kg')).toMatchObject({ available: false, tracks: [] })
  })

  it('fails only when the complete source catalog is unavailable', async () => {
    await expect(loadSourceDiscovery(async () => Promise.reject(new Error('offline')))).rejects.toThrow('音乐内容暂时无法加载')
  })

  it('keeps a bounded stale discovery snapshot for graceful startup', async () => {
    const data = new Map<string, string>()
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    }
    const catalog = await loadSourceDiscovery(async () => initialTracks)
    const cachedCatalog = { ...catalog, charts: [{ id: 'official:tx:26', boardId: '26', source: 'tx' as const, name: 'QQ 热歌榜', eyebrow: 'QQ 音乐', description: '官方榜单', category: 'platform' as const, cover: initialTracks[0].cover, preview: [], tracks: [], provenance: 'live' as const }] }
    writeSourceDiscoveryCache('v1.2.0:tx,wy', cachedCatalog, storage)
    expect(readSourceDiscoveryCache('v1.2.0:tx,wy', storage, catalog.loadedAt + 31 * 60 * 1000, 30 * 60 * 1000)).toBeNull()
    expect(readSourceDiscoveryCache('v1.2.0:tx,wy', storage, catalog.loadedAt + sourceDiscoveryMaxStaleMs)).toEqual({
      ...cachedCatalog,
      charts: [{ ...cachedCatalog.charts[0], provenance: 'cached' }],
    })
    expect(readSourceDiscoveryCache('v1.2.0:tx,wy', storage, catalog.loadedAt + sourceDiscoveryMaxStaleMs + 1)).toBeNull()
    expect(readSourceDiscoveryCache('another-source-set', storage, catalog.loadedAt)).toBeNull()
  })
})
