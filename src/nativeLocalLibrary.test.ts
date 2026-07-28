import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredLocalTrack } from './localLibrary'
import { initialTracks } from './testFixtures'

const nativeFs = vi.hoisted(() => ({
  files: new Map<string, Uint8Array | string>(),
  directories: new Set<string>(),
  nextWriteError: null as Error | null,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppLocalData: 5 },
  exists: vi.fn(async (path: string) => nativeFs.files.has(path) || nativeFs.directories.has(path)),
  mkdir: vi.fn(async (path: string) => { nativeFs.directories.add(path) }),
  readDir: vi.fn(async (path: string) => Array.from(nativeFs.files.keys())
    .filter((file) => file.startsWith(`${path}/`) && !file.slice(path.length + 1).includes('/'))
    .map((file) => ({ name: file.slice(path.length + 1) }))),
  readTextFile: vi.fn(async (path: string) => {
    const value = nativeFs.files.get(path)
    if (typeof value !== 'string') throw new Error('missing text file')
    return value
  }),
  writeFile: vi.fn(async (path: string, value: Uint8Array) => {
    if (nativeFs.nextWriteError) {
      const error = nativeFs.nextWriteError
      nativeFs.nextWriteError = null
      throw error
    }
    nativeFs.files.set(path, value)
  }),
  writeTextFile: vi.fn(async (path: string, value: string) => { nativeFs.files.set(path, value) }),
  rename: vi.fn(async (from: string, to: string) => {
    const value = nativeFs.files.get(from)
    if (value === undefined) throw new Error('missing source')
    nativeFs.files.set(to, value)
    nativeFs.files.delete(from)
  }),
  remove: vi.fn(async (path: string) => { nativeFs.files.delete(path) }),
}))

vi.mock('@tauri-apps/api/path', () => ({
  appLocalDataDir: vi.fn(async () => '/app-local-data'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}))

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: vi.fn((path: string) => `asset:${path}`) }))

beforeEach(() => {
  nativeFs.files.clear()
  nativeFs.directories.clear()
  nativeFs.nextWriteError = null
})

describe('native local music library', () => {
  it('persists media files and an index inside the scoped app music directory', async () => {
    const { readNativeLocalTracks, removeNativeLocalTrack, saveNativeLocalTrack } = await import('./nativeLocalLibrary')
    const stored: StoredLocalTrack = {
      storageId: 'download:kw:228908',
      track: { ...initialTracks[0], id: 228908, localFileId: 'download:kw:228908', offline: true, audioUrl: undefined },
      audio: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/flac' }),
      cover: new Blob([new Uint8Array([4, 5])], { type: 'image/png' }),
      addedAt: 123,
    }

    const saved = await saveNativeLocalTrack(stored)
    expect(saved.audioUrl).toMatch(/^asset:\/app-local-data\/music\/.+\.flac$/)
    expect(saved.cover).toMatch(/^asset:\/app-local-data\/music\/.+\.png$/)
    expect(nativeFs.files.has('music/library.json')).toBe(true)
    expect(Array.from(nativeFs.files.keys()).some((path) => path.endsWith('.flac'))).toBe(true)

    await expect(readNativeLocalTracks()).resolves.toMatchObject([{ id: 228908, offline: true }])
    await removeNativeLocalTrack(stored.storageId)
    await expect(readNativeLocalTracks()).resolves.toEqual([])
    expect(Array.from(nativeFs.files.keys()).filter((path) => path !== 'music/library.json')).toEqual([])
  })

  it('does not publish a partial file when device storage runs out', async () => {
    const { saveNativeLocalTrack } = await import('./nativeLocalLibrary')
    nativeFs.nextWriteError = new Error('ENOSPC: no space left on device')
    const stored: StoredLocalTrack = {
      storageId: 'download:kw:space-full',
      track: { ...initialTracks[0], id: 991, localFileId: 'download:kw:space-full', offline: true, audioUrl: undefined },
      audio: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }),
      addedAt: 123,
    }

    await expect(saveNativeLocalTrack(stored)).rejects.toThrow('设备存储空间不足，未能保存音乐')
    expect(Array.from(nativeFs.files.keys()).some((path) => path.endsWith('.next'))).toBe(false)
    expect(nativeFs.files.has('music/library.json')).toBe(false)
  })

  it('clears managed and interrupted music files while preserving unrelated app data', async () => {
    const { clearNativeLocalTracks, saveNativeLocalTrack } = await import('./nativeLocalLibrary')
    const stored: StoredLocalTrack = {
      storageId: 'download:kw:cleanup',
      track: { ...initialTracks[0], id: 992, localFileId: 'download:kw:cleanup', offline: true, audioUrl: undefined },
      audio: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/flac' }),
      addedAt: 123,
    }
    await saveNativeLocalTrack(stored)
    nativeFs.files.set('music/deadbeef.mp3.next', new Uint8Array([7]))
    nativeFs.files.set('music/external-folders.json', '["/storage/music"]')

    await clearNativeLocalTracks()

    expect(JSON.parse(String(nativeFs.files.get('music/library.json')))).toEqual([])
    expect(nativeFs.files.has('music/deadbeef.mp3.next')).toBe(false)
    expect(nativeFs.files.get('music/external-folders.json')).toBe('["/storage/music"]')
  })

  it('replaces an existing download without duplicating its library record', async () => {
    const { readNativeLocalTracks, saveNativeLocalTrack } = await import('./nativeLocalLibrary')
    const stored: StoredLocalTrack = {
      storageId: 'download:kw:duplicate',
      track: { ...initialTracks[0], id: 993, localFileId: 'download:kw:duplicate', offline: true, audioUrl: undefined },
      audio: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }),
      addedAt: 123,
    }

    await Promise.all([saveNativeLocalTrack(stored), saveNativeLocalTrack({ ...stored, addedAt: 124 })])

    await expect(readNativeLocalTracks()).resolves.toHaveLength(1)
    const index = JSON.parse(String(nativeFs.files.get('music/library.json'))) as unknown[]
    expect(index).toHaveLength(1)
    expect(Array.from(nativeFs.files.keys()).filter((path) => path.endsWith('.mp3'))).toHaveLength(1)
  })
})
