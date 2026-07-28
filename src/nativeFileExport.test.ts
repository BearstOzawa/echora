import { beforeEach, describe, expect, it, vi } from 'vitest'

const nativeExport = vi.hoisted(() => ({
  existing: new Set<string>(),
  written: new Map<string, Uint8Array>(),
  savePath: null as string | null,
  openPath: null as string | null,
}))

vi.mock('@tauri-apps/api/path', () => ({ join: vi.fn(async (...parts: string[]) => parts.join('/')) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(async () => nativeExport.savePath),
  open: vi.fn(async () => nativeExport.openPath),
}))
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(async (path: string) => nativeExport.existing.has(path) || nativeExport.written.has(path)),
  writeFile: vi.fn(async (path: string, bytes: Uint8Array) => { nativeExport.written.set(path, bytes) }),
}))

beforeEach(() => {
  nativeExport.existing.clear()
  nativeExport.written.clear()
  nativeExport.savePath = null
  nativeExport.openPath = null
})

describe('native file export', () => {
  it('writes a single song only after the user chooses a destination', async () => {
    const { exportNativeAudioFiles } = await import('./nativeFileExport')
    const file = new File(['audio'], 'Artist - Song.flac', { type: 'audio/flac' })

    await expect(exportNativeAudioFiles([file])).resolves.toEqual({ exportedCount: 0, cancelled: true })
    nativeExport.savePath = '/Users/test/Music/Artist - Song.flac'
    await expect(exportNativeAudioFiles([file])).resolves.toEqual({ exportedCount: 1, cancelled: false })
    expect(nativeExport.written.has(nativeExport.savePath)).toBe(true)
  })

  it('exports a batch into one folder without overwriting existing names', async () => {
    const { exportNativeAudioFiles } = await import('./nativeFileExport')
    nativeExport.openPath = '/Users/test/Exports'
    nativeExport.existing.add('/Users/test/Exports/Artist - Song.mp3')

    const files = [
      new File(['one'], 'Artist - Song.mp3', { type: 'audio/mpeg' }),
      new File(['two'], 'Another - Song.mp3', { type: 'audio/mpeg' }),
    ]
    await expect(exportNativeAudioFiles(files)).resolves.toEqual({ exportedCount: 2, cancelled: false })
    expect(Array.from(nativeExport.written.keys())).toEqual([
      '/Users/test/Exports/Artist - Song 2.mp3',
      '/Users/test/Exports/Another - Song.mp3',
    ])
  })
})
