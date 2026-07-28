export type Source = 'QQ' | '网易云' | '酷我' | '咪咕' | '酷狗' | '本地'
export type Workspace = 'field' | 'library' | 'account' | 'nowPlaying'
export type QualityMode = '自动' | '无损' | 'Hi-Res'
export type PlaybackMode = 'sequence' | 'shuffle' | 'repeat-one'
export type PlaybackRate = 0.5 | 0.75 | 1 | 1.25 | 1.5 | 2

export type OnlineSource = 'tx' | 'wy' | 'kw' | 'mg' | 'kg'
export type LxQuality = '128k' | '320k' | 'flac' | 'flac24bit'

export type LxMusicInfo = {
  songmid: string | number
  songId?: string | number
  name: string
  singer: string
  albumName: string
  albumId?: string | number
  albumMid?: string
  strMediaMid?: string
  copyrightId?: string
  interval: string | null
  source: OnlineSource
  img?: string | null
  lrc?: string | null
  lrcUrl?: string
  mrcUrl?: string
  trcUrl?: string
  types: Array<{ type: LxQuality; size: string | null; hash?: string }>
  _types: Partial<Record<LxQuality, { size: string | null; hash?: string }>>
  typeUrl: Record<string, string>
}

export type RemoteTrack = {
  source: OnlineSource
  musicInfo: LxMusicInfo
  availableQualities: LxQuality[]
  requestedQuality?: LxQuality
  resolvedQuality?: LxQuality
  resolvedAt?: number
  playbackToken?: string
}

export type Track = {
  id: number
  title: string
  artist: string
  album: string
  duration: string
  durationSeconds: number
  source: Source
  quality: string
  cover: string
  bpm: number
  musicalKey: string
  x: number
  y: number
  offline: boolean
  verified: boolean
  sizeMb: number
  localFileId?: string
  audioUrl?: string
  sourceTrackId?: number
  remote?: RemoteTrack
}

export type MemoryNode = {
  id: string
  label: string
  detail: string
  x: number
  y: number
  weight: number
  tone: 'acid' | 'blue' | 'coral' | 'white'
}

export type AgentEvent = {
  id: number
  label: string
  detail: string
  state: 'done' | 'active' | 'waiting'
}
