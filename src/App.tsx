import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentNavigationRequest } from './components/AgentSessionSpace'
import type { LibraryNavigationRequest, MobileLibrarySection } from './components/LibrarySpace'
import { defaultPlaybackSettings, readAppSettings, writeAppSettings } from './appSettings'
import type { AppSettings, MusicSourceSettings } from './appSettings'
import { readAudioEffects, writeAudioEffects } from './audioEffects'
import { clearPlaybackSession, readPlaybackSession, writePlaybackSession } from './playbackSession'
import type { PlaybackSession } from './playbackSession'
import { applyTrackLayout, captureTrackLayout, layoutQueueTracks } from './queueLayout'
import { likedTrackSnapshot, readLikedTracks, writeLikedTracks } from './likedTracks'
import { getNextTrackId, getPreviousTrackId } from './playbackOrder'
import { createAgentSession, mergeAgentConstraints, readAgentSessions, writeAgentSessions } from './agentSessions'
import type { AgentMessage, AgentPreferences, AgentRun, AgentSession } from './agentSessions'
import { learnAgentMemoriesFromConversation, mergeAgentMemories, readAgentMemories, writeAgentMemories } from './agentMemories'
import type { LocalMusicFolder } from './nativeMusicFolders'
import { createMediaBridgeUrl, inspectMusicCatalogSources, loadMusicChartDetail, loadMusicCharts, searchMusicCatalog } from './musicCatalog'
import type { MusicCatalogSourceStatus } from './musicCatalog'
import { loadSourceDiscovery, readSourceDiscoveryCache, sourceDiscoveryFreshnessMs, writeSourceDiscoveryCache } from './sourceDiscovery'
import type { SourceDiscoveryCatalog } from './sourceDiscovery'
import { resolvePlaybackShortcut } from './playbackShortcuts'
import { inspectMusicSource, normalizeMusicSourceCapabilities, resolveTrackAudio, updateMusicSourceProviderCatalog, updateMusicSourceProviderHealth, updateMusicSourceProviderPlayback } from './musicSource'
import type { MusicSourceStatus } from './musicSource'
import { recordMusicSourceHealth } from './musicSourceHealth'
import { playbackHealthReason, reportMusicPlaybackHealth } from './musicPlaybackHealth'
import { artistTokens, isSameTrackVersion, normalizeTrackIdentity, rankSourceFallbacks, resolveSourceFallback } from './sourceFallback'
import { readRemoteCatalog, writeRemoteCatalog } from './remoteCatalog'
import { fetchTrackLyrics, trackLyricsKey } from './lyrics'
import type { LyricLine } from './lyrics'
import type { LxQuality, OnlineSource, PlaybackMode, PlaybackRate, QualityMode, Track, Workspace } from './types'
import { useAudioPlayback } from './useAudioPlayback'
import { usePlaybackWakeLock, useSystemMediaSession } from './useSystemPlayback'
import { detectRuntimeCapabilities } from './runtimeCapabilities'
import { arrangeListeningTracks, createListeningPlan, createLocalListeningPlan, interleaveDiscoveredTracks, isAiConfigured, preferCanonicalTrackVersions } from './listeningAgent'
import { collapseTrackVariants } from './libraryDiscovery'
import { defaultUserProfile, readUserProfile, writeUserProfile } from './userProfile'
import { clearTransientAppCache, clearUsageHistory } from './storageMaintenance'
import { clearPlaybackCache, prunePlaybackCache } from './playbackCache'
import { assertDownloadSpace, createDownloadScheduler, downloadFileName, downloadResponseWithSingleRetry, readDownloadStates, triggerBrowserDownload, writeDownloadStates } from './downloadManager'
import type { TrackDownloadState } from './downloadManager'
import { agentPlaybackContext, defaultPlaybackContext, reconcileQueuePlaybackState, restoredPlaybackContext } from './playbackContext'
import type { PlaybackApplyMode, PlaybackContext, PlaybackSelection } from './playbackContext'
import { applyApplicationUpdate, checkForApplicationUpdate, initialApplicationUpdateState } from './applicationUpdate'
import { brandMarkPath, isBrandArtwork } from './brandAssets'
import { canReusePlaybackResource, claimAutomaticPlaybackRetry, hasSameLocalResource, hasSameRemoteIdentity, localPlaybackTrack, mergePlaybackResource, needsRemotePlaybackRefresh, remoteTrackIdentity, unresolvedPlaybackTrack } from './playbackRecovery'
import { createPlaybackProgressStore } from './playbackProgress'
import { cloudAuth, cloudCapabilities } from './cloudApi'
import { loadCustomAiCredential, queueCloudSnapshot, syncCustomAiCredential } from './cloudSync'
import { useCloudSession } from './useCloudSession'

type Appearance = 'dark' | 'light'
type PaletteId = 'rose' | 'amber' | 'lime' | 'mint' | 'cyan' | 'blue' | 'violet'
type HeaderPanel = 'theme' | 'sources' | 'effects' | 'settings' | null
type SettingsView = 'root' | 'general' | 'source' | 'content' | 'local' | 'ai' | 'data' | 'about'
type SystemNotice = { message: string; tone: 'success' | 'info' }
type LyricsState = { status: 'idle' | 'loading' | 'ready' | 'unavailable'; lines: LyricLine[]; message: string }

const downloadScheduler = createDownloadScheduler(2)

const palettes: { id: PaletteId; label: string; dark: string; light: string }[] = [
  { id: 'rose', label: '玫瑰', dark: '#ff6f91', light: '#d94f6d' },
  { id: 'amber', label: '琥珀', dark: '#ffc857', light: '#b86b00' },
  { id: 'lime', label: '青柠', dark: '#b8e96b', light: '#5c8b21' },
  { id: 'mint', label: '薄荷', dark: '#52d6c7', light: '#087f74' },
  { id: 'cyan', label: '天青', dark: '#55c7ee', light: '#0b789c' },
  { id: 'blue', label: '靛蓝', dark: '#8ea3ff', light: '#4e6fc6' },
  { id: 'violet', label: '紫藤', dark: '#c49aff', light: '#7a56b3' },
]

const defaultPalettes: Record<Appearance, PaletteId> = { dark: 'rose', light: 'blue' }
const isPaletteId = (value: unknown): value is PaletteId => palettes.some((palette) => palette.id === value)
const resolvedQualityLabels: Record<LxQuality, string> = { '128k': 'MP3 128 kbps', '320k': 'MP3 320 kbps', flac: 'FLAC 无损', flac24bit: 'FLAC Hi-Res' }
const sourcePhaseLabels: Record<MusicSourceStatus['phase'], string> = { checking: '载入中', ready: '内容可用', degraded: '部分异常', error: '不可用' }
const initialSourceStatus = (): MusicSourceStatus => ({
  phase: 'checking',
  providers: normalizeMusicSourceCapabilities({}),
  message: '正在检测音乐服务',
  checkedAt: null,
  activity: null,
})

const upsertTracks = (current: Track[], additions: Track[]) => {
  const tracks = new Map(current.map((track) => [track.id, track]))
  additions.forEach((track) => tracks.set(track.id, track))
  return Array.from(tracks.values())
}

let sourceDiscoveryRequest: Promise<SourceDiscoveryCatalog> | null = null
let sourceDiscoverySignature = ''
let localLibraryRequest: Promise<typeof import('./localLibrary')> | null = null
let nativeMusicFoldersRequest: Promise<typeof import('./nativeMusicFolders')> | null = null

const loadLocalLibrary = () => localLibraryRequest ??= import('./localLibrary')
const loadNativeMusicFolders = () => nativeMusicFoldersRequest ??= import('./nativeMusicFolders')

export const readAppearance = (
  storage: Pick<Storage, 'getItem'> = localStorage,
  prefersDark = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches,
): Appearance => {
  const stored = storage.getItem('echora.appearance')
  if (stored === 'light' || stored === 'dark') return stored
  return prefersDark ? 'dark' : 'light'
}

const readPalettes = (): Record<Appearance, PaletteId> => {
  try {
    const stored = JSON.parse(localStorage.getItem('echora.palettes') ?? '{}') as Partial<Record<Appearance, unknown>>
    return {
      dark: isPaletteId(stored.dark) ? stored.dark : defaultPalettes.dark,
      light: isPaletteId(stored.light) ? stored.light : defaultPalettes.light,
    }
  } catch {
    return defaultPalettes
  }
}

