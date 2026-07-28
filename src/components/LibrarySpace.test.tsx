import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initialTracks } from '../testFixtures'
import type { SourceDiscoveryCatalog, SourceDiscoveryShelf } from '../sourceDiscovery'
import type { RuntimeCapabilities } from '../runtimeCapabilities'
import LibrarySpace from './LibrarySpace'

afterEach(cleanup)
beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('echora.playlists', JSON.stringify([
    { id: 'test-late-night', name: '深夜低照度', trackIds: [1, 3, 8, 12] },
    { id: 'test-weekend', name: '周末慢速', trackIds: [2, 6, 10] },
    { id: 'test-new-signals', name: '最近发现', trackIds: [5, 7, 9, 11] },
  ]))
})

const shelf = (id: string, name: string, eyebrow: string, kind: SourceDiscoveryShelf['kind']): SourceDiscoveryShelf => ({
  id,
  name,
  eyebrow,
  kind,
  query: name,
  description: `${name}的全音源策展说明。`,
  tracks: initialTracks.slice(0, 6),
})

const discoveryShelves: SourceDiscoveryShelf[] = [
    shelf('source-trending', '此刻热听', '跨源趋势', 'trend'),
    shelf('source-fresh', '新声抵达', '新作速递', 'fresh'),
    shelf('source-global', '世界流行', '全球视野', 'global'),
    shelf('source-focus', '安静专注', '低干扰场景', 'mood'),
    shelf('source-night', '深夜慢听', '夜间氛围', 'mood'),
    shelf('source-live', '现场能量', 'Live 现场', 'live'),
    shelf('source-classics', '经典重访', '时间留下的歌', 'classic'),
    shelf('source-lossless', '无损优选', '高规格音质', 'quality'),
]
const discoveryProviders: SourceDiscoveryCatalog['providers'] = [
    { source: 'tx', name: 'QQ 音乐', tracks: initialTracks.slice(0, 3) },
    { source: 'wy', name: '网易云音乐', tracks: initialTracks.slice(1, 4) },
    { source: 'kw', name: '酷我音乐', tracks: initialTracks.slice(2, 5) },
    { source: 'mg', name: '咪咕音乐', tracks: initialTracks.slice(3, 6) },
]
const discoveryCatalog: SourceDiscoveryCatalog = {
  shelves: discoveryShelves,
  providers: discoveryProviders,
  charts: [
    { id: 'official:tx:26', boardId: '26', source: 'tx', name: 'QQ 热歌榜', eyebrow: 'QQ 音乐', description: 'QQ 音乐官方榜单', category: 'platform', cover: initialTracks[0].cover, preview: [], tracks: initialTracks.slice(0, 6), updatedAt: '2026-07-14' },
    { id: 'official:tx:62', boardId: '62', source: 'tx', name: 'QQ 飙升榜', eyebrow: 'QQ 音乐', description: 'QQ 音乐官方榜单', category: 'platform', cover: initialTracks[0].cover, preview: [], tracks: initialTracks.slice(0, 6), updatedAt: '2026-07-14' },
    { id: 'official:tx:65', boardId: '65', source: 'tx', name: 'QQ 国风热歌榜', eyebrow: 'QQ 音乐', description: 'QQ 音乐官方榜单', category: 'platform', cover: initialTracks[0].cover, preview: [], tracks: initialTracks.slice(0, 6), updatedAt: '2026-07-14' },
    { id: 'official:wy:3778678', boardId: '3778678', source: 'wy', name: '网易云热歌榜', eyebrow: '网易云音乐', description: '网易云音乐官方榜单', category: 'platform', cover: initialTracks[0].cover, preview: [], tracks: initialTracks.slice(0, 6), updatedAt: '2026-07-14' },
  ],
  hotTracks: initialTracks.slice(0, 8),
  freshTracks: initialTracks.slice(2, 10),
  tracks: initialTracks,
  loadedAt: 1,
}

const desktopRuntime: RuntimeCapabilities = { kind: 'desktop', native: true, canControlWindow: true, canImportFolder: true, hasLocalLibrary: true, downloadBehavior: 'offline-library', canExportLocalFiles: true, localLibraryLabel: '下载内容保存在应用本地音乐中；也可以导入文件或音乐文件夹。', downloadSuccessLabel: '已保存到应用本地音乐', credentialStorageLabel: '本机' }

