import type { PlaybackMode, PlaybackRate, QualityMode, Track } from './types'
import { restoredPlaybackContext } from './playbackContext'
import type { PlaybackContext, PlaybackContextKind } from './playbackContext'
import { brandMarkPath, normalizeBrandArtwork } from './brandAssets'

export const playbackSessionKey = 'echora.playbackSession'

export type PlaybackSession = {
  tracks: Track[]
  detachedTrack: Track | null
  downloadedTrackIds: number[]
  activeTrackId: number
  isPlaying: boolean
  playbackMode: PlaybackMode
  playbackRate: PlaybackRate
  playProgress: number
  volume: number
  muted: boolean
  quality: QualityMode
  intensity: number
  novelty: number
  intent: string
  sessionName: string
  playbackContext: PlaybackContext
}

type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const qualities: QualityMode[] = ['自动', '无损', 'Hi-Res']
const playbackRates: PlaybackRate[] = [0.5, 0.75, 1, 1.25, 1.5, 2]
const sources = ['QQ', '网易云', '酷我', '咪咕', '酷狗', '本地']
const playbackContextKinds: PlaybackContextKind[] = ['collection', 'playlist', 'liked', 'local', 'search', 'discovery', 'agent', 'manual', 'restored']

const isTrack = (value: unknown): value is Track => {
  if (!value || typeof value !== 'object') return false
  const track = value as Record<string, unknown>
  return Number.isFinite(track.id)
    && typeof track.title === 'string'
    && typeof track.artist === 'string'
    && typeof track.album === 'string'
    && typeof track.duration === 'string'
    && Number.isFinite(track.durationSeconds)
    && sources.includes(String(track.source))
    && typeof track.quality === 'string'
    && typeof track.cover === 'string'
    && Number.isFinite(track.bpm)
    && typeof track.musicalKey === 'string'
    && Number.isFinite(track.x)
    && Number.isFinite(track.y)
    && typeof track.offline === 'boolean'
    && typeof track.verified === 'boolean'
    && Number.isFinite(track.sizeMb)
}

const boundedNumber = (value: unknown, fallback: number, min: number, max: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

const nonEmptyString = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value : fallback

const persistentTrack = (track: Track): Track => {
  const normalized = { ...track, cover: normalizeBrandArtwork(track.cover), audioUrl: undefined }
  if (!track.remote) return normalized
  return { ...normalized, remote: { ...track.remote, resolvedQuality: undefined, resolvedAt: undefined, playbackToken: undefined } }
}

const readPlaybackContext = (value: unknown): PlaybackContext => {
  if (!value || typeof value !== 'object') return restoredPlaybackContext
  const context = value as Partial<PlaybackContext>
  if (!playbackContextKinds.includes(context.kind as PlaybackContextKind) || typeof context.id !== 'string' || typeof context.title !== 'string') return restoredPlaybackContext
  return {
    kind: context.kind as PlaybackContextKind,
    id: context.id,
    title: context.title,
    ...(context.kind === 'agent' && typeof context.agentSessionId === 'string' ? { agentSessionId: context.agentSessionId } : {}),
  }
}

export const readPlaybackSession = (storage: SessionStorage = localStorage): PlaybackSession | null => {
  try {
    const parsed = JSON.parse(storage.getItem(playbackSessionKey) ?? 'null') as Record<string, unknown> | null
    if (!parsed || !Array.isArray(parsed.tracks) || !parsed.tracks.length || !parsed.tracks.every(isTrack)) return null

    const tracks = parsed.tracks
    if (tracks.every((track) => !track.remote && !track.localFileId)) return null
    const detachedTrack = isTrack(parsed.detachedTrack) ? persistentTrack(parsed.detachedTrack) : null
    const storedActiveId = typeof parsed.activeTrackId === 'number' ? parsed.activeTrackId : tracks[0].id
    const activeTrackId = tracks.some((track) => track.id === storedActiveId) || detachedTrack?.id === storedActiveId
      ? storedActiveId
      : tracks[0].id

    return {
      tracks: tracks.map(persistentTrack),
      detachedTrack,
      downloadedTrackIds: Array.isArray(parsed.downloadedTrackIds)
        ? parsed.downloadedTrackIds.filter((id): id is number => typeof id === 'number' && Number.isInteger(id))
        : [],
      activeTrackId,
      isPlaying: false,
      playbackMode: parsed.playbackMode === 'shuffle' || parsed.playbackMode === 'repeat-one' ? parsed.playbackMode : 'sequence',
      playbackRate: playbackRates.includes(parsed.playbackRate as PlaybackRate) ? parsed.playbackRate as PlaybackRate : 1,
      playProgress: boundedNumber(parsed.playProgress, 0, 0, 100),
      volume: boundedNumber(parsed.volume, 72, 0, 100),
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : false,
      quality: qualities.includes(parsed.quality as QualityMode) ? parsed.quality as QualityMode : '无损',
      intensity: boundedNumber(parsed.intensity, 64, 0, 100),
      novelty: boundedNumber(parsed.novelty, 38, 0, 100),
      intent: nonEmptyString(parsed.intent, '继续上次的播放安排。'),
      sessionName: nonEmptyString(parsed.sessionName, '上次播放'),
      playbackContext: readPlaybackContext(parsed.playbackContext),
    }
  } catch {
    return null
  }
}

export const writePlaybackSession = (session: PlaybackSession, storage: SessionStorage = localStorage) => {
  const serializableSession = {
    ...session,
    isPlaying: false,
    tracks: session.tracks.map((track) => persistentTrack(track.localFileId ? { ...track, cover: brandMarkPath } : track)),
    detachedTrack: session.detachedTrack
      ? persistentTrack(session.detachedTrack.localFileId ? { ...session.detachedTrack, cover: brandMarkPath } : session.detachedTrack)
      : null,
  }
  storage.setItem(playbackSessionKey, JSON.stringify(serializableSession))
}

export const clearPlaybackSession = (storage: SessionStorage = localStorage) => {
  storage.removeItem(playbackSessionKey)
}