export function useEchoraController() {
  const [runtime] = useState(detectRuntimeCapabilities)
  const cloud = useCloudSession()
  const [appSettings, setAppSettings] = useState<AppSettings>(readAppSettings)
  const playbackSettings = appSettings.playback ?? defaultPlaybackSettings
  const [audioEffects, setAudioEffects] = useState(readAudioEffects)
  const [initialSession] = useState(() => appSettings.resumePlayback ? readPlaybackSession() : null)
  const [playbackProgressStore] = useState(() => createPlaybackProgressStore(initialSession?.playProgress ?? 0))
  const playProgressRef = useRef(initialSession?.playProgress ?? 0)
  const setPlayProgress = useCallback((nextProgress: number) => {
    const normalized = Number.isFinite(nextProgress) ? Math.min(100, Math.max(0, nextProgress)) : 0
    playProgressRef.current = normalized
    playbackProgressStore.set(normalized)
  }, [playbackProgressStore])
  const [appearance, setAppearance] = useState<Appearance>(readAppearance)
  const [paletteByAppearance, setPaletteByAppearance] = useState<Record<Appearance, PaletteId>>(readPalettes)
  const [followTrackPalette, setFollowTrackPalette] = useState(() => localStorage.getItem('echora.followTrackPalette') === 'true')
  const [headerPanel, setHeaderPanel] = useState<HeaderPanel>(null)
  const [accountOpen, setAccountOpen] = useState(false)
  const [echoraAiStatus, setEchoraAiStatus] = useState<'checking' | 'available' | 'disabled' | 'unreachable'>('checking')
  const echoraAiAvailable = echoraAiStatus === 'available'
  const [settingsInitialView, setSettingsInitialView] = useState<SettingsView>('general')
  const [workspace, setWorkspace] = useState<Workspace>(() => appSettings.startupView === 'field' ? 'field' : 'library')
  const [libraryNavigation, setLibraryNavigation] = useState<LibraryNavigationRequest | null>(null)
  const [mobileLibrarySection, setMobileLibrarySection] = useState<MobileLibrarySection>('music')
  const [agentNavigation, setAgentNavigation] = useState<AgentNavigationRequest | null>(null)
  const [localTracks, setLocalTracks] = useState<Track[]>([])
  const [localMusicFolders, setLocalMusicFolders] = useState<LocalMusicFolder[]>([])
  const [localFolderBusyIds, setLocalFolderBusyIds] = useState<string[]>([])
  const [localLibraryLocation, setLocalLibraryLocation] = useState(() => runtime.kind === 'mobile' ? 'Echora 应用存储 / 离线音乐' : runtime.kind === 'web' ? '由浏览器管理下载位置' : '正在读取应用目录')
  const [remoteCatalog, setRemoteCatalog] = useState<Track[]>(readRemoteCatalog)
  const [tracks, setTracks] = useState<Track[]>(() => {
    const restoredTracks = initialSession?.tracks ?? []
    return restoredTracks.length > 7 ? layoutQueueTracks(restoredTracks, initialSession?.intensity, initialSession?.novelty) : restoredTracks
  })
  const [detachedTrack, setDetachedTrack] = useState<Track | null>(initialSession?.detachedTrack ?? null)
  const [playbackContext, setPlaybackContext] = useState<PlaybackContext>(() => initialSession?.playbackContext ?? (initialSession ? restoredPlaybackContext : defaultPlaybackContext))
  const [activeTrackId, setActiveTrackId] = useState(initialSession?.activeTrackId ?? -1)
  const [isPlaying, setIsPlaying] = useState(initialSession?.isPlaying ?? false)
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(initialSession?.playbackMode ?? 'sequence')
  const [playbackRate, setPlaybackRate] = useState<PlaybackRate>(initialSession?.playbackRate ?? 1)
  const [volume, setVolume] = useState(initialSession?.volume ?? 72)
  const [muted, setMuted] = useState(initialSession?.muted ?? false)
  const [downloadedTrackIds, setDownloadedTrackIds] = useState<number[]>([])
  const [likedTracks, setLikedTracks] = useState(readLikedTracks)
  const [quality, setQuality] = useState<QualityMode>(initialSession?.quality ?? '无损')
  const [intensity, setIntensity] = useState(initialSession?.intensity ?? 64)
  const [novelty, setNovelty] = useState(initialSession?.novelty ?? 38)
  const [intent, setIntent] = useState(initialSession?.intent ?? '从音乐库开始，或描述此刻的聆听目标。')
  const [sessionName, setSessionName] = useState(initialSession?.sessionName ?? '新的音乐会话')
  const [runningAgentSessionIds, setRunningAgentSessionIds] = useState<string[]>([])
  const [agentSessions, setAgentSessions] = useState(readAgentSessions)
  const [agentMemories, setAgentMemories] = useState(readAgentMemories)
  const [userProfile, setUserProfile] = useState(readUserProfile)
  const [activeAgentSessionId, setActiveAgentSessionId] = useState(() => agentSessions.find((session) => session.status === 'active')?.id ?? agentSessions[0]?.id ?? '')
  const [notice, setNotice] = useState<SystemNotice | null>(null)
  const [applicationUpdate, setApplicationUpdate] = useState(initialApplicationUpdateState)
  const [resolvingTrackIds, setResolvingTrackIds] = useState<number[]>([])
  const [downloadingTrackIds, setDownloadingTrackIds] = useState<number[]>([])
  const [initialDownloadStates] = useState<Record<number, TrackDownloadState>>(() => runtime.hasLocalLibrary ? readDownloadStates() : {})
  const [downloadStates, setDownloadStates] = useState<Record<number, TrackDownloadState>>(initialDownloadStates)
  const [lyricsState, setLyricsState] = useState<LyricsState>({ status: 'idle', lines: [], message: '' })
  const [sourceStatus, setSourceStatus] = useState<MusicSourceStatus>(() => initialSourceStatus())
  const headerControlsRef = useRef<HTMLDivElement>(null)
  const returnWorkspaceRef = useRef<Workspace>('library')
  const accountReturnWorkspaceRef = useRef<Workspace>('library')
  const sessionRef = useRef<PlaybackSession | null>(null)
  const settingsRef = useRef(appSettings)
  const resolutionRequestsRef = useRef(new Map<string, Promise<Track>>())
  const downloadRequestsRef = useRef(new Set<string>())
  const downloadControllersRef = useRef(new Map<string, AbortController>())
  const downloadStatesRef = useRef<Record<number, TrackDownloadState>>(initialDownloadStates)
  const playbackRequestRef = useRef(0)
  const automaticPlaybackRetriesRef = useRef(new Set<number>())
  const sourceStatusRequestRef = useRef(0)
  const libraryNavigationKeyRef = useRef(0)
  const agentNavigationKeyRef = useRef(0)
  const activeAgentSessionIdRef = useRef(activeAgentSessionId)
  const agentRunControllersRef = useRef(new Map<string, AbortController>())
  const autoScannedFolderIdsRef = useRef(new Set<string>())
  const localTracksRef = useRef<Track[]>([])
  const localTracksRequestRef = useRef<Promise<Track[]> | null>(null)

  const loadInitialLocalTracks = () => {
    if (!runtime.hasLocalLibrary || (!runtime.native && !('indexedDB' in window))) return Promise.resolve([])
    localTracksRequestRef.current ??= loadLocalLibrary().then(({ readLocalTracks }) => readLocalTracks()).then((savedTracks) => {
      localTracksRef.current = savedTracks
      return savedTracks
    })
    return localTracksRequestRef.current
  }

  const baseCatalog = useMemo(() => upsertTracks(remoteCatalog, localTracks), [localTracks, remoteCatalog])
  const catalog = useMemo(() => upsertTracks(likedTracks.tracks, baseCatalog), [baseCatalog, likedTracks.tracks])
  const likedTrackIds = likedTracks.ids
  const activeTrack = tracks.find((track) => track.id === activeTrackId)
    ?? (detachedTrack?.id === activeTrackId ? detachedTrack : null)
    ?? tracks[0]
    ?? null
  const activeLyricsKey = activeTrack ? trackLyricsKey(activeTrack) : ''
  const orderedTracks = useMemo(() => [...tracks].sort((a, b) => a.x - b.x), [tracks])
  const activePalette = followTrackPalette && activeTrack ? palettes[Math.abs(activeTrack.id - 1) % palettes.length].id : paletteByAppearance[appearance]
  const activePaletteDefinition = palettes.find((palette) => palette.id === activePalette) ?? palettes[0]
  const activeAccent = appearance === 'dark' ? activePaletteDefinition.dark : activePaletteDefinition.light
  const navigationWorkspace = workspace === 'nowPlaying'
    ? returnWorkspaceRef.current
    : workspace === 'account'
      ? accountReturnWorkspaceRef.current
      : workspace
  const sourceConfigured = sourceStatus.phase !== 'error'
  const enhancedQualityEnabled = sourceStatus.phase === 'ready' || sourceStatus.phase === 'degraded'
  const availableOnlineSources = useMemo(() => sourceStatus.providers.filter((provider) => provider.registered).map((provider) => provider.source), [sourceStatus.providers])
  const availableOnlineSourceSignature = availableOnlineSources.join(',')
  const discoveryCacheSignature = `${availableOnlineSourceSignature}:featured-${appSettings.content.featuredTrackLimit}:charts-${appSettings.content.chartTrackLimit}`
  const busyTrackIds = useMemo(() => Array.from(new Set([...resolvingTrackIds, ...downloadingTrackIds])), [downloadingTrackIds, resolvingTrackIds])
  const sourceVariants = useMemo(() => {
    if (!activeTrack) return []
    if (!activeTrack.remote) return [activeTrack]
    const candidates = [activeTrack, ...catalog].filter((track) => track.remote && isSameTrackVersion(activeTrack, track))
    const bySource = new Map<Track['source'], Track>()
    candidates.forEach((track) => {
      if (track.source === activeTrack.source) {
        bySource.set(track.source, activeTrack)
        return
      }
      const current = bySource.get(track.source)
      if (!current || normalizeTrackIdentity(track.album) === normalizeTrackIdentity(activeTrack.album)) bySource.set(track.source, track)
    })
    return Array.from(bySource.values())
  }, [activeTrack, catalog])
  const relatedTracks = useMemo(() => {
    if (!activeTrack) return []
    const activeArtists = new Set(artistTokens(activeTrack.artist))
    const activeAlbum = normalizeTrackIdentity(activeTrack.album)
    const seen = new Set<string>()
    return catalog
      .filter((track) => track.id !== activeTrack.id && normalizeTrackIdentity(track.title) !== normalizeTrackIdentity(activeTrack.title))
      .map((track) => {
        const sameArtist = artistTokens(track.artist).some((artist) => activeArtists.has(artist))
        const sameAlbum = Boolean(activeAlbum && activeAlbum === normalizeTrackIdentity(track.album))
        return { track, score: (sameAlbum ? 2 : 0) + (sameArtist ? 1 : 0) }
      })
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)
      .flatMap(({ track }) => {
        const key = `${normalizeTrackIdentity(track.title)}:${artistTokens(track.artist).join(':')}`
        if (seen.has(key)) return []
        seen.add(key)
        return [track]
      })
      .slice(0, 8)
  }, [activeTrack, catalog])

  const toggleHeaderPanel = (panel: Exclude<HeaderPanel, null>) => setHeaderPanel((current) => current === panel ? null : panel)
  const changeVolume = (nextVolume: number) => {
    setVolume(nextVolume)
    setMuted(nextVolume === 0)
  }
  const toggleMute = () => {
    if (muted || volume === 0) {
      if (volume === 0) setVolume(60)
      setMuted(false)
      return
    }
    setMuted(true)
  }
  const changeWorkspace = (nextWorkspace: Workspace) => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setWorkspace(nextWorkspace)
    setHeaderPanel(null)
  }

  const openAgentView = (view: AgentNavigationRequest['view']) => {
    agentNavigationKeyRef.current += 1
    setAgentNavigation({ key: agentNavigationKeyRef.current, view })
    changeWorkspace('field')
  }

  const openAccountPage = () => {
    const currentWorkspace = workspace === 'nowPlaying' ? returnWorkspaceRef.current : workspace
    accountReturnWorkspaceRef.current = currentWorkspace === 'account' ? 'library' : currentWorkspace
    changeWorkspace('account')
  }

  const closeAccountPage = () => changeWorkspace(accountReturnWorkspaceRef.current === 'account' ? 'library' : accountReturnWorkspaceRef.current)
  const openAccount = () => {
    setHeaderPanel(null)
    setAccountOpen(true)
  }
  const closeAccount = () => setAccountOpen(false)

  const refreshMusicSourceStatus = useCallback(() => {
    const requestId = sourceStatusRequestRef.current + 1
    sourceStatusRequestRef.current = requestId
    setSourceStatus(initialSourceStatus())
    void inspectMusicSource(appSettings.musicSource, true).then(async (providers) => {
      if (sourceStatusRequestRef.current !== requestId) return
      const registeredCount = providers.filter((provider) => provider.registered).length
      const registeredSources = providers.filter((provider) => provider.registered).map((provider) => provider.source)
      let catalogStatuses: MusicCatalogSourceStatus[] = []
      let catalogFailure = ''
      try {
        catalogStatuses = await inspectMusicCatalogSources(registeredSources)
      } catch (error) {
        catalogFailure = error instanceof Error ? error.message : '音乐内容服务检测失败'
      }
      if (sourceStatusRequestRef.current !== requestId) return
      const checkedAt = Date.now()
      const checkedProviders = catalogFailure
        ? registeredSources.reduce((current, source) => updateMusicSourceProviderCatalog(current, source, 'error', catalogFailure, checkedAt), providers)
        : catalogStatuses.reduce((current, status) => updateMusicSourceProviderCatalog(current, status.source, status.status, status.message, checkedAt), providers)
      const catalogErrorCount = checkedProviders.filter((provider) => provider.registered && provider.catalogStatus === 'error').length
      setSourceStatus({
        phase: catalogErrorCount ? 'degraded' : 'ready',
        providers: checkedProviders,
        message: catalogErrorCount ? `${catalogErrorCount} 个音乐平台内容服务异常` : `${registeredCount} 个音乐平台内容可用`,
        checkedAt,
        activity: null,
      })
    }).catch((error: unknown) => {
      if (sourceStatusRequestRef.current !== requestId) return
      setSourceStatus({
        phase: 'error',
        providers: normalizeMusicSourceCapabilities({}),
        message: error instanceof Error ? error.message.replaceAll('音源', '音乐服务') : '音乐服务检测失败',
        checkedAt: Date.now(),
        activity: null,
      })
    })
  }, [appSettings.musicSource])

  const recordCatalogSourceStatuses = useCallback((statuses: MusicCatalogSourceStatus[]) => {
    if (!statuses.length) return
    const checkedAt = Date.now()
    setSourceStatus((current) => {
      const providers = statuses.reduce((nextProviders, status) => updateMusicSourceProviderCatalog(nextProviders, status.source, status.status, status.message, checkedAt), current.providers)
      const catalogErrorCount = providers.filter((provider) => provider.registered && provider.catalogStatus === 'error').length
      const playbackErrorCount = providers.filter((provider) => provider.registered && provider.playbackStatus === 'error').length
      const errorCount = new Set(providers.filter((provider) => provider.catalogStatus === 'error' || provider.playbackStatus === 'error').map((provider) => provider.source)).size
      return {
        ...current,
        phase: errorCount ? 'degraded' : current.phase === 'error' ? 'error' : 'ready',
        providers,
        message: errorCount
          ? `${errorCount} 个音乐平台最近服务异常`
          : playbackErrorCount ? current.message : `${providers.filter((provider) => provider.catalogStatus === 'available').length} 个音乐平台内容可用`,
      }
    })
  }, [])

  useEffect(() => localStorage.setItem('echora.appearance', appearance), [appearance])
  useEffect(() => localStorage.setItem('echora.palettes', JSON.stringify(paletteByAppearance)), [paletteByAppearance])
  useEffect(() => localStorage.setItem('echora.followTrackPalette', String(followTrackPalette)), [followTrackPalette])
  useEffect(() => {
    const icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><g transform="translate(0 1.4)" stroke="${activeAccent}" stroke-linecap="round" opacity=".28"><path d="M46 14.5A22 22 0 1 0 46 49.5" stroke-width="5.8"/><path d="M24.5 23.5h15M24.5 32h19M24.5 40.5h12.5" stroke-width="5.2"/></g><g stroke="${activeAccent}" stroke-linecap="round"><path d="M46 14.5A22 22 0 1 0 46 49.5" stroke-width="5.8"/><path d="M24.5 23.5h15M24.5 32h19M24.5 40.5h12.5" stroke-width="5.2"/></g><path d="M44.5 15.7A20.5 20.5 0 0 0 22.8 14" stroke="white" stroke-width="1.3" stroke-linecap="round" opacity=".44"/></svg>`
    if (icon) icon.href = `data:image/svg+xml,${encodeURIComponent(svg)}`
    if (themeColor) themeColor.content = appearance === 'dark' ? '#111318' : '#f5f7fa'
  }, [activeAccent, appearance])
  useEffect(() => writeLikedTracks(likedTracks), [likedTracks])
  useEffect(() => {
    const baseCatalogById = new Map(baseCatalog.map((track) => [track.id, track]))
    setLikedTracks((current) => {
      const snapshotIds = new Set(current.tracks.map((track) => track.id))
      const additions = current.ids.flatMap((id) => {
        const track = baseCatalogById.get(id)
        return track && !snapshotIds.has(id) ? [likedTrackSnapshot(track)] : []
      })
      return additions.length ? { ...current, tracks: [...current.tracks, ...additions] } : current
    })
  }, [baseCatalog])
  useEffect(() => writeAppSettings(appSettings), [appSettings])
  useEffect(() => {
    void prunePlaybackCache(runtime, appSettings.storage.playbackCacheLimitMb).catch(() => undefined)
  }, [appSettings.storage.playbackCacheLimitMb, runtime])
  useEffect(() => writeAudioEffects(audioEffects), [audioEffects])
  useEffect(() => writeAgentSessions(agentSessions), [agentSessions])
  useEffect(() => writeAgentMemories(agentMemories), [agentMemories])
  useEffect(() => writeUserProfile(userProfile), [userProfile])
  useEffect(() => writeRemoteCatalog(remoteCatalog), [remoteCatalog])
  useEffect(() => refreshMusicSourceStatus(), [refreshMusicSourceStatus])
  useEffect(() => {
    let current = true
    if (!cloud.online) {
      setEchoraAiStatus('unreachable')
      return () => { current = false }
    }
    setEchoraAiStatus('checking')
    void cloudCapabilities.ai()
      .then(({ available }) => { if (current) setEchoraAiStatus(available ? 'available' : 'disabled') })
      .catch(() => { if (current) setEchoraAiStatus('unreachable') })
    return () => { current = false }
  }, [cloud.online])

  useEffect(() => {
    if (cloud.syncPhase !== 'current') return
    queueCloudSnapshot('preferences', 'app')
  }, [appSettings, audioEffects, cloud.syncPhase])
  useEffect(() => {
    if (cloud.syncPhase !== 'current') return
    queueCloudSnapshot('appearance', 'app')
  }, [appearance, cloud.syncPhase, followTrackPalette, paletteByAppearance])
  useEffect(() => {
    if (cloud.syncPhase !== 'current') return
    queueCloudSnapshot('favorites', 'main')
  }, [cloud.syncPhase, likedTracks])
  useEffect(() => {
    if (cloud.syncPhase !== 'current') return
    queueCloudSnapshot('conversations', 'main')
  }, [agentSessions, cloud.syncPhase])
  useEffect(() => {
    if (cloud.syncPhase !== 'current') return
    queueCloudSnapshot('memories', 'main')
  }, [agentMemories, cloud.syncPhase])

  useEffect(() => {
    const applyCloudData = () => {
      setAppSettings(readAppSettings())
      setAppearance(readAppearance())
      setPaletteByAppearance(readPalettes())
      setFollowTrackPalette(localStorage.getItem('echora.followTrackPalette') === 'true')
      setLikedTracks(readLikedTracks())
      setAgentSessions(readAgentSessions())
      setAgentMemories(readAgentMemories())
    }
    window.addEventListener('echora:cloud-data-applied', applyCloudData)
    return () => window.removeEventListener('echora:cloud-data-applied', applyCloudData)
  }, [])

  useEffect(() => {
    setUserProfile(cloud.session
      ? { id: cloud.session.user.id, displayName: cloud.session.user.displayName, createdAt: cloud.session.user.createdAt }
      : defaultUserProfile())
  }, [cloud.session?.user.displayName, cloud.session?.user.id])

  useEffect(() => {
    if (!cloud.session || cloud.syncPhase !== 'current') return
    void loadCustomAiCredential().then((credential) => {
      if (!credential) return
      setAppSettings((current) => ({ ...current, ai: { ...current.ai, mode: 'custom', provider: credential.provider as AppSettings['ai']['provider'], baseUrl: credential.baseUrl, model: credential.model, apiKey: credential.apiKey } }))
    }).catch(() => undefined)
  }, [cloud.session?.token, cloud.syncPhase])

  useEffect(() => {
    if (!cloud.session || cloud.syncPhase !== 'current' || appSettings.ai.mode !== 'custom') return
    const timer = window.setTimeout(() => void syncCustomAiCredential(appSettings.ai).catch(() => undefined), 1200)
    return () => window.clearTimeout(timer)
  }, [appSettings.ai, cloud.session?.token, cloud.syncPhase])

  useEffect(() => {
    if (!runtime.hasLocalLibrary || (!runtime.native && !('indexedDB' in window))) return
    let cancelled = false
    void loadInitialLocalTracks().then((savedTracks) => {
      if (cancelled) {
        void loadLocalLibrary().then(({ releaseLocalTrackUrls }) => savedTracks.forEach(releaseLocalTrackUrls))
        return
      }
      const savedById = new Map(savedTracks.map((track) => [track.id, track]))
      setLocalTracks(savedTracks)
      setDownloadedTrackIds(savedTracks.map((track) => track.id))
      setTracks((current) => {
        const restored = current
          .map((track) => {
            const saved = savedById.get(track.id)
            return saved ? mergePlaybackResource(track, saved) : track
          })
          .filter((track) => !track.localFileId || savedById.has(track.id))
        return restored
      })
      setDetachedTrack((current) => {
        if (!current) return null
        const saved = savedById.get(current.id)
        if (saved) return mergePlaybackResource(current, saved)
        return current.localFileId ? null : current
      })
    }).catch(() => {
      if (!cancelled) showNotice('无法读取应用本地音乐库', 'info')
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    localTracksRef.current = localTracks
  }, [localTracks])

  useEffect(() => {
    if (!runtime.native) return
    let cancelled = false
    if (runtime.kind === 'desktop') {
      void Promise.all([
        loadNativeMusicFolders().then(({ listLocalMusicFolders }) => listLocalMusicFolders()),
        import('./nativeLocalLibrary').then(({ getNativeLocalLibraryLocation }) => getNativeLocalLibraryLocation()),
      ]).then(([folders, location]) => {
        if (cancelled) return
        setLocalMusicFolders(folders)
        setLocalLibraryLocation(location)
      }).catch(() => {
        if (!cancelled) setLocalLibraryLocation('Echora 应用数据 / music')
      })
    }
    return () => { cancelled = true }
  }, [runtime.kind, runtime.native])

  useEffect(() => {
    if (!tracks.some((track) => track.id === activeTrackId) && detachedTrack?.id !== activeTrackId) {
      setActiveTrackId(tracks[0]?.id ?? -1)
      setPlayProgress(0)
      if (!tracks.length) setIsPlaying(false)
    }
  }, [activeTrackId, detachedTrack?.id, tracks])

  sessionRef.current = { tracks, detachedTrack, downloadedTrackIds, activeTrackId, isPlaying, playbackMode, playbackRate, playProgress: playProgressRef.current, volume, muted, quality, intensity, novelty, intent, sessionName, playbackContext }
  settingsRef.current = appSettings
  activeAgentSessionIdRef.current = activeAgentSessionId

  useEffect(() => {
    const saveSession = () => {
      if (settingsRef.current.resumePlayback && sessionRef.current) writePlaybackSession(sessionRef.current)
      else clearPlaybackSession()
    }
    const timer = window.setInterval(saveSession, 4000)
    window.addEventListener('pagehide', saveSession)
    return () => {
      saveSession()
      window.clearInterval(timer)
      window.removeEventListener('pagehide', saveSession)
    }
  }, [])

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('.effects-panel, .global-player-effects, .source-panel, .mobile-theme-sheet, .settings-modal-backdrop')) return
      if (!headerControlsRef.current?.contains(event.target as Node)) setHeaderPanel(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHeaderPanel(null)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 2600)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (workspace !== 'nowPlaying' || !activeTrack) return
    let cancelled = false
    setLyricsState({ status: 'loading', lines: [], message: '正在载入歌词' })
    void fetchTrackLyrics(activeTrack).then((lines) => {
      if (!cancelled) setLyricsState({ status: 'ready', lines, message: '' })
    }).catch((error: unknown) => {
      if (!cancelled) setLyricsState({ status: 'unavailable', lines: [], message: error instanceof Error ? error.message : '歌词加载失败' })
    })
    return () => { cancelled = true }
  }, [activeLyricsKey, workspace])

  const showNotice = (message: string, tone: SystemNotice['tone'] = 'success') => setNotice({ message, tone })

  const checkApplicationUpdate = async (announce = true) => {
    if (!runtime.native) return initialApplicationUpdateState
    setApplicationUpdate((current) => ({ ...current, phase: 'checking', message: '正在检查更新' }))
    const next = await checkForApplicationUpdate(runtime)
    setApplicationUpdate(next)
    if (announce || next.phase === 'available') showNotice(next.message, next.phase === 'available' ? 'success' : 'info')
    return next
  }

  const installApplicationUpdate = async () => {
    try {
      await applyApplicationUpdate(applicationUpdate, runtime)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '无法打开更新地址', 'info')
    }
  }

  useEffect(() => {
    if (!runtime.native) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void checkForApplicationUpdate(runtime, controller.signal).then((next) => {
        setApplicationUpdate(next)
        if (next.phase === 'available') showNotice(next.message)
      }).catch(() => undefined)
    }, 1800)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [runtime.native])

  const clearContentCache = async () => {
    await Promise.all([clearTransientAppCache(), clearPlaybackCache(runtime)])
    sourceDiscoveryRequest = null
    sourceDiscoverySignature = ''
    setRemoteCatalog([])
  }

  const clearUsageData = async () => {
    clearUsageHistory()
    window.location.reload()
  }

  const clearLocalMusic = async () => {
    const { clearLocalTracks } = await loadLocalLibrary()
    await clearLocalTracks()
    window.location.reload()
  }

  const applyQueueToPlayback = (nextQueue: Track[], context: PlaybackContext, mode: PlaybackApplyMode, requestedTrackId?: number) => {
    const startTrack = requestedTrackId === undefined ? undefined : nextQueue.find((track) => track.id === requestedTrackId)
    if (mode === 'play-first' || startTrack) {
      const track = startTrack ?? nextQueue[0]
      setPlaybackContext(context)
      setTracks(nextQueue)
      setDetachedTrack(null)
      if (track) startTrackPlayback(track)
      else {
        setActiveTrackId(-1)
        setIsPlaying(false)
        setPlayProgress(0)
      }
      return
    }
    const nextIds = nextQueue.map((track) => track.id)
    const playbackState = reconcileQueuePlaybackState(nextIds, activeTrackId, isPlaying, playProgressRef.current, mode)
    const hydratedQueue = activeTrack?.audioUrl && nextIds.includes(activeTrack.id)
      ? nextQueue.map((track) => track.id === activeTrack.id ? mergePlaybackResource(track, activeTrack) : track)
      : nextQueue
    setPlaybackContext(context)
    setDetachedTrack(playbackState.detached ? activeTrack : null)
    if (playbackState.activeTrackId !== activeTrackId) {
      playbackRequestRef.current += 1
      setIsPlaying(playbackState.isPlaying)
      setPlayProgress(playbackState.playProgress)
      setActiveTrackId(playbackState.activeTrackId)
    }
    setTracks(hydratedQueue)
  }

  const submitAgentMessage = async (content: string) => {
    const sessionId = activeAgentSessionId
    if (!sessionId || agentRunControllersRef.current.has(sessionId)) return
    const sessionAtSubmit = agentSessions.find((session) => session.id === sessionId)
    if (!sessionAtSubmit) return
    const sessionTitleAtSubmit = sessionAtSubmit.title
    const preferences = sessionAtSubmit.preferences
    const createdAt = Date.now()
    const runId = `run-${createdAt}`
    const userMessage: AgentMessage = { id: `message-user-${createdAt}`, role: 'user', content, createdAt }
    const aiEnabled = isAiConfigured(appSettings.ai, Boolean(cloud.session) && echoraAiAvailable)
    const runningRun: AgentRun = { id: runId, status: 'running', label: '正在理解本轮要求', detail: '结合当前会话、固定条件与长期记忆', createdAt }
    const previousQueueTrackIds = [...sessionAtSubmit.queueTrackIds]
    const previousTrackLayout = [...(sessionAtSubmit.trackLayout ?? [])]
    const learnedMemories = appSettings.ai.autoLearnPreferences !== false
      ? learnAgentMemoriesFromConversation(
        sessionAtSubmit.messages.filter((message) => message.role === 'user').map((message) => message.content),
        content,
        createdAt,
        agentMemories,
      )
      : []
    const memoriesAtSubmit = mergeAgentMemories(agentMemories, learnedMemories)
    if (memoriesAtSubmit !== agentMemories) setAgentMemories(memoriesAtSubmit)

    const pendingProposal = [...sessionAtSubmit.messages]
      .reverse()
      .find((message) => message.change?.status === 'pending' && message.change.proposal)
      ?.change?.proposal
    let planningTracks = pendingProposal
      ? applyTrackLayout(
        pendingProposal.queueTrackIds.map((id) => catalog.find((track) => track.id === id)).filter((track): track is Track => Boolean(track)),
        pendingProposal.trackLayout,
        pendingProposal.targetIntensity,
        pendingProposal.targetNovelty,
      )
      : sessionAtSubmit.queueTrackIds
        .map((id) => catalog.find((track) => track.id === id))
        .filter((track): track is Track => Boolean(track))
    const activeTrackAtSubmit = activeTrack

    const controller = new AbortController()
    agentRunControllersRef.current.set(sessionId, controller)
    setRunningAgentSessionIds((current) => Array.from(new Set([...current, sessionId])))
    setAgentSessions((current) => current.map((session) => session.id === sessionId ? {
      ...session,
      status: 'active',
      updatedAt: createdAt,
      messages: [...session.messages, userMessage],
      runs: [runningRun, ...session.runs],
    } : session))

    try {
      const requestInput = {
        message: content,
        session: { ...sessionAtSubmit, messages: [...sessionAtSubmit.messages, userMessage] },
        memories: memoriesAtSubmit,
        tracks: planningTracks,
        activeTrack: activeTrackAtSubmit,
        activeTrackId,
        intensity: sessionAtSubmit.intensity,
        novelty: sessionAtSubmit.novelty,
        ai: appSettings.ai,
        cloudAuthenticated: Boolean(cloud.session),
        signal: controller.signal,
      }
      const result = await createListeningPlan(requestInput)
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
      let plan = {
        ...result.plan,
        avoidRecent: preferences.avoidAdjacentArtists || result.plan.avoidRecent,
        constraints: result.plan.constraints,
      }
      if (!plan.searchQueries.length && !planningTracks.length) {
        const fallback = createLocalListeningPlan(requestInput)
        plan = { ...plan, searchQueries: fallback.searchQueries, replaceQueue: true }
      }

      setAgentSessions((current) => current.map((session) => session.id === sessionId ? {
        ...session,
        runs: session.runs.map((run) => run.id === runId ? { ...run, label: plan.searchQueries.length ? '正在检索音乐候选' : '正在整理现有编排', detail: plan.searchQueries.length ? plan.searchQueries.join(' · ') : '本轮不需要引入新歌曲' } : run),
      } : session))

      const searchResults = plan.searchQueries.length
        ? await Promise.allSettled(plan.searchQueries.map((query) => searchMusicCatalog(query, availableOnlineSources, controller.signal, 20, recordCatalogSourceStatuses)))
        : []
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const searchGroups = searchResults.map((searchResult) => searchResult.status === 'fulfilled' ? searchResult.value : [])
      const discoveredTracks = collapseTrackVariants(interleaveDiscoveredTracks(preferCanonicalTrackVersions(searchGroups, plan.searchQueries)))
      if (plan.searchQueries.length && !discoveredTracks.length && !planningTracks.length && !(plan.keepCurrent && activeTrackAtSubmit)) throw new Error('未找到符合当前条件的可用歌曲，可调整艺人、风格或场景后重试')
      if (discoveredTracks.length) setRemoteCatalog((current) => upsertTracks(current, discoveredTracks))

      setAgentSessions((current) => current.map((session) => session.id === sessionId ? {
        ...session,
        runs: session.runs.map((run) => run.id === runId ? { ...run, label: '正在组织编排', detail: discoveredTracks.length ? `从 ${discoveredTracks.length} 首候选中平衡顺序与过渡` : '根据当前歌曲调整顺序与能量' } : run),
      } : session))

      const targetTrackCount = preferences.targetTrackCount
      const nextQueue = arrangeListeningTracks(plan, planningTracks, discoveredTracks, activeTrackId, targetTrackCount, activeTrackAtSubmit)
      if (!nextQueue.length) throw new Error('当前编排为空，请先描述想听的音乐或在音乐库选择歌曲')
      const laidOutQueue = layoutQueueTracks(nextQueue, plan.targetIntensity, plan.targetNovelty)
      const nextIds = laidOutQueue.map((track) => track.id)
      const addedTrackIds = nextIds.filter((id) => !previousQueueTrackIds.includes(id))
      const removedTrackIds = previousQueueTrackIds.filter((id) => !nextIds.includes(id))
      const keptTrackIds = nextIds.filter((id) => previousQueueTrackIds.includes(id))
      const queueChanged = nextIds.join(',') !== previousQueueTrackIds.join(',')
      const changeStatus = preferences.autoApply ? 'applied' as const : 'pending' as const
      const completedAt = Date.now()
      const changeSummary = discoveredTracks.length
        ? `从音乐服务找到 ${discoveredTracks.length} 首候选，编排 ${nextIds.length} 首`
        : queueChanged ? `按目标能量重排 ${nextIds.length} 首歌曲` : '保留当前编排并更新会话约束'
      const sourceNote = discoveredTracks.length ? `已从音乐服务找到 ${discoveredTracks.length} 首候选。` : ''
      const applyNote = preferences.autoApply
        ? `已按会话偏好自动应用 ${nextIds.length} 首编排。`
        : `已生成 ${nextIds.length} 首编排提案，当前播放保持不变，确认后应用。`
      const planResponse = `${plan.response} ${sourceNote}${applyNote}`.trim()
      const response = result.fallbackReason
        ? `AI 服务暂时不可用，本次已切换到本地编排。${planResponse}`
        : planResponse
      const assistantMessage: AgentMessage = {
        id: `message-agent-${completedAt}`,
        role: 'assistant',
        content: response,
        createdAt: completedAt,
        reasoning: result.reasoning,
        change: {
          summary: changeSummary,
          addedTrackIds,
          removedTrackIds,
          keptTrackIds,
          undoable: preferences.autoApply && queueChanged,
          status: changeStatus,
          proposal: {
            queueTrackIds: nextIds,
            tracks: laidOutQueue.map(likedTrackSnapshot),
            trackLayout: captureTrackLayout(laidOutQueue),
            targetIntensity: plan.targetIntensity,
            targetNovelty: plan.targetNovelty,
          },
        },
      }
      const nextTitle = sessionTitleAtSubmit === '新的音乐会话'
        ? plan.title || '新的聆听'
        : sessionTitleAtSubmit

      if (preferences.autoApply && activeAgentSessionIdRef.current === sessionId) {
        setIntensity(plan.targetIntensity)
        setNovelty(plan.targetNovelty)
        applyQueueToPlayback(laidOutQueue, agentPlaybackContext(sessionId, nextTitle), preferences.playbackApplyMode)
        setIntent(content)
        setSessionName(nextTitle)
      }
      setAgentSessions((current) => current.map((session) => {
        if (session.id !== sessionId) return session
        const constraints = mergeAgentConstraints(session.constraints, plan.constraints)
        return {
          ...session,
          title: nextTitle,
          summary: content.length > 20 ? `${content.slice(0, 20)}…` : content,
          goal: session.title === '新的音乐会话' ? content : session.goal,
          constraints,
          memories: memoriesAtSubmit.filter((memory) => memory.enabled).map((memory) => memory.id),
          intensity: plan.targetIntensity,
          novelty: plan.targetNovelty,
          ...(preferences.autoApply ? {
            queueTrackIds: nextIds,
            trackLayout: captureTrackLayout(laidOutQueue),
            previousQueueTrackIds: queueChanged ? previousQueueTrackIds : null,
            previousTrackLayout: queueChanged ? previousTrackLayout : null,
          } : {}),
          updatedAt: completedAt,
          messages: [
            ...session.messages.map((message) => message.change?.status === 'pending'
              ? { ...message, change: { ...message.change, status: 'dismissed' as const } }
              : message),
            assistantMessage,
          ],
          runs: session.runs.map((run) => run.id === runId ? {
            ...run,
            status: 'complete',
            label: result.mode === 'ai' ? 'AI 回合已完成' : result.fallbackReason ? '已使用本地编排' : '本地回合已完成',
            detail: `${changeSummary} · ${preferences.autoApply ? '已自动应用' : '等待确认'}${result.fallbackReason ? ` · ${result.fallbackReason}` : ''}`,
            createdAt: completedAt,
          } : run),
        }
      }))
      if (result.fallbackReason) showNotice('AI 服务暂时不可用，已使用本地策略生成提案', 'info')
    } catch (error) {
      const failedAt = Date.now()
      const cancelled = controller.signal.aborted || error instanceof DOMException && error.name === 'AbortError'
      const message = cancelled ? '已停止生成，编排与播放队列保持不变。' : error instanceof Error ? error.message : '编排任务执行失败'
      setAgentSessions((current) => current.map((session) => session.id === sessionId ? {
        ...session,
        updatedAt: failedAt,
        messages: [...session.messages, { id: `message-agent-error-${failedAt}`, role: 'assistant' as const, content: cancelled ? message : `本轮未完成：${message}`, createdAt: failedAt }],
        runs: session.runs.map((run) => run.id === runId ? { ...run, status: cancelled ? 'cancelled' : 'failed', label: cancelled ? '已停止生成' : '回合执行失败', detail: message, createdAt: failedAt } : run),
      } : session))
      if (!cancelled) showNotice(message, 'info')
    } finally {
      if (agentRunControllersRef.current.get(sessionId) === controller) agentRunControllersRef.current.delete(sessionId)
      setRunningAgentSessionIds((current) => current.filter((id) => id !== sessionId))
    }
  }

  const updateAgentPreferences = (sessionId: string, preferences: AgentPreferences) => {
    setAgentSessions((current) => current.map((session) => session.id === sessionId
      ? { ...session, preferences }
      : session))
  }

  const applyAgentProposal = (messageId: string, selectedTrackIds: number[]) => {
    const session = agentSessions.find((item) => item.id === activeAgentSessionId)
    const change = session?.messages.find((message) => message.id === messageId)?.change
    if (!session || change?.status !== 'pending' || !change.proposal) return
    const proposal = change.proposal
    const selectedIds = new Set(selectedTrackIds)
    const proposalSnapshots = new Map((proposal.tracks ?? []).map((track) => [track.id, track]))
    let proposalTracks = proposal.queueTrackIds
      .filter((id) => selectedIds.has(id))
      .map((id) => catalog.find((track) => track.id === id) ?? proposalSnapshots.get(id))
      .filter((track): track is Track => Boolean(track))
    if (!proposalTracks.length) {
      showNotice('至少选择一首歌曲后再应用', 'info')
      return
    }
    const unavailableTrackCount = selectedTrackIds.length - proposalTracks.length

    const nextQueue = applyTrackLayout(proposalTracks, proposal.trackLayout, proposal.targetIntensity, proposal.targetNovelty)
    const previousQueueTrackIds = tracks.map((track) => track.id)
    const previousTrackLayout = captureTrackLayout(tracks)
    const nextIds = nextQueue.map((track) => track.id)
    const queueChanged = nextIds.join(',') !== previousQueueTrackIds.join(',')
    applyQueueToPlayback(nextQueue, agentPlaybackContext(session.id, session.title), session.preferences.playbackApplyMode)
    setIntensity(proposal.targetIntensity)
    setNovelty(proposal.targetNovelty)
    setAgentSessions((current) => current.map((item) => item.id === session.id ? {
      ...item,
      queueTrackIds: nextIds,
      trackLayout: captureTrackLayout(nextQueue),
      previousQueueTrackIds: queueChanged ? previousQueueTrackIds : null,
      previousTrackLayout: queueChanged ? previousTrackLayout : null,
      messages: item.messages.map((message) => {
        if (!message.change) return message
        if (message.id === messageId) return {
          ...message,
          change: {
            ...message.change,
            status: 'applied' as const,
            undoable: queueChanged,
            addedTrackIds: nextIds.filter((id) => !previousQueueTrackIds.includes(id)),
            removedTrackIds: previousQueueTrackIds.filter((id) => !nextIds.includes(id)),
            keptTrackIds: nextIds.filter((id) => previousQueueTrackIds.includes(id)),
            proposal: {
              ...proposal,
              queueTrackIds: nextIds,
              tracks: nextQueue.map(likedTrackSnapshot),
              trackLayout: captureTrackLayout(nextQueue),
            },
          },
        }
        return message.change.status === 'pending'
          ? { ...message, change: { ...message.change, status: 'dismissed' as const } }
          : message
      }),
    } : item))
    setIntent(session.goal)
    setSessionName(session.title)
    showNotice(unavailableTrackCount ? `已应用 ${nextIds.length} 首，跳过 ${unavailableTrackCount} 首暂不可用歌曲` : `已应用 ${nextIds.length} 首编排`, unavailableTrackCount ? 'info' : 'success')
  }

  const dismissAgentProposal = (messageId: string) => {
    setAgentSessions((current) => current.map((session) => session.id === activeAgentSessionId ? {
      ...session,
      messages: session.messages.map((message) => message.id === messageId && message.change?.status === 'pending'
        ? { ...message, change: { ...message.change, status: 'dismissed' as const, undoable: false } }
        : message),
    } : session))
  }

  const restoreAgentSessionTracks = (session: AgentSession) => {
    const sessionTracks = session.queueTrackIds.map((id) => catalog.find((track) => track.id === id)).filter((track): track is Track => Boolean(track))
    return applyTrackLayout(sessionTracks, session.trackLayout, session.intensity, session.novelty)
  }

  const selectAgentSession = (sessionId: string) => {
    const session = agentSessions.find((item) => item.id === sessionId)
    if (!session) return
    setActiveAgentSessionId(sessionId)
    setAgentSessions((current) => current.map((item) => ({
      ...item,
      status: item.id === sessionId ? 'active' : 'paused',
    })))
  }

  const startAgentSession = () => {
    const session = createAgentSession([], [])
    setAgentSessions((current) => [session, ...current.map((item) => ({ ...item, status: 'paused' as const }))])
    setActiveAgentSessionId(session.id)
  }

  const openPlaybackArrangement = () => {
    const linkedSession = playbackContext.kind === 'agent'
      ? agentSessions.find((session) => session.id === playbackContext.agentSessionId)
      : undefined
    if (linkedSession) {
      selectAgentSession(linkedSession.id)
      openAgentView('arrangement')
      return
    }
    const created = createAgentSession(tracks.map((track) => track.id), captureTrackLayout(tracks))
    const title = playbackContext.title === defaultPlaybackContext.title ? '当前播放队列' : playbackContext.title
    const session: AgentSession = {
      ...created,
      title,
      summary: `基于“${title}”继续编排`,
      goal: `继续编排“${title}”`,
    }
    setAgentSessions((current) => [session, ...current.map((item) => ({ ...item, status: 'paused' as const }))])
    setActiveAgentSessionId(session.id)
    setPlaybackContext(agentPlaybackContext(session.id, title))
    openAgentView('arrangement')
  }

  const renameAgentSession = (sessionId: string, title: string) => {
    const nextTitle = title.trim()
    if (!nextTitle) return
    setAgentSessions((current) => current.map((session) => session.id === sessionId ? { ...session, title: nextTitle } : session))
    if (playbackContext.kind === 'agent' && playbackContext.agentSessionId === sessionId) setPlaybackContext(agentPlaybackContext(sessionId, nextTitle))
  }

  const deleteAgentSession = (sessionId: string) => {
    agentRunControllersRef.current.get(sessionId)?.abort()
    if (playbackContext.kind === 'agent' && playbackContext.agentSessionId === sessionId) setPlaybackContext(defaultPlaybackContext)
    const deletedIndex = agentSessions.findIndex((session) => session.id === sessionId)
    if (deletedIndex < 0) return
    const remaining = agentSessions.filter((session) => session.id !== sessionId)
    if (sessionId !== activeAgentSessionId) {
      setAgentSessions(remaining)
      return
    }

    const nextSession = remaining[Math.min(deletedIndex, remaining.length - 1)] ?? remaining[0]
    if (!nextSession) {
      setAgentSessions([])
      setActiveAgentSessionId('')
      return
    }
    setAgentSessions(remaining.map((session) => ({ ...session, status: session.id === nextSession.id ? 'active' : 'paused' })))
    setActiveAgentSessionId(nextSession.id)
  }

  const terminateAgentSession = (sessionId: string) => {
    agentRunControllersRef.current.get(sessionId)?.abort()
  }

  const undoAgentChange = () => {
    const session = agentSessions.find((item) => item.id === activeAgentSessionId)
    if (!session?.previousQueueTrackIds?.length) return
    const restoredTracks = session.previousQueueTrackIds.map((id) => catalog.find((track) => track.id === id)).filter((track): track is Track => Boolean(track))
    const restoredIds = restoredTracks.map((track) => track.id)
    const createdAt = Date.now()
    const restoredArrangement = applyTrackLayout(restoredTracks, session.previousTrackLayout ?? undefined, session.intensity, session.novelty)
    if (playbackContext.kind === 'agent' && playbackContext.agentSessionId === session.id) {
      applyQueueToPlayback(restoredArrangement, agentPlaybackContext(session.id, session.title), 'continue-current')
    }
    setAgentSessions((current) => current.map((item) => item.id === activeAgentSessionId ? {
      ...item,
      queueTrackIds: restoredIds,
      previousQueueTrackIds: null,
      previousTrackLayout: null,
      updatedAt: createdAt,
      messages: [...item.messages, { id: `message-undo-${createdAt}`, role: 'assistant' as const, content: '已撤销上一次编排调整，当前队列恢复到修改前的状态。', createdAt }],
      runs: [{ id: `run-undo-${createdAt}`, status: 'complete' as const, label: '已撤销调整', detail: `恢复 ${restoredIds.length} 首歌曲`, createdAt }, ...item.runs],
    } : item))
  }

  const commitAgentArrangement = (session: AgentSession, arranged: Track[]) => {
    setAgentSessions((current) => current.map((item) => item.id === session.id ? {
      ...item,
      queueTrackIds: arranged.map((track) => track.id),
      trackLayout: captureTrackLayout(arranged),
    } : item))
    if (playbackContext.kind === 'agent' && playbackContext.agentSessionId === session.id) {
      applyQueueToPlayback(arranged, agentPlaybackContext(session.id, session.title), 'continue-current')
    }
  }

  const moveTrack = (id: number, x: number, y: number) => {
    const session = agentSessions.find((item) => item.id === activeAgentSessionId)
    if (!session) return
    const arranged = restoreAgentSessionTracks(session)
      .map((track) => track.id === id ? { ...track, x, y } : track)
      .sort((left, right) => left.x - right.x)
    commitAgentArrangement(session, arranged)
  }

  const reorderTrack = (id: number, direction: -1 | 1) => {
    const session = agentSessions.find((item) => item.id === activeAgentSessionId)
    if (!session) return
    const arranged = restoreAgentSessionTracks(session).sort((left, right) => left.x - right.x)
    const index = arranged.findIndex((track) => track.id === id)
    const targetIndex = index + direction
    if (index < 0 || targetIndex < 0 || targetIndex >= arranged.length) return
    const xPositions = arranged.map((track) => track.x).sort((a, b) => a - b)
    const next = [...arranged]
    const [moved] = next.splice(index, 1)
    next.splice(targetIndex, 0, moved)
    commitAgentArrangement(session, next.map((track, position) => ({ ...track, x: xPositions[position] })))
  }

  const reorderTrackTo = (id: number, targetIndex: number) => {
    const session = agentSessions.find((item) => item.id === activeAgentSessionId)
    if (!session) return
    const arranged = restoreAgentSessionTracks(session).sort((left, right) => left.x - right.x)
    const index = arranged.findIndex((track) => track.id === id)
    const nextIndex = Math.max(0, Math.min(arranged.length - 1, targetIndex))
    if (index < 0 || index === nextIndex) return
    const xPositions = arranged.map((track) => track.x).sort((a, b) => a - b)
    const next = [...arranged]
    const [moved] = next.splice(index, 1)
    next.splice(nextIndex, 0, moved)
    commitAgentArrangement(session, next.map((track, position) => ({ ...track, x: xPositions[position] })))
  }

  const removeTrackFromArrangement = (id: number) => {
    const session = agentSessions.find((item) => item.id === activeAgentSessionId)
    if (!session || session.queueTrackIds.length <= 1 || !session.queueTrackIds.includes(id)) return
    commitAgentArrangement(session, restoreAgentSessionTracks(session).filter((track) => track.id !== id))
  }

  const changeArrangementZoom = (sessionId: string, zoom: number) => {
    setAgentSessions((current) => current.map((session) => session.id === sessionId ? { ...session, arrangementZoom: zoom } : session))
  }

  const searchLibraryCatalog = useCallback(async (query: string) => {
    const results = await searchMusicCatalog(query, availableOnlineSources, undefined, 20, recordCatalogSourceStatuses)
    setRemoteCatalog((current) => upsertTracks(current, results))
    return results
  }, [availableOnlineSourceSignature, recordCatalogSourceStatuses])

  const loadLibraryDiscovery = useCallback(async (force = false) => {
    if (!availableOnlineSources.length) throw new Error('音乐服务暂时不可用')
    if (force || sourceDiscoverySignature !== discoveryCacheSignature) sourceDiscoveryRequest = null
    sourceDiscoverySignature = discoveryCacheSignature
    const resilientSnapshot = readSourceDiscoveryCache(discoveryCacheSignature)
    const cached = !force && !sourceDiscoveryRequest
      ? readSourceDiscoveryCache(discoveryCacheSignature, localStorage, Date.now(), sourceDiscoveryFreshnessMs)
      : null
    if (cached) sourceDiscoveryRequest = Promise.resolve(cached)
    sourceDiscoveryRequest ??= loadSourceDiscovery(
      (query) => searchMusicCatalog(query, availableOnlineSources, undefined, appSettings.content.featuredTrackLimit, recordCatalogSourceStatuses),
      () => loadMusicCharts(availableOnlineSources),
      (chart) => loadMusicChartDetail(chart, appSettings.content.featuredTrackLimit),
      appSettings.content.featuredTrackLimit,
      availableOnlineSources,
    ).then((discovery) => {
      writeSourceDiscoveryCache(discoveryCacheSignature, discovery)
      return discovery
    }).catch((error) => {
      sourceDiscoveryRequest = null
      if (resilientSnapshot) return resilientSnapshot
      throw error
    })
    const discovery = await sourceDiscoveryRequest
    setRemoteCatalog((current) => upsertTracks(current, discovery.tracks))
    return discovery
  }, [appSettings.content.featuredTrackLimit, discoveryCacheSignature, recordCatalogSourceStatuses])

  const loadLibraryChart = useCallback(async (chart: Parameters<typeof loadMusicChartDetail>[0]) => {
    const chartTracks = await loadMusicChartDetail(chart, appSettings.content.chartTrackLimit)
    setRemoteCatalog((current) => upsertTracks(current, chartTracks))
    return chartTracks
  }, [appSettings.content.chartTrackLimit])

  const resolvePlayableTrack = (track: Track, requestedQuality?: LxQuality, forceRefresh = false, sourceSettings: MusicSourceSettings = appSettings.musicSource, preferAlternateSource = false) => {
    const usesAlternatePreference = sourceSettings.preferredQuality !== appSettings.musicSource.preferredQuality
    const requestKey = `${track.id}:${track.remote?.source ?? 'local'}:${track.remote?.musicInfo.songmid ?? ''}:${requestedQuality ?? sourceSettings.preferredQuality}:${forceRefresh ? 'refresh' : 'cached'}:${preferAlternateSource ? 'alternate' : 'primary'}`
    const existing = resolutionRequestsRef.current.get(requestKey)
    if (existing) return existing
    const request = (async () => {
      const hydratedLocalTracks = await loadInitialLocalTracks().catch(() => localTracksRef.current)
      const preferredLocal = requestedQuality || usesAlternatePreference ? track : localPlaybackTrack(track, hydratedLocalTracks)
      if (canReusePlaybackResource(preferredLocal) && !usesAlternatePreference && (!requestedQuality || preferredLocal.remote?.resolvedQuality === requestedQuality)) return preferredLocal
      if (!track.remote) throw new Error('当前条目缺少可用的音源信息')
      setResolvingTrackIds((current) => current.includes(track.id) ? current : [...current, track.id])
      let resolved: Awaited<ReturnType<typeof resolveTrackAudio>> | undefined
      let resolutionTrack = track
      const resolutionStartedAt = performance.now()
      const preferredQuality = sourceSettings.preferredQuality === 'hires'
        ? 'flac24bit'
        : sourceSettings.preferredQuality === 'lossless' ? 'flac' : '320k'
      if (preferAlternateSource && sourceSettings.autoFallback) {
        const fallback = await resolveSourceFallback({
          track,
          catalog,
          availableSources: rankSourceFallbacks(availableOnlineSources, sourceStatus.providers),
          preferredQuality,
          search: (query, sources) => searchMusicCatalog(query, sources, undefined, 12, recordCatalogSourceStatuses),
          resolve: (alternative) => resolveTrackAudio(alternative, sourceSettings, requestedQuality, true),
        })
        if (fallback.searched.length) setRemoteCatalog((current) => upsertTracks(current, fallback.searched))
        if (fallback.match) {
          resolutionTrack = fallback.match.track
          resolved = fallback.match.value
        }
      }
      try {
        if (!resolved) resolved = await resolveTrackAudio(track, sourceSettings, requestedQuality, forceRefresh)
      } catch (primaryError) {
        const primaryMessage = primaryError instanceof Error ? primaryError.message : '播放地址解析失败'
        const health = recordMusicSourceHealth({ source: track.remote.source, outcome: 'error', latencyMs: performance.now() - resolutionStartedAt, requestedQuality: requestedQuality ?? preferredQuality, reason: primaryMessage })
        setSourceStatus((current) => ({
          ...current,
          phase: current.phase === 'error' ? 'error' : 'degraded',
          providers: updateMusicSourceProviderHealth(updateMusicSourceProviderPlayback(current.providers, track.remote!.source, 'error', `${track.title} · ${primaryMessage}`), track.remote!.source, health),
          message: current.phase === 'error' ? current.message : `${track.source}最近播放异常`,
          activity: { kind: 'error', message: `${track.title} · ${primaryMessage}`, at: Date.now() },
        }))
        if (sourceSettings.autoFallback) {
          const fallback = await resolveSourceFallback({
            track,
            catalog,
            availableSources: rankSourceFallbacks(availableOnlineSources, sourceStatus.providers),
            preferredQuality,
            search: (query, sources) => searchMusicCatalog(query, sources, undefined, 12, recordCatalogSourceStatuses),
            resolve: async (alternative) => {
              const alternativeStartedAt = performance.now()
              try {
                return await resolveTrackAudio(alternative, sourceSettings, requestedQuality, forceRefresh)
              } catch (alternativeError) {
                const alternativeMessage = alternativeError instanceof Error ? alternativeError.message : '播放地址解析失败'
                const alternativeHealth = recordMusicSourceHealth({ source: alternative.remote!.source, outcome: 'error', latencyMs: performance.now() - alternativeStartedAt, requestedQuality: requestedQuality ?? preferredQuality, reason: alternativeMessage })
                setSourceStatus((current) => ({
                  ...current,
                  phase: current.phase === 'error' ? 'error' : 'degraded',
                  providers: updateMusicSourceProviderHealth(updateMusicSourceProviderPlayback(current.providers, alternative.remote!.source, 'error', `${alternative.title} · ${alternativeMessage}`), alternative.remote!.source, alternativeHealth),
                }))
                throw alternativeError
              }
            },
          })
          if (fallback.searched.length) setRemoteCatalog((current) => upsertTracks(current, fallback.searched))
          if (fallback.match) {
            resolutionTrack = fallback.match.track
            resolved = fallback.match.value
          }
        }
        if (resolved) {
          showNotice(`${track.source}暂时不可播放，已切换至${resolutionTrack.source} · ${resolvedQualityLabels[resolved.quality]}`, 'info')
        } else {
          throw primaryError
        }
      }
      if (!resolved) throw new Error('未获取到有效播放链接')
      const resolvedAudio = resolved
      if (!requestedQuality && resolutionTrack.id === track.id && resolvedAudio.quality !== preferredQuality) {
        showNotice(`${track.source}当前未提供${resolvedQualityLabels[preferredQuality]}，已使用${resolvedQualityLabels[resolvedAudio.quality]}`, 'info')
      }
      const usedSourceFallback = resolutionTrack.remote?.source !== track.remote?.source
      const usedQualityFallback = !requestedQuality && resolvedAudio.quality !== preferredQuality
      const resolvedVariant: Track = {
        ...resolutionTrack,
        audioUrl: createMediaBridgeUrl(resolvedAudio.url, {
          cacheKey: `${resolutionTrack.remote!.source}:${resolutionTrack.remote!.musicInfo.songmid}:${resolvedAudio.quality}`,
          cacheLimitMb: appSettings.storage.playbackCacheLimitMb,
        }),
        quality: resolvedQualityLabels[resolvedAudio.quality],
        remote: {
          ...resolutionTrack.remote!,
          requestedQuality: requestedQuality ?? preferredQuality,
          resolvedQuality: resolvedAudio.quality,
          resolvedAt: Date.now(),
          playbackToken: resolvedAudio.playbackToken,
        },
      }
      const catalogVariant: Track = resolvedVariant.sourceTrackId
        ? { ...resolvedVariant, id: resolvedVariant.sourceTrackId, sourceTrackId: undefined }
        : resolvedVariant
      const playable: Track = { ...resolvedVariant, id: track.id, sourceTrackId: catalogVariant.id }
      setQuality(resolvedAudio.quality === 'flac24bit' ? 'Hi-Res' : resolvedAudio.quality === 'flac' ? '无损' : '自动')
      setRemoteCatalog((current) => upsertTracks(current, [catalogVariant]))
      setTracks((current) => current
        .filter((item) => item.id === track.id || item.id !== resolutionTrack.id)
        .map((item) => item.id === track.id ? { ...item, ...playable, x: item.x, y: item.y } : item))
      setDetachedTrack((current) => current?.id === track.id ? { ...current, ...playable, x: current.x, y: current.y } : current)
      const health = recordMusicSourceHealth({ source: resolutionTrack.remote!.source, outcome: 'success', latencyMs: performance.now() - resolutionStartedAt, requestedQuality: requestedQuality ?? preferredQuality, resolvedQuality: resolvedAudio.quality })
      setSourceStatus((current) => {
        const providers = updateMusicSourceProviderHealth(updateMusicSourceProviderPlayback(
          current.providers,
          resolutionTrack.remote!.source,
          'available',
          `${playable.title} · ${resolvedQualityLabels[resolvedAudio.quality]}`,
        ), resolutionTrack.remote!.source, health)
        const errorCount = providers.filter((provider) => provider.playbackStatus === 'error').length
        const isDegraded = usedSourceFallback || usedQualityFallback || errorCount > 0
        return {
          ...current,
          phase: isDegraded ? 'degraded' : 'ready',
          providers,
          message: usedSourceFallback
            ? `已从${track.source}切换至${playable.source}`
            : usedQualityFallback
              ? `当前播放使用${resolvedQualityLabels[resolvedAudio.quality]}`
              : errorCount > 0
                ? `${errorCount} 个音乐平台最近播放异常`
                : '当前播放正常',
          activity: { kind: 'success', message: `${playable.title} · ${playable.source} · ${resolvedQualityLabels[resolvedAudio.quality]}`, at: Date.now() },
        }
      })
      return playable
    })().finally(() => {
      resolutionRequestsRef.current.delete(requestKey)
      setResolvingTrackIds((current) => current.filter((id) => id !== track.id))
    })
    resolutionRequestsRef.current.set(requestKey, request)
    return request
  }

  const startTrackPlayback = (track: Track, resumeProgress = 0, options: { automaticRetry?: boolean; forceRefresh?: boolean; preferAlternateSource?: boolean } = {}) => {
    if (!options.automaticRetry) automaticPlaybackRetriesRef.current.delete(track.id)
    const requestId = playbackRequestRef.current + 1
    playbackRequestRef.current = requestId
    setDetachedTrack(null)
    setActiveTrackId(track.id)
    setPlayProgress(resumeProgress)
    setIsPlaying(false)
    void resolvePlayableTrack(track, undefined, options.forceRefresh, appSettings.musicSource, options.preferAlternateSource).then((playable) => {
      if (playbackRequestRef.current !== requestId) return
      setActiveTrackId(playable.id)
      setIsPlaying(true)
    }).catch((error: unknown) => {
      if (playbackRequestRef.current !== requestId) return
      const message = error instanceof Error ? error.message : '无法播放这首歌曲'
      if (message.includes('导入音乐源')) {
        setSettingsInitialView('source')
        setHeaderPanel('settings')
      }
      showNotice(message, 'info')
    })
  }

  const resumeTrackPlayback = () => {
    if (!activeTrack) return
    const forceRefresh = needsRemotePlaybackRefresh(activeTrack)
    const resumableTrack = forceRefresh ? unresolvedPlaybackTrack(activeTrack) : activeTrack
    startTrackPlayback(resumableTrack, playProgressRef.current, { forceRefresh })
  }

  const pausePlayback = () => {
    playbackRequestRef.current += 1
    setIsPlaying(false)
  }

  const playFromLibrary = (track: Track, selection?: PlaybackSelection) => {
    const sourceTracks = selection?.tracks.length ? selection.tracks : [track]
    const nextTracks = layoutQueueTracks(sourceTracks.map((item) => ({ ...item, offline: downloadedTrackIds.includes(item.id) })), intensity, novelty)
    const context = selection?.context ?? { kind: 'manual', id: `track:${track.id}`, title: track.title }
    applyQueueToPlayback(nextTracks, context, 'play-first', track.id)
  }

  const playCollection = (collection: Track[], context: PlaybackContext = { kind: 'collection', id: `collection:${Date.now()}`, title: '音乐列表' }) => {
    if (!collection.length) return
    const nextTracks = layoutQueueTracks(collection.map((track) => ({ ...track, offline: downloadedTrackIds.includes(track.id) })), intensity, novelty)
    applyQueueToPlayback(nextTracks, context, 'play-first')
  }

  const playQueueTrack = (id: number) => {
    const track = tracks.find((item) => item.id === id)
    if (track) startTrackPlayback(track)
  }

  const playAgentTrack = (id: number) => {
    const session = agentSessions.find((item) => item.id === activeAgentSessionId)
    if (!session) return
    const sessionTracks = restoreAgentSessionTracks(session)
    if (sessionTracks.some((track) => track.id === id)) applyQueueToPlayback(sessionTracks, agentPlaybackContext(session.id, session.title), 'play-first', id)
  }

  const switchPlaybackSource = (source: OnlineSource) => {
    if (!activeTrack) return
    const target = sourceVariants.find((track) => track.remote?.source === source)
    if (!target || target.remote?.source === activeTrack.remote?.source) return
    const queueVariant = { ...target, id: activeTrack.id, sourceTrackId: target.sourceTrackId ?? target.id }
    setTracks((current) => {
      const activePosition = current.find((track) => track.id === activeTrack.id)
      const withoutTarget = current.filter((track) => track.id !== target.id)
      return withoutTarget.map((track) => track.id === activeTrack.id ? { ...queueVariant, x: activePosition?.x ?? track.x, y: activePosition?.y ?? track.y } : track)
    })
    startTrackPlayback(queueVariant)
  }

  const switchPlaybackQuality = (nextQuality: LxQuality) => {
    if (!activeTrack) return
    if (!activeTrack.remote || activeTrack.remote.resolvedQuality === nextQuality) return
    const requestId = playbackRequestRef.current + 1
    playbackRequestRef.current = requestId
    const resumePlayback = isPlaying
    const resumeProgress = playProgressRef.current
    const unresolvedTrack: Track = { ...activeTrack, audioUrl: undefined, remote: { ...activeTrack.remote, resolvedQuality: undefined, resolvedAt: undefined, playbackToken: undefined } }
    setIsPlaying(false)
    void resolvePlayableTrack(unresolvedTrack, nextQuality).then((playable) => {
      if (playbackRequestRef.current !== requestId) return
      setActiveTrackId(playable.id)
      setPlayProgress(resumeProgress)
      setQuality(nextQuality === 'flac24bit' ? 'Hi-Res' : nextQuality === 'flac' ? '无损' : '自动')
      setIsPlaying(resumePlayback)
    }).catch((error: unknown) => {
      if (playbackRequestRef.current !== requestId) return
      setIsPlaying(resumePlayback)
      showNotice(error instanceof Error ? error.message : '无法切换音质', 'info')
    })
  }

  const cyclePlaybackMode = () => {
    const nextMode: PlaybackMode = playbackMode === 'sequence' ? 'shuffle' : playbackMode === 'shuffle' ? 'repeat-one' : 'sequence'
    setPlaybackMode(nextMode)
  }

  const toggleLike = (track: Track) => {
    setLikedTracks((current) => {
      if (current.ids.includes(track.id)) return {
        ids: current.ids.filter((id) => id !== track.id),
        tracks: current.tracks.filter((item) => item.id !== track.id),
      }
      return { ids: [...current.ids, track.id], tracks: [...current.tracks, likedTrackSnapshot(track)] }
    })
  }

  const addToQueue = (track: Track) => {
    if (tracks.some((item) => item.id === track.id)) {
      showNotice(`“${track.title}”已在队列中`, 'info')
      return
    }
    setPlaybackContext(defaultPlaybackContext)
    setTracks((current) => layoutQueueTracks([...current, { ...track, offline: downloadedTrackIds.includes(track.id) }], intensity, novelty))
    showNotice(`已将“${track.title}”加入播放队列`)
  }

  const playNext = (track: Track) => {
    if (track.id === activeTrackId) {
      showNotice(`正在播放“${track.title}”`, 'info')
      return
    }
    setPlaybackContext(defaultPlaybackContext)
    setTracks((current) => {
      const withoutTrack = current.filter((item) => item.id !== track.id)
      const activePosition = withoutTrack.findIndex((item) => item.id === activeTrackId)
      const insertionPosition = activePosition < 0 ? 0 : activePosition + 1
      const nextQueue = [...withoutTrack]
      nextQueue.splice(insertionPosition, 0, { ...track, offline: downloadedTrackIds.includes(track.id) })
      return layoutQueueTracks(nextQueue, intensity, novelty)
    })
    showNotice(`下一首播放“${track.title}”`)
  }

  const removeFromPlaybackQueue = (track: Track) => {
    if (tracks.length <= 1 || !tracks.some((item) => item.id === track.id)) return
    const nextQueue = tracks.filter((item) => item.id !== track.id)
    applyQueueToPlayback(nextQueue, playbackContext, 'continue-current')
    showNotice(`已将“${track.title}”移出播放队列`)
  }

  const openNowPlaying = (trackId?: number) => {
    if (!activeTrack && typeof trackId !== 'number') return
    if (typeof trackId === 'number' && trackId !== activeTrackId) {
      setActiveTrackId(trackId)
      setPlayProgress(0)
    }
    if (workspace !== 'nowPlaying') returnWorkspaceRef.current = workspace
    changeWorkspace('nowPlaying')
  }

  const openAgentNowPlaying = (id: number) => {
    const session = agentSessions.find((item) => item.id === activeAgentSessionId)
    if (!session?.queueTrackIds.includes(id)) return
    playAgentTrack(id)
    if (workspace !== 'nowPlaying') returnWorkspaceRef.current = workspace
    changeWorkspace('nowPlaying')
  }

  const navigateLibrary = (request: { type: 'home' | 'featured' | 'personal' | 'liked' | 'daily' | 'search' | 'queue' } | { type: 'artist' | 'album'; track: Track }) => {
    libraryNavigationKeyRef.current += 1
    setLibraryNavigation({ ...request, key: libraryNavigationKeyRef.current } as LibraryNavigationRequest)
    changeWorkspace('library')
  }

  const commitDownloadState = (trackId: number, state?: TrackDownloadState) => {
    const next = { ...downloadStatesRef.current }
    if (state) next[trackId] = { ...next[trackId], ...state }
    else delete next[trackId]
    downloadStatesRef.current = next
    setDownloadStates(next)
    if (runtime.hasLocalLibrary) writeDownloadStates(next)
  }

  const cancelDownload = (trackId: number) => {
    const state = downloadStatesRef.current[trackId]
    if (!state || !['queued', 'downloading', 'retrying'].includes(state.phase)) return
    downloadControllersRef.current.get(state.requestKey)?.abort()
  }

  const ensureDownloadSpace = async (track: Track) => {
    if (!runtime.native) return
    const expectedBytes = Math.max(0, Math.round(track.sizeMb * 1024 * 1024))
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const availableBytes = await invoke<number>('available_local_storage_bytes')
      assertDownloadSpace(availableBytes, expectedBytes)
    } catch (error) {
      if (error instanceof Error && error.message.includes('存储空间不足')) throw error
      // Older native shells may not expose the preflight command yet. The
      // atomic writer still reports ENOSPC without leaving a partial file.
    }
  }

  const downloadFromLibrary = (track: Track) => {
    const requestKey = remoteTrackIdentity(track) ?? `track:${track.id}`
    const existingDownload = localTracksRef.current.find((candidate) => hasSameLocalResource(candidate, track))
    if (track.localFileId || existingDownload) {
      setDownloadedTrackIds((current) => current.includes(track.id) ? current : [...current, track.id])
      showNotice(`“${track.title}”已在本地音乐中`, 'info')
      return
    }
    if (downloadRequestsRef.current.has(requestKey)) return
    if (!track.remote) {
      showNotice('这首音乐没有可用的在线下载地址', 'info')
      return
    }
    if (!sourceConfigured) {
      setSettingsInitialView('source')
      setHeaderPanel('settings')
      showNotice('音乐服务当前不可用，请稍后重试', 'info')
      return
    }
    downloadRequestsRef.current.add(requestKey)
    const controller = new AbortController()
    downloadControllersRef.current.set(requestKey, controller)
    setDownloadingTrackIds((current) => current.includes(track.id) ? current : [...current, track.id])
    commitDownloadState(track.id, { trackId: track.id, requestKey, phase: 'queued', receivedBytes: 0, track })
    const downloadSourceSettings = { ...appSettings.musicSource, preferredQuality: appSettings.musicSource.downloadQuality }
    void downloadScheduler.acquire(controller.signal).then(async (releaseSlot) => {
      try {
        const initialPlayable = await resolvePlayableTrack(track, undefined, false, downloadSourceSettings)
        await ensureDownloadSpace(initialPlayable)
        let playable = initialPlayable
        let lastProgress = -1
        const audio = await downloadResponseWithSingleRetry({
          signal: controller.signal,
          onRetry: () => {
            commitDownloadState(track.id, { trackId: track.id, requestKey, phase: 'retrying', receivedBytes: 0 })
          },
          responseForAttempt: async (attempt) => {
            if (attempt === 1) playable = await resolvePlayableTrack(track, undefined, true, downloadSourceSettings)
            return fetch(playable.audioUrl!, { signal: controller.signal })
          },
          onProgress: (receivedBytes, totalBytes) => {
            const progress = totalBytes ? Math.min(100, Math.round(receivedBytes / totalBytes * 100)) : undefined
            if (progress === lastProgress && totalBytes) return
            lastProgress = progress ?? lastProgress
            const phase = downloadStatesRef.current[track.id]?.phase === 'retrying' ? 'retrying' : 'downloading'
            commitDownloadState(track.id, { trackId: track.id, requestKey, phase, receivedBytes, totalBytes, progress })
          },
        })
        if (runtime.downloadBehavior === 'browser') {
          triggerBrowserDownload(audio, playable, appSettings.musicSource.downloadFileNameFormat)
          commitDownloadState(track.id, { trackId: track.id, requestKey, phase: 'complete', receivedBytes: audio.size, totalBytes: audio.size, progress: 100 })
          showNotice(`“${playable.title}”${runtime.downloadSuccessLabel}`)
          return
        }
        const cover = !isBrandArtwork(playable.cover)
          ? await fetch(playable.cover, { signal: controller.signal }).then((result) => result.ok ? result.blob() : undefined).catch(() => undefined)
          : undefined
        const { saveDownloadedTrack } = await loadLocalLibrary()
        const downloaded = await saveDownloadedTrack(playable, audio, cover)
        const nextLocalTracks = [downloaded, ...localTracksRef.current.filter((item) => !hasSameLocalResource(item, downloaded))]
        localTracksRef.current = nextLocalTracks
        setLocalTracks(nextLocalTracks)
        setDownloadedTrackIds(nextLocalTracks.map((item) => item.id))
        setTracks((current) => current.map((item) => hasSameRemoteIdentity(item, downloaded) ? mergePlaybackResource(item, downloaded) : item))
        commitDownloadState(track.id, { trackId: track.id, requestKey, phase: 'complete', receivedBytes: audio.size, totalBytes: audio.size, progress: 100 })
        showNotice(`“${downloaded.title}”${runtime.downloadSuccessLabel}`)
      } finally {
        releaseSlot()
      }
    }).catch((error: unknown) => {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        commitDownloadState(track.id)
        showNotice(`已取消“${track.title}”的下载`, 'info')
        return
      }
      const previous = downloadStatesRef.current[track.id]
      const failureReason = error instanceof Error ? error.message : '下载歌曲失败'
      commitDownloadState(track.id, { trackId: track.id, requestKey, phase: 'failed', receivedBytes: previous?.receivedBytes ?? 0, totalBytes: previous?.totalBytes, progress: previous?.progress, failureReason })
      showNotice(failureReason, 'info')
    }).finally(() => {
      downloadRequestsRef.current.delete(requestKey)
      downloadControllersRef.current.delete(requestKey)
      setDownloadingTrackIds((current) => current.filter((id) => id !== track.id))
    })
  }

  const importLocalFiles = async (files: File[]) => {
    try {
      const { importLocalAudioFiles } = await loadLocalLibrary()
      const result = await importLocalAudioFiles(files)
      if (result.tracks.length) {
        setLocalTracks((current) => [...result.tracks, ...current])
        setDownloadedTrackIds((current) => Array.from(new Set([...current, ...result.tracks.map((track) => track.id)])))
      }
      if (!result.importedCount) {
        showNotice(result.skippedCount ? '所选文件已存在，或不是支持的音频文件' : '没有选择可导入的音频文件', 'info')
        return
      }
      showNotice(`已加入 ${result.importedCount} 首音乐${result.skippedCount ? `，${result.skippedCount} 个文件未处理` : ''}`)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '导入本地音乐失败', 'info')
      throw error
    }
  }

  const mergeImportedLocalTracks = (imported: Track[]) => {
    if (!imported.length) return
    const importedIds = new Set(imported.map((track) => track.id))
    setLocalTracks((current) => [...imported, ...current.filter((track) => !importedIds.has(track.id))])
    setDownloadedTrackIds((current) => Array.from(new Set([...current, ...imported.map((track) => track.id)])))
  }

  const scanMusicFolder = async (folder: LocalMusicFolder, announce = true) => {
    if (localFolderBusyIds.includes(folder.id)) return
    setLocalFolderBusyIds((current) => [...current, folder.id])
    try {
      const { listLocalMusicFolders, scanLocalMusicFolder } = await loadNativeMusicFolders()
      const result = await scanLocalMusicFolder(folder)
      mergeImportedLocalTracks(result.tracks)
      setLocalMusicFolders(await listLocalMusicFolders())
      if (announce) {
        const message = result.importedCount
          ? `已从“${folder.name}”导入 ${result.importedCount} 首音乐`
          : result.discoveredCount
            ? `“${folder.name}”已完成扫描，没有发现新音乐`
            : `“${folder.name}”中没有可识别的音频文件`
        showNotice(message, result.importedCount ? 'success' : 'info')
      }
      return result
    } catch (error) {
      showNotice(error instanceof Error ? error.message : `无法扫描“${folder.name}”`, 'info')
      throw error
    } finally {
      setLocalFolderBusyIds((current) => current.filter((id) => id !== folder.id))
    }
  }

  useEffect(() => {
    if (!runtime.native || runtime.kind !== 'desktop' || !appSettings.storage.autoScanLocalFolders) return
    const pending = localMusicFolders.filter((folder) => folder.available && !autoScannedFolderIdsRef.current.has(folder.id))
    pending.forEach((folder) => {
      autoScannedFolderIdsRef.current.add(folder.id)
      void scanMusicFolder(folder, false)
    })
  }, [appSettings.storage.autoScanLocalFolders, localMusicFolders.map((folder) => `${folder.id}:${folder.available}`).join(','), runtime.kind, runtime.native])

  const addLocalMusicFolders = async () => {
    try {
      const { chooseLocalMusicFolders } = await loadNativeMusicFolders()
      const previousIds = new Set(localMusicFolders.map((folder) => folder.id))
      const folders = await chooseLocalMusicFolders()
      if (!folders.length) return
      setLocalMusicFolders(folders)
      const added = folders.filter((folder) => !previousIds.has(folder.id))
      if (!added.length) {
        showNotice('这些文件夹已添加', 'info')
        return
      }
      let importedCount = 0
      for (const folder of added) {
        autoScannedFolderIdsRef.current.add(folder.id)
        const result = await scanMusicFolder(folder, false)
        importedCount += result?.importedCount ?? 0
      }
      showNotice(importedCount ? `已添加 ${added.length} 个音乐来源，新增 ${importedCount} 首音乐` : `已添加 ${added.length} 个音乐来源，未发现新音乐`)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '无法添加音乐文件夹', 'info')
    }
  }

  const forgetLocalMusicFolder = async (id: string) => {
    try {
      const { removeLocalMusicFolder } = await loadNativeMusicFolders()
      setLocalMusicFolders(await removeLocalMusicFolder(id))
      showNotice('已移除音乐来源，离线歌曲不受影响')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '无法移除音乐文件夹', 'info')
    }
  }

  const exportLocalTracks = async (exportTracks: Track[]) => {
    const available = exportTracks.filter((track) => track.audioUrl)
    if (!available.length) {
      showNotice('所选歌曲没有可导出的本地文件', 'info')
      return
    }
    try {
      const files = await Promise.all(available.map(async (track) => {
        const response = await fetch(track.audioUrl!)
        if (!response.ok) throw new Error(`无法读取“${track.title}”的本地文件`)
        const mimeType = response.headers.get('content-type') ?? 'audio/mpeg'
        return new File([await response.blob()], downloadFileName(track, appSettings.musicSource.downloadFileNameFormat, mimeType), { type: mimeType })
      }))
      if (runtime.native && (runtime.kind === 'desktop' || files.length === 1)) {
        const result = await (await import('./nativeFileExport')).exportNativeAudioFiles(files)
        if (result.cancelled) return
        showNotice(result.exportedCount === 1 ? '歌曲已导出' : `已导出 ${result.exportedCount} 首歌曲`)
        return
      }
      if (runtime.kind === 'mobile' && navigator.share && navigator.canShare?.({ files })) {
        await navigator.share({ files, title: '导出 Echora 音乐' })
        return
      }
      throw new Error('当前设备暂不支持导出文件')
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '导出本地音乐失败', 'info')
    }
  }

  const shareTrack = async (track: Track, method: 'system' | 'copy') => {
    const text = `《${track.title}》 - ${track.artist}\n专辑：${track.album}\n来自 Echora`
    try {
      if (method === 'system' && navigator.share) {
        await navigator.share({ title: track.title, text })
        return
      }
      if (!navigator.clipboard?.writeText) throw new Error('当前设备暂不支持分享')
      await navigator.clipboard.writeText(text)
      showNotice('歌曲信息已复制')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      showNotice(error instanceof Error ? error.message : '分享未完成', 'info')
    }
  }

  const removeDownloadFromLibrary = async (track: Track) => {
    if (!track.localFileId) {
      showNotice('这首歌曲没有可移除的本地文件', 'info')
      return
    }
    try {
      const { removeLocalTrack, releaseLocalTrackUrls } = await loadLocalLibrary()
      await removeLocalTrack(track.localFileId)
      const affectedIds = new Set([...localTracksRef.current, ...tracks, ...remoteCatalog]
        .filter((item) => hasSameLocalResource(item, track))
        .map((item) => item.id))
      const nextLocalTracks = localTracksRef.current.filter((item) => !hasSameLocalResource(item, track))
      localTracksRef.current = nextLocalTracks
      setLocalTracks(nextLocalTracks)
      setDownloadedTrackIds((current) => current.filter((id) => !affectedIds.has(id)))
      if (track.remote) {
        const remembered = remoteCatalog.find((item) => item.id === track.id || hasSameRemoteIdentity(item, track))
        const onlineTrack: Track = remembered ? { ...remembered, localFileId: undefined, offline: false } : {
          ...track,
          localFileId: undefined,
          audioUrl: undefined,
          offline: false,
          cover: track.remote.musicInfo.img || brandMarkPath,
        }
        setTracks((current) => current.map((item) => hasSameLocalResource(item, track)
          ? { ...onlineTrack, id: item.id, x: item.x, y: item.y }
          : item))
        if (affectedIds.has(activeTrackId)) pausePlayback()
        releaseLocalTrackUrls(track)
        showNotice(`已移除“${track.title}”的本地文件，在线歌曲仍保留`)
        return
      }
      setLikedTracks((current) => ({
        ids: current.ids.filter((id) => id !== track.id),
        tracks: current.tracks.filter((item) => item.id !== track.id),
      }))
      setAgentSessions((current) => current.map((session) => ({
        ...session,
        queueTrackIds: session.queueTrackIds.filter((id) => id !== track.id),
        trackLayout: session.trackLayout?.filter((position) => position.id !== track.id),
        previousQueueTrackIds: session.previousQueueTrackIds?.filter((id) => id !== track.id) ?? null,
        previousTrackLayout: session.previousTrackLayout?.filter((position) => position.id !== track.id) ?? null,
      })))
      const remainingQueue = tracks.filter((item) => item.id !== track.id)
      setTracks(remainingQueue)
      if (activeTrackId === track.id) {
        setActiveTrackId(remainingQueue[0]?.id ?? -1)
        setPlayProgress(0)
        pausePlayback()
        if (!remainingQueue.length) changeWorkspace('library')
      }
      releaseLocalTrackUrls(track)
      showNotice(`已移除“${track.title}”的本地文件`)
    } catch {
      showNotice(`无法移除“${track.title}”`, 'info')
    }
  }

  const nextTrack = () => {
    if (detachedTrack?.id === activeTrackId && !orderedTracks.some((track) => track.id === activeTrackId)) {
      if (orderedTracks[0]) playQueueTrack(orderedTracks[0].id)
      return
    }
    const nextId = getNextTrackId(orderedTracks, activeTrackId, playbackMode)
    if (nextId !== null) playQueueTrack(nextId)
  }

  const previousTrack = () => {
    if (detachedTrack?.id === activeTrackId && !orderedTracks.some((track) => track.id === activeTrackId)) {
      if (orderedTracks[0]) playQueueTrack(orderedTracks[0].id)
      return
    }
    const previousId = getPreviousTrackId(orderedTracks, activeTrackId)
    if (previousId !== null) playQueueTrack(previousId)
  }

  const { seek: seekPlayback } = useAudioPlayback({
    track: activeTrack,
    isPlaying,
    progress: playProgressRef.current,
    volume,
    muted,
    playbackRate,
    playbackMode,
    audioEffects,
    onProgress: setPlayProgress,
    onEnded: nextTrack,
    onStarted: ({ latencyMs }) => {
      void reportMusicPlaybackHealth({ track: activeTrack, outcome: 'success', latencyMs })
    },
    onError: (issue) => {
      if (issue.kind === 'interrupted') return
      if (issue.kind === 'media') {
        void reportMusicPlaybackHealth({
          track: activeTrack,
          outcome: 'error',
          latencyMs: issue.latencyMs,
          reason: playbackHealthReason(issue),
        })
      }
      if (issue.kind === 'media' && activeTrack && claimAutomaticPlaybackRetry(activeTrack, automaticPlaybackRetriesRef.current)) {
        const failedTrack = unresolvedPlaybackTrack(activeTrack)
        setIsPlaying(false)
        setTracks((current) => current.map((track) => track.id === failedTrack.id ? { ...failedTrack, x: track.x, y: track.y } : track))
        setDetachedTrack((current) => current?.id === failedTrack.id ? { ...failedTrack, x: current.x, y: current.y } : current)
        setRemoteCatalog((current) => current.map((track) => hasSameRemoteIdentity(track, failedTrack) ? unresolvedPlaybackTrack(track) : track))
        showNotice('当前播放来源不可用，正在切换可用版本', 'info')
        startTrackPlayback(failedTrack, playProgressRef.current, { automaticRetry: true, forceRefresh: true, preferAlternateSource: true })
        return
      }
      setIsPlaying(false)
      showNotice(activeTrack?.localFileId ? '本地文件无法播放，请检查文件是否仍然可用' : issue.message, 'info')
    },
  })

  useSystemMediaSession({
    enabled: playbackSettings.systemMediaControls,
    track: activeTrack,
    isPlaying,
    liked: Boolean(activeTrack && likedTrackIds.includes(activeTrack.id)),
    progressStore: playbackProgressStore,
    playbackRate,
    onPlay: resumeTrackPlayback,
    onPause: pausePlayback,
    onPrevious: previousTrack,
    onNext: nextTrack,
    onToggleLike: () => { if (activeTrack) toggleLike(activeTrack) },
    onSeek: seekPlayback,
  })
  usePlaybackWakeLock(playbackSettings.keepAwakeWhilePlaying && isPlaying)

  const trayActionsRef = useRef({
    previous: previousTrack,
    toggle: () => isPlaying ? pausePlayback() : resumeTrackPlayback(),
    next: nextTrack,
    toggleLike: () => { if (activeTrack) toggleLike(activeTrack) },
  })
  trayActionsRef.current = {
    previous: previousTrack,
    toggle: () => isPlaying ? pausePlayback() : resumeTrackPlayback(),
    next: nextTrack,
    toggleLike: () => { if (activeTrack) toggleLike(activeTrack) },
  }

  useEffect(() => {
    if (!runtime.native || runtime.kind !== 'desktop') return
    let unlisten: (() => void) | undefined
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      unlisten = await listen<string>('echora://tray-control', ({ payload }) => {
        if (payload === 'previous') trayActionsRef.current.previous()
        if (payload === 'toggle-playback') trayActionsRef.current.toggle()
        if (payload === 'next') trayActionsRef.current.next()
        if (payload === 'toggle-like') trayActionsRef.current.toggleLike()
      })
    })
    return () => unlisten?.()
  }, [runtime.kind, runtime.native])

  const quickActionRef = useRef<(action: string) => void>(() => undefined)
  quickActionRef.current = (action) => {
    if (action === 'liked') navigateLibrary({ type: 'liked' })
    if (action === 'search') navigateLibrary({ type: 'search' })
    if (action === 'daily') navigateLibrary({ type: 'daily' })
  }

  useEffect(() => {
    if (!runtime.native || runtime.kind !== 'mobile') return
    let unlisten: (() => void) | undefined
    const handleAndroidQuickAction = (event: Event) => quickActionRef.current((event as CustomEvent<string>).detail)
    window.addEventListener('echora-android-quick-action', handleAndroidQuickAction)
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      unlisten = await listen<string>('echora://quick-action', ({ payload }) => quickActionRef.current(payload))
    })
    return () => {
      window.removeEventListener('echora-android-quick-action', handleAndroidQuickAction)
      unlisten?.()
    }
  }, [runtime.kind, runtime.native])

  useEffect(() => {
    if (!runtime.native || runtime.kind !== 'desktop') return
    void import('@tauri-apps/api/core').then(({ invoke }) => invoke('update_tray_state', {
      title: activeTrack?.title ?? null,
      artist: activeTrack?.artist ?? null,
      isPlaying,
      isLiked: Boolean(activeTrack && likedTrackIds.includes(activeTrack.id)),
      canLike: Boolean(activeTrack),
    })).catch(() => undefined)
  }, [activeTrack?.artist, activeTrack?.id, activeTrack?.title, isPlaying, likedTrackIds, runtime.kind, runtime.native])

  useEffect(() => {
    if (workspace !== 'nowPlaying' || !activeTrack) return
    const handlePlaybackShortcut = (event: KeyboardEvent) => {
      const isMediaKey = /^(Media|AudioVolume)/.test(event.key)
      if (!isMediaKey && (headerPanel || document.querySelector('[role="dialog"], [role="menu"]'))) return
      const action = resolvePlaybackShortcut(event, appSettings.seekStepSeconds)
      if (!action) return
      event.preventDefault()
      if (action.type === 'toggle-playback') {
        if (isPlaying) pausePlayback()
        else resumeTrackPlayback()
      }
      if (action.type === 'seek-by') {
        const duration = Math.max(1, activeTrack.durationSeconds)
        seekPlayback(playProgressRef.current + (action.seconds / duration) * 100)
      }
      if (action.type === 'seek-to') seekPlayback(action.progress)
      if (action.type === 'change-volume') changeVolume(Math.min(100, Math.max(0, volume + action.amount)))
      if (action.type === 'toggle-mute') toggleMute()
      if (action.type === 'previous-track') previousTrack()
      if (action.type === 'next-track') nextTrack()
      if (action.type === 'exit-song-mode') changeWorkspace(returnWorkspaceRef.current === 'nowPlaying' ? 'library' : returnWorkspaceRef.current)
    }
    document.addEventListener('keydown', handlePlaybackShortcut)
    return () => document.removeEventListener('keydown', handlePlaybackShortcut)
  }, [activeTrack, appSettings.seekStepSeconds, headerPanel, isPlaying, muted, orderedTracks, playbackMode, seekPlayback, volume, workspace])

  const controlWindow = async (action: 'close' | 'minimize' | 'maximize') => {
    if (!('__TAURI_INTERNALS__' in window)) return
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const appWindow = getCurrentWindow()
    if (action === 'close') {
      if (appSettings.closeBehavior === 'background') await appWindow.hide()
      else await appWindow.close()
    }
    if (action === 'minimize') await appWindow.minimize()
    if (action === 'maximize') await appWindow.toggleMaximize()
  }

  const startWindowDrag = async (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !('__TAURI_INTERNALS__' in window)) return
    const target = event.target as HTMLElement
    if (target.closest('button, input, select, textarea, a, [role="dialog"]')) return
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().startDragging()
  }

  const clearSavedPlaybackSession = () => {
    clearPlaybackSession()
    setAppSettings((current) => ({ ...current, resumePlayback: false }))
    showNotice('已清除保存的播放状态')
  }

  const closeNowPlaying = () => changeWorkspace(returnWorkspaceRef.current === 'nowPlaying' ? 'library' : returnWorkspaceRef.current)
  const toggleNowPlaying = () => workspace === 'nowPlaying' ? closeNowPlaying() : openNowPlaying()

  return {
    palettes,
    sourcePhaseLabels,
    runtime,
    appSettings,
    setAppSettings,
    audioEffects,
    setAudioEffects,
    appearance,
    setAppearance,
    paletteByAppearance,
    setPaletteByAppearance,
    followTrackPalette,
    setFollowTrackPalette,
    activePalette,
    activePaletteDefinition,
    activeAccent,
    headerPanel,
    setHeaderPanel,
    toggleHeaderPanel,
    settingsInitialView,
    setSettingsInitialView,
    workspace,
    navigationWorkspace,
    changeWorkspace,
    accountOpen,
    openAccount,
    closeAccount,
    openAccountPage,
    closeAccountPage,
    libraryNavigation,
    mobileLibrarySection,
    setMobileLibrarySection,
    agentNavigation,
    tracks,
    playbackContext,
    activeTrack,
    activeTrackId,
    isPlaying,
    playbackProgressStore,
    volume,
    muted,
    playbackMode,
    playbackRate,
    setPlaybackRate,
    downloadedTrackIds,
    downloadStates,
    localMusicFolders,
    localFolderBusyIds,
    localLibraryLocation,
    likedTrackIds,
    catalog,
    busyTrackIds,
    sourceStatus,
    sourceConfigured,
    enhancedQualityEnabled,
    sourceVariants,
    resolvingTrackIds,
    relatedTracks,
    lyricsState,
    agentSessions,
    agentMemories,
    setAgentMemories,
    activeAgentSessionId,
    runningAgentSessionIds,
    userProfile,
    setUserProfile: async (profile: typeof userProfile) => {
      setUserProfile(profile)
      if (cloud.session) await cloudAuth.updateProfile(profile.displayName)
    },
    applyCloudProfile: (profile: typeof userProfile) => setUserProfile(profile),
    cloudSession: cloud.session,
    cloudOnline: cloud.online,
    cloudSyncPhase: cloud.syncPhase,
    echoraAiAvailable,
    echoraAiStatus,
    cloudAuth,
    notice,
    applicationUpdate,
    headerControlsRef,
    controlWindow,
    startWindowDrag,
    navigateLibrary,
    openAgentView,
    refreshMusicSourceStatus,
    clearSavedPlaybackSession,
    clearContentCache,
    clearUsageData,
    clearLocalMusic,
    startAgentSession,
    renameAgentSession,
    deleteAgentSession,
    selectAgentSession,
    terminateAgentSession,
    submitAgentMessage,
    updateAgentPreferences,
    applyAgentProposal,
    dismissAgentProposal,
    undoAgentChange,
    playAgentTrack,
    moveTrack,
    reorderTrack,
    reorderTrackTo,
    removeTrackFromArrangement,
    changeArrangementZoom,
    openAgentNowPlaying,
    toggleLike,
    playFromLibrary,
    playCollection,
    playNext,
    addToQueue,
    downloadFromLibrary,
    cancelDownload,
    removeDownloadFromLibrary,
    exportLocalTracks,
    shareTrack,
    removeFromPlaybackQueue,
    importLocalFiles,
    addLocalMusicFolders,
    scanMusicFolder,
    forgetLocalMusicFolder,
    showNotice,
    checkApplicationUpdate,
    installApplicationUpdate,
    searchLibraryCatalog,
    loadLibraryDiscovery,
    loadLibraryChart,
    seekPlayback,
    startTrackPlayback,
    resumeTrackPlayback,
    pausePlayback,
    nextTrack,
    previousTrack,
    changeVolume,
    toggleMute,
    toggleNowPlaying,
    closeNowPlaying,
    openNowPlaying,
    openPlaybackArrangement,
    playQueueTrack,
    cyclePlaybackMode,
    switchPlaybackSource,
    switchPlaybackQuality,
  }
}

export type EchoraController = ReturnType<typeof useEchoraController>
