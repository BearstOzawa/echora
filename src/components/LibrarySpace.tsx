import { Album, BarChart3, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, CloudDownload, Compass, Copy, Disc3, Download, Flame, Globe2, HardDrive, Headphones, Heart, House, ListEnd, ListMusic, ListPlus, LoaderCircle, MoreHorizontal, Music2, Palette, PencilLine, Play, Plus, RadioTower, RefreshCw, Search, Settings2, Sparkles, Trash2, Trophy, UserRound, Waves, X } from 'lucide-react'
import { FormEvent, Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { collapseTrackVariants, groupAlbums, groupArtists } from '../libraryDiscovery'
import type { AlbumGroup, ArtistGroup } from '../libraryDiscovery'
import { buildDailyRecommendations, sourceDiscoveryFreshnessMs } from '../sourceDiscovery'
import type { SourceChart, SourceDiscoveryCatalog, SourceDiscoveryShelf, SourceProviderLane } from '../sourceDiscovery'
import { defaultContentSettings } from '../appSettings'
import type { ContentSettings } from '../appSettings'
import type { RuntimeCapabilities } from '../runtimeCapabilities'
import { detectRuntimeCapabilities } from '../runtimeCapabilities'
import type { Track } from '../types'
import { defaultPlaybackContext } from '../playbackContext'
import type { PlaybackContext, PlaybackSelection } from '../playbackContext'
import { sourceBrandKey } from '../sourceBrand'
import type { MobileLibraryNavigationLevel } from '../mobileNavigation'
import useLongPress from '../useLongPress'
import ContextMenu from './ContextMenu'
import type { ContextMenuItem } from './ContextMenu'
import ArtworkImage from './ArtworkImage'
import GlassSelect from './GlassSelect'
import { brandMarkPath, isBrandArtwork } from '../brandAssets'
import { downloadStateLabel } from '../downloadManager'
import type { TrackDownloadState } from '../downloadManager'
import SwipeActionRow from './SwipeActionRow'
import { queueCloudSnapshot } from '../cloudSync'

type Playlist = {
  id: string
  name: string
  trackIds: number[]
  trackSnapshots: Track[]
}

type Collection = 'home' | 'new' | 'featured' | 'charts' | 'providers' | 'liked' | 'local' | 'queue' | string
type ResultMode = 'tracks' | 'albums' | 'artists'
type PlaylistEditor = { mode: 'create' | 'rename'; playlistId?: string } | null
type PlaylistPicker = { trackIds: number[]; trackTitle: string } | null
export type MobileLibrarySection = 'music' | 'explore' | 'mine' | 'search'
export type LibraryNavigationRequest = { key: number; type: 'home' | 'featured' | 'personal' | 'liked' | 'daily' | 'search' | 'queue' } | { key: number; type: 'artist' | 'album'; track: Track }
type LibraryEntity = {
  type: 'album' | 'artist' | 'collection' | 'chart'
  id: string
  name: string
  eyebrow: string
  description: string
  cover: string
  tracks: Track[]
  artist?: string
  originQuery?: string
  originResultMode?: ResultMode
  originMobileSearchMode?: boolean
}

type Props = {
  mobile?: boolean
  catalog: Track[]
  queueTracks: Track[]
  playbackContext?: PlaybackContext
  downloadedTrackIds: number[]
  activeTrackId: number
  isPlaying: boolean
  likedTrackIds: number[]
  onToggleLike: (track: Track) => void
  onPlayTrack: (track: Track, selection?: PlaybackSelection) => void
  onPlayTracks: (tracks: Track[], context?: PlaybackContext) => void
  onPlayNext: (track: Track) => void
  onAddToQueue: (track: Track) => void
  onDownloadTrack: (track: Track) => void
  onCancelDownload?: (trackId: number) => void
  onRemoveDownload: (track: Track) => void
  onExportLocalTracks: (tracks: Track[]) => void
  onRemoveFromQueue: (track: Track) => void
  onNotice: (message: string) => void
  onSearchCatalog?: (query: string) => Promise<Track[]>
  onLoadDiscovery?: (force?: boolean, onProgress?: (discovery: SourceDiscoveryCatalog) => void) => Promise<SourceDiscoveryCatalog>
  onLoadChart?: (chart: SourceChart) => Promise<Track[]>
  busyTrackIds?: number[]
  downloadStates?: Record<number, TrackDownloadState>
  runtime?: RuntimeCapabilities
  contentSettings?: ContentSettings
  navigationRequest?: LibraryNavigationRequest | null
  onMobileSectionChange?: (section: MobileLibrarySection) => void
  onMobileNavigationLevelChange?: (level: MobileLibraryNavigationLevel) => void
  onMobileTitleChange?: (title: string) => void
  onOpenSettings?: () => void
  onOpenAccount?: () => void
  onOpenSources?: () => void
  onOpenTheme?: () => void
  userName?: string
  profileCaption?: string
  sourcePhase?: 'checking' | 'ready' | 'degraded' | 'error'
}

const legacyDemoPlaylists = new Map([
  ['late-night', '深夜低照度'],
  ['weekend', '周末慢速'],
  ['new-signals', '最近发现'],
])

const orderChartsForDisplay = (charts: SourceChart[]) => charts

const discoveryTrackKey = (track: Track) => `${track.title}\u0000${track.artist}`
  .toLocaleLowerCase()
  .replace(/[\s·・,.，。'"“”‘’()（）\[\]【】_-]/g, '')

const withoutSeenTracks = (tracks: Track[], seen: Set<string>, limit = Number.POSITIVE_INFINITY) => {
  const result: Track[] = []
  collapseTrackVariants(tracks).forEach((track) => {
    const key = discoveryTrackKey(track)
    if (seen.has(key) || result.length >= limit) return
    seen.add(key)
    result.push(track)
  })
  return result
}

const fillDiscoveryTracks = (preferred: Track[], fallback: Track[], excluded: Set<string>, limit: number) => {
  const result = withoutSeenTracks(preferred, new Set(excluded), limit)
  if (result.length >= limit) return result

  const sectionKeys = new Set(result.map(discoveryTrackKey))
  return [...result, ...withoutSeenTracks(fallback, sectionKeys, limit - result.length)]
}

const isTrackSnapshot = (value: unknown): value is Track => {
  if (!value || typeof value !== 'object') return false
  const track = value as Partial<Track>
  return typeof track.id === 'number'
    && typeof track.title === 'string'
    && typeof track.artist === 'string'
    && typeof track.album === 'string'
    && typeof track.source === 'string'
}

const playlistSnapshot = (track: Track): Track => ({
  ...track,
  audioUrl: undefined,
  remote: track.remote ? { ...track.remote, resolvedQuality: undefined, resolvedAt: undefined, playbackToken: undefined } : undefined,
})

const readPlaylists = (): Playlist[] => {
  try {
    const stored = JSON.parse(localStorage.getItem('echora.playlists') ?? 'null') as unknown
    if (!Array.isArray(stored)) return []
    const playlists = stored.flatMap((value): Playlist[] => {
      if (!value || typeof value !== 'object') return []
      const playlist = value as Partial<Playlist>
      if (typeof playlist.id !== 'string' || typeof playlist.name !== 'string' || !Array.isArray(playlist.trackIds)) return []
      if (legacyDemoPlaylists.get(playlist.id) === playlist.name) return []
      const trackIds = playlist.trackIds.filter((id): id is number => typeof id === 'number' && Number.isInteger(id))
      const trackSnapshots = Array.isArray(playlist.trackSnapshots)
        ? playlist.trackSnapshots.filter(isTrackSnapshot).filter((track) => trackIds.includes(track.id)).map(playlistSnapshot)
        : []
      return [{ id: playlist.id, name: playlist.name, trackIds: Array.from(new Set(trackIds)), trackSnapshots }]
    })
    return playlists
  } catch {
    return []
  }
}

export default function LibrarySpace({ mobile = false, catalog, queueTracks, playbackContext = defaultPlaybackContext, downloadedTrackIds, activeTrackId, isPlaying, likedTrackIds, onToggleLike, onPlayTrack, onPlayTracks, onPlayNext, onAddToQueue, onDownloadTrack, onCancelDownload, onRemoveDownload, onExportLocalTracks, onRemoveFromQueue, onNotice, onSearchCatalog, onLoadDiscovery, onLoadChart, busyTrackIds = [], downloadStates = {}, runtime = detectRuntimeCapabilities(), contentSettings = defaultContentSettings, navigationRequest, onMobileSectionChange, onMobileNavigationLevelChange, onMobileTitleChange, onOpenSettings, onOpenAccount, onOpenSources, onOpenTheme, userName = '登录 Echora', profileCaption = '账户、设备与安全', sourcePhase = 'checking' }: Props) {
  const [playlists, setPlaylists] = useState<Playlist[]>(readPlaylists)
  const [activeCollection, setActiveCollection] = useState<Collection>('home')
  const [query, setQuery] = useState('')
  const [mobileSearchMode, setMobileSearchMode] = useState(false)
  const [resultMode, setResultMode] = useState<ResultMode>('tracks')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [playlistEditor, setPlaylistEditor] = useState<PlaylistEditor>(null)
  const [playlistPicker, setPlaylistPicker] = useState<PlaylistPicker>(null)
  const [pendingPlaylistTrackIds, setPendingPlaylistTrackIds] = useState<number[]>([])
  const [playlistName, setPlaylistName] = useState('')
  const [targetPlaylistId, setTargetPlaylistId] = useState(playlists[0]?.id ?? '')
  const [trackMenu, setTrackMenu] = useState<{ x: number; y: number; track: Track; selection?: PlaybackSelection } | null>(null)
  const [playlistMenu, setPlaylistMenu] = useState<{ x: number; y: number; playlist: Playlist } | null>(null)
  const [remoteSearchTracks, setRemoteSearchTracks] = useState<Track[]>([])
  const [searchStatus, setSearchStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [searchError, setSearchError] = useState('')
  const [activeEntity, setActiveEntity] = useState<LibraryEntity | null>(null)
  const [entityHistory, setEntityHistory] = useState<LibraryEntity[]>([])
  const [entityLoading, setEntityLoading] = useState(false)
  const [entityError, setEntityError] = useState('')
  const [chartSource, setChartSource] = useState<'all' | SourceChart['source']>('all')
  const [chartTrackCache, setChartTrackCache] = useState<Record<string, Track[]>>({})
  const [personalHeaderCondensed, setPersonalHeaderCondensed] = useState(false)
  const [mobileHeaderCondensed, setMobileHeaderCondensed] = useState(false)
  const [mobileHeaderRaised, setMobileHeaderRaised] = useState(false)
  const [mobileHomeSection, setMobileHomeSection] = useState<'recommended' | 'new' | 'collections' | 'providers'>('recommended')
  const [mobileNewFeed, setMobileNewFeed] = useState<'trending' | 'latest'>('trending')
  const [mobileProviderSource, setMobileProviderSource] = useState<SourceProviderLane['source'] | null>(null)
  const [sourceDiscovery, setSourceDiscovery] = useState<SourceDiscoveryCatalog | null>(null)
  const [discoveryStatus, setDiscoveryStatus] = useState<'loading' | 'ready' | 'error'>(sourcePhase === 'checking' || onLoadDiscovery ? 'loading' : 'error')
  const [discoveryError, setDiscoveryError] = useState(sourcePhase === 'checking' || onLoadDiscovery ? '' : '音乐内容暂时无法加载')
  const discoveryRequestRef = useRef(0)
  const discoveryLoadedAtRef = useRef(0)
  const searchRequestRef = useRef(0)
  const entityRequestRef = useRef(0)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const mobileViewRef = useRef<HTMLDivElement | null>(null)
  const desktopContentRef = useRef<HTMLDivElement | null>(null)
  const queueTrackIds = queueTracks.map((track) => track.id)
  const activePlaylist = playlists.find((playlist) => playlist.id === activeCollection)
  const mobileNavigationLevel: MobileLibraryNavigationLevel = mobileSearchMode
    ? 'search'
    : activeEntity || activePlaylist || activeCollection === 'liked' || activeCollection === 'local' || activeCollection === 'downloads' || activeCollection === 'queue'
      ? 'detail'
      : 'root'

  useEffect(() => {
    localStorage.setItem('echora.playlists', JSON.stringify(playlists))
    queueCloudSnapshot('playlists', 'main')
  }, [playlists])
  useEffect(() => {
    const applyCloudPlaylists = () => setPlaylists(readPlaylists())
    window.addEventListener('echora:cloud-data-applied', applyCloudPlaylists)
    return () => window.removeEventListener('echora:cloud-data-applied', applyCloudPlaylists)
  }, [])
  useEffect(() => setSelectedIds([]), [activeCollection, activeEntity, resultMode, query])
  useEffect(() => {
    setMobileHeaderCondensed(false)
    setMobileHeaderRaised(false)
  }, [activeCollection, activeEntity?.id, mobileSearchMode])
  useEffect(() => setMobileHomeSection('recommended'), [activeCollection])
  useEffect(() => {
    const section: MobileLibrarySection = mobileSearchMode
      ? 'search'
      : activeCollection === 'home'
      ? 'music'
      : activeCollection === 'featured' || activeCollection === 'charts'
        ? 'explore'
        : 'mine'
    onMobileSectionChange?.(section)
  }, [activeCollection, mobileSearchMode, onMobileSectionChange])
  useEffect(() => {
    if (!mobile) return
    onMobileNavigationLevelChange?.(mobileNavigationLevel)
  }, [mobile, mobileNavigationLevel, onMobileNavigationLevelChange])
  useEffect(() => () => {
    if (mobile) onMobileNavigationLevelChange?.('root')
  }, [mobile, onMobileNavigationLevelChange])
  useLayoutEffect(() => {
    const selectors = '.mobile-library-scroll, .library-home, .library-entity-page, .track-table-body'
    ;[mobileViewRef.current, desktopContentRef.current].forEach((root) => {
      root?.querySelectorAll<HTMLElement>(selectors).forEach((scroller) => { scroller.scrollTop = 0 })
      root?.querySelectorAll<HTMLElement>('.mobile-card-rail, .mobile-chart-rail').forEach((scroller) => { scroller.scrollLeft = 0 })
    })
  }, [activeCollection, activeEntity?.id, discoveryStatus, mobileSearchMode, resultMode])
  const refreshDiscovery = (force = false) => {
    if (!onLoadDiscovery) return
    const requestId = discoveryRequestRef.current + 1
    discoveryRequestRef.current = requestId
    setDiscoveryStatus('loading')
    setDiscoveryError('')
    void onLoadDiscovery(force, (discovery) => {
      if (discoveryRequestRef.current !== requestId) return
      setSourceDiscovery(discovery)
      discoveryLoadedAtRef.current = discovery.loadedAt
    }).then((discovery) => {
      if (discoveryRequestRef.current !== requestId) return
      setSourceDiscovery(discovery)
      discoveryLoadedAtRef.current = discovery.loadedAt
      setDiscoveryStatus('ready')
    }).catch((error: unknown) => {
      if (discoveryRequestRef.current !== requestId) return
      if (sourcePhase === 'checking') {
        setDiscoveryStatus('loading')
        setDiscoveryError('')
        return
      }
      setDiscoveryStatus('error')
      setDiscoveryError(error instanceof Error ? error.message : '音乐内容暂时无法加载')
    })
  }
  useEffect(() => {
    refreshDiscovery()
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - discoveryLoadedAtRef.current >= sourceDiscoveryFreshnessMs) refreshDiscovery(true)
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      discoveryRequestRef.current += 1
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [onLoadDiscovery, sourcePhase])
  useEffect(() => {
    if (!sourceDiscovery || discoveryStatus !== 'ready') return
    const remaining = sourceDiscoveryFreshnessMs - (Date.now() - sourceDiscovery.loadedAt)
    const timer = window.setTimeout(() => {
      if (document.visibilityState === 'visible') refreshDiscovery(true)
    }, Math.max(1000, remaining))
    return () => window.clearTimeout(timer)
  }, [discoveryStatus, sourceDiscovery?.loadedAt, onLoadDiscovery])
  useEffect(() => {
    const catalogById = new Map(catalog.map((track) => [track.id, track]))
    setPlaylists((current) => {
      let changed = false
      const next = current.map((playlist) => {
        const snapshotIds = new Set(playlist.trackSnapshots.map((track) => track.id))
        const missingSnapshots = playlist.trackIds.flatMap((id) => {
          const track = catalogById.get(id)
          return track && !snapshotIds.has(id) ? [playlistSnapshot(track)] : []
        })
        if (!missingSnapshots.length) return playlist
        changed = true
        return { ...playlist, trackSnapshots: [...playlist.trackSnapshots, ...missingSnapshots] }
      })
      return changed ? next : current
    })
  }, [catalog])

  const likedIds = likedTrackIds
  useEffect(() => {
    if (!playlistEditor && !playlistPicker) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setPlaylistEditor(null)
      setPlaylistPicker(null)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [playlistEditor, playlistPicker])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matchesQuery = (track: Track) => {
    if (!normalizedQuery) return true
    return [track.title, track.artist, track.album, track.source].some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
  }

  const targetPlaylists = activePlaylist ? playlists.filter((playlist) => playlist.id !== activePlaylist.id) : playlists
  const effectiveTargetPlaylistId = targetPlaylists.some((playlist) => playlist.id === targetPlaylistId) ? targetPlaylistId : targetPlaylists[0]?.id ?? ''
  const sourceTracks = sourceDiscovery?.tracks ?? []
  const remoteSearchDisplayTracks = useMemo(() => collapseTrackVariants(remoteSearchTracks), [remoteSearchTracks])
  const catalogById = useMemo(() => new Map(catalog.map((track) => [track.id, track])), [catalog])
  const downloadTaskIds = useMemo(() => new Set(Object.values(downloadStates).filter((state) => state.phase !== 'complete').map((state) => state.trackId)), [downloadStates])
  const downloadTaskTracks = useMemo(() => Object.values(downloadStates)
    .filter((state) => state.phase !== 'complete' && state.track)
    .map((state) => state.track!), [downloadStates])
  const collectionTracks = useMemo(() => {
    if (activeEntity) return activeEntity.tracks
    if (activeCollection === 'home') return normalizedQuery && onSearchCatalog ? remoteSearchDisplayTracks : catalog
    if (activeCollection === 'new' || activeCollection === 'featured' || activeCollection === 'charts' || activeCollection === 'providers') return sourceTracks
    if (activeCollection === 'liked') return catalog.filter((track) => likedIds.includes(track.id))
    if (activeCollection === 'local') return catalog.filter((track) => downloadedTrackIds.includes(track.id))
    if (activeCollection === 'downloads') return Array.from(new Map<number, Track>([
      ...downloadTaskTracks,
      ...catalog.filter((track) => downloadTaskIds.has(track.id)),
    ].map((track) => [track.id, track])).values())
    if (activeCollection === 'queue') return queueTracks
    if (!activePlaylist) return []
    const snapshotsById = new Map(activePlaylist.trackSnapshots.map((track) => [track.id, track]))
    return activePlaylist.trackIds.map((id) => catalogById.get(id) ?? snapshotsById.get(id)).filter((track): track is Track => Boolean(track))
  }, [activeCollection, activeEntity, activePlaylist, catalog, catalogById, downloadedTrackIds, downloadTaskIds, downloadTaskTracks, likedIds, normalizedQuery, onSearchCatalog, queueTracks, remoteSearchDisplayTracks, sourceTracks])
  const visibleTracks = useMemo(() => {
    if (!normalizedQuery) return collectionTracks
    if (!activeEntity && activeCollection === 'home' && onSearchCatalog) return collectionTracks
    return collectionTracks.filter(matchesQuery)
  }, [activeCollection, activeEntity, collectionTracks, normalizedQuery, onSearchCatalog])
  const selectedTracks = useMemo(() => {
    const selected = new Set(selectedIds)
    return visibleTracks.filter((track) => selected.has(track.id))
  }, [selectedIds, visibleTracks])

  useEffect(() => {
    if (activeEntity || activeCollection !== 'home' || !normalizedQuery || !onSearchCatalog) {
      setSearchStatus('idle')
      setSearchError('')
      return
    }
    const requestId = searchRequestRef.current + 1
    searchRequestRef.current = requestId
    setSearchStatus('loading')
    setSearchError('')
    setRemoteSearchTracks([])
    const timer = window.setTimeout(() => {
      void onSearchCatalog(query.trim()).then((results) => {
        if (searchRequestRef.current !== requestId) return
        setRemoteSearchTracks(results)
        setSearchStatus('idle')
      }).catch((error: unknown) => {
        if (searchRequestRef.current !== requestId) return
        setRemoteSearchTracks([])
        setSearchStatus('error')
        setSearchError(error instanceof Error ? error.message : '搜索音乐失败')
      })
    }, 360)
    return () => window.clearTimeout(timer)
  }, [activeCollection, activeEntity, normalizedQuery, onSearchCatalog, query])

  const groupingSource = activeCollection === 'home' && query && !activeEntity ? visibleTracks : catalog
  const albumGroups = useMemo(() => groupAlbums(groupingSource), [groupingSource])
  const artistGroups = useMemo(() => groupArtists(groupingSource), [groupingSource])
  const sourceShelves = sourceDiscovery?.shelves ?? []
  const sourceProviders = sourceDiscovery?.providers ?? []
  const sourceCharts = sourceDiscovery?.charts ?? []
  const hotTracks = sourceDiscovery?.hotTracks ?? []
  const freshTracks = sourceDiscovery?.freshTracks ?? []
  const freshTimeline = useMemo(() => collapseTrackVariants(freshTracks), [freshTracks])
  const hotTimeline = useMemo(() => collapseTrackVariants(hotTracks), [hotTracks])
  const newReleaseLeadTrack = freshTimeline[0] ?? hotTimeline[0]
  const newReleaseRailTracks = newReleaseLeadTrack ? freshTimeline.filter((track) => discoveryTrackKey(track) !== discoveryTrackKey(newReleaseLeadTrack)).slice(0, 6) : freshTimeline.slice(0, 6)
  const newReleaseRailKeys = new Set(newReleaseRailTracks.map(discoveryTrackKey))
  if (newReleaseLeadTrack) newReleaseRailKeys.add(discoveryTrackKey(newReleaseLeadTrack))
  const recentReleaseTracks = freshTimeline.filter((track) => !newReleaseRailKeys.has(discoveryTrackKey(track))).slice(0, 8)
  const latestFeedTracks = recentReleaseTracks.length ? recentReleaseTracks : newReleaseRailTracks
  const trendingTracks = withoutSeenTracks(hotTimeline, new Set(freshTimeline.map(discoveryTrackKey)), 8)
  const availableSourceProviders = sourceProviders.filter((provider) => provider.available !== false && provider.tracks.length > 0)
  const activeProvider = availableSourceProviders.find((provider) => provider.source === mobileProviderSource) ?? availableSourceProviders[0]
  const activeMobileProvider = activeProvider
  const spotlightShelf = sourceShelves.find((shelf) => shelf.kind !== 'quality')
  const spotlightTrack = spotlightShelf?.tracks[0]
  const moodShelves = sourceShelves.filter((shelf) => shelf.kind === 'mood' || shelf.kind === 'live')
  const featuredShelves = sourceShelves.filter((shelf) => shelf.kind !== 'quality')
  const curatedCollectionGroups = [
    { id: 'current', label: '新鲜策划', kinds: ['trend', 'fresh', 'global'] },
    { id: 'scene', label: '场景与情绪', kinds: ['mood', 'live'] },
    { id: 'lasting', label: '经典与风格', kinds: ['classic', 'style', 'soundtrack'] },
  ].map((group) => ({ ...group, shelves: featuredShelves.filter((shelf) => shelf.id !== spotlightShelf?.id && group.kinds.includes(shelf.kind) && shelf.tracks.length) })).filter((group) => group.shelves.length)
  const visibleMobileNewFeed = trendingTracks.length ? mobileNewFeed : 'latest'
  const likedCatalogTracks = useMemo(() => catalog.filter((track) => likedIds.includes(track.id)), [catalog, likedIds])
  const recommendationSignals = contentSettings.personalizedRecommendations ? likedCatalogTracks : []
  const hasPersonalizationSignals = recommendationSignals.length > 0
  const dailyTracks = useMemo(() => buildDailyRecommendations(sourceShelves, recommendationSignals, new Date(), contentSettings.featuredTrackLimit, sourceProviders.map((provider) => provider.source)), [contentSettings.featuredTrackLimit, contentSettings.personalizedRecommendations, likedCatalogTracks, sourceProviders, sourceShelves])
  const homeFreshPreviewTracks = useMemo(() => {
    const seen = new Set(dailyTracks.slice(0, 6).map(discoveryTrackKey))
    const candidates = [...freshTimeline, ...hotTimeline]
    return fillDiscoveryTracks(candidates, candidates, seen, 6)
  }, [dailyTracks, freshTimeline, hotTimeline])
  const homeRecommendationTracks = useMemo(() => {
    const seen = new Set([...dailyTracks.slice(0, 6), ...homeFreshPreviewTracks].map(discoveryTrackKey))
    const candidates = [...featuredShelves.flatMap((shelf) => shelf.tracks), ...sourceTracks]
    return fillDiscoveryTracks(candidates, candidates, seen, 6)
  }, [dailyTracks, featuredShelves, homeFreshPreviewTracks, sourceTracks])
  const homeFeaturedShelves = featuredShelves.filter((shelf) => shelf.id !== spotlightShelf?.id).slice(0, 8)
  const homeAlbumPicks = useMemo(() => groupAlbums(collapseTrackVariants([
    ...homeRecommendationTracks,
    ...freshTimeline,
    ...dailyTracks,
    ...sourceTracks,
  ])).slice(0, 8), [dailyTracks, freshTimeline, homeRecommendationTracks, sourceTracks])
  const collectionListeningTracks = useMemo(() => {
    const spotlightKeys = new Set((spotlightShelf?.tracks ?? []).slice(0, 4).map(discoveryTrackKey))
    const candidates = featuredShelves.filter((shelf) => shelf.id !== spotlightShelf?.id).flatMap((shelf) => shelf.tracks)
    return fillDiscoveryTracks(candidates, candidates, spotlightKeys, 8)
  }, [featuredShelves, spotlightShelf])
  const dailyRecommendationCopy = hasPersonalizationSignals ? '随收藏与日期更新' : '随日期更新'
  const chartSourceNames: Record<SourceChart['source'], string> = { tx: 'QQ 音乐', wy: '网易云音乐', kw: '酷我音乐', kg: '酷狗音乐', mg: '咪咕音乐' }
  const chartSectionDefinitions = [...new Set(sourceCharts.map((chart) => chart.source))].map((id) => ({ id, name: chartSourceNames[id] }))
  const availableChartSections = chartSectionDefinitions.flatMap((section) => {
    const charts = orderChartsForDisplay(sourceCharts.filter((chart) => chart.source === section.id))
    return charts.length ? [{ ...section, charts }] : []
  })
  const homeCharts = availableChartSections.flatMap((section) => section.charts.slice(0, 1))
  const leadingChart = homeCharts[0] ?? orderChartsForDisplay(sourceCharts)[0]
  const chartSections = availableChartSections.flatMap((section) => {
    if (chartSource !== 'all' && chartSource !== section.id) return []
    return [{ ...section, charts: chartSource === 'all' ? section.charts.slice(0, 4) : section.charts }]
  })
  const activeLeadingChart = chartSource === 'all' ? leadingChart : availableChartSections.find((section) => section.id === chartSource)?.charts[0]
  const activeProviderAlbums = useMemo(() => groupAlbums(activeProvider?.tracks ?? []).slice(0, 8), [activeProvider])
  const activeProviderCharts = useMemo(() => activeProvider ? orderChartsForDisplay(sourceCharts.filter((chart) => chart.source === activeProvider.source)).slice(0, 4) : [], [activeProvider, sourceCharts])

  const chartArtworkTracks = (chart: SourceChart, overrideTracks?: Track[]) => {
    const cacheKey = `${chart.id}:${contentSettings.chartTrackLimit}`
    const chartTracks = overrideTracks?.length
      ? overrideTracks
      : chartTrackCache[cacheKey]?.length
        ? chartTrackCache[cacheKey]
        : chart.tracks
    const providerTracks = sourceProviders.find((provider) => provider.source === chart.source)?.tracks ?? []
    const platformTracks = sourceTracks.filter((track) => sourceBrandKey(track.source) === chart.source)
    const candidates = chartTracks.length ? chartTracks : providerTracks.length ? providerTracks : platformTracks
    const siblingIndex = Math.max(0, sourceCharts.filter((item) => item.source === chart.source).findIndex((item) => item.id === chart.id))
    const rotated = chartTracks.length || candidates.length < 2
      ? candidates
      : [...candidates.slice(siblingIndex % candidates.length), ...candidates.slice(0, siblingIndex % candidates.length)]
    return Array.from(new Map(rotated
      .filter((track) => !isBrandArtwork(track.cover))
      .map((track) => [track.cover, track])).values()).slice(0, 3)
  }

  const chartCover = (chart: SourceChart, overrideTracks?: Track[]) => !isBrandArtwork(chart.cover)
    ? chart.cover
    : chartArtworkTracks(chart, overrideTracks)[0]?.cover ?? brandMarkPath

  const renderChartArtwork = (chart: SourceChart, eager = false, overrideTracks?: Track[]) => {
    if (!isBrandArtwork(chart.cover)) {
      return <span className="chart-artwork-composition is-count-1"><ArtworkImage src={chart.cover} alt="" loading={eager ? 'eager' : 'lazy'} /></span>
    }
    const artworkTracks = chartArtworkTracks(chart, overrideTracks)
    if (artworkTracks.length) {
      return <span className={`chart-artwork-composition is-count-${artworkTracks.length}`}>{artworkTracks.map((track, index) => <ArtworkImage key={`${chart.id}:artwork:${track.cover}`} src={track.cover} alt="" loading={eager && index === 0 ? 'eager' : 'lazy'} />)}</span>
    }
    const providerLabel = chart.eyebrow.replace(/\s*音乐$/, '') || '榜单'
    const chartLabel = chart.name.replace(/QQ|网易云|酷我|酷狗|咪咕|音乐|榜单/g, '').trim().slice(0, 4) || '排行'
    return <span className="chart-artwork-placeholder" aria-hidden="true"><i>{providerLabel}</i><b>{chartLabel}</b></span>
  }

  const collectionTitle = activeEntity?.name ?? (activeCollection === 'home' ? (query ? `“${query}”的结果` : '推荐') : activeCollection === 'new' ? '新热' : activeCollection === 'featured' ? '选集' : activeCollection === 'charts' ? '榜单' : activeCollection === 'providers' ? '平台' : activeCollection === 'personal' ? '我的音乐' : activeCollection === 'liked' ? '喜欢的音乐' : activeCollection === 'local' ? '本地音乐' : activeCollection === 'downloads' ? '下载管理' : activeCollection === 'queue' ? '播放队列' : activePlaylist?.name ?? '歌单')
  const collectionKind = activeEntity?.eyebrow ?? (activeCollection === 'home' ? (query ? '音乐搜索' : '音乐首页') : activeCollection === 'new' ? '新作与趋势' : activeCollection === 'featured' ? '主题选集' : activeCollection === 'charts' ? '平台榜单' : activeCollection === 'providers' ? '音乐来源' : activeCollection === 'personal' ? '个人音乐' : activeCollection === 'liked' ? '个人收藏' : activeCollection === 'local' ? '离线音乐' : activeCollection === 'downloads' ? '离线任务' : activeCollection === 'queue' ? '' : '我的歌单')
  useEffect(() => onMobileTitleChange?.(mobileSearchMode ? '搜索' : collectionTitle), [collectionTitle, mobileSearchMode, onMobileTitleChange])
  const currentPlaybackContext: PlaybackContext = activeCollection === 'queue'
    ? playbackContext
    : activePlaylist
      ? { kind: 'playlist', id: `playlist:${activePlaylist.id}`, title: activePlaylist.name }
      : activeCollection === 'liked'
        ? { kind: 'liked', id: 'liked', title: '喜欢的音乐' }
        : activeCollection === 'local'
          ? { kind: 'local', id: 'local', title: '本地音乐' }
          : activeEntity
            ? { kind: activeEntity.type === 'chart' || activeEntity.type === 'collection' ? 'discovery' : 'collection', id: `${activeEntity.type}:${activeEntity.id}`, title: activeEntity.name }
            : query
              ? { kind: 'search', id: `search:${normalizedQuery}`, title: `“${query.trim()}”的搜索结果` }
              : { kind: 'collection', id: String(activeCollection), title: collectionTitle }
  const playTrackInCurrentContext = (track: Track) => onPlayTrack(track, { tracks: visibleTracks, context: currentPlaybackContext })
  const playCurrentCollection = () => onPlayTracks(visibleTracks, currentPlaybackContext)
  const searchPlaceholder = !activeEntity && activeCollection === 'home' ? '搜索歌曲、专辑或艺人' : `在${collectionTitle}中搜索`
  const emptyTitle = searchStatus === 'loading'
    ? '正在搜索多个音乐平台'
    : searchStatus === 'error'
      ? '搜索暂时不可用'
      : query
        ? '未找到相关内容'
    : activeCollection === 'local'
      ? '当前列表为空'
      : activeCollection === 'downloads'
        ? '没有下载任务'
      : activeCollection === 'liked'
        ? '尚未收藏歌曲'
        : activeCollection === 'queue'
          ? '播放队列为空'
          : activePlaylist ? '歌单中暂无歌曲' : '暂无可显示的歌曲'
  const emptyDetail = searchStatus === 'loading'
    ? '正在寻找相关歌曲、专辑和艺人'
    : searchStatus === 'error'
      ? searchError
      : query
        ? activeCollection === 'home' && onSearchCatalog ? '可调整关键词或稍后重试' : `当前列表中没有“${query}”`
    : activeCollection === 'local'
      ? runtime.localLibraryLabel
      : activeCollection === 'downloads'
        ? '进行中或需要重试的任务将显示在这里'
      : activeCollection === 'liked'
        ? '收藏的歌曲将显示在此处'
        : activeCollection === 'queue'
          ? '播放列表、歌曲或应用一份会话编排后会显示在这里'
          : activePlaylist ? '可从音乐库将歌曲添加至此歌单' : '内容将在可用后自动显示'

  const selectCollection = (collection: Collection) => {
    entityRequestRef.current += 1
    setActiveEntity(null)
    setEntityHistory([])
    setEntityLoading(false)
    setEntityError('')
    setActiveCollection(collection)
    if (collection === 'home') setMobileHomeSection('recommended')
    setMobileSearchMode(false)
    setMobileHeaderCondensed(false)
    setMobileHeaderRaised(false)
    setResultMode('tracks')
    setQuery('')
  }

  const openPlaylistEditor = (mode: 'create' | 'rename', playlist?: Playlist, initialTrackIds: number[] = []) => {
    setPlaylistName(playlist?.name ?? '')
    setPendingPlaylistTrackIds(mode === 'create' ? initialTrackIds : [])
    setPlaylistEditor({ mode, playlistId: playlist?.id })
  }

  const savePlaylist = (event: FormEvent) => {
    event.preventDefault()
    const name = playlistName.trim()
    if (!name || !playlistEditor) return
    if (playlistEditor.mode === 'rename' && playlistEditor.playlistId) {
      setPlaylists((current) => current.map((playlist) => playlist.id === playlistEditor.playlistId ? { ...playlist, name } : playlist))
    } else {
      const nextPlaylist = {
        id: `playlist-${Date.now()}`,
        name,
        trackIds: pendingPlaylistTrackIds,
        trackSnapshots: pendingPlaylistTrackIds.flatMap((id) => {
          const track = catalogById.get(id)
          return track ? [playlistSnapshot(track)] : []
        }),
      }
      setPlaylists((current) => [...current, nextPlaylist])
      setTargetPlaylistId(nextPlaylist.id)
      if (pendingPlaylistTrackIds.length) onNotice(`已创建“${name}”并添加歌曲`)
      else setActiveCollection(nextPlaylist.id)
    }
    setPlaylistName('')
    setPendingPlaylistTrackIds([])
    setPlaylistEditor(null)
  }

  const addToPlaylist = (trackIds: number[], playlistId: string) => {
    const target = playlists.find((playlist) => playlist.id === playlistId)
    if (!target || !trackIds.length) return
    setPlaylists((current) => current.map((playlist) => {
      if (playlist.id !== playlistId) return playlist
      const snapshotIds = new Set(playlist.trackSnapshots.map((track) => track.id))
      const additions = trackIds.flatMap((id) => {
        const track = catalogById.get(id)
        return track && !snapshotIds.has(id) ? [playlistSnapshot(track)] : []
      })
      return { ...playlist, trackIds: Array.from(new Set([...playlist.trackIds, ...trackIds])), trackSnapshots: [...playlist.trackSnapshots, ...additions] }
    }))
    setPlaylistPicker(null)
    onNotice(`已添加到“${target.name}”`)
  }

  const removeFromPlaylist = (trackId: number) => {
    if (!activePlaylist) return
    setPlaylists((current) => current.map((playlist) => playlist.id === activePlaylist.id ? {
      ...playlist,
      trackIds: playlist.trackIds.filter((id) => id !== trackId),
      trackSnapshots: playlist.trackSnapshots.filter((track) => track.id !== trackId),
    } : playlist))
  }

  const toggleLike = (track: Track) => onToggleLike(track)
  const toggleSelected = (trackId: number) => setSelectedIds((current) => current.includes(trackId) ? current.filter((id) => id !== trackId) : [...current, trackId])
  const selectAll = () => setSelectedIds(selectedIds.length === visibleTracks.length ? [] : visibleTracks.map((track) => track.id))

  const openEntity = (entity: LibraryEntity, searchTerm?: string, matchesResult?: (track: Track) => boolean) => {
    const requestId = entityRequestRef.current + 1
    entityRequestRef.current = requestId
    if (activeEntity) setEntityHistory((current) => [...current, activeEntity])
    setActiveEntity({ ...entity, originQuery: query, originResultMode: resultMode, originMobileSearchMode: mobileSearchMode })
    setMobileSearchMode(false)
    setEntityLoading(Boolean(searchTerm && onSearchCatalog))
    setEntityError('')
    setQuery('')
    setResultMode('tracks')
    if (!searchTerm || !matchesResult || !onSearchCatalog) return
    void onSearchCatalog(searchTerm).then((results) => {
      if (entityRequestRef.current !== requestId) return
      const matchingTracks = results.filter(matchesResult)
      setActiveEntity((current) => current?.id === entity.id ? {
        ...current,
        tracks: collapseTrackVariants(Array.from(new Map([...current.tracks, ...matchingTracks].map((track) => [track.id, track])).values())),
      } : current)
    }).catch(() => {
      // The entity remains useful with tracks already present in the catalog.
    }).finally(() => {
      if (entityRequestRef.current === requestId) setEntityLoading(false)
    })
  }

  const openAlbum = (album: AlbumGroup) => openEntity({
    type: 'album',
    id: `album:${album.id}`,
    name: album.name,
    eyebrow: '专辑',
    description: `${album.artist} 的专辑作品。`,
    cover: album.cover,
    tracks: album.tracks,
    artist: album.artist,
  }, album.name, (track) => track.album === album.name && track.artist === album.artist)

  const openArtist = (artist: ArtistGroup) => openEntity({
    type: 'artist',
    id: `artist:${artist.id}`,
    name: artist.name,
    eyebrow: '艺人',
    description: `${artist.name} 的热门作品与专辑。`,
    cover: artist.cover,
    tracks: artist.tracks,
  }, artist.name, (track) => track.artist === artist.name)

  const openSourceShelf = (shelf: SourceDiscoveryShelf, type: 'collection' | 'chart' = 'collection') => {
    openEntity({
      type,
      id: shelf.id,
      name: shelf.name,
      eyebrow: type === 'chart' ? '热门榜单' : shelf.eyebrow,
      description: shelf.description,
      cover: shelf.tracks[0]?.cover ?? brandMarkPath,
      tracks: shelf.tracks,
    })
  }

  const openProviderLane = (provider: SourceProviderLane) => provider.tracks.length && openEntity({
    type: 'collection',
    id: `provider:${provider.source}`,
    name: provider.name,
    eyebrow: '平台精选',
    description: `沿着当前主题，继续浏览来自${provider.name}的作品。`,
    cover: provider.tracks[0]?.cover ?? brandMarkPath,
    tracks: provider.tracks,
  })

  const openSourceChart = (chart: SourceChart) => {
    const cacheKey = `${chart.id}:${contentSettings.chartTrackLimit}`
    const cachedTracks = chartTrackCache[cacheKey] ?? chart.tracks.slice(0, contentSettings.chartTrackLimit)
    openEntity({
      type: 'chart',
      id: chart.id,
      name: chart.name,
      eyebrow: chart.eyebrow,
      description: `由${chart.eyebrow}维护，曲目与排序随平台榜单更新。`,
      cover: chartCover(chart, cachedTracks),
      tracks: cachedTracks,
    })
    if (cachedTracks.length || !onLoadChart) return
    const requestId = entityRequestRef.current
    setEntityLoading(true)
    void onLoadChart(chart).then((tracks) => {
      if (entityRequestRef.current !== requestId) return
      setChartTrackCache((current) => ({ ...current, [cacheKey]: tracks }))
      setActiveEntity((current) => current?.id === chart.id ? { ...current, cover: chartCover(chart, tracks), tracks } : current)
      if (!tracks.length) setEntityError('这个榜单暂时没有返回歌曲')
    }).catch((error: unknown) => {
      if (entityRequestRef.current !== requestId) return
      setEntityError(error instanceof Error ? error.message : '榜单歌曲暂时不可用')
    }).finally(() => {
      if (entityRequestRef.current === requestId) setEntityLoading(false)
    })
  }

  const closeEntity = () => {
    entityRequestRef.current += 1
    const previousEntity = entityHistory[entityHistory.length - 1]
    if (previousEntity) {
      setEntityHistory((current) => current.slice(0, -1))
      setActiveEntity(previousEntity)
      setEntityLoading(false)
      setEntityError('')
      setQuery('')
      return
    }
    const originQuery = activeEntity?.originQuery ?? ''
    const originResultMode = activeEntity?.originResultMode ?? 'tracks'
    const originMobileSearchMode = activeEntity?.originMobileSearchMode ?? false
    setActiveEntity(null)
    setEntityLoading(false)
    setEntityError('')
    setQuery(originQuery)
    setResultMode(originResultMode)
    setMobileSearchMode(originMobileSearchMode)
  }

  const menuPosition = (element: HTMLElement) => {
    const bounds = element.getBoundingClientRect()
    return { x: bounds.left + 28, y: bounds.top + Math.min(bounds.height, 34) }
  }

  const duplicatePlaylist = (playlist: Playlist) => {
    const copy = { ...playlist, id: `playlist-${Date.now()}`, name: `${playlist.name} 副本`, trackIds: [...playlist.trackIds] }
    setPlaylists((current) => [...current, copy])
    setActiveCollection(copy.id)
    setTargetPlaylistId(copy.id)
  }

  const deletePlaylist = (playlist: Playlist) => {
    const remaining = playlists.filter((item) => item.id !== playlist.id)
    setPlaylists(remaining)
    if (activeCollection === playlist.id) setActiveCollection('home')
    if (targetPlaylistId === playlist.id) setTargetPlaylistId(remaining[0]?.id ?? '')
  }

  const playlistContextItems = (playlist: Playlist): ContextMenuItem[] => {
    const playlistTracks = playlist.trackIds.map((id) => catalog.find((track) => track.id === id)).filter((track): track is Track => Boolean(track))
    return [
      { label: '播放歌单', icon: Play, disabled: playlistTracks.length === 0, onSelect: () => onPlayTracks(playlistTracks, { kind: 'playlist', id: `playlist:${playlist.id}`, title: playlist.name }) },
      { label: '重命名', icon: PencilLine, onSelect: () => openPlaylistEditor('rename', playlist) },
      { label: '创建副本', icon: Copy, onSelect: () => duplicatePlaylist(playlist) },
      { label: '删除歌单', icon: Trash2, danger: true, onSelect: () => deletePlaylist(playlist) },
    ]
  }

  const contextItems = (track: Track, selection?: PlaybackSelection): ContextMenuItem[] => {
    const isLiked = likedIds.includes(track.id)
    const isDownloaded = downloadedTrackIds.includes(track.id)
    const isQueued = queueTrackIds.includes(track.id)
    const items: ContextMenuItem[] = [
      { label: '立即播放', icon: Play, onSelect: () => selection ? onPlayTrack(track, selection) : playTrackInCurrentContext(track) },
      { label: '下一首播放', icon: ListEnd, onSelect: () => onPlayNext(track) },
    ]
    if (!isQueued) items.push({ label: '加入播放队列', icon: ListPlus, separatorBefore: true, onSelect: () => onAddToQueue(track) })
    items.push({ label: '添加到歌单…', icon: ListPlus, separatorBefore: isQueued, onSelect: () => setPlaylistPicker({ trackIds: [track.id], trackTitle: track.title }) })
    items.push({ label: isLiked ? '取消喜欢' : '加入喜欢', icon: Heart, separatorBefore: true, onSelect: () => toggleLike(track) })
    const downloadState = downloadStates[track.id]
    const downloadActive = downloadState && ['queued', 'downloading', 'retrying'].includes(downloadState.phase)
    if (!isDownloaded && downloadActive && onCancelDownload) items.push({ label: `${downloadStateLabel(downloadState)} · 取消`, icon: X, onSelect: () => onCancelDownload(track.id) })
    else if (!isDownloaded) items.push({ label: downloadState?.phase === 'failed' ? '重试下载' : busyTrackIds.includes(track.id) ? '正在处理' : runtime.downloadBehavior === 'browser' ? '下载文件' : '下载到本地', icon: busyTrackIds.includes(track.id) ? LoaderCircle : CloudDownload, disabled: busyTrackIds.includes(track.id), onSelect: () => onDownloadTrack(track) })
    if (activeCollection === 'local' && runtime.canExportLocalFiles && track.audioUrl) items.push({ label: '导出歌曲', icon: Download, onSelect: () => onExportLocalTracks([track]) })

    const destructiveItems: ContextMenuItem[] = []
    if (activeCollection === 'queue') destructiveItems.push({ label: '从播放队列移除', icon: Trash2, danger: true, disabled: queueTrackIds.length <= 1, onSelect: () => onRemoveFromQueue(track) })
    if (activePlaylist) destructiveItems.push({ label: '从当前歌单移除', icon: Trash2, danger: true, onSelect: () => removeFromPlaylist(track.id) })
    if (isDownloaded) destructiveItems.push({ label: track.localFileId ? '移除本机文件' : '删除下载', icon: Trash2, danger: true, onSelect: () => onRemoveDownload(track) })
    destructiveItems.forEach((item, index) => items.push({ ...item, separatorBefore: index === 0 }))
    return items
  }

  const trackLongPress = useLongPress<HTMLElement>(({ clientX, clientY, currentTarget }) => {
    const track = knownTracks.find((item) => item.id === Number(currentTarget.dataset.trackId))
    if (!track) return
    setPlaylistMenu(null)
    setTrackMenu({ x: clientX, y: clientY, track })
  })
  const openTrackSurfaceMenu = (event: ReactMouseEvent<HTMLElement>, track: Track, selection?: PlaybackSelection) => {
    event.preventDefault()
    setPlaylistMenu(null)
    setTrackMenu({ x: event.clientX, y: event.clientY, track, selection })
  }
  const playlistLongPress = useLongPress<HTMLElement>(({ clientX, clientY, currentTarget }) => {
    const playlist = playlists.find((item) => item.id === currentTarget.dataset.playlistId)
    if (!playlist) return
    setTrackMenu(null)
    setPlaylistMenu({ x: clientX, y: clientY, playlist })
  })

  const knownTracks = Array.from(new Map([...catalog, ...sourceTracks, ...remoteSearchTracks, ...(activeEntity?.tracks ?? [])].map((track) => [track.id, track])).values())
  const openTrackArtist = (track: Track) => openArtist({
    id: track.artist,
    name: track.artist,
    cover: track.cover,
    tracks: knownTracks.filter((item) => item.artist === track.artist),
  })
  const openTrackAlbum = (track: Track) => openAlbum({
    id: `${track.artist}\u0000${track.album}`,
    name: track.album,
    artist: track.artist,
    cover: track.cover,
    tracks: knownTracks.filter((item) => item.artist === track.artist && item.album === track.album),
  })

  useEffect(() => {
    if (!navigationRequest) return
    if (navigationRequest.type === 'home') selectCollection('home')
    if (navigationRequest.type === 'featured') selectCollection('featured')
    if (navigationRequest.type === 'personal') selectCollection('personal')
    if (navigationRequest.type === 'liked') selectCollection('liked')
    if (navigationRequest.type === 'daily') selectCollection('home')
    if (navigationRequest.type === 'search') {
      selectCollection('home')
      setMobileSearchMode(true)
      window.setTimeout(() => searchInputRef.current?.focus(), 0)
    }
    if (navigationRequest.type === 'queue') selectCollection('queue')
    if (navigationRequest.type === 'artist') openTrackArtist(navigationRequest.track)
    if (navigationRequest.type === 'album') openTrackAlbum(navigationRequest.track)
  }, [navigationRequest?.key])

  const renderSourceChart = (chart: SourceChart) => (
    <article className="library-chart-card" key={chart.id} data-music-source={sourceBrandKey(chart.source)}>
      <button onClick={() => openSourceChart(chart)}>
        <span className="library-chart-cover">{renderChartArtwork(chart)}</span>
        <span className="library-chart-copy"><small>{chart.eyebrow} · 平台榜单</small><strong>{chart.name}</strong><em>{chart.updatedAt ? `更新于 ${chart.updatedAt}` : chart.updateFrequency || '随平台更新'}</em></span>
        <ChevronRight size={18} />
      </button>
    </article>
  )

  const renderDesktopTrackGrid = (items: Track[], id: string, title: string, limit = 10) => {
    const context: PlaybackContext = { kind: 'discovery', id, title }
    return <div className="library-source-track-grid">
      {items.slice(0, limit).map((track, index) => <button key={`${id}:${track.id}`} data-track-id={track.id} data-music-source={sourceBrandKey(track.source)} onContextMenu={(event) => openTrackSurfaceMenu(event, track, { tracks: items, context })} onClick={() => onPlayTrack(track, { tracks: items, context })}>
        <span className="library-source-track-cover"><ArtworkImage src={track.cover} alt="" /><i><Play size={16} fill="currentColor" /></i><b>{String(index + 1).padStart(2, '0')}</b></span>
        <strong>{track.title}</strong><small>{track.artist}</small><em>{track.source}</em>
      </button>)}
    </div>
  }

  const renderDesktopTrackRows = (items: Track[], id: string, title: string, limit = 6) => {
    const context: PlaybackContext = { kind: 'discovery', id, title }
    return <div className="library-discovery-track-list">
      {items.slice(0, limit).map((track, index) => <button key={`${id}:${track.id}`} data-track-id={track.id} data-music-source={sourceBrandKey(track.source)} onContextMenu={(event) => openTrackSurfaceMenu(event, track, { tracks: items, context })} onClick={() => onPlayTrack(track, { tracks: items, context })}>
        <b>{String(index + 1).padStart(2, '0')}</b>
        <ArtworkImage src={track.cover} alt="" loading={index < 2 ? 'eager' : 'lazy'} />
        <span><strong>{track.title}</strong><small>{track.artist} · {track.album}</small></span>
        <em><i />{track.source}</em>
        <Play size={14} fill="currentColor" />
      </button>)}
    </div>
  }

  const chartGridClass = (count: number) => `library-chart-grid is-count-${Math.min(4, Math.max(1, count))}`

  const renderTrackTable = () => (
    <div className="track-table">
      {(visibleTracks.length > 0 || query) && (
        <div className="track-table-head">
          <button onClick={selectAll} aria-label="全选"><i className={selectedIds.length === visibleTracks.length && visibleTracks.length ? 'is-checked' : ''}>{selectedIds.length === visibleTracks.length && visibleTracks.length ? <Check size={11} /> : null}</i></button>
          <span />
          <span>歌曲</span><span>艺人</span><span>专辑</span><span>音源</span><span>音质</span><span className="track-duration">时长</span><span className="track-actions-heading" aria-label="操作"><MoreHorizontal size={16} /></span>
        </div>
      )}
      <div className="track-table-body">
        {visibleTracks.map((track) => (
          <div
            className={`track-row ${track.id === activeTrackId ? 'is-playing' : ''}`}
            key={track.id}
            tabIndex={0}
            onContextMenu={(event) => { event.preventDefault(); event.currentTarget.focus(); setPlaylistMenu(null); setTrackMenu({ x: event.clientX, y: event.clientY, track }) }}
            onKeyDown={(event) => {
              if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
              event.preventDefault()
              setPlaylistMenu(null)
              setTrackMenu({ ...menuPosition(event.currentTarget), track })
            }}
          >
            <button className="track-check" onClick={() => toggleSelected(track.id)} aria-label={`选择 ${track.title}`}><i className={selectedIds.includes(track.id) ? 'is-checked' : ''}>{selectedIds.includes(track.id) && <Check size={11} />}</i></button>
            <button className="track-play" onClick={() => playTrackInCurrentContext(track)} title="播放" aria-label={`播放 ${track.title}`}><ArtworkImage src={track.cover} alt="" /><span><Play size={15} fill="currentColor" /></span></button>
            <button className="track-primary" onClick={() => playTrackInCurrentContext(track)}><span className="track-title-line"><strong>{track.title}</strong>{track.id === activeTrackId && <span className={`mini-levels ${isPlaying ? 'is-playing' : ''}`} aria-hidden="true"><i /><i /><i /></span>}</span>{track.bpm > 0 && <small>{track.bpm} BPM</small>}</button>
            <button className="track-cell track-entity-link" onClick={() => openTrackArtist(track)} title={`查看艺人 ${track.artist}`}>{track.artist}</button>
            <button className="track-cell track-entity-link" onClick={() => openTrackAlbum(track)} title={`查看专辑 ${track.album}`}>{track.album}</button>
            <span className="track-cell track-source-cell" data-music-source={sourceBrandKey(track.source)}><i />{track.source}</span>
            <span className="track-cell quality-cell">{track.quality}</span>
            <span className="track-cell track-duration">{track.duration}</span>
            <div className="track-actions">
              <button className={likedIds.includes(track.id) ? 'is-liked' : ''} onClick={() => toggleLike(track)} title={likedIds.includes(track.id) ? '取消喜欢' : '喜欢'} aria-label={likedIds.includes(track.id) ? '取消喜欢' : '喜欢'}><Heart size={15} fill={likedIds.includes(track.id) ? 'currentColor' : 'none'} /></button>
              {!downloadedTrackIds.includes(track.id) && (() => { const state = downloadStates[track.id]; const active = state && ['queued', 'downloading', 'retrying'].includes(state.phase); const label = active ? `${downloadStateLabel(state)}，点击取消` : state?.phase === 'failed' ? '重试下载' : runtime.downloadBehavior === 'browser' ? '下载文件' : '下载到本地'; return <button className={active ? 'is-busy' : ''} disabled={busyTrackIds.includes(track.id) && !active} onClick={() => active && onCancelDownload ? onCancelDownload(track.id) : onDownloadTrack(track)} title={label} aria-label={`${label} ${track.title}`}>{active ? <LoaderCircle size={15} /> : <CloudDownload size={15} />}</button> })()}
              <button onClick={(event) => { setPlaylistMenu(null); setTrackMenu({ ...menuPosition(event.currentTarget), track }) }} title="更多操作" aria-label={`更多操作 ${track.title}`}><MoreHorizontal size={16} /></button>
            </div>
          </div>
        ))}
        {!visibleTracks.length && <div className={`library-empty ${searchStatus === 'loading' ? 'is-loading' : ''}`}>{searchStatus === 'loading' ? <LoaderCircle size={24} /> : activeCollection === 'local' && !query ? <CloudDownload size={24} /> : <Search size={22} />}<strong>{emptyTitle}</strong><span>{emptyDetail}</span>{activeCollection === 'local' && !query && <button className="library-empty-action" onClick={() => selectCollection('home')}><House size={15} /> 返回首页</button>}</div>}
      </div>
    </div>
  )

  const renderMobileTrackList = (items: Track[] = visibleTracks, limit?: number) => {
    const displayTracks = typeof limit === 'number' ? items.slice(0, limit) : items
    return (
      <div className="mobile-track-list">
        {displayTracks.map((track) => {
          const task = activeCollection === 'downloads' ? downloadStates[track.id] : undefined
          const taskActive = Boolean(task && ['queued', 'downloading', 'retrying'].includes(task.phase))
          const row = <article
            className={`mobile-track-row supports-long-press ${track.id === activeTrackId ? 'is-playing' : ''} ${task ? `is-download-task is-${task.phase}` : ''}`}
            data-music-source={sourceBrandKey(track.source)}
            data-track-id={track.id}
            {...trackLongPress}
            onContextMenu={(event) => {
              event.preventDefault()
              setPlaylistMenu(null)
              setTrackMenu({ x: event.clientX, y: event.clientY, track })
            }}
          >
            <button className="mobile-track-play" onClick={() => onPlayTrack(track, { tracks: items, context: currentPlaybackContext })} aria-label={`播放 ${track.title}`}>
              <span className="mobile-track-artwork"><ArtworkImage src={track.cover} alt="" />{track.id === activeTrackId ? <span className={`mini-levels ${isPlaying ? 'is-playing' : ''}`} aria-hidden="true"><i /><i /><i /></span> : <Play size={14} fill="currentColor" />}</span>
              <span className="mobile-track-copy"><strong>{track.title}</strong><small>{task ? <>{downloadStateLabel(task)}{task.failureReason && task.phase === 'failed' ? ` · ${task.failureReason}` : ''}</> : <><span className="mobile-source-dot" />{track.artist}<i>·</i>{track.album}</>}</small>{task && typeof task.progress === 'number' && <span className="mobile-download-progress" aria-label={`下载进度 ${task.progress}%`}><i style={{ width: `${task.progress}%` }} /></span>}</span>
            </button>
            {task ? <button className="mobile-download-task-action" onClick={() => taskActive && onCancelDownload ? onCancelDownload(track.id) : onDownloadTrack(track)} aria-label={taskActive ? `取消下载 ${track.title}` : `重试下载 ${track.title}`}>{taskActive ? <X size={17} /> : <RefreshCw size={16} />}</button> : <time>{track.duration}</time>}
            <button className="mobile-track-more" onClick={(event) => { setPlaylistMenu(null); setTrackMenu({ ...menuPosition(event.currentTarget), track }) }} aria-label={`更多操作 ${track.title}`}><MoreHorizontal size={19} /></button>
          </article>
          return activeCollection === 'queue'
            ? <SwipeActionRow key={track.id} enabled={queueTracks.length > 1} ariaLabel={`从播放队列移除 ${track.title}`} onAction={() => onRemoveFromQueue(track)} className="mobile-track-swipe-row">{row}</SwipeActionRow>
            : <Fragment key={track.id}>{row}</Fragment>
        })}
        {!displayTracks.length && <div className={`mobile-library-empty ${searchStatus === 'loading' ? 'is-loading' : ''}`}>{searchStatus === 'loading' ? <LoaderCircle size={25} /> : <Music2 size={24} />}<strong>{emptyTitle}</strong><span>{emptyDetail}</span></div>}
      </div>
    )
  }

  const renderMobilePreviewTracks = (items: Track[], limit = 4) => (
    <div className="mobile-preview-track-list">
      {items.slice(0, limit).map((track) => <article className={`supports-long-press ${track.id === activeTrackId ? 'is-playing' : ''}`} key={track.id} data-music-source={sourceBrandKey(track.source)} data-track-id={track.id} {...trackLongPress} onContextMenu={(event) => openTrackSurfaceMenu(event, track, { tracks: items, context: currentPlaybackContext })}>
        <ArtworkImage src={track.cover} alt="" />
        <span><strong>{track.title}</strong><small><span className="mobile-source-dot" />{track.artist}</small></span>
        <button onClick={() => onPlayTrack(track, { tracks: items, context: currentPlaybackContext })} aria-label={`播放 ${track.title}`}>{track.id === activeTrackId && isPlaying ? <span className="mini-levels is-playing" aria-hidden="true"><i /><i /><i /></span> : <Play size={14} fill="currentColor" />}</button>
      </article>)}
    </div>
  )

  const renderMobileChart = (chart: SourceChart) => {
    const preview = chart.preview.length ? chart.preview.slice(0, 3) : chart.tracks.slice(0, 3).map((track) => ({ title: track.title, artist: track.artist }))
    return <button className="mobile-chart-summary" key={chart.id} data-music-source={sourceBrandKey(chart.source)} onClick={() => openSourceChart(chart)}>
      <span className="mobile-chart-cover">{renderChartArtwork(chart)}</span>
      <span className="mobile-chart-content"><span><strong>{chart.name}</strong><small>{chart.updatedAt ? `更新于 ${chart.updatedAt}` : chart.updateFrequency || '随平台更新'}</small></span>{preview.map((item, index) => <em key={`${item.title}-${index}`}><b>{index + 1}</b><span>{item.title}</span><small>{item.artist}</small></em>)}</span>
      <ChevronRight size={18} />
    </button>
  }

  const renderMobileHomeChart = (chart: SourceChart) => {
    const lead = chart.preview[0] ?? chart.tracks[0]
    return <button className="mobile-home-chart-card" key={`home:${chart.id}`} data-music-source={sourceBrandKey(chart.source)} onClick={() => openSourceChart(chart)}>
      {renderChartArtwork(chart)}
      <span><small>{chart.eyebrow}</small><strong>{chart.name}</strong><em>{lead ? lead.title : chart.updateFrequency || '随平台更新'}</em></span>
      <ChevronRight size={16} />
    </button>
  }

  const mobileBack = () => {
    if (mobileSearchMode) {
      setMobileSearchMode(false)
      setQuery('')
      setResultMode('tracks')
      return
    }
    if (activeEntity) return closeEntity()
    if (activeCollection === 'featured' || activeCollection === 'charts') return selectCollection('home')
    if (activeCollection === 'liked' || activeCollection === 'local' || activeCollection === 'downloads' || activeCollection === 'queue' || activePlaylist) return selectCollection('personal')
    setMobileSearchMode(false)
  }

  const updateMobileHeader = (scrollTop: number, threshold = 72) => {
    const nextRaised = scrollTop > 4
    const nextCondensed = scrollTop > threshold
    setMobileHeaderRaised((current) => current === nextRaised ? current : nextRaised)
    setMobileHeaderCondensed((current) => current === nextCondensed ? current : nextCondensed)
  }

  const selectMobileHomeSection = (section: 'recommended' | 'new' | 'collections' | 'providers') => {
    const scroller = mobileViewRef.current?.querySelector<HTMLElement>('.mobile-home-page')
    setMobileHomeSection(section)
    setMobileHeaderCondensed(false)
    setMobileHeaderRaised(false)
    if (scroller) scroller.scrollTop = 0
  }

  const mobileCollectionCover = activeEntity?.cover ?? activePlaylist?.trackSnapshots[0]?.cover ?? visibleTracks[0]?.cover ?? brandMarkPath
  const isPersonalDetail = !activeEntity && (
    activeCollection === 'liked' ||
    activeCollection === 'local' ||
    activeCollection === 'downloads' ||
    activeCollection === 'queue' ||
    Boolean(activePlaylist)
  )
  const entityAlbums = activeEntity?.type === 'artist' ? groupAlbums(activeEntity.tracks) : []
  const previousEntity = entityHistory[entityHistory.length - 1]
  const entityReturnLabel = previousEntity
    ? `返回${previousEntity.name}`
    : activeEntity?.originQuery
    ? '返回搜索结果'
    : activeEntity && activeCollection === 'featured'
      ? '返回精选'
      : activeEntity && activeCollection === 'charts'
        ? '返回榜单'
      : activeEntity && activeCollection === 'queue'
        ? '返回播放队列'
        : activeEntity && activeCollection === 'liked'
          ? '返回喜欢的音乐'
          : activeEntity && activeCollection === 'local'
            ? '返回本地音乐'
            : activeEntity && activePlaylist
              ? `返回${activePlaylist.name}`
              : activePlaylist || activeCollection === 'liked' || activeCollection === 'local' || activeCollection === 'downloads' || activeCollection === 'queue'
                ? '返回我的'
                : '返回首页'
  const overlayPortalTarget = document.querySelector<HTMLElement>('.client-shell') ?? document.body

  return (
    <section className={`library-workspace ${mobile ? 'is-mobile' : ''}`} data-collection={activeCollection === 'personal' ? 'personal' : 'standard'} data-mobile-layout={mobile && isPersonalDetail ? 'personal-detail' : undefined} data-mobile-navigation-level={mobile ? mobileNavigationLevel : undefined} data-mobile-header={mobileSearchMode || isPersonalDetail ? 'search' : 'none'}>
      {mobile && <div ref={mobileViewRef} className="mobile-library-view">
        {mobileSearchMode ? <>
          <header className="mobile-search-header">
            <button onClick={mobileBack} aria-label="退出搜索"><ChevronLeft size={24} /></button>
            <label><Search size={18} /><input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索歌曲、专辑或艺人" aria-label="搜索歌曲、专辑或艺人" autoFocus />{query && <button onClick={() => setQuery('')} aria-label="清除搜索"><X size={15} /></button>}</label>
          </header>
          {query && <nav className="mobile-result-tabs" aria-label="搜索结果类型">
            <button className={resultMode === 'tracks' ? 'is-active' : ''} onClick={() => setResultMode('tracks')}>歌曲</button>
            <button className={resultMode === 'albums' ? 'is-active' : ''} onClick={() => setResultMode('albums')}>专辑</button>
            <button className={resultMode === 'artists' ? 'is-active' : ''} onClick={() => setResultMode('artists')}>艺人</button>
          </nav>}
          <main className="mobile-library-scroll mobile-search-results">
            {!query ? <section className="mobile-search-start"><header><div><strong>搜索音乐</strong><p>查找歌曲、专辑与艺人</p></div></header>{hotTracks.length > 0 && <div className="mobile-search-trending"><strong>当前热听</strong><div>{hotTracks.slice(0, 6).map((track, index) => <button key={`hot-${track.id}-${index}`} onClick={() => setQuery(track.title)}><b>{index + 1}</b><span>{track.title}</span></button>)}</div></div>}{freshTracks.length > 0 && <div className="mobile-search-trending is-fresh"><strong>最新发布</strong><div>{freshTracks.slice(0, 6).map((track, index) => <button key={`fresh-${track.id}-${index}`} onClick={() => setQuery(track.title)}><b>{index + 1}</b><span>{track.title}</span></button>)}</div></div>}{!hotTracks.length && !freshTracks.length && <div className="mobile-search-live-state"><LoaderCircle size={18} /><span>{discoveryStatus === 'error' ? '实时内容暂时不可用' : '正在更新实时内容'}</span></div>}</section> : resultMode === 'tracks' ? renderMobileTrackList() : resultMode === 'albums' ? <div className="mobile-entity-grid">{albumGroups.map((album) => <button key={album.id} onClick={() => openAlbum(album)}><ArtworkImage src={album.cover} alt="" /><strong>{album.name}</strong><small>{album.artist}</small></button>)}</div> : <div className="mobile-artist-grid">{artistGroups.map((artist) => <button key={artist.id} onClick={() => openArtist(artist)}><ArtworkImage src={artist.cover} alt="" /><strong>{artist.name}</strong><small>{artist.tracks.length} 首作品</small></button>)}</div>}
          </main>
        </> : activeCollection === 'home' && !activeEntity ? <main className="mobile-library-scroll mobile-home-page" data-home-section={mobileHomeSection} onScroll={(event) => updateMobileHeader(event.currentTarget.scrollTop)}>
          <header className={`mobile-scroll-header mobile-root-toolbar ${mobileHeaderRaised ? 'is-raised' : ''} ${mobileHeaderCondensed ? 'is-condensed' : ''}`}><nav className="mobile-root-tabs" aria-label="首页内容"><button className={mobileHomeSection === 'recommended' ? 'is-active' : ''} aria-current={mobileHomeSection === 'recommended' ? 'page' : undefined} onClick={() => selectMobileHomeSection('recommended')}>推荐</button><button className={mobileHomeSection === 'new' ? 'is-active' : ''} aria-current={mobileHomeSection === 'new' ? 'page' : undefined} onClick={() => selectMobileHomeSection('new')}>新热</button><button className={mobileHomeSection === 'collections' ? 'is-active' : ''} aria-current={mobileHomeSection === 'collections' ? 'page' : undefined} onClick={() => selectMobileHomeSection('collections')}>选集</button><button className={mobileHomeSection === 'providers' ? 'is-active' : ''} aria-current={mobileHomeSection === 'providers' ? 'page' : undefined} onClick={() => selectMobileHomeSection('providers')}>平台</button></nav><button onClick={() => { setMobileSearchMode(true); window.setTimeout(() => searchInputRef.current?.focus(), 0) }} aria-label="搜索"><Search size={20} /></button></header>
          {mobileHomeSection === 'recommended' && <>
            {dailyTracks.length > 0 && <button className="mobile-daily-card" onClick={() => onPlayTracks(dailyTracks, { kind: 'discovery', id: 'daily', title: '每日推荐' })}>
              <span className="mobile-daily-art"><ArtworkImage src={dailyTracks[0].cover} alt="" loading="eager" />{dailyTracks.slice(1, 4).map((track) => <ArtworkImage key={track.id} src={track.cover} alt="" />)}</span>
              <span className="mobile-daily-copy"><small><CalendarDays size={14} /> 每日推荐</small><strong>今日 {dailyTracks.length} 首</strong><em>{dailyRecommendationCopy}</em></span><i><Play size={18} fill="currentColor" /></i>
            </button>}
            {discoveryStatus === 'loading' && !sourceDiscovery && <section className="mobile-source-loading is-loading" aria-live="polite"><LoaderCircle size={24} /><strong>正在更新音乐内容</strong><span>聚合已接入平台的最新内容</span></section>}
            {discoveryStatus === 'error' && !sourceDiscovery && <section className="mobile-source-loading"><RadioTower size={24} /><strong>内容暂时不可用</strong><span>{discoveryError}</span><button onClick={() => refreshDiscovery(true)}>重新加载</button></section>}
            {homeRecommendationTracks.length > 0 && <section className="mobile-content-section mobile-home-track-picks"><header><span><strong>为你精选</strong><small>{hasPersonalizationSignals ? '结合你的收藏' : '跨平台挑选'}</small></span><button onClick={() => onPlayTracks(homeRecommendationTracks, { kind: 'discovery', id: 'home-picks', title: '为你精选' })}>播放 <Play size={14} fill="currentColor" /></button></header>{renderMobilePreviewTracks(homeRecommendationTracks, 5)}</section>}
            {homeAlbumPicks.length > 0 && <section className="mobile-content-section mobile-home-albums"><header><span><strong>专辑推荐</strong><small>从今日内容继续发现</small></span></header><div className="mobile-card-rail mobile-home-album-rail">{homeAlbumPicks.map((album) => <button className="mobile-feature-card" key={`home-album:${album.id}`} onClick={() => openAlbum(album)}><span><ArtworkImage src={album.cover} alt="" /></span><strong>{album.name}</strong><small>{album.artist}</small></button>)}</div></section>}
            {homeFeaturedShelves.length > 0 && <section className="mobile-content-section mobile-home-recommendations">
              <header><span><strong>适合此刻</strong><small>按场景与状态整理</small></span><button onClick={() => selectMobileHomeSection('collections')}>全部 <ChevronRight size={15} /></button></header>
              <div className="mobile-home-scene-rail">{homeFeaturedShelves.map((shelf) => <button key={shelf.id} onClick={() => openSourceShelf(shelf)}><ArtworkImage src={shelf.tracks[0]?.cover} alt="" /><span><strong>{shelf.name}</strong><small>{shelf.tracks.slice(0, 2).map((track) => track.title).join(' · ')}</small></span><ChevronRight size={16} /></button>)}</div>
            </section>}
            {homeCharts.length > 0 && <section className="mobile-content-section mobile-home-trends"><header><span><strong>趋势速览</strong><small>各平台正在发生</small></span><button onClick={() => selectCollection('charts')}>全部 <ChevronRight size={15} /></button></header><div className="mobile-home-trend-strip">{homeCharts.slice(0, 4).map((chart) => <button key={`home-chart:${chart.id}`} data-music-source={sourceBrandKey(chart.source)} onClick={() => openSourceChart(chart)}>{renderChartArtwork(chart)}<span><small>{chart.eyebrow}</small><strong>{chart.name}</strong><em>{chart.tracks[0]?.title ?? chart.preview[0]?.title ?? '随平台更新'}</em></span><ChevronRight size={16} /></button>)}</div></section>}
            {homeFreshPreviewTracks.length > 0 && <section className="mobile-content-section mobile-home-fresh-preview"><header><span><strong>新鲜上架</strong><small>近期值得留意的新作</small></span><button onClick={() => selectMobileHomeSection('new')}>更多 <ChevronRight size={15} /></button></header>{renderMobilePreviewTracks(homeFreshPreviewTracks, 5)}</section>}
          </>}
          {mobileHomeSection === 'new' && <>
            {newReleaseLeadTrack && <div className="mobile-home-tab-page mobile-new-release-page">
              <section className="mobile-content-section mobile-new-release-section">
                <header><strong>本周主推</strong><span className="mobile-section-meta">持续更新</span></header>
                <article className="mobile-new-release-lead" data-music-source={sourceBrandKey(newReleaseLeadTrack.source)} data-track-id={newReleaseLeadTrack.id}>
                  <ArtworkImage src={newReleaseLeadTrack.cover} alt="" loading="eager" />
                  <span><small><Sparkles size={14} /> 新作</small><strong>{newReleaseLeadTrack.title}</strong><em>{newReleaseLeadTrack.artist}<i>·</i>{newReleaseLeadTrack.album}</em></span>
                  <button onClick={() => onPlayTrack(newReleaseLeadTrack, { tracks: freshTracks.length ? freshTracks : hotTracks, context: currentPlaybackContext })} aria-label={`播放 ${newReleaseLeadTrack.title}`}><Play size={17} fill="currentColor" /></button>
                </article>
              </section>
              {newReleaseRailTracks.length > 0 && <section className="mobile-content-section mobile-new-release-rail-section"><header><strong>新作选集</strong><span className="mobile-section-meta">{newReleaseRailTracks.length} 首</span></header><div className="mobile-new-release-rail">{newReleaseRailTracks.map((track) => <button key={`fresh:${track.id}`} data-track-id={track.id} data-music-source={sourceBrandKey(track.source)} onClick={() => onPlayTrack(track, { tracks: freshTimeline, context: currentPlaybackContext })}><ArtworkImage src={track.cover} alt="" /><strong>{track.title}</strong><small>{track.artist}</small></button>)}</div></section>}
              {(trendingTracks.length > 0 || latestFeedTracks.length > 0) && <section className="mobile-content-section mobile-new-feed-section">
                <nav className="mobile-provider-tabs mobile-new-feed-tabs" aria-label="新热内容"><button className={visibleMobileNewFeed === 'trending' ? 'is-active' : ''} aria-current={visibleMobileNewFeed === 'trending' ? 'page' : undefined} onClick={() => setMobileNewFeed('trending')} disabled={!trendingTracks.length}>热听趋势</button><button className={visibleMobileNewFeed === 'latest' ? 'is-active' : ''} aria-current={visibleMobileNewFeed === 'latest' ? 'page' : undefined} onClick={() => setMobileNewFeed('latest')} disabled={!latestFeedTracks.length}>刚刚上新</button></nav>
                {visibleMobileNewFeed === 'trending' ? <div className="mobile-trending-list">{trendingTracks.map((track, index) => <button key={`trend:${track.id}`} data-music-source={sourceBrandKey(track.source)} onClick={() => onPlayTrack(track, { tracks: trendingTracks, context: currentPlaybackContext })}><b>{String(index + 1).padStart(2, '0')}</b><ArtworkImage src={track.cover} alt="" /><span><strong>{track.title}</strong><small>{track.artist}<i>·</i>{track.album}</small></span><Play size={15} fill="currentColor" /></button>)}</div> : renderMobilePreviewTracks(latestFeedTracks, 8)}
              </section>}
            </div>}
            {!hotTracks.length && !freshTracks.length && <section className="mobile-source-loading mobile-home-tab-page"><RadioTower size={24} /><strong>新热内容暂时不可用</strong><span>稍后重新加载</span><button onClick={() => refreshDiscovery(true)}>重新加载</button></section>}
          </>}
          {mobileHomeSection === 'collections' && <>
            {spotlightShelf && spotlightTrack && <div className="mobile-home-tab-page mobile-collections-page">
              <section className="mobile-collection-feature">
                <button className="mobile-collection-spotlight" data-shelf-id={spotlightShelf.id} onClick={() => openSourceShelf(spotlightShelf)}><span className="mobile-collection-spotlight-art">{spotlightShelf.tracks.slice(0, 3).map((track) => <ArtworkImage key={`spotlight:${track.id}`} src={track.cover} alt="" loading="eager" />)}</span><span><small>{spotlightShelf.eyebrow}</small><strong>{spotlightShelf.name}</strong><p>{spotlightShelf.description}</p><em>{spotlightShelf.tracks.length} 首 · 跨平台更新</em></span><ChevronRight size={18} /></button>
                <div className="mobile-collection-feature-tracks">{spotlightShelf.tracks.slice(0, 3).map((track, index) => <button key={`spotlight-track:${track.id}`} data-music-source={sourceBrandKey(track.source)} onClick={() => onPlayTrack(track, { tracks: spotlightShelf.tracks, context: { kind: 'discovery', id: `shelf:${spotlightShelf.id}`, title: spotlightShelf.name } })}><b>{String(index + 1).padStart(2, '0')}</b><span><strong>{track.title}</strong><small>{track.artist}</small></span><Play size={14} fill="currentColor" /></button>)}</div>
              </section>
              {curatedCollectionGroups.map((group) => <section className={`mobile-content-section mobile-curated-section${group.shelves.length === 1 ? ' is-single' : ''}`} key={group.id}><header><strong>{group.label}</strong><span className="mobile-section-meta">{group.shelves.length} 个选集</span></header><div className="mobile-curated-rail">{group.shelves.map((shelf) => <button key={`curated:${shelf.id}`} data-shelf-id={shelf.id} onClick={() => openSourceShelf(shelf)}><ArtworkImage src={shelf.tracks[0]?.cover} alt="" /><span><strong>{shelf.name}</strong><small>{shelf.tracks.slice(0, 2).map((track) => track.title).join(' · ')}</small><em>{shelf.eyebrow} · {shelf.tracks.length} 首</em></span><ChevronRight size={16} /></button>)}</div></section>)}
              {collectionListeningTracks.length > 0 && <section className="mobile-content-section mobile-collection-listening"><header><span><strong>选集中热听</strong><small>来自本期主题</small></span><button onClick={() => onPlayTracks(collectionListeningTracks, { kind: 'discovery', id: 'collections:listening', title: '选集中热听' })}>播放 <Play size={14} fill="currentColor" /></button></header>{renderMobilePreviewTracks(collectionListeningTracks, 6)}</section>}
            </div>}
            {!featuredShelves.length && <section className="mobile-source-loading mobile-home-tab-page"><Music2 size={24} /><strong>选集暂时不可用</strong><span>稍后重新加载</span><button onClick={() => refreshDiscovery(true)}>重新加载</button></section>}
          </>}
          {mobileHomeSection === 'providers' && <>
            {sourceProviders.length > 0 && <div className="mobile-home-tab-page mobile-platform-page">
              <nav className="mobile-provider-tabs" aria-label="音乐平台">{sourceProviders.map((provider) => {
                const providerAvailable = provider.available !== false && provider.tracks.length > 0
                return <button key={provider.source} className={activeMobileProvider?.source === provider.source ? 'is-active' : ''} aria-current={activeMobileProvider?.source === provider.source ? 'page' : undefined} data-music-source={sourceBrandKey(provider.source)} onClick={() => providerAvailable && setMobileProviderSource(provider.source)} disabled={!providerAvailable}>{provider.name}</button>
              })}</nav>
              {activeMobileProvider && <>
                <section className="mobile-platform-focus" data-music-source={sourceBrandKey(activeMobileProvider.source)}>
                  <span className="mobile-platform-focus-art">{activeMobileProvider.tracks.slice(0, 3).map((track) => <ArtworkImage key={`focus:${track.id}`} src={track.cover} alt="" />)}</span>
                  <span><small>音乐平台</small><strong>{activeMobileProvider.name}</strong><em>{activeMobileProvider.tracks.length} 首可听内容</em></span>
                  <button onClick={() => onPlayTracks(activeMobileProvider.tracks, { kind: 'discovery', id: `provider:${activeMobileProvider.source}`, title: activeMobileProvider.name })} aria-label={`播放 ${activeMobileProvider.name}`}><Play size={17} fill="currentColor" /></button>
                </section>
                <section className="mobile-content-section mobile-platform-selection"><header><span><strong>平台热听</strong><small>来自 {activeMobileProvider.name}</small></span><button onClick={() => openProviderLane(activeMobileProvider)}>全部 <ChevronRight size={15} /></button></header>{renderMobilePreviewTracks(activeMobileProvider.tracks, 8)}</section>
                {activeProviderAlbums.length > 1 && <section className="mobile-content-section mobile-platform-albums"><header><strong>专辑</strong><span className="mobile-section-meta">{activeProviderAlbums.length} 张</span></header><div className="mobile-card-rail">{activeProviderAlbums.map((album) => <button className="mobile-feature-card" key={`provider-album:${album.id}`} onClick={() => openAlbum(album)}><span><ArtworkImage src={album.cover} alt="" /></span><strong>{album.name}</strong><small>{album.artist}</small></button>)}</div></section>}
                {activeProviderCharts.length > 0 && <section className="mobile-content-section mobile-platform-charts"><header><strong>官方榜单</strong><button onClick={() => selectCollection('charts')}>全部 <ChevronRight size={15} /></button></header><div className="mobile-home-chart-rail">{activeProviderCharts.map(renderMobileHomeChart)}</div></section>}
              </>}
            </div>}
            {!sourceProviders.length && <section className="mobile-source-loading mobile-home-tab-page"><RadioTower size={24} /><strong>平台内容暂时不可用</strong><span>稍后重新加载</span><button onClick={() => refreshDiscovery(true)}>重新加载</button></section>}
          </>}
        </main> : activeCollection === 'featured' && !activeEntity ? <main className="mobile-library-scroll mobile-discovery-page" onScroll={(event) => updateMobileHeader(event.currentTarget.scrollTop)}>
          <h1 className="visually-hidden">发现</h1>
          <header className={`mobile-scroll-header mobile-root-toolbar ${mobileHeaderRaised ? 'is-raised' : ''} ${mobileHeaderCondensed ? 'is-condensed' : ''}`}><nav className="mobile-root-tabs" aria-label="发现内容"><button className="is-active" aria-current="page">精选</button><button onClick={() => selectCollection('charts')}>榜单</button></nav><button onClick={() => { setMobileSearchMode(true); window.setTimeout(() => searchInputRef.current?.focus(), 0) }} aria-label="搜索"><Search size={20} /></button></header>
          {spotlightShelf && spotlightTrack && <button className="mobile-discovery-lead" onClick={() => openSourceShelf(spotlightShelf)}><ArtworkImage src={spotlightTrack.cover} alt="" /><span><small>{spotlightShelf.eyebrow}</small><strong>{spotlightShelf.name}</strong><p>{spotlightShelf.description}</p></span><ChevronRight size={18} /></button>}
          <section className="mobile-content-section"><header><strong>精选主题</strong></header><div className="mobile-theme-grid">{featuredShelves.map((shelf) => <button key={shelf.id} onClick={() => openSourceShelf(shelf)}><span><ArtworkImage src={shelf.tracks[0]?.cover} alt="" /><ArtworkImage src={shelf.tracks[1]?.cover} alt="" /></span><strong>{shelf.name}</strong><small>{shelf.description}</small></button>)}</div></section>
          {moodShelves.length > 0 && <section className="mobile-content-section"><header><strong>按场景聆听</strong></header><div className="mobile-scene-list">{moodShelves.map((shelf) => <button key={shelf.id} onClick={() => openSourceShelf(shelf)}><ArtworkImage src={shelf.tracks[0]?.cover} alt="" /><span><strong>{shelf.name}</strong><small>{shelf.description}</small></span><ChevronRight size={17} /></button>)}</div></section>}
          {(hotTracks.length > 0 || freshTracks.length > 0) && <section className="mobile-content-section mobile-featured-new-hot"><header><strong>新热精选</strong></header>{hotTracks.length > 0 && renderMobilePreviewTracks(hotTracks, 5)}{freshTracks.length > 0 && renderMobilePreviewTracks(freshTracks, 5)}</section>}
          {sourceProviders.length > 0 && <section className="mobile-content-section mobile-provider-section"><header><strong>平台精选</strong></header><div>{sourceProviders.map((provider) => <button key={provider.source} data-music-source={sourceBrandKey(provider.source)} onClick={() => openProviderLane(provider)} disabled={!provider.available}><span className="mobile-provider-mark"><RadioTower size={16} /></span><span><strong>{provider.name}</strong><small>{provider.available ? `${provider.tracks.length} 首内容` : '暂未返回内容'}</small></span><ChevronRight size={16} /></button>)}</div></section>}
        </main> : activeCollection === 'charts' && !activeEntity ? <main className="mobile-library-scroll mobile-charts-view mobile-discovery-page" onScroll={(event) => updateMobileHeader(event.currentTarget.scrollTop)}>
          <h1 className="visually-hidden">发现</h1>
          <header className={`mobile-scroll-header mobile-root-toolbar ${mobileHeaderRaised ? 'is-raised' : ''} ${mobileHeaderCondensed ? 'is-condensed' : ''}`}><nav className="mobile-root-tabs" aria-label="发现内容"><button onClick={() => selectCollection('featured')}>精选</button><button className="is-active" aria-current="page">榜单</button></nav><button onClick={() => { setMobileSearchMode(true); window.setTimeout(() => searchInputRef.current?.focus(), 0) }} aria-label="搜索"><Search size={20} /></button></header>
          <nav className="mobile-chart-filters"><button className={chartSource === 'all' ? 'is-active' : ''} onClick={() => setChartSource('all')}>全部</button>{availableChartSections.map((section) => <button key={section.id} className={chartSource === section.id ? 'is-active' : ''} data-music-source={sourceBrandKey(section.id)} onClick={() => setChartSource(section.id)}><span><RadioTower size={13} /></span>{section.name}</button>)}</nav>
          <section className="mobile-chart-list">{chartSections.flatMap((section) => section.charts).map(renderMobileChart)}</section>
        </main> : activeCollection === 'personal' && !activeEntity ? <main className="mobile-library-scroll mobile-personal-page" onScroll={(event) => setPersonalHeaderCondensed(event.currentTarget.scrollTop > 112)}>
          <h1 className="visually-hidden">我的</h1>
          <header className={`mobile-personal-toolbar ${personalHeaderCondensed ? 'is-condensed' : ''}`}><button onClick={onOpenSettings} aria-label="应用设置"><Settings2 size={20} /></button><strong>{personalHeaderCondensed ? userName : ''}</strong><div className="mobile-personal-toolbar-actions">{onOpenTheme && <button onClick={onOpenTheme} aria-label="外观设置"><Palette size={19} /></button>}<button onClick={onOpenSources} aria-label="音乐服务状态"><RadioTower size={19} /><i className={`is-${sourcePhase}`} /></button></div></header>
          <section className="mobile-profile-hero">
            <button className="mobile-profile-identity" onClick={onOpenAccount} aria-label="打开账户">
              <span className="mobile-profile-avatar">{userName.trim().slice(0, 1).toLocaleUpperCase() || <UserRound size={24} />}</span>
              <span><strong>{userName}</strong><small>{profileCaption}</small></span>
              <ChevronRight size={18} />
            </button>
          </section>
          <section className="mobile-personal-list-section">
            <header><strong>我的音乐</strong></header>
            <div>
              <button onClick={() => selectCollection('liked')}><span><Heart size={19} fill="currentColor" /></span><span><strong>喜欢的音乐</strong><small>{likedCatalogTracks.length} 首收藏</small></span><ChevronRight size={17} /></button>
              {runtime.hasLocalLibrary && <button onClick={() => selectCollection('local')}><span><HardDrive size={19} /></span><span><strong>本地音乐</strong><small>{downloadedTrackIds.length} 首离线音乐</small></span><ChevronRight size={17} /></button>}
              {runtime.hasLocalLibrary && <button onClick={() => selectCollection('downloads')}><span><Download size={19} /></span><span><strong>下载管理</strong><small>{downloadTaskIds.size ? `${downloadTaskIds.size} 项待处理` : '当前没有下载任务'}</small></span><ChevronRight size={17} /></button>}
              <button onClick={() => selectCollection('queue')}><span><ListMusic size={19} /></span><span><strong>播放队列</strong><small>{queueTracks.length ? `${queueTracks.length} 首` : '当前没有待播放歌曲'}</small></span><ChevronRight size={17} /></button>
            </div>
          </section>
          <section className="mobile-playlists-section"><header><span><strong>我的歌单</strong><small>{playlists.length ? `歌单总数 ${playlists.length}` : '整理喜欢的音乐'}</small></span><button onClick={() => openPlaylistEditor('create')} aria-label="新建歌单"><Plus size={20} /></button></header><div>{playlists.map((playlist) => <article key={playlist.id} className="supports-long-press" data-playlist-id={playlist.id} {...playlistLongPress} onContextMenu={(event) => { event.preventDefault(); setPlaylistMenu({ x: event.clientX, y: event.clientY, playlist }) }}><button onClick={() => selectCollection(playlist.id)}><span className="mobile-playlist-cover">{playlist.trackSnapshots[0] ? <ArtworkImage src={playlist.trackSnapshots[0].cover} alt="" /> : <Music2 size={20} />}</span><span><strong>{playlist.name}</strong><small>{playlist.trackIds.length} 首歌曲</small></span><ChevronRight size={17} /></button><button onClick={(event) => setPlaylistMenu({ ...menuPosition(event.currentTarget), playlist })} aria-label={`管理歌单 ${playlist.name}`}><MoreHorizontal size={19} /></button></article>)}{!playlists.length && <button className="mobile-create-playlist" onClick={() => openPlaylistEditor('create')}><span><Plus size={21} /></span><span><strong>创建第一个歌单</strong><small>按场景、风格或心情整理音乐</small></span><ChevronRight size={17} /></button>}</div></section>
        </main> : <main className="mobile-library-scroll mobile-collection-page" onScroll={(event) => updateMobileHeader(event.currentTarget.scrollTop, 124)}>
          <header className={`mobile-scroll-header mobile-detail-toolbar ${mobileHeaderRaised ? 'is-raised' : ''} ${mobileHeaderCondensed ? 'is-condensed' : ''}`}><button onClick={mobileBack} aria-label={entityReturnLabel}><ChevronLeft size={22} /></button><strong>{collectionTitle}</strong><button onClick={() => { setMobileSearchMode(true); window.setTimeout(() => searchInputRef.current?.focus(), 0) }} aria-label={`在${collectionTitle}中搜索`}><Search size={19} /></button></header>
          <header className={`mobile-collection-hero ${activeEntity ? `is-${activeEntity.type}` : ''}`}>
            <ArtworkImage className="mobile-collection-backdrop" src={mobileCollectionCover} alt="" />
            <ArtworkImage className="mobile-collection-cover" src={mobileCollectionCover} alt="" />
            <span className="mobile-collection-copy">{collectionKind && <small>{collectionKind}</small>}<h1>{collectionTitle}</h1>{activeEntity?.artist && <button onClick={() => activeEntity.tracks[0] && openTrackArtist(activeEntity.tracks[0])}>{activeEntity.artist}</button>}<p>{activeEntity?.description ?? (activePlaylist ? `${activePlaylist.trackIds.length} 首歌曲` : activeCollection === 'liked' ? `${likedCatalogTracks.length} 首收藏` : activeCollection === 'local' ? runtime.localLibraryLabel : activeCollection === 'downloads' ? `${downloadTaskIds.size} 项待处理` : `${queueTracks.length} 首`)}</p></span>
            <div className="mobile-collection-actions"><button className="is-primary" disabled={!visibleTracks.length} onClick={playCurrentCollection}><Play size={18} fill="currentColor" />播放全部</button>{activeEntity && <button disabled={!visibleTracks.length} onClick={() => setPlaylistPicker({ trackIds: visibleTracks.map((track) => track.id), trackTitle: collectionTitle })}><ListPlus size={18} />收藏</button>}</div>
          </header>
          {activeEntity?.type === 'artist' && entityAlbums.length > 0 && <section className="mobile-content-section mobile-artist-albums"><header><strong>专辑</strong></header><div className="mobile-card-rail">{entityAlbums.slice(0, 8).map((album) => <button className="mobile-feature-card" key={album.id} onClick={() => openAlbum(album)}><span><ArtworkImage src={album.cover} alt="" /></span><strong>{album.name}</strong><small>{album.tracks.length} 首</small></button>)}</div></section>}
          {entityLoading && <div className="mobile-entity-loading"><LoaderCircle size={17} /> 正在更新歌曲</div>}
          {entityError && <div className="mobile-entity-error">{entityError}</div>}
          <section className="mobile-collection-tracks"><header><strong>{activeEntity?.type === 'artist' ? '热门歌曲' : '歌曲'}</strong><span>{visibleTracks.length} 首</span></header>{renderMobileTrackList()}</section>
        </main>}
      </div>}
      {!mobile && <><header className="workspace-pane-header workspace-pane-rail library-rail-header">
        <span><strong>音乐库</strong></span>
      </header>

      <header className="workspace-pane-header workspace-pane-main library-main-header">
        <div className="workspace-pane-title">
          <span>{collectionKind && <small>{collectionKind}</small>}<strong>{collectionTitle}</strong></span>
        </div>
        {activeCollection !== 'personal' && <div className="library-searchbar">
          <Search size={18} />
          <input ref={searchInputRef} name="music-search" value={query} onFocus={() => setMobileSearchMode(true)} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={!activeEntity && activeCollection === 'home' ? '搜索音乐' : searchPlaceholder} />
          {query && <button onClick={() => setQuery('')} title="清除" aria-label="清除搜索"><X size={16} /></button>}
        </div>}
        <div className="library-toolbar-actions">
          {!activeEntity && activeCollection === 'home' && query && (
            <div className="result-tabs">
              <button className={resultMode === 'tracks' ? 'is-active' : ''} onClick={() => setResultMode('tracks')}>歌曲</button>
              <button className={resultMode === 'albums' ? 'is-active' : ''} onClick={() => setResultMode('albums')}>专辑</button>
              <button className={resultMode === 'artists' ? 'is-active' : ''} onClick={() => setResultMode('artists')}>艺人</button>
            </div>
          )}
          {!activeEntity && visibleTracks.length > 0 && !['new', 'featured', 'charts', 'providers'].includes(activeCollection) && (activeCollection !== 'home' || query) && <button className="play-collection" onClick={playCurrentCollection}><Play size={15} fill="currentColor" /> 播放</button>}
        </div>
      </header>

      <aside className="library-sidebar">
        <nav className="library-discovery-nav">
          <button className={activeCollection === 'home' ? 'is-active' : ''} onClick={() => selectCollection('home')}><House size={16} /><span>推荐</span></button>
          <button className={activeCollection === 'new' ? 'is-active' : ''} onClick={() => selectCollection('new')}><Flame size={16} /><span>新热</span></button>
          <button className={activeCollection === 'featured' ? 'is-active' : ''} onClick={() => selectCollection('featured')}><Compass size={16} /><span>选集</span></button>
          <button className={activeCollection === 'charts' ? 'is-active' : ''} onClick={() => selectCollection('charts')}><Trophy size={16} /><span>榜单</span></button>
          <button className={activeCollection === 'providers' ? 'is-active' : ''} onClick={() => selectCollection('providers')}><Globe2 size={16} /><span>平台</span></button>
        </nav>
        <div className="library-sidebar-label">个人音乐</div>
        <nav className="library-personal-nav">
          <button className={activeCollection === 'liked' ? 'is-active' : ''} onClick={() => selectCollection('liked')}><Heart size={16} /><span>喜欢的音乐</span><small>{likedCatalogTracks.length}</small></button>
          {runtime.hasLocalLibrary && <button className={activeCollection === 'local' ? 'is-active' : ''} onClick={() => selectCollection('local')}><HardDrive size={16} /><span>本地音乐</span><small>{downloadedTrackIds.length}</small></button>}
          {runtime.hasLocalLibrary && <button className={activeCollection === 'downloads' ? 'is-active' : ''} onClick={() => selectCollection('downloads')}><Download size={16} /><span>下载管理</span><small>{downloadTaskIds.size}</small></button>}
          <button className={activeCollection === 'queue' ? 'is-active' : ''} onClick={() => selectCollection('queue')}><ListMusic size={16} /><span>播放队列</span><small>{queueTrackIds.length}</small></button>
        </nav>

        <div className="playlist-heading"><span>我的歌单</span><button onClick={() => openPlaylistEditor('create')} title="新建歌单" aria-label="新建歌单"><Plus size={15} /></button></div>
        <div className="playlist-list">
          {playlists.map((playlist) => (
            <button
              key={playlist.id}
              className={activeCollection === playlist.id ? 'is-active' : ''}
              onClick={() => selectCollection(playlist.id)}
              onContextMenu={(event) => { event.preventDefault(); event.currentTarget.focus(); setTrackMenu(null); setPlaylistMenu({ x: event.clientX, y: event.clientY, playlist }) }}
              onKeyDown={(event) => {
                if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
                event.preventDefault()
                setTrackMenu(null)
                setPlaylistMenu({ ...menuPosition(event.currentTarget), playlist })
              }}
            >
              <Music2 size={15} /><span>{playlist.name}</span><small>{playlist.trackIds.length}</small>
            </button>
          ))}
        </div>
      </aside>

      <div ref={desktopContentRef} className="library-content">
        {selectedIds.length > 0 && (
          <div className="bulk-toolbar">
            <div className="bulk-selection-summary"><strong>已选择 {selectedIds.length} 首</strong></div>
            <div className="bulk-action-group">
              <GlassSelect className="bulk-playlist-select" value={effectiveTargetPlaylistId} onChange={setTargetPlaylistId} ariaLabel="目标歌单" disabled={!targetPlaylists.length} options={targetPlaylists.map((playlist) => ({ value: playlist.id, label: playlist.name, description: `${playlist.trackIds.length} 首` }))} />
              <button disabled={!effectiveTargetPlaylistId} onClick={() => addToPlaylist(selectedIds, effectiveTargetPlaylistId)}><ListPlus size={15} /> 加入歌单</button>
              {activeCollection !== 'local' && <button onClick={() => selectedTracks.forEach(onDownloadTrack)}><CloudDownload size={15} /> 下载</button>}
              {activeCollection === 'local' && runtime.canExportLocalFiles && <button onClick={() => onExportLocalTracks(selectedTracks)}><Download size={15} /> 导出</button>}
              {activeCollection === 'local' && <button className="is-danger" onClick={() => { selectedTracks.forEach(onRemoveDownload); setSelectedIds([]) }}><Trash2 size={15} /> 移除本地</button>}
            </div>
            <button className="bulk-cancel" onClick={() => setSelectedIds([])} title="取消选择" aria-label="取消选择"><X size={16} /></button>
          </div>
        )}

        {activeCollection === 'personal' && !activeEntity ? (
          <div className="mobile-personal-home">
            <header className="mobile-personal-intro">
              <span><Music2 size={24} /></span>
              <div><h2>我的音乐</h2><p>收藏、离线内容、播放队列和歌单都在这里。</p></div>
              <nav aria-label="个人音乐设置">{onOpenSettings && <button onClick={onOpenSettings} title="应用设置" aria-label="应用设置"><Settings2 size={18} /></button>}</nav>
            </header>
            <section className="mobile-personal-shortcuts" aria-label="个人音乐入口">
              <button onClick={() => selectCollection('liked')}><span><Heart size={20} /></span><span><strong>喜欢的音乐</strong><small>{likedCatalogTracks.length ? `${likedCatalogTracks.length} 首收藏` : '收藏的歌曲会出现在这里'}</small></span><ChevronRight size={18} /></button>
              {runtime.hasLocalLibrary && <button onClick={() => selectCollection('local')}><span><HardDrive size={20} /></span><span><strong>本地音乐</strong><small>{downloadedTrackIds.length ? `${downloadedTrackIds.length} 首离线音乐` : '下载与导入的音乐'}</small></span><ChevronRight size={18} /></button>}
              <button onClick={() => selectCollection('queue')}><span><ListMusic size={20} /></span><span><strong>播放队列</strong><small>{queueTracks.length ? `${queueTracks.length} 首` : '当前没有待播放歌曲'}</small></span><ChevronRight size={18} /></button>
            </section>
            <section className="mobile-personal-playlists">
              <header><span><strong>我的歌单</strong><small>{playlists.length ? `歌单总数 ${playlists.length}` : '整理常听与收藏'}</small></span><button onClick={() => openPlaylistEditor('create')} title="新建歌单" aria-label="新建歌单"><Plus size={17} /></button></header>
              <div>
                {playlists.map((playlist) => <button key={playlist.id} onClick={() => selectCollection(playlist.id)} onContextMenu={(event) => { event.preventDefault(); setTrackMenu(null); setPlaylistMenu({ x: event.clientX, y: event.clientY, playlist }) }}><span><Music2 size={18} /></span><span><strong>{playlist.name}</strong><small>{playlist.trackIds.length} 首歌曲</small></span><ChevronRight size={17} /></button>)}
                {!playlists.length && <button className="is-empty" onClick={() => openPlaylistEditor('create')}><span><Plus size={18} /></span><span><strong>创建第一个歌单</strong><small>把喜欢的歌曲整理到一起</small></span><ChevronRight size={17} /></button>}
              </div>
            </section>
          </div>
        ) : activeEntity ? (
          <div className="library-entity-page">
            <section className={`library-entity-hero is-${activeEntity.type}`}>
              <button className="library-entity-back" onClick={closeEntity}><ChevronLeft size={16} /> {entityReturnLabel}</button>
              <div className="library-entity-cover">
                {activeEntity.type === 'chart' && sourceCharts.find((chart) => chart.id === activeEntity.id)
                  ? renderChartArtwork(sourceCharts.find((chart) => chart.id === activeEntity.id)!, true, activeEntity.tracks)
                  : <ArtworkImage src={activeEntity.cover} alt="" />}
                {activeEntity.type === 'artist' && <span aria-hidden="true"><UserRound size={22} /></span>}
              </div>
              <div className="library-entity-copy">
                <span className="library-entity-kicker">{activeEntity.type === 'chart' ? <BarChart3 size={15} /> : activeEntity.type === 'artist' ? <UserRound size={15} /> : activeEntity.type === 'album' ? <Disc3 size={15} /> : <Sparkles size={15} />}{activeEntity.eyebrow}</span>
                <h2>{activeEntity.name}</h2>
                {activeEntity.artist && activeEntity.tracks[0] && <button className="library-entity-artist" onClick={() => openTrackArtist(activeEntity.tracks[0])}>{activeEntity.artist}</button>}
                <p>{activeEntity.description}</p>
                <div className="library-entity-actions">
                  <button className="is-primary" disabled={!activeEntity.tracks.length} onClick={() => onPlayTracks(activeEntity.tracks, currentPlaybackContext)}><Play size={16} fill="currentColor" /> 播放全部</button>
                  <button disabled={!activeEntity.tracks.length} onClick={() => setPlaylistPicker({ trackIds: activeEntity.tracks.map((track) => track.id), trackTitle: activeEntity.name })}><ListPlus size={16} /> 收藏到歌单</button>
                </div>
              </div>
            </section>

            {entityLoading && <div className="library-entity-loading"><LoaderCircle size={15} /> {activeEntity.type === 'chart' ? '正在加载榜单歌曲' : '正在补全作品'}</div>}
            {entityError && <section className="library-source-state is-entity-error"><Trophy size={22} /><strong>歌曲暂时无法载入</strong><span>{entityError}</span></section>}

            {activeEntity.type === 'artist' && entityAlbums.length > 0 && (
              <section className="library-home-section library-entity-albums">
                <header><span><Album size={17} /><strong>专辑</strong></span><small>{entityAlbums.length} 张已发现专辑</small></header>
                <div className="library-home-albums">
                  {entityAlbums.slice(0, 6).map((album) => <button key={album.id} onClick={() => openAlbum(album)}><ArtworkImage src={album.cover} alt="" /><span><strong>{album.name}</strong><small>{album.tracks.length} 首歌曲</small></span></button>)}
                </div>
              </section>
            )}

            {(activeEntity.tracks.length > 0 || (!entityLoading && !entityError)) && <section className="library-entity-tracks">
              <header><span><ListMusic size={17} /><strong>{activeEntity.type === 'artist' ? '热门作品' : '歌曲'}</strong></span><small>{query ? `当前显示 ${visibleTracks.length} 首` : `共 ${activeEntity.tracks.length} 首`}</small></header>
              {renderTrackTable()}
            </section>}
          </div>
        ) : activeCollection === 'home' && !query ? (
          <div className="library-home library-source-home library-recommendation-page">
            <section className="library-home-section library-recommendation-daily">
              <header><span><CalendarDays size={18} /><strong>每日推荐</strong><small>{dailyRecommendationCopy}</small></span><button className="library-section-link" disabled={!dailyTracks.length} onClick={() => onPlayTracks(dailyTracks, { kind: 'discovery', id: `daily:${new Date().toISOString().slice(0, 10)}`, title: '每日推荐' })}><Play size={14} fill="currentColor" /> 播放全部</button></header>
              {dailyTracks.length ? <div className="library-recommendation-layout">
                <button className="library-daily-collection library-recommendation-mix" onClick={() => onPlayTracks(dailyTracks, { kind: 'discovery', id: `daily:${new Date().toISOString().slice(0, 10)}`, title: '每日推荐' })} aria-label="播放今日推荐">
                  <span className="library-daily-mosaic">{dailyTracks.slice(0, 4).map((track) => <ArtworkImage key={track.id} src={track.cover} alt="" loading="eager" />)}<b><CalendarDays size={15} /> {new Date().getDate()}</b><i><Play size={18} fill="currentColor" /></i></span>
                  <span><strong>今日 {dailyTracks.length} 首</strong><small>跨平台甄选</small></span><ChevronRight size={18} />
                </button>
                {renderDesktopTrackRows(dailyTracks, `daily:${new Date().toISOString().slice(0, 10)}`, '每日推荐', 5)}
              </div> : <div className="library-daily-loading"><LoaderCircle size={20} /><span>{discoveryStatus === 'error' ? '每日推荐暂时不可用' : '正在更新每日推荐'}</span></div>}
            </section>

            {discoveryStatus === 'error' && !sourceDiscovery && (
              <section className="library-source-state">
                <RadioTower size={25} /><strong>音乐发现暂时不可用</strong><span>{discoveryError}</span><button onClick={() => refreshDiscovery(true)}><RefreshCw size={15} /> 重新加载</button>
              </section>
            )}
            {discoveryStatus === 'loading' && !sourceDiscovery && (
              <section className="library-source-state is-loading"><LoaderCircle size={25} /><strong>正在连接音乐平台</strong><span>获取最新音乐内容</span></section>
            )}

            {sourceDiscovery && <>
              {homeRecommendationTracks.length > 0 && <section className="library-home-section library-recommendation-picks">
                <header><span><Sparkles size={18} /><strong>为你精选</strong><small>{hasPersonalizationSignals ? '结合你的收藏' : '跨平台挑选'}</small></span><button className="library-section-link" onClick={() => onPlayTracks(homeRecommendationTracks, { kind: 'discovery', id: 'home:picks', title: '为你精选' })}><Play size={14} fill="currentColor" /> 播放</button></header>
                {renderDesktopTrackRows(homeRecommendationTracks, 'home:picks', '为你精选', 6)}
              </section>}

              {homeAlbumPicks.length > 0 && <section className="library-home-section library-recommendation-albums">
                <header><span><Disc3 size={18} /><strong>专辑推荐</strong><small>从今日内容继续发现</small></span></header>
                <div className="library-home-albums is-recommendation-albums">{homeAlbumPicks.map((album) => <button key={`home-album:${album.id}`} onClick={() => openAlbum(album)} aria-label={`查看专辑 ${album.name}`}><ArtworkImage src={album.cover} alt="" /><span><strong>{album.name}</strong><small>{album.artist}</small></span></button>)}</div>
              </section>}

              {homeFeaturedShelves.length > 0 && <section className="library-home-section library-more-curations">
                <header><span><Compass size={18} /><strong>适合此刻</strong><small>按场景与状态整理</small></span><button className="library-section-link" onClick={() => selectCollection('featured')}>全部选集 <ChevronRight size={15} /></button></header>
                <div className="library-home-curation-grid is-recommendation-grid">
                  {homeFeaturedShelves.map((shelf) => <button className="library-home-curation-card" key={shelf.id} onClick={() => openSourceShelf(shelf)} aria-label={`浏览${shelf.name}`}>
                    <span className="library-home-curation-covers">{shelf.tracks.slice(0, 3).map((track) => <ArtworkImage key={track.id} src={track.cover} alt="" />)}</span>
                    <span className="library-home-curation-copy"><span><small>{shelf.eyebrow}</small><strong>{shelf.name}</strong></span><i><ChevronRight size={15} /></i></span>
                  </button>)}
                </div>
              </section>}

              {homeCharts.length > 0 && <section className="library-home-section library-recommendation-trends">
                <header><span><BarChart3 size={18} /><strong>趋势速览</strong><small>各平台正在发生</small></span><button className="library-section-link" onClick={() => selectCollection('charts')}>全部榜单 <ChevronRight size={15} /></button></header>
                <div className="library-home-trend-strip">{homeCharts.slice(0, 4).map((chart) => <button key={`home-chart:${chart.id}`} data-music-source={sourceBrandKey(chart.source)} onClick={() => openSourceChart(chart)}>{renderChartArtwork(chart)}<span><small>{chart.eyebrow}</small><strong>{chart.name}</strong><em>{chart.tracks.slice(0, 2).map((track) => track.title).join(' · ') || chart.preview.slice(0, 2).map((track) => track.title).join(' · ') || '随平台更新'}</em></span><ChevronRight size={17} /></button>)}</div>
              </section>}

              {homeFreshPreviewTracks.length > 0 && <section className="library-home-section library-recommendation-fresh">
                <header><span><Clock3 size={18} /><strong>新鲜上架</strong><small>近期值得留意的新作</small></span><button className="library-section-link" onClick={() => selectCollection('new')}>进入新热 <ChevronRight size={15} /></button></header>
                {renderDesktopTrackRows(homeFreshPreviewTracks, 'home:fresh', '新鲜上架', 6)}
              </section>}
            </>}
          </div>
        ) : activeCollection === 'new' && !query ? (
          <div className="library-home library-destination-page library-new-page">
            <section className="library-destination-heading">
              <div><span><Flame size={16} /> 新作与趋势</span><h2>新作正在抵达</h2><p>按发布时间与全平台热度持续更新。</p></div>
              {newReleaseLeadTrack && <button className="library-new-lead" data-track-id={newReleaseLeadTrack.id} data-music-source={sourceBrandKey(newReleaseLeadTrack.source)} onContextMenu={(event) => openTrackSurfaceMenu(event, newReleaseLeadTrack, { tracks: freshTracks, context: { kind: 'discovery', id: 'new:fresh', title: '最新发布' } })} onClick={() => onPlayTrack(newReleaseLeadTrack, { tracks: freshTracks, context: { kind: 'discovery', id: 'new:fresh', title: '最新发布' } })}><ArtworkImage src={newReleaseLeadTrack.cover} alt="" /><span><small>最新发布</small><strong>{newReleaseLeadTrack.title}</strong><em>{newReleaseLeadTrack.artist} · {newReleaseLeadTrack.album}</em></span><i><Play size={18} fill="currentColor" /></i></button>}
            </section>

            {discoveryStatus === 'error' && !sourceDiscovery && <section className="library-source-state"><RadioTower size={25} /><strong>新热内容暂时不可用</strong><span>{discoveryError}</span><button onClick={() => refreshDiscovery(true)}><RefreshCw size={15} /> 重新加载</button></section>}
            {discoveryStatus === 'loading' && !sourceDiscovery && <section className="library-source-state is-loading"><LoaderCircle size={25} /><strong>正在更新新热内容</strong><span>获取近期发行与热听趋势</span></section>}

            {sourceDiscovery && <>
              {newReleaseRailTracks.length > 0 && <section className="library-home-section">
                <header><span><Sparkles size={18} /><strong>新作选集</strong><small>{newReleaseRailTracks.length} 首</small></span><button className="library-section-link" onClick={() => onPlayTracks(freshTimeline, { kind: 'discovery', id: 'new:fresh', title: '最新发布' })}><Play size={14} fill="currentColor" /> 播放全部</button></header>
                {renderDesktopTrackGrid(newReleaseRailTracks, 'new:fresh', '最新发布', 6)}
              </section>}
              <section className="library-home-section library-new-streams">
                <header><span><Waves size={18} /><strong>趋势与上新</strong><small>持续更新</small></span></header>
                <div className="library-new-hot-grid">
                  {trendingTracks.length > 0 && <article className="library-aggregate-lane is-hot"><header><span><i><Flame size={15} /></i><span><strong>热听趋势</strong><small>跨平台热度聚合</small></span></span><button onClick={() => onPlayTracks(trendingTracks, { kind: 'discovery', id: 'new:hot', title: '热听趋势' })} aria-label="播放热听趋势"><Play size={14} fill="currentColor" /></button></header><div>{trendingTracks.map((track, index) => <button key={`hot:${track.id}`} data-music-source={sourceBrandKey(track.source)} onContextMenu={(event) => openTrackSurfaceMenu(event, track, { tracks: trendingTracks, context: { kind: 'discovery', id: 'new:hot', title: '热听趋势' } })} onClick={() => onPlayTrack(track, { tracks: trendingTracks, context: { kind: 'discovery', id: 'new:hot', title: '热听趋势' } })}><b>{String(index + 1).padStart(2, '0')}</b><ArtworkImage src={track.cover} alt="" /><span><strong>{track.title}</strong><small>{track.artist} · {track.album}</small></span><em><i />{track.source}</em></button>)}</div></article>}
                  {latestFeedTracks.length > 0 && <article className="library-aggregate-lane is-fresh"><header><span><i><Clock3 size={15} /></i><span><strong>刚刚上新</strong><small>按发布时间更新</small></span></span><button onClick={() => onPlayTracks(latestFeedTracks, { kind: 'discovery', id: 'new:recent', title: '刚刚上新' })} aria-label="播放刚刚上新"><Play size={14} fill="currentColor" /></button></header><div>{latestFeedTracks.map((track) => <button key={`recent:${track.id}`} data-music-source={sourceBrandKey(track.source)} onContextMenu={(event) => openTrackSurfaceMenu(event, track, { tracks: latestFeedTracks, context: { kind: 'discovery', id: 'new:recent', title: '刚刚上新' } })} onClick={() => onPlayTrack(track, { tracks: latestFeedTracks, context: { kind: 'discovery', id: 'new:recent', title: '刚刚上新' } })}><b>新</b><ArtworkImage src={track.cover} alt="" /><span><strong>{track.title}</strong><small>{track.artist} · {track.album}</small></span><em><i />{track.source}</em></button>)}</div></article>}
                </div>
              </section>
            </>}
          </div>
        ) : activeCollection === 'featured' && !query ? (
          <div className="library-home library-featured-page library-source-featured">
            {spotlightTrack && spotlightShelf && <section className="library-curation-editorial">
              <button className="library-curation-primary" data-shelf-id={spotlightShelf.id} onClick={() => openSourceShelf(spotlightShelf)}>
                <span className="library-curation-primary-art">{spotlightShelf.tracks.slice(0, 4).map((track) => <ArtworkImage key={`editorial:${track.id}`} src={track.cover} alt="" loading="eager" />)}</span>
                <span className="library-curation-primary-copy"><small>{spotlightShelf.eyebrow}</small><strong>{spotlightShelf.name}</strong><p>{spotlightShelf.description}</p><em>{spotlightShelf.tracks.length} 首 · 跨平台更新</em><i>打开选集 <ChevronRight size={15} /></i></span>
              </button>
              <div className="library-curation-preview"><header><strong>本期选曲</strong><button onClick={() => onPlayTracks(spotlightShelf.tracks, { kind: 'discovery', id: `shelf:${spotlightShelf.id}`, title: spotlightShelf.name })} aria-label={`播放${spotlightShelf.name}`}><Play size={14} fill="currentColor" /></button></header>{spotlightShelf.tracks.slice(0, 4).map((track, index) => <button key={`editorial-track:${track.id}`} data-music-source={sourceBrandKey(track.source)} onClick={() => onPlayTrack(track, { tracks: spotlightShelf.tracks, context: { kind: 'discovery', id: `shelf:${spotlightShelf.id}`, title: spotlightShelf.name } })}><b>{String(index + 1).padStart(2, '0')}</b><ArtworkImage src={track.cover} alt="" /><span><strong>{track.title}</strong><small>{track.artist}</small></span><Play size={14} fill="currentColor" /></button>)}</div>
            </section>}

            {discoveryStatus === 'error' && !sourceDiscovery && <section className="library-source-state"><RadioTower size={25} /><strong>主题内容暂时不可用</strong><span>{discoveryError}</span><button onClick={() => refreshDiscovery(true)}><RefreshCw size={15} /> 重新加载</button></section>}
            {discoveryStatus === 'loading' && !sourceDiscovery && <section className="library-source-state is-loading"><LoaderCircle size={25} /><strong>正在加载主题内容</strong><span>获取最新精选内容</span></section>}

            {sourceDiscovery && <>
              {curatedCollectionGroups.map((group) => <section className={`library-home-section library-curated-group${group.shelves.length === 1 ? ' is-single' : ''}`} key={group.id}>
                <header><span><Sparkles size={18} /><strong>{group.label}</strong></span><small>{group.shelves.length} 个选集</small></header>
                <div className="library-curation-grid">
                  {group.shelves.map((shelf) => <button key={shelf.id} data-shelf-id={shelf.id} onClick={() => openSourceShelf(shelf)}>
                    <span className="library-curation-covers">{shelf.tracks.slice(0, 3).map((track) => <ArtworkImage key={track.id} src={track.cover} alt="" />)}</span>
                    <span className="library-curation-copy"><small>{shelf.eyebrow}</small><strong>{shelf.name}</strong><p>{shelf.tracks.slice(0, 2).map((track) => track.title).join(' · ')}</p><em>{shelf.tracks.length} 首 · {new Set(shelf.tracks.map((track) => track.source)).size} 个平台</em></span>
                  </button>)}
                </div>
              </section>)}

              {collectionListeningTracks.length > 0 && <section className="library-home-section library-collection-listening">
                <header><span><Headphones size={18} /><strong>选集中热听</strong><small>来自本期主题</small></span><button className="library-section-link" onClick={() => onPlayTracks(collectionListeningTracks, { kind: 'discovery', id: 'collections:listening', title: '选集中热听' })}><Play size={14} fill="currentColor" /> 播放</button></header>
                {renderDesktopTrackRows(collectionListeningTracks, 'collections:listening', '选集中热听', 8)}
              </section>}
            </>}
          </div>
        ) : activeCollection === 'charts' && !query ? (
          <div className="library-home library-charts-page">
            <section className="library-charts-hero">
              <div>
                <span><Trophy size={17} /> 平台官方榜单</span>
                <h2>正在发生的声音</h2>
                <p>纵览各平台的热歌、新歌与趋势排行，曲目顺序随平台持续更新。</p>
                <button disabled={!activeLeadingChart} onClick={() => activeLeadingChart && openSourceChart(activeLeadingChart)}><ListMusic size={16} /> 浏览核心榜</button>
              </div>
              {activeLeadingChart && <button className="library-chart-spotlight" data-music-source={sourceBrandKey(activeLeadingChart.source)} onClick={() => openSourceChart(activeLeadingChart)}><span className="library-chart-cover">{renderChartArtwork(activeLeadingChart, true)}</span><span><small>{activeLeadingChart.eyebrow} · 平台榜单</small><strong>{activeLeadingChart.name}</strong><em>{activeLeadingChart.updatedAt ? `更新于 ${activeLeadingChart.updatedAt}` : activeLeadingChart.updateFrequency || '随平台更新'}</em></span><ChevronRight size={20} /></button>}
            </section>

            {availableChartSections.length > 0 && <nav className="library-chart-source-filter" aria-label="榜单平台">
              <button className={chartSource === 'all' ? 'is-active' : ''} onClick={() => setChartSource('all')}>全部平台 <small>{sourceCharts.length}</small></button>
              {availableChartSections.map((section) => <button className={chartSource === section.id ? 'is-active' : ''} data-music-source={sourceBrandKey(section.id)} key={section.id} onClick={() => setChartSource(section.id)}>{section.name} <small>{section.charts.length}</small></button>)}
            </nav>}

            {discoveryStatus === 'error' && !sourceDiscovery && <section className="library-source-state"><Trophy size={25} /><strong>榜单暂时不可用</strong><span>{discoveryError}</span><button onClick={() => refreshDiscovery(true)}><RefreshCw size={15} /> 重新加载</button></section>}
            {discoveryStatus === 'loading' && !sourceDiscovery && <section className="library-source-state is-loading"><LoaderCircle size={25} /><strong>正在更新榜单</strong><span>获取各平台榜单数据</span></section>}

            {sourceDiscovery && chartSections.map((section) => <section className={`library-home-section library-chart-section is-${section.id}`} key={section.id}>
              <header><span><BarChart3 size={18} /><strong>{section.name}</strong></span>{chartSource === 'all' && availableChartSections.find((item) => item.id === section.id)!.charts.length > section.charts.length && <button className="library-section-link" onClick={() => setChartSource(section.id)}>查看全部 <ChevronRight size={15} /></button>}</header>
              <div className={chartGridClass(section.charts.length)}>{section.charts.map(renderSourceChart)}</div>
            </section>)}
            {sourceDiscovery && !sourceCharts.length && <section className="library-source-state"><Trophy size={25} /><strong>平台榜单暂时不可用</strong><span>歌曲搜索仍可正常使用，请稍后重新加载榜单。</span><button onClick={() => refreshDiscovery(true)}><RefreshCw size={15} /> 重新加载</button></section>}
          </div>
        ) : activeCollection === 'providers' && !query ? (
          <div className="library-home library-destination-page library-providers-page">
            <section className="library-destination-heading library-platform-heading">
              <div><span><Globe2 size={16} /> 音乐平台</span><h2>按来源浏览</h2><p>进入平台热听、专辑与官方榜单。</p></div>
              <strong>{availableSourceProviders.length}<small> 个平台可用</small></strong>
            </section>

            {discoveryStatus === 'error' && !sourceDiscovery && <section className="library-source-state"><RadioTower size={25} /><strong>平台内容暂时不可用</strong><span>{discoveryError}</span><button onClick={() => refreshDiscovery(true)}><RefreshCw size={15} /> 重新加载</button></section>}
            {discoveryStatus === 'loading' && !sourceDiscovery && <section className="library-source-state is-loading"><LoaderCircle size={25} /><strong>正在连接音乐平台</strong><span>获取平台内容</span></section>}

            {sourceDiscovery && sourceProviders.length > 0 && <>
              <nav className="library-provider-selector" aria-label="音乐平台">
                {sourceProviders.map((provider) => <button key={provider.source} data-music-source={sourceBrandKey(provider.source)} className={activeProvider?.source === provider.source ? 'is-active' : ''} disabled={provider.available === false || !provider.tracks.length} onClick={() => setMobileProviderSource(provider.source)}><i /><span><strong>{provider.name}</strong><small>{provider.available !== false && provider.tracks.length ? `${provider.tracks.length} 首内容` : '暂不可用'}</small></span></button>)}
              </nav>
              {activeProvider && <section className="library-home-section library-provider-focus" data-music-source={sourceBrandKey(activeProvider.source)}>
                <header><span><RadioTower size={18} /><strong>{activeProvider.name}热听</strong><small>{activeProvider.tracks.length} 首可听内容</small></span><button className="library-section-link" onClick={() => openProviderLane(activeProvider)}>全部歌曲 <ChevronRight size={15} /></button></header>
                {renderDesktopTrackGrid(activeProvider.tracks, `provider:${activeProvider.source}`, activeProvider.name, 8)}
              </section>}
              {activeProviderAlbums.length > 1 && <section className="library-home-section library-provider-albums">
                <header><span><Disc3 size={18} /><strong>专辑</strong><small>{activeProvider.name}</small></span></header>
                <div className="library-home-albums">{activeProviderAlbums.map((album) => <button key={album.id} onClick={() => openAlbum(album)} aria-label={`查看专辑 ${album.name}`}><ArtworkImage src={album.cover} alt="" /><span><strong>{album.name}</strong><small>{album.artist}</small></span></button>)}</div>
              </section>}
              {activeProviderCharts.length > 0 && <section className="library-home-section library-provider-charts">
                <header><span><BarChart3 size={18} /><strong>官方榜单</strong><small>{activeProvider.name}</small></span><button className="library-section-link" onClick={() => { setChartSource(activeProvider.source); selectCollection('charts') }}>全部榜单 <ChevronRight size={15} /></button></header>
                <div className={chartGridClass(activeProviderCharts.length)}>{activeProviderCharts.map(renderSourceChart)}</div>
              </section>}
            </>}
            {sourceDiscovery && !sourceProviders.length && <section className="library-source-state"><Globe2 size={25} /><strong>平台内容暂时不可用</strong><span>稍后重新加载。</span><button onClick={() => refreshDiscovery(true)}><RefreshCw size={15} /> 重新加载</button></section>}
          </div>
        ) : activeCollection === 'home' && resultMode === 'albums' ? (
          <div className="library-group-list">
            {albumGroups.map((album) => <button key={album.id} onClick={() => openAlbum(album)}><ArtworkImage src={album.cover} alt="" /><span><strong>{album.name}</strong><small>{album.artist} · {album.tracks.length} 首</small></span><span>查看专辑</span></button>)}
            {!albumGroups.length && <div className={`library-empty ${searchStatus === 'loading' ? 'is-loading' : ''}`}>{searchStatus === 'loading' ? <LoaderCircle size={24} /> : <Album size={23} />}<strong>{emptyTitle}</strong><span>{emptyDetail}</span></div>}
          </div>
        ) : activeCollection === 'home' && resultMode === 'artists' ? (
          <div className="library-group-list artist-groups">
            {artistGroups.map((artist) => <button key={artist.id} onClick={() => openArtist(artist)}><ArtworkImage src={artist.cover} alt="" /><span><strong>{artist.name}</strong><small>{artist.tracks.length} 首作品</small></span><span>查看艺人</span></button>)}
            {!artistGroups.length && <div className={`library-empty ${searchStatus === 'loading' ? 'is-loading' : ''}`}>{searchStatus === 'loading' ? <LoaderCircle size={24} /> : <UserRound size={23} />}<strong>{emptyTitle}</strong><span>{emptyDetail}</span></div>}
          </div>
        ) : (
          renderTrackTable()
        )}
      </div></>}
      {trackMenu && <ContextMenu x={trackMenu.x} y={trackMenu.y} items={contextItems(trackMenu.track, trackMenu.selection)} onClose={() => setTrackMenu(null)} />}
      {playlistMenu && <ContextMenu x={playlistMenu.x} y={playlistMenu.y} items={playlistContextItems(playlistMenu.playlist)} onClose={() => setPlaylistMenu(null)} />}
      {playlistPicker && createPortal(
        <div className="playlist-picker-backdrop" onPointerDown={() => setPlaylistPicker(null)}>
          <section className="playlist-picker" role="dialog" aria-label={`添加 ${playlistPicker.trackTitle} 到歌单`} onPointerDown={(event) => event.stopPropagation()}>
            <header><div><strong>添加到歌单</strong><small>{playlistPicker.trackTitle}</small></div>{mobile && <button className="playlist-picker-mobile-create" onClick={() => { const trackIds = playlistPicker.trackIds; setPlaylistPicker(null); openPlaylistEditor('create', undefined, trackIds) }}><Plus size={15} /> 新建</button>}<button onClick={() => setPlaylistPicker(null)} title="关闭" aria-label="关闭歌单选择"><X size={17} /></button></header>
            <div className="playlist-picker-list">
              {playlists.map((playlist) => {
                const alreadyAdded = playlistPicker.trackIds.every((id) => playlist.trackIds.includes(id))
                return <button key={playlist.id} disabled={alreadyAdded} onClick={() => addToPlaylist(playlistPicker.trackIds, playlist.id)}><span><Music2 size={16} /></span><span><strong>{playlist.name}</strong><small>{playlist.trackIds.length} 首歌曲</small></span><em>{alreadyAdded ? <><Check size={13} /> 已添加</> : '添加'}</em></button>
              })}
            </div>
            {!mobile && <footer><button onClick={() => { const trackIds = playlistPicker.trackIds; setPlaylistPicker(null); openPlaylistEditor('create', undefined, trackIds) }}><Plus size={16} /> 新建歌单并添加</button></footer>}
          </section>
        </div>, overlayPortalTarget
      )}
      {playlistEditor && createPortal(
        <div className="playlist-editor-backdrop" onPointerDown={() => setPlaylistEditor(null)}>
          <form className="playlist-editor" role="dialog" aria-label={playlistEditor.mode === 'create' ? '新建歌单' : '编辑歌单'} onSubmit={savePlaylist} onPointerDown={(event) => event.stopPropagation()}>
            <header>
              <button className="playlist-editor-mobile-cancel" type="button" onClick={() => setPlaylistEditor(null)}>取消</button>
              <span className="playlist-editor-icon"><ListMusic size={19} /></span>
              <div><strong>{playlistEditor.mode === 'create' ? '新建歌单' : '编辑歌单'}</strong><small>{playlistEditor.mode === 'create' ? pendingPlaylistTrackIds.length ? '创建后将歌曲添加到新歌单' : '创建一个新的音乐集合' : '修改歌单名称'}</small></div>
              <button className="playlist-editor-mobile-submit" type="submit" disabled={!playlistName.trim()}>完成</button>
              <button className="playlist-editor-close" type="button" onClick={() => setPlaylistEditor(null)} title="关闭" aria-label="关闭"><X size={18} /></button>
            </header>
            <label><span>歌单名称</span><input autoFocus value={playlistName} maxLength={32} onChange={(event) => setPlaylistName(event.target.value)} placeholder="输入歌单名称" aria-label="歌单名称" /><small>{playlistName.trim().length}/32</small></label>
            <footer><button type="button" onClick={() => setPlaylistEditor(null)}>取消</button><button className="is-primary" disabled={!playlistName.trim()}>{playlistEditor.mode === 'create' ? '创建歌单' : '保存修改'}</button></footer>
          </form>
        </div>, overlayPortalTarget
      )}
    </section>
  )
}
