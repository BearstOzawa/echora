import { describe, expect, it, vi } from 'vitest'
import { clearTransientAppCache, clearUsageHistory, formatStorageSize, restoreAppDefaults } from './storageMaintenance'

describe('storage maintenance', () => {
  it('clears only rebuildable Echora content caches', async () => {
    const removeItem = vi.fn()
    const cacheStorage = { keys: vi.fn().mockResolvedValue(['echora-artwork', 'another-app']), delete: vi.fn().mockResolvedValue(true) }
    const result = await clearTransientAppCache({ removeItem }, cacheStorage)
    expect(removeItem).toHaveBeenCalledWith('echora.remoteCatalog')
    expect(removeItem).toHaveBeenCalledWith('echora.remoteCatalog.v2')
    expect(removeItem).toHaveBeenCalledWith('echora.sourceDiscovery.v1')
    expect(removeItem).toHaveBeenCalledWith('echora.sourceDiscovery.v2')
    expect(removeItem).toHaveBeenCalledWith('echora.sourceDiscovery.v3')
    expect(removeItem).toHaveBeenCalledWith('echora.sourceDiscovery.v4')
    expect(removeItem).toHaveBeenCalledWith('echora.sourceDiscovery.v5')
    expect(removeItem).toHaveBeenCalledWith('echora.sourceDiscovery.v6')
    expect(removeItem).not.toHaveBeenCalledWith('echora.agentSessions.v1')
    expect(cacheStorage.delete).toHaveBeenCalledWith('echora-artwork')
    expect(cacheStorage.delete).not.toHaveBeenCalledWith('another-app')
    expect(result.deletedCacheCount).toBe(1)
  })

  it('clears usage history without removing playlists, preferences or offline music', () => {
    const removeItem = vi.fn()
    clearUsageHistory({ removeItem })
    expect(removeItem).toHaveBeenCalledWith('echora.playbackSession')
    expect(removeItem).not.toHaveBeenCalledWith('echora.agentMemories')
    expect(removeItem).not.toHaveBeenCalledWith('echora.playlists')
    expect(removeItem).not.toHaveBeenCalledWith('echora.likedTracks')
    expect(removeItem).not.toHaveBeenCalledWith('echora.appSettings')
    expect(removeItem).not.toHaveBeenCalledWith('echora.localLibrary')
  })

  it('restores owned settings and personal data while preserving offline music', async () => {
    const removeItem = vi.fn()
    await restoreAppDefaults({ removeItem }, undefined)
    expect(removeItem).toHaveBeenCalledWith('echora.appSettings')
    expect(removeItem).toHaveBeenCalledWith('echora.playlists')
    expect(removeItem).not.toHaveBeenCalledWith('echora.localLibrary')
    expect(removeItem).not.toHaveBeenCalledWith('echora.installationId')
  })

  it('formats storage usage for settings copy', () => {
    expect(formatStorageSize(512)).toBe('512 B')
    expect(formatStorageSize(2 * 1024 * 1024)).toBe('2.0 MB')
  })
})
