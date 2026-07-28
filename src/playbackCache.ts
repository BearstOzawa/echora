import type { RuntimeCapabilities } from './runtimeCapabilities'

export type PlaybackCacheStats = {
  bytes: number
  entries: number
}

const canManageNativeCache = (runtime: RuntimeCapabilities) => runtime.native && runtime.kind !== 'web'

export const readPlaybackCacheStats = async (runtime: RuntimeCapabilities): Promise<PlaybackCacheStats | null> => {
  if (!canManageNativeCache(runtime)) return null
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<PlaybackCacheStats>('playback_cache_stats')
  } catch {
    return null
  }
}

export const prunePlaybackCache = async (runtime: RuntimeCapabilities, limitMb: number) => {
  if (!canManageNativeCache(runtime)) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<PlaybackCacheStats>('prune_playback_cache', { limitMb })
}

export const clearPlaybackCache = async (runtime: RuntimeCapabilities) => {
  if (!canManageNativeCache(runtime)) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<PlaybackCacheStats>('clear_playback_cache')
}
