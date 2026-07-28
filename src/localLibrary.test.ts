import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { IAudioMetadata } from 'music-metadata'
import { describeAudioQuality, importLocalAudioFiles, inferArtistAndTitle, readLocalTracks, removeLocalTrack, saveDownloadedTrack } from './localLibrary'

const deleteDatabase = () => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase('echora.localLibrary')
  request.onsuccess = () => resolve()
  request.onerror = () => reject(request.error)
})

beforeEach(deleteDatabase)

describe('local music library', () => {
  it('infers missing tags from a conventional file name', () => {
    expect(inferArtistAndTitle('Mira Vale - Slow Satellites.flac')).toEqual({ artist: 'Mira Vale', title: 'Slow Satellites' })
    expect(inferArtistAndTitle('Untitled.wav')).toEqual({ artist: '未知艺人', title: 'Untitled' })
  })

  it('describes lossy and lossless formats from parsed metadata', () => {
    expect(describeAudioQuality({ format: { codec: 'FLAC', lossless: true, bitsPerSample: 24, sampleRate: 96_000 } } as Pick<IAudioMetadata, 'format'>)).toBe('FLAC 24bit 96kHz')
    expect(describeAudioQuality({ format: { codec: 'MPEG 1 Layer 3', bitrate: 320_000 } } as Pick<IAudioMetadata, 'format'>)).toBe('MP1 LAYER 3 320 kbps')
  })

  it('persists imported audio, skips duplicates, and removes the stored file', async () => {
    const file = new File([new Uint8Array([0, 1, 2, 3])], 'Mira Vale - Slow Satellites.mp3', { type: 'audio/mpeg', lastModified: 42 })
    const first = await importLocalAudioFiles([file])
    expect(first.importedCount).toBe(1)
    expect(first.tracks[0]).toMatchObject({ title: 'Slow Satellites', artist: 'Mira Vale', source: '本地', offline: true })

    const duplicate = await importLocalAudioFiles([file])
    expect(duplicate).toMatchObject({ importedCount: 0, skippedCount: 1 })
    const saved = await readLocalTracks()
    expect(saved).toHaveLength(1)

    await removeLocalTrack(saved[0].localFileId!)
    await expect(readLocalTracks()).resolves.toEqual([])
  })

  it('persists a resolved remote download under the original catalog id', async () => {
    const remoteTrack = {
      id: 928_908,
      title: '晴天',
      artist: '周杰伦',
      album: '叶惠美',
      duration: '4:29',
      durationSeconds: 269,
      source: '酷我' as const,
      quality: 'FLAC 无损',
      cover: 'https://example.com/cover.jpg',
      bpm: 0,
      musicalKey: '待分析',
      x: 20,
      y: 50,
      offline: false,
      verified: true,
      sizeMb: 0,
      remote: {
        source: 'kw' as const,
        availableQualities: ['flac' as const],
        playbackToken: 'signed-playback-token',
        musicInfo: {
          songmid: '228908',
          name: '晴天',
          singer: '周杰伦',
          albumName: '叶惠美',
          source: 'kw' as const,
          interval: '04:29',
          types: [{ type: 'flac' as const, size: null }],
          _types: { flac: { size: null } },
          typeUrl: {},
        },
      },
    }
    const downloaded = await saveDownloadedTrack(remoteTrack, new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/flac' }))
    expect(downloaded).toMatchObject({ id: remoteTrack.id, offline: true, localFileId: 'download:kw:228908' })
    const stored = await readLocalTracks()
    expect(stored[0]).toMatchObject({ id: remoteTrack.id, title: '晴天', source: '酷我', offline: true })
    expect(stored[0].remote?.playbackToken).toBeUndefined()

    await saveDownloadedTrack({ ...remoteTrack, id: remoteTrack.id + 1 }, new Blob([new Uint8Array([4, 5, 6])], { type: 'audio/flac' }))
    const replaced = await readLocalTracks()
    expect(replaced).toHaveLength(1)
    expect(replaced[0]).toMatchObject({ id: remoteTrack.id + 1, localFileId: 'download:kw:228908' })
  })
})