const renderLibrary = (downloadedTrackIds = [1], onSearchCatalog?: (query: string) => Promise<typeof initialTracks>, catalog = initialTracks, runtime?: RuntimeCapabilities) => {
  const actions = {
    onPlayTrack: vi.fn(),
    onPlayTracks: vi.fn(),
    onPlayNext: vi.fn(),
    onAddToQueue: vi.fn(),
    onDownloadTrack: vi.fn(),
    onRemoveDownload: vi.fn(),
    onExportLocalTracks: vi.fn(),
    onRemoveFromQueue: vi.fn(),
    onNotice: vi.fn(),
    onToggleLike: vi.fn(),
  }
  render(<LibrarySpace catalog={catalog} queueTracks={catalog.slice(0, 2)} downloadedTrackIds={downloadedTrackIds} activeTrackId={1} isPlaying likedTrackIds={[1]} onSearchCatalog={onSearchCatalog} onLoadDiscovery={vi.fn().mockResolvedValue(discoveryCatalog)} runtime={runtime} {...actions} />)
  return actions
}

const renderMobileLibrary = (navigationRequest: { key: number; type: 'home' | 'featured' | 'personal' | 'liked' | 'search' | 'queue' } = { key: 1, type: 'featured' }, onMobileNavigationLevelChange?: (level: 'root' | 'detail' | 'search') => void) => {
  const actions = {
    onPlayTrack: vi.fn(), onPlayTracks: vi.fn(), onPlayNext: vi.fn(), onAddToQueue: vi.fn(), onDownloadTrack: vi.fn(), onRemoveDownload: vi.fn(), onExportLocalTracks: vi.fn(), onRemoveFromQueue: vi.fn(), onNotice: vi.fn(), onToggleLike: vi.fn(),
  }
  render(<LibrarySpace mobile catalog={initialTracks} queueTracks={initialTracks.slice(0, 2)} downloadedTrackIds={[]} activeTrackId={initialTracks[0].id} isPlaying={false} likedTrackIds={[initialTracks[0].id]} onLoadDiscovery={vi.fn().mockResolvedValue(discoveryCatalog)} navigationRequest={navigationRequest} onMobileNavigationLevelChange={onMobileNavigationLevelChange} {...actions} />)
  return actions
}

