export type AiProvider = 'openai' | 'anthropic' | 'compatible' | 'ollama'
export type AiMode = 'echora' | 'custom'

export type AiSettings = {
  mode?: AiMode
  provider: AiProvider
  baseUrl: string
  model: string
  apiKey: string
  autoLearnPreferences?: boolean
}

export type MusicSourceQuality = 'high' | 'lossless' | 'hires'
export type DownloadFileNameFormat = 'artist-title' | 'title-artist'

export type MusicSourceSettings = {
  preferredQuality: MusicSourceQuality
  downloadQuality: MusicSourceQuality
  downloadFileNameFormat: DownloadFileNameFormat
  autoFallback: boolean
}

export const featuredTrackLimitOptions = [10, 20, 30] as const
export const chartTrackLimitOptions = [20, 30, 50] as const
export type FeaturedTrackLimit = typeof featuredTrackLimitOptions[number]
export type ChartTrackLimit = typeof chartTrackLimitOptions[number]

export type ContentSettings = {
  featuredTrackLimit: FeaturedTrackLimit
  chartTrackLimit: ChartTrackLimit
  personalizedRecommendations: boolean
}

export const playbackCacheLimitOptions = [512, 1024, 2048, 5120] as const
export type PlaybackCacheLimit = typeof playbackCacheLimitOptions[number]

export type StorageSettings = {
  playbackCacheLimitMb: PlaybackCacheLimit
  autoScanLocalFolders: boolean
}

export const seekStepOptions = [5, 10, 15] as const
export type SeekStepSeconds = typeof seekStepOptions[number]
export type StartupView = 'library' | 'field'

export type PlaybackSettings = {
  systemMediaControls: boolean
  keepAwakeWhilePlaying: boolean
}

export type AppSettings = {
  startupView: StartupView
  resumePlayback: boolean
  seekStepSeconds: SeekStepSeconds
  closeBehavior: 'background' | 'quit'
  reduceMotion: boolean
  playback: PlaybackSettings
  ai: AiSettings
  musicSource: MusicSourceSettings
  content: ContentSettings
  storage: StorageSettings
}

export const defaultAiSettings: AiSettings = {
  mode: 'echora',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  apiKey: '',
  autoLearnPreferences: true,
}

export const defaultMusicSourceSettings: MusicSourceSettings = {
  preferredQuality: 'high',
  downloadQuality: 'high',
  downloadFileNameFormat: 'artist-title',
  autoFallback: true,
}

export const defaultContentSettings: ContentSettings = {
  featuredTrackLimit: 20,
  chartTrackLimit: 50,
  personalizedRecommendations: true,
}

export const defaultStorageSettings: StorageSettings = {
  playbackCacheLimitMb: 2048,
  autoScanLocalFolders: true,
}

export const defaultPlaybackSettings: PlaybackSettings = {
  systemMediaControls: true,
  keepAwakeWhilePlaying: false,
}

export const defaultAppSettings: AppSettings = {
  startupView: 'library',
  resumePlayback: true,
  seekStepSeconds: 5,
  closeBehavior: 'quit',
  reduceMotion: false,
  playback: defaultPlaybackSettings,
  ai: defaultAiSettings,
  musicSource: defaultMusicSourceSettings,
  content: defaultContentSettings,
  storage: defaultStorageSettings,
}

const isAiProvider = (value: unknown): value is AiProvider => value === 'openai' || value === 'anthropic' || value === 'compatible' || value === 'ollama'

const readAiSettings = (value: unknown): AiSettings => {
  if (!value || typeof value !== 'object') return defaultAiSettings
  const stored = value as Partial<AiSettings>
  return {
    mode: stored.mode === 'custom' ? 'custom' : 'echora',
    provider: isAiProvider(stored.provider) ? stored.provider : defaultAiSettings.provider,
    baseUrl: typeof stored.baseUrl === 'string' ? stored.baseUrl : defaultAiSettings.baseUrl,
    model: typeof stored.model === 'string' ? stored.model : defaultAiSettings.model,
    apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : defaultAiSettings.apiKey,
    autoLearnPreferences: typeof stored.autoLearnPreferences === 'boolean' ? stored.autoLearnPreferences : defaultAiSettings.autoLearnPreferences,
  }
}

