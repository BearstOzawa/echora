import { afterEach, describe, expect, it, vi } from 'vitest'
import { inspectMusicCatalogSources, loadMusicChartDetail, loadMusicCharts, mapGatewayTrack, searchMusicCatalog } from './musicCatalog'
import type { LxQuality } from './types'

describe('remote music catalog mapping', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('creates a stable playable track without claiming it is already offline', () => {
    const gatewayTrack = {
      source: 'kw' as const,
      title: '晴天',
      artist: '周杰伦',
      album: '叶惠美',
      durationSeconds: 269,
      cover: null,
      qualities: ['128k', '320k', 'flac'] as LxQuality[],
      sizeBytesByQuality: { flac: 55_397_039 },
      musicInfo: {
        songmid: '228908',
        name: '晴天',
        singer: '周杰伦',
        albumName: '叶惠美',
        source: 'kw' as const,
        interval: '04:29',
        types: [{ type: 'flac' as const, size: '52.83Mb' }],
        _types: { flac: { size: '52.83Mb' } },
        typeUrl: {},
      },
    }
    const first = mapGatewayTrack(gatewayTrack, 0)
    const second = mapGatewayTrack(gatewayTrack, 3)
    expect(first).toMatchObject({ title: '晴天', source: '酷我', quality: 'FLAC 无损', offline: false, cover: '/echora-mark-v2.svg' })
    expect(first.id).toBe(second.id)
    expect(first.remote?.musicInfo.songmid).toBe('228908')
  })

  it('keeps artwork on its direct content host', () => {
    const track = mapGatewayTrack({
      source: 'kw', title: '测试歌曲', artist: '测试艺人', album: '测试专辑', durationSeconds: 180, cover: 'https://img.example.com/cover.jpg', qualities: ['128k'], sizeBytesByQuality: {},
      musicInfo: { songmid: 'cover-test', name: '测试歌曲', singer: '测试艺人', albumName: '测试专辑', source: 'kw', interval: '03:00', types: [], _types: {}, typeUrl: {} },
    }, 0)
    expect(track.cover).toBe('https://img.example.com/cover.jpg')
  })

  it('limits catalog searches to music-service verified platforms', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ tracks: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(searchMusicCatalog('测试歌曲', ['tx', 'kw'])).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledWith('https://echora-cloud.lili.uno/v1/music/search?query=%E6%B5%8B%E8%AF%95%E6%AD%8C%E6%9B%B2&sources=tx%2Ckw&limit=20', expect.objectContaining({ signal: undefined }))
  })

  it('does not issue a catalog request when no platform is available', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(searchMusicCatalog('测试歌曲', [])).rejects.toThrow('音乐服务暂时不可用')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports per-platform catalog health without discarding successful results', async () => {
    const onSourceStatus = vi.fn()
    const sourceStatuses = [
      { source: 'tx', status: 'available', message: '已返回 1 首' },
      { source: 'kg', status: 'error', message: '酷狗搜索服务响应超时' },
    ]
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ tracks: [], sourceStatuses }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await searchMusicCatalog('测试歌曲', ['tx', 'kg'], undefined, 20, onSourceStatus)
    expect(onSourceStatus).toHaveBeenCalledWith(sourceStatuses)
  })

  it('keeps source diagnostics when every platform returns no playable catalog result', async () => {
    const sourceStatuses = [
      { source: 'tx', status: 'empty', message: '服务已响应，暂无匹配结果' },
      { source: 'kg', status: 'error', message: '内容服务请求失败' },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: '所有音乐平台暂时都没有返回结果', sourceStatuses }), { status: 502, headers: { 'Content-Type': 'application/json' } })))
    await expect(inspectMusicCatalogSources(['tx', 'kg'])).resolves.toEqual(sourceStatuses)
  })

  it('maps dynamic chart summaries and loads the configured detail count on demand', async () => {
    const track = {
      source: 'tx', title: '榜单歌曲', artist: '测试艺人', album: '测试专辑', durationSeconds: 180, cover: null,
      qualities: ['128k'], sizeBytesByQuality: { '128k': 1 },
      musicInfo: { songmid: 'chart-1', name: '榜单歌曲', singer: '测试艺人', albumName: '测试专辑', source: 'tx', interval: '03:00', types: [], _types: {}, typeUrl: {} },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ charts: [{ id: 'tx:26', name: 'QQ 热歌榜', description: 'QQ 音乐官方榜单', source: 'tx', updatedAt: '2026-07-14', cover: 'https://example.com/chart.jpg', updateFrequency: '每日更新', preview: [{ title: '榜单歌曲', artist: '测试艺人' }] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ chart: { id: 'tx:26', name: 'QQ 热歌榜', description: 'QQ 音乐官方榜单', source: 'tx', updatedAt: '2026-07-14', tracks: [track] } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const charts = await loadMusicCharts(['tx'])
    expect(charts[0]).toMatchObject({ id: 'official:tx:26', boardId: '26', source: 'tx', name: 'QQ 热歌榜', eyebrow: 'QQ', updatedAt: '2026-07-14', updateFrequency: '每日更新', provenance: 'live', tracks: [] })
    expect(charts[0].preview[0].title).toBe('榜单歌曲')
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://echora-cloud.lili.uno/v1/music/charts?sources=tx', expect.objectContaining({ signal: undefined }))
    const tracks = await loadMusicChartDetail(charts[0], 30)
    expect(tracks[0].title).toBe('榜单歌曲')
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://echora-cloud.lili.uno/v1/music/charts/tx/26?limit=30', expect.objectContaining({ signal: undefined }))
  })
})
