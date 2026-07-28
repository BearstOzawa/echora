export type PlaybackContextKind = 'collection' | 'playlist' | 'liked' | 'local' | 'search' | 'discovery' | 'agent' | 'manual' | 'restored'

export type PlaybackContext = {
  kind: PlaybackContextKind
  id: string
  title: string
  agentSessionId?: string
}

export type PlaybackApplyMode = 'continue-current' | 'play-first' | 'pause-first'

export type PlaybackSelection = {
  tracks: import('./types').Track[]
  context: PlaybackContext
}

export type QueuePlaybackState = {
  activeTrackId: number
  isPlaying: boolean
  playProgress: number
  detached: boolean
}

export const defaultPlaybackContext: PlaybackContext = {
  kind: 'manual',
  id: 'manual-queue',
  title: '播放队列',
}

export const restoredPlaybackContext: PlaybackContext = {
  kind: 'restored',
  id: 'restored-queue',
  title: '上次播放',
}

export const agentPlaybackContext = (sessionId: string, title: string): PlaybackContext => ({
  kind: 'agent',
  id: `agent:${sessionId}`,
  title,
  agentSessionId: sessionId,
})

export const reconcileQueuePlaybackState = (
  nextTrackIds: number[],
  activeTrackId: number,
  isPlaying: boolean,
  playProgress: number,
  mode: PlaybackApplyMode,
): QueuePlaybackState => {
  const firstTrackId = nextTrackIds[0] ?? -1
  if (mode === 'play-first') return { activeTrackId: firstTrackId, isPlaying: firstTrackId >= 0, playProgress: 0, detached: false }
  if (mode === 'pause-first') return { activeTrackId: firstTrackId, isPlaying: false, playProgress: 0, detached: false }
  if (activeTrackId >= 0) return {
    activeTrackId,
    isPlaying,
    playProgress,
    detached: !nextTrackIds.includes(activeTrackId),
  }
  return { activeTrackId: firstTrackId, isPlaying: false, playProgress: 0, detached: false }
}