const readMusicSourceSettings = (value: unknown): MusicSourceSettings => {
  if (!value || typeof value !== 'object') return defaultMusicSourceSettings
  const stored = value as Partial<MusicSourceSettings>
  const preferredQuality = stored.preferredQuality === 'lossless' || stored.preferredQuality === 'hires' ? stored.preferredQuality : 'high'
  const storedDownloadQuality = stored.downloadQuality === 'high' || stored.downloadQuality === 'lossless' || stored.downloadQuality === 'hires'
    ? stored.downloadQuality
    : preferredQuality
  return {
    preferredQuality,
    downloadQuality: storedDownloadQuality,
    downloadFileNameFormat: stored.downloadFileNameFormat === 'title-artist' ? 'title-artist' : 'artist-title',
    autoFallback: typeof stored.autoFallback === 'boolean' ? stored.autoFallback : true,
  }
}

const readContentSettings = (value: unknown): ContentSettings => {
  if (!value || typeof value !== 'object') return defaultContentSettings
  const stored = value as Partial<ContentSettings>
  return {
    featuredTrackLimit: featuredTrackLimitOptions.includes(stored.featuredTrackLimit as FeaturedTrackLimit) ? stored.featuredTrackLimit as FeaturedTrackLimit : defaultContentSettings.featuredTrackLimit,
    chartTrackLimit: chartTrackLimitOptions.includes(stored.chartTrackLimit as ChartTrackLimit) ? stored.chartTrackLimit as ChartTrackLimit : defaultContentSettings.chartTrackLimit,
    personalizedRecommendations: typeof stored.personalizedRecommendations === 'boolean' ? stored.personalizedRecommendations : defaultContentSettings.personalizedRecommendations,
  }
}

const readStorageSettings = (value: unknown): StorageSettings => {
  if (!value || typeof value !== 'object') return defaultStorageSettings
  const stored = value as Partial<StorageSettings>
  return {
    playbackCacheLimitMb: playbackCacheLimitOptions.includes(stored.playbackCacheLimitMb as PlaybackCacheLimit)
      ? stored.playbackCacheLimitMb as PlaybackCacheLimit
      : defaultStorageSettings.playbackCacheLimitMb,
    autoScanLocalFolders: typeof stored.autoScanLocalFolders === 'boolean' ? stored.autoScanLocalFolders : defaultStorageSettings.autoScanLocalFolders,
  }
}

const readPlaybackSettings = (value: unknown): PlaybackSettings => {
  if (!value || typeof value !== 'object') return defaultPlaybackSettings
  const stored = value as Partial<PlaybackSettings>
  return {
    systemMediaControls: typeof stored.systemMediaControls === 'boolean' ? stored.systemMediaControls : defaultPlaybackSettings.systemMediaControls,
    keepAwakeWhilePlaying: typeof stored.keepAwakeWhilePlaying === 'boolean' ? stored.keepAwakeWhilePlaying : defaultPlaybackSettings.keepAwakeWhilePlaying,
  }
}

export const readAppSettings = (): AppSettings => {
  try {
    const stored = JSON.parse(localStorage.getItem('echora.appSettings') ?? '{}') as Partial<AppSettings>
    return {
      startupView: stored.startupView === 'field' ? 'field' : 'library',
      resumePlayback: typeof stored.resumePlayback === 'boolean' ? stored.resumePlayback : defaultAppSettings.resumePlayback,
      seekStepSeconds: seekStepOptions.includes(stored.seekStepSeconds as SeekStepSeconds) ? stored.seekStepSeconds as SeekStepSeconds : defaultAppSettings.seekStepSeconds,
      closeBehavior: stored.closeBehavior === 'background' ? 'background' : 'quit',
      reduceMotion: typeof stored.reduceMotion === 'boolean' ? stored.reduceMotion : defaultAppSettings.reduceMotion,
      playback: readPlaybackSettings(stored.playback),
      ai: readAiSettings(stored.ai),
      musicSource: readMusicSourceSettings(stored.musicSource),
      content: readContentSettings(stored.content),
      storage: readStorageSettings(stored.storage),
    }
  } catch {
    return defaultAppSettings
  }
}

export const writeAppSettings = (settings: AppSettings) => localStorage.setItem('echora.appSettings', JSON.stringify(settings))
