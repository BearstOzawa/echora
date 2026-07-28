export const transientStorageKeys = [
  'echora.remoteCatalog',
  'echora.remoteCatalog.v2',
  'echora.sourceDiscovery.v1',
  'echora.sourceDiscovery.v2',
  'echora.sourceDiscovery.v3',
  'echora.sourceDiscovery.v4',
  'echora.sourceDiscovery.v5',
  'echora.sourceDiscovery.v6',
] as const
export const libraryStorageKeys = [
  'echora.playlists',
  'echora.likedTracks',
  'echora.userProfile',
] as const
export const activityStorageKeys = [
  'echora.agentSessions.v1',
  'echora.agentMemories',
  'echora.playbackSession',
] as const
export const preferenceStorageKeys = [
  'echora.appSettings',
  'echora.audioEffects',
  'echora.appearance',
  'echora.palettes',
  'echora.followTrackPalette',
  'echora.lyricFontLevel',
] as const

type CacheStorageLike = Pick<CacheStorage, 'keys' | 'delete'>

export const estimateStorageUsage = async () => {
  if (!navigator.storage?.estimate) return null
  try {
    const estimate = await navigator.storage.estimate()
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
  } catch {
    return null
  }
}

export const clearTransientAppCache = async (storage: Pick<Storage, 'removeItem'> = localStorage, cacheStorage: CacheStorageLike | undefined = globalThis.caches) => {
  transientStorageKeys.forEach((key) => storage.removeItem(key))
  let deletedCacheCount = 0
  if (cacheStorage) {
    try {
      const names = await cacheStorage.keys()
      const ownedNames = names.filter((name) => name.startsWith('echora-'))
      const results = await Promise.all(ownedNames.map((name) => cacheStorage.delete(name)))
      deletedCacheCount = results.filter(Boolean).length
    } catch {
      // Metadata cache is already cleared; runtime-managed caches may be unavailable.
    }
  }
  return { clearedKeys: [...transientStorageKeys], deletedCacheCount }
}

const removeOwnedKeys = (keys: readonly string[], storage: Pick<Storage, 'removeItem'>) => keys.forEach((key) => storage.removeItem(key))

export const clearUsageHistory = (storage: Pick<Storage, 'removeItem'> = localStorage) => {
  storage.removeItem('echora.playbackSession')
  return { clearedKeys: ['echora.playbackSession'] }
}

export const restoreAppDefaults = async (storage: Pick<Storage, 'removeItem'> = localStorage, cacheStorage: CacheStorageLike | undefined = globalThis.caches) => {
  removeOwnedKeys([...libraryStorageKeys, ...activityStorageKeys, ...preferenceStorageKeys], storage)
  const cacheResult = await clearTransientAppCache(storage, cacheStorage)
  return { clearedKeys: [...libraryStorageKeys, ...activityStorageKeys, ...preferenceStorageKeys, ...cacheResult.clearedKeys], deletedCacheCount: cacheResult.deletedCacheCount }
}

export const formatStorageSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}
