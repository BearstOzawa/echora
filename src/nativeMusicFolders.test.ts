import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initialTracks } from './testFixtures'

const folderMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  readFile: vi.fn(),
  importFiles: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: folderMocks.invoke }))
vi.mock('@tauri-apps/api/path', () => ({}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: folderMocks.readFile,
  stat: vi.fn(async () => ({ mtime: new Date(1000) })),
}))
vi.mock('./localLibrary', () => ({ importLocalAudioFiles: folderMocks.importFiles }))

beforeEach(() => {
  folderMocks.invoke.mockReset()
  folderMocks.readFile.mockReset()
  folderMocks.importFiles.mockReset()
})

describe('native music folders', () => {
  it('uses the native scan manifest and keeps processing when one file cannot be read', async () => {
    const folder = { id: 'folder-music', name: 'Music', path: '/Music', addedAt: 1, trackCount: 0, available: true }
    folderMocks.invoke.mockResolvedValue(['/Music/one.mp3', '/Music/broken.flac'])
    folderMocks.readFile.mockImplementation(async (path: string) => {
      if (path.includes('broken')) throw new Error('unreadable')
      return new Uint8Array([1, 2, 3])
    })
    folderMocks.importFiles.mockResolvedValue({ tracks: [initialTracks[0]], importedCount: 1, skippedCount: 0 })

    const { scanLocalMusicFolder } = await import('./nativeMusicFolders')
    await expect(scanLocalMusicFolder(folder)).resolves.toEqual({
      tracks: [initialTracks[0]],
      importedCount: 1,
      skippedCount: 1,
      discoveredCount: 2,
    })
    expect(folderMocks.invoke).toHaveBeenCalledWith('scan_music_folder', { id: folder.id })
  })
})