describe('LibrarySpace playback actions', () => {
  it('starts a new profile without demo playlists', () => {
    localStorage.removeItem('echora.playlists')
    renderLibrary()
    expect(screen.queryByText('深夜低照度')).toBeNull()
    expect(screen.queryByText('周末慢速')).toBeNull()
  })

  it('plays a track when its primary title is clicked', () => {
    const actions = renderLibrary()
    fireEvent.click(screen.getByText('播放队列').closest('button')!)
    const title = screen.getByText('Slow Satellites')
    fireEvent.click(title.closest('button')!)
    expect(actions.onPlayTrack).toHaveBeenCalledWith(initialTracks[0], expect.objectContaining({
      tracks: initialTracks.slice(0, 2),
      context: expect.objectContaining({ kind: 'manual', title: '播放队列' }),
    }))
  })

  it('shows duration as a dedicated scannable column', () => {
    renderLibrary()
    fireEvent.click(screen.getByText('播放队列').closest('button')!)
    expect(screen.getByText('时长')).toBeTruthy()
    const row = screen.getByText('Slow Satellites').closest('.track-row')!
    expect(row.querySelector('.track-duration')?.textContent).toBe(initialTracks[0].duration)
  })

  it('groups multi-select actions into a stable toolbar', () => {
    renderLibrary()
    fireEvent.click(screen.getByText('播放队列').closest('button')!)
    fireEvent.click(screen.getByRole('button', { name: '选择 Slow Satellites' }))
    fireEvent.click(screen.getByRole('button', { name: '选择 Glass Hours' }))
    expect(screen.getByText('已选择 2 首')).toBeTruthy()
    expect(document.querySelector('.bulk-action-group')).toBeTruthy()
    expect(screen.getByLabelText('操作').querySelector('svg')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消选择' }))
    expect(screen.queryByText('已选择 2 首')).toBeNull()
  })

  it('exposes a distinct play-next action in the desktop context menu', () => {
    const actions = renderLibrary()
    fireEvent.click(screen.getByText('播放队列').closest('button')!)
    const title = screen.getByText('Glass Hours')
    fireEvent.contextMenu(title.closest('.track-row')!)
    fireEvent.click(screen.getByRole('menuitem', { name: '下一首播放' }))
    expect(actions.onPlayNext).toHaveBeenCalledWith(initialTracks[1])
    expect(actions.onPlayTrack).not.toHaveBeenCalled()
  })

  it('creates a playlist through the full editor dialog', () => {
    renderLibrary()
    fireEvent.click(screen.getByRole('button', { name: '新建歌单' }))
    fireEvent.change(screen.getByRole('textbox', { name: '歌单名称' }), { target: { value: '雨天收藏' } })
    fireEvent.click(screen.getByRole('button', { name: '创建歌单' }))
    expect(screen.getByRole('button', { name: /雨天收藏/ })).toBeTruthy()
  })

  it('keeps playlist tracks when they disappear from the transient catalog', async () => {
    renderLibrary()
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('echora.playlists') ?? '[]') as Array<{ id: string; trackSnapshots?: typeof initialTracks }>
      expect(stored.find((playlist) => playlist.id === 'test-late-night')?.trackSnapshots?.some((track) => track.id === 1)).toBe(true)
    })
    cleanup()

    renderLibrary([1], undefined, initialTracks.filter((track) => track.id !== 1))
    fireEvent.click(screen.getByText('深夜低照度').closest('button')!)
    expect(screen.getByText('Slow Satellites')).toBeTruthy()
  })

  it('renames an existing playlist from its context menu', () => {
    renderLibrary()
    const playlist = screen.getByText('深夜低照度').closest('button')!
    fireEvent.click(playlist)
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull()
    fireEvent.contextMenu(playlist)
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    fireEvent.change(screen.getByRole('textbox', { name: '歌单名称' }), { target: { value: '夜间专注' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    expect(screen.getByRole('button', { name: /夜间专注/ })).toBeTruthy()
  })

  it('explains downloads and optional imports in the local empty state', () => {
    renderLibrary([], undefined, initialTracks, desktopRuntime)
    fireEvent.click(screen.getByRole('button', { name: /本地音乐/ }))
    expect(screen.getByText('当前列表为空')).toBeTruthy()
    expect(screen.getByText('下载内容保存在应用本地音乐中；也可以导入文件或音乐文件夹。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '全选' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '返回首页' }))
    expect(screen.getByText('每日推荐')).toBeTruthy()
  })

  it('lets the browser own downloads instead of presenting an in-app local library', () => {
    renderLibrary([])
    expect(screen.queryByRole('button', { name: /本地音乐/ })).toBeNull()
    fireEvent.click(screen.getByText('播放队列').closest('button')!)
    expect(screen.getAllByTitle('下载文件').length).toBeGreaterThan(0)
  })

  it('counts only liked tracks that can still be restored', () => {
    const actions = {
      onPlayTrack: vi.fn(), onPlayTracks: vi.fn(), onPlayNext: vi.fn(), onAddToQueue: vi.fn(), onDownloadTrack: vi.fn(), onRemoveDownload: vi.fn(), onExportLocalTracks: vi.fn(), onRemoveFromQueue: vi.fn(), onNotice: vi.fn(), onToggleLike: vi.fn(),
    }
    render(<LibrarySpace catalog={initialTracks} queueTracks={[]} downloadedTrackIds={[]} activeTrackId={-1} isPlaying={false} likedTrackIds={[initialTracks[0].id, 999999]} onLoadDiscovery={vi.fn().mockResolvedValue(discoveryCatalog)} {...actions} />)
    expect(screen.getByRole('button', { name: '喜欢的音乐1' })).toBeTruthy()
  })

  it('provides a mobile personal hub instead of exposing the desktop sidebar as navigation', () => {
    const onMobileSectionChange = vi.fn()
    const actions = {
      onPlayTrack: vi.fn(), onPlayTracks: vi.fn(), onPlayNext: vi.fn(), onAddToQueue: vi.fn(), onDownloadTrack: vi.fn(), onRemoveDownload: vi.fn(), onExportLocalTracks: vi.fn(), onRemoveFromQueue: vi.fn(), onNotice: vi.fn(), onToggleLike: vi.fn(),
    }
    render(<LibrarySpace catalog={initialTracks} queueTracks={initialTracks.slice(0, 2)} downloadedTrackIds={[initialTracks[0].id]} activeTrackId={initialTracks[0].id} isPlaying={false} likedTrackIds={[initialTracks[0].id]} onLoadDiscovery={vi.fn().mockResolvedValue(discoveryCatalog)} runtime={desktopRuntime} navigationRequest={{ key: 1, type: 'personal' }} onMobileSectionChange={onMobileSectionChange} {...actions} />)

    expect(screen.getAllByText('我的音乐').length).toBeGreaterThan(0)
    expect(screen.getByText('收藏、离线内容、播放队列和歌单都在这里。')).toBeTruthy()
    expect(screen.getByText('1 首收藏')).toBeTruthy()
    expect(screen.getByText('1 首离线音乐')).toBeTruthy()
    expect(screen.getByText('2 首')).toBeTruthy()
    expect(screen.queryByText(/2 首 · 播放队列/)).toBeNull()
    expect(onMobileSectionChange).toHaveBeenLastCalledWith('mine')
  })

  it('groups mobile personal music into lists without duplicate sound or service shortcuts', () => {
    renderMobileLibrary({ key: 1, type: 'personal' })
    const mobileView = document.querySelector('.mobile-library-view') as HTMLElement

    expect(within(mobileView).getByText('我的音乐')).toBeTruthy()
    expect(within(mobileView).getByRole('button', { name: /喜欢的音乐/ })).toBeTruthy()
    expect(within(mobileView).getByRole('button', { name: /播放队列/ })).toBeTruthy()
    expect(mobileView.querySelector('.mobile-personal-list-section')).toBeTruthy()
    expect(mobileView.querySelector('.mobile-library-shortcuts')).toBeNull()
    expect(within(mobileView).queryByText('声音空间')).toBeNull()
    expect(within(mobileView).queryByText('音乐服务', { exact: true })).toBeNull()
  })

  it('reports mobile entity details so the product shell can hide its tab bar', async () => {
    const onMobileNavigationLevelChange = vi.fn()
    renderMobileLibrary({ key: 1, type: 'featured' }, onMobileNavigationLevelChange)

    const mobileView = document.querySelector('.mobile-library-view') as HTMLElement
    const collection = await within(mobileView).findByRole('button', { name: /经典重访/ })
    fireEvent.click(collection)
    await waitFor(() => expect(onMobileNavigationLevelChange).toHaveBeenLastCalledWith('detail'))

    fireEvent.click(within(mobileView).getByRole('button', { name: '返回精选' }))
    await waitFor(() => expect(onMobileNavigationLevelChange).toHaveBeenLastCalledWith('root'))
  })

  it('reports a mobile playlist as a detail page', async () => {
    const onMobileNavigationLevelChange = vi.fn()
    renderMobileLibrary({ key: 1, type: 'personal' }, onMobileNavigationLevelChange)

    const mobileView = document.querySelector('.mobile-library-view') as HTMLElement
    fireEvent.click(mobileView.querySelector<HTMLElement>('[data-playlist-id="test-late-night"] > button')!)
    await waitFor(() => expect(onMobileNavigationLevelChange).toHaveBeenLastCalledWith('detail'))

    fireEvent.click(within(mobileView).getByRole('button', { name: '返回我的' }))
    await waitFor(() => expect(onMobileNavigationLevelChange).toHaveBeenLastCalledWith('root'))
  })

  it('treats personal collections and search as pushed mobile layers', async () => {
    const onMobileNavigationLevelChange = vi.fn()
    renderMobileLibrary({ key: 1, type: 'liked' }, onMobileNavigationLevelChange)

    const mobileView = document.querySelector('.mobile-library-view') as HTMLElement
    await waitFor(() => expect(onMobileNavigationLevelChange).toHaveBeenLastCalledWith('detail'))
    fireEvent.click(within(mobileView).getByRole('button', { name: '在喜欢的音乐中搜索' }))
    await waitFor(() => expect(onMobileNavigationLevelChange).toHaveBeenLastCalledWith('search'))

    fireEvent.click(within(mobileView).getByRole('button', { name: '退出搜索' }))
    await waitFor(() => expect(onMobileNavigationLevelChange).toHaveBeenLastCalledWith('detail'))
    expect(within(mobileView).getByRole('heading', { name: '喜欢的音乐' })).toBeTruthy()
  })

  it('keeps the home curation shelf compact and artwork-led', async () => {
    renderLibrary()
    await waitFor(() => expect(document.querySelectorAll('.library-home-curation-card')).toHaveLength(5))
    const cards = Array.from(document.querySelectorAll('.library-home-curation-card'))
    expect(cards.every((card) => card.querySelectorAll('.library-home-curation-covers img').length === 3)).toBe(true)
    expect(cards.every((card) => card.querySelector('p') === null)).toBe(true)
  })

  it('keeps local export in the bulk-selection toolbar', () => {
    const actions = renderLibrary([initialTracks[0].id], undefined, initialTracks, desktopRuntime)
    fireEvent.click(screen.getByRole('button', { name: /本地音乐/ }))
    expect(screen.queryByRole('button', { name: '导出' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: `选择 ${initialTracks[0].title}` }))
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    expect(actions.onExportLocalTracks).toHaveBeenCalledWith([initialTracks[0]])
  })

  it('renders a source-wide music home instead of a personal catalog summary', async () => {
    renderLibrary([1], undefined, initialTracks, desktopRuntime)
    expect(document.querySelector('.library-main-header .workspace-pane-title em')).toBeNull()
    expect(screen.getByText('每日推荐')).toBeTruthy()
    expect(await screen.findByRole('button', { name: '播放今日推荐' })).toBeTruthy()
    expect(screen.getByText('全平台新热')).toBeTruthy()
    expect(screen.getByText('全网热听')).toBeTruthy()
    expect(screen.getByText('新歌速递')).toBeTruthy()
    expect(screen.getByRole('button', { name: '播放全网热听' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '播放新歌速递' })).toBeTruthy()
    expect(screen.getByText('榜单速览')).toBeTruthy()
    expect(screen.getByText('音乐平台')).toBeTruthy()
    expect(screen.getByText('专辑与作品集')).toBeTruthy()
    expect(document.querySelectorAll('.library-more-curations .library-home-curation-card')).toHaveLength(5)
    const dimensionCard = document.querySelector('.library-home-curation-card')!
    expect(dimensionCard.querySelector('.library-home-curation-covers')).toBeTruthy()
    expect(dimensionCard.querySelector('.library-home-curation-copy')).toBeTruthy()
    expect(dimensionCard.querySelector('.library-home-curation-covers .library-home-curation-copy')).toBeNull()
    expect(screen.queryByText('继续聆听')).toBeNull()
  })

  it('opens a source-backed curation dimension and plays it as a real collection', async () => {
    const actions = renderLibrary()
    fireEvent.click(screen.getByRole('button', { name: '精选' }))
    expect(await screen.findByText('精选主题')).toBeTruthy()
    expect(document.querySelector('.library-main-header .workspace-pane-title em')).toBeNull()
    expect(document.querySelectorAll('.library-curation-grid > button')).toHaveLength(discoveryShelves.filter((item) => item.kind !== 'quality').length)
    expect(document.querySelectorAll('.library-curation-grid > .is-leading')).toHaveLength(0)
    expect(screen.getByText('平台官方榜单')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: /新声抵达/ })[0])
    expect(screen.getByRole('button', { name: '播放全部' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '播放全部' }))
    expect(actions.onPlayTracks).toHaveBeenCalled()
  })

  it('provides a dedicated page for real platform charts', async () => {
    const actions = renderLibrary()
    fireEvent.click(screen.getByRole('button', { name: '榜单' }))
    expect(await screen.findByText('平台官方榜单')).toBeTruthy()
    expect(document.querySelector('.library-main-header .workspace-pane-title em')).toBeNull()
    expect(screen.getByRole('navigation', { name: '榜单平台' })).toBeTruthy()
    expect(screen.getAllByText('QQ 热歌榜').length).toBeGreaterThan(0)
    expect(screen.getByText('网易云热歌榜')).toBeTruthy()
    expect(document.querySelector('.library-chart-section.is-tx .library-chart-grid')?.classList.contains('is-count-3')).toBe(true)
    expect(document.querySelector('.library-chart-card > div')).toBeNull()
    fireEvent.click(document.querySelector('.library-chart-section.is-tx .library-chart-card > button')!)
    expect(screen.getByRole('button', { name: '播放全部' })).toBeTruthy()
    expect(document.querySelector('.library-main-header .workspace-pane-title em')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '播放全部' }))
    expect(actions.onPlayTracks).toHaveBeenCalled()
  })

  it('keeps featured and charts as peer tabs inside mobile discovery', async () => {
    renderMobileLibrary()
    const mobileView = document.querySelector('.mobile-library-view') as HTMLElement
    expect(await within(mobileView).findByRole('heading', { name: '发现' })).toBeTruthy()
    expect(await within(mobileView).findByText('精选主题')).toBeTruthy()

    const featuredScroller = mobileView.querySelector('.mobile-library-scroll') as HTMLElement
    featuredScroller.scrollTop = 480
    fireEvent.click(within(mobileView).getByRole('button', { name: '榜单' }))

    expect(await within(mobileView).findByRole('heading', { name: '发现' })).toBeTruthy()
    expect(within(mobileView).queryByRole('button', { name: '返回发现' })).toBeNull()
    expect(within(mobileView).getByRole('button', { name: '榜单' }).className).toContain('is-active')
    expect((mobileView.querySelector('.mobile-library-scroll') as HTMLElement).scrollTop).toBe(0)
    expect(await within(mobileView).findByText('QQ 热歌榜')).toBeTruthy()
  })

  it('starts mobile and desktop detail pages at the top after drilling down', async () => {
    renderMobileLibrary()
    const mobileView = document.querySelector('.mobile-library-view') as HTMLElement
    expect(await within(mobileView).findByText('精选主题')).toBeTruthy()
    const mobileScroller = mobileView.querySelector('.mobile-library-scroll') as HTMLElement
    mobileScroller.scrollTop = 520
    fireEvent.click(mobileView.querySelector('.mobile-theme-grid > button')!)
    expect((mobileView.querySelector('.mobile-library-scroll') as HTMLElement).scrollTop).toBe(0)

    cleanup()
    renderLibrary()
    fireEvent.click(screen.getByRole('button', { name: '精选' }))
    expect(await screen.findByText('精选主题')).toBeTruthy()
    const desktopScroller = document.querySelector('.library-home') as HTMLElement
    desktopScroller.scrollTop = 640
    fireEvent.click(document.querySelector('.library-curation-grid > button')!)
    expect((document.querySelector('.library-entity-page') as HTMLElement).scrollTop).toBe(0)
  })

  it('turns artist and album cells into navigable detail pages', () => {
    renderLibrary()
    fireEvent.click(screen.getByText('播放队列').closest('button')!)
    fireEvent.click(screen.getByTitle(`查看艺人 ${initialTracks[0].artist}`))
    expect(screen.getByText(`${initialTracks[0].artist} 的热门作品与专辑。`)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: `${initialTracks[0].album}1 首歌曲` }))
    expect(screen.getByRole('button', { name: `返回${initialTracks[0].artist}` })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: `返回${initialTracks[0].artist}` }))
    fireEvent.click(screen.getByRole('button', { name: '返回播放队列' }))
    fireEvent.click(screen.getByTitle(`查看专辑 ${initialTracks[0].album}`))
    expect(screen.getByText(`${initialTracks[0].artist} 的专辑作品。`)).toBeTruthy()
  })

  it('uses the remote catalog service for searches from the music home', async () => {
    const remoteResult = [{ ...initialTracks[0], id: 9001, title: '晴天', artist: '周杰伦', source: '酷我' as const }]
    const searchCatalog = vi.fn().mockResolvedValue(remoteResult)
    renderLibrary([1], searchCatalog)
    fireEvent.change(screen.getByRole('textbox', { name: '搜索音乐' }), { target: { value: '周杰伦' } })
    expect(screen.getByText('正在搜索多个音乐平台')).toBeTruthy()
    await waitFor(() => expect(searchCatalog).toHaveBeenCalledWith('周杰伦'))
    expect(await screen.findByText('晴天')).toBeTruthy()
  })

  it('opens album and artist entities from grouped search results', async () => {
    const remoteResult = [
      { ...initialTracks[0], id: 9101, title: '第一首', artist: '测试艺人', album: '测试专辑', source: '网易云' as const },
      { ...initialTracks[1], id: 9102, title: '第二首', artist: '测试艺人', album: '测试专辑', source: 'QQ' as const },
    ]
    const searchCatalog = vi.fn().mockResolvedValue(remoteResult)
    renderLibrary([1], searchCatalog)
    fireEvent.change(screen.getByRole('textbox', { name: '搜索音乐' }), { target: { value: '测试艺人' } })
    expect(await screen.findByText('第一首')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '专辑' }))
    fireEvent.click(screen.getByRole('button', { name: /测试专辑.*查看专辑/ }))
    expect(screen.getByText('测试艺人 的专辑作品。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '返回搜索结果' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '专辑' }).className).toContain('is-active'))
    fireEvent.click(screen.getByRole('button', { name: '艺人' }))
    fireEvent.click(await screen.findByRole('button', { name: /测试艺人.*查看艺人/ }))
    expect(screen.getByText('测试艺人 的热门作品与专辑。')).toBeTruthy()
  })

  it('keeps search scoped to the active collection', () => {
    renderLibrary([1], undefined, initialTracks, desktopRuntime)
    fireEvent.click(screen.getByRole('button', { name: /喜欢的音乐/ }))
    const input = screen.getByRole('textbox', { name: '在喜欢的音乐中搜索' })
    fireEvent.change(input, { target: { value: 'Glass Hours' } })
    expect(screen.getByText('当前列表中没有“Glass Hours”')).toBeTruthy()
    expect(screen.queryByText('搜索结果')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /本地音乐/ }))
    expect((screen.getByRole('textbox', { name: '在本地音乐中搜索' }) as HTMLInputElement).value).toBe('')

    fireEvent.click(screen.getByText('播放队列').closest('button')!)
    const queueSearch = screen.getByRole('textbox', { name: '在播放队列中搜索' })
    fireEvent.change(queueSearch, { target: { value: 'Glass Hours' } })
    expect(screen.getByText('Glass Hours')).toBeTruthy()

    fireEvent.click(screen.getByText('深夜低照度').closest('button')!)
    const playlistSearch = screen.getByRole('textbox', { name: '在深夜低照度中搜索' })
    fireEvent.change(playlistSearch, { target: { value: 'Blue Static' } })
    expect(screen.getByText('Blue Static')).toBeTruthy()
  })

  it('keeps local source management out of the local-library header', () => {
    renderLibrary([], undefined, initialTracks, desktopRuntime)
    fireEvent.click(screen.getByRole('button', { name: /本地音乐/ }))
    expect(screen.queryByRole('button', { name: /添加本地音乐/ })).toBeNull()
    expect(screen.queryByLabelText('选择本地音乐文件夹')).toBeNull()
  })

  it('asks for an explicit playlist instead of using a hidden target', () => {
    const actions = renderLibrary()
    fireEvent.click(screen.getByText('播放队列').closest('button')!)
    const title = screen.getByText('Slow Satellites')
    fireEvent.contextMenu(title.closest('.track-row')!)
    expect(screen.queryByRole('menuitem', { name: /加入“/ })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '添加到歌单…' }))
    expect(screen.getByRole('dialog', { name: '添加 Slow Satellites 到歌单' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /周末慢速.*添加/ }))
    expect(actions.onNotice).toHaveBeenCalledWith('已添加到“周末慢速”')
  })

  it('uses the current collection to provide removal actions', () => {
    const actions = renderLibrary()
    fireEvent.click(screen.getByText('播放队列').closest('button')!)
    fireEvent.contextMenu(screen.getByText('Glass Hours').closest('.track-row')!)
    fireEvent.click(screen.getByRole('menuitem', { name: '从播放队列移除' }))
    expect(actions.onRemoveFromQueue).toHaveBeenCalledWith(initialTracks[1])
  })

  it('keeps destructive actions out of the row toolbar', () => {
    renderLibrary([1], undefined, initialTracks, desktopRuntime)
    fireEvent.click(screen.getByRole('button', { name: /本地音乐/ }))
    expect(screen.getByRole('button', { name: '更多操作 Slow Satellites' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '删除下载' })).toBeNull()
    expect(screen.queryByRole('button', { name: /加入“/ })).toBeNull()
  })

  it('exports one local song from its more menu', () => {
    const localTrack = { ...initialTracks[0], localFileId: 'download:wy:slow', audioUrl: 'asset://local/slow.flac' }
    const actions = renderLibrary([localTrack.id], undefined, [localTrack, ...initialTracks.slice(1)], desktopRuntime)
    fireEvent.click(screen.getByRole('button', { name: /本地音乐/ }))
    fireEvent.click(screen.getByRole('button', { name: '更多操作 Slow Satellites' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '导出歌曲' }))
    expect(actions.onExportLocalTracks).toHaveBeenCalledWith([localTrack])
  })
})
