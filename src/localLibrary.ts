import { parseBlob } from 'music-metadata'
import type { IAudioMetadata, IPicture } from 'music-metadata'
import type { Track } from './types'
import { brandMarkPath } from './brandAssets'

const databaseName = 'echora.localLibrary'
const databaseVersion = 1
const trackStoreName = 'tracks'
const fallbackCover = brandMarkPath

export type StoredLocalTrack = {
  storageId: string
  track: Track
  audio: Blob
  cover?: Blob
  addedAt: number
}

const usesNativeLibrary = () => '__TAURI_INTERNALS__' in globalThis
const usesAndroidNativeLibrary = () => usesNativeLibrary() && typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)

export type LocalImportResult = {
  tracks: Track[]
  importedCount: number
  skippedCount: number
}

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  if (!('indexedDB' in globalThis)) {
    reject(new Error('当前环境不支持本地音乐存储'))
    return
  }
  const request = indexedDB.open(databaseName, databaseVersion)
  request.onupgradeneeded = () => {
    const database = request.result
    if (!database.objectStoreNames.contains(trackStoreName)) database.createObjectStore(trackStoreName, { keyPath: 'storageId' })
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('无法打开本地音乐库'))
})

const runRequest = <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) => openDatabase().then((database) => new Promise<T>((resolve, reject) => {
  const transaction = database.transaction(trackStoreName, mode)
  const request = action(transaction.objectStore(trackStoreName))
  let result: T
  let requestCompleted = false
  let settled = false
  const fail = (error: Error) => {
    if (settled) return
    settled = true
    database.close()
    reject(error)
  }
  request.onsuccess = () => {
    result = request.result
    requestCompleted = true
  }
  request.onerror = () => fail(request.error ?? new Error('本地音乐库操作失败'))
  transaction.oncomplete = () => {
    database.close()
    if (settled) return
    if (!requestCompleted) {
      fail(new Error('本地音乐库事务未完成'))
      return
    }
    settled = true
    resolve(result!)
  }
  transaction.onerror = () => fail(transaction.error ?? new Error('本地音乐库事务失败'))
  transaction.onabort = () => fail(transaction.error ?? new Error('本地音乐库事务已取消'))
}))

const fileIdentity = (file: File) => `${file.name}:${file.size}:${file.lastModified}`

const createObjectUrl = (blob: Blob | undefined) => {
  if (!blob || typeof URL.createObjectURL !== 'function') return undefined
  try {
    return URL.createObjectURL(blob)
  } catch {
    return undefined
  }
}

const runtimeTrack = (record: StoredLocalTrack): Track => ({
  ...record.track,
  cover: createObjectUrl(record.cover) ?? record.track.cover ?? fallbackCover,
  audioUrl: createObjectUrl(record.audio),
})

const fileNameWithoutExtension = (fileName: string) => fileName.replace(/\.[^.]+$/, '').trim()

export const inferArtistAndTitle = (fileName: string) => {
  const baseName = fileNameWithoutExtension(fileName)
  const parts = baseName.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2) return { artist: '未知艺人', title: baseName || '未命名歌曲' }
  return { artist: parts[0], title: parts.slice(1).join(' - ') }
}

const formatDuration = (durationSeconds: number) => {
  if (!durationSeconds) return '--:--'
  const rounded = Math.round(durationSeconds)
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`
}

export const describeAudioQuality = (metadata: Pick<IAudioMetadata, 'format'>) => {
  const { format } = metadata
  const codec = (format.codec ?? format.container ?? '音频').replace(/^MPEG\s*/i, 'MP').toUpperCase()
  if (format.lossless) {
    const depth = format.bitsPerSample ? `${format.bitsPerSample}bit` : '无损'
    const rate = format.sampleRate ? `${Number((format.sampleRate / 1000).toFixed(1))}kHz` : ''
    return [codec, depth, rate].filter(Boolean).join(' ')
  }
  const bitrate = format.bitrate ? `${Math.round(format.bitrate / 1000)} kbps` : ''
  return [codec, bitrate].filter(Boolean).join(' ') || '音频文件'
}

const pictureBlob = (picture: IPicture | undefined) => {
  if (!picture) return undefined
  const bytes = new Uint8Array(picture.data.byteLength)
  bytes.set(picture.data)
  return new Blob([bytes.buffer], { type: picture.format })
}

const createTrackId = () => -(Date.now() * 1000 + Math.floor(Math.random() * 1000))

const createStoredTrack = async (file: File, index: number): Promise<StoredLocalTrack> => {
  let metadata: IAudioMetadata | null = null
  try {
    metadata = await parseBlob(file, { duration: true })
  } catch {
    // Unsupported tags should not prevent a browser-playable file from being imported.
  }
  const inferred = inferArtistAndTitle(file.name)
  const durationSeconds = Math.max(0, Math.round(metadata?.format.duration ?? 0))
  const storageId = fileIdentity(file)
  const track: Track = {
    id: createTrackId(),
    title: metadata?.common.title?.trim() || inferred.title,
    artist: metadata?.common.artist?.trim() || inferred.artist,
    album: metadata?.common.album?.trim() || '未分类专辑',
    duration: formatDuration(durationSeconds),
    durationSeconds,
    source: '本地',
    quality: metadata ? describeAudioQuality(metadata) : (file.type || '音频文件'),
    cover: fallbackCover,
    bpm: Math.max(0, Math.round(metadata?.common.bpm ?? 0)),
    musicalKey: metadata?.common.key?.trim() || '未知',
    x: 12 + (index % 6) * 15,
    y: 50,
    offline: true,
    verified: true,
    sizeMb: Number((file.size / 1024 / 1024).toFixed(1)),
    localFileId: storageId,
  }
  return {
    storageId,
    track,
    audio: file,
    cover: pictureBlob(metadata?.common.picture?.[0]),
    addedAt: Date.now(),
  }
}

export const readLocalTracks = async (): Promise<Track[]> => {
  if (usesNativeLibrary()) return (await import('./nativeLocalLibrary')).readNativeLocalTracks()
  const records = await runRequest<StoredLocalTrack[]>('readonly', (store) => store.getAll())
  return records.sort((a, b) => b.addedAt - a.addedAt).map(runtimeTrack)
}

export const importLocalAudioFiles = async (files: File[]): Promise<LocalImportResult> => {
  const supportedExtension = usesAndroidNativeLibrary()
    ? /\.(mp3|flac|m4a|aac|ogg|opus|wav)$/i
    : /\.(mp3|flac|m4a|aac|ogg|opus|wav|aiff?|ape|wma)$/i
  const audioFiles = files.filter((file) => supportedExtension.test(file.name))
  const existingIds = new Set(usesNativeLibrary()
    ? (await readLocalTracks()).flatMap((track) => track.localFileId ? [track.localFileId] : [])
    : (await runRequest<StoredLocalTrack[]>('readonly', (store) => store.getAll())).map((record) => record.storageId))
  const imported: StoredLocalTrack[] = []
  const importedTracks: Track[] = []
  let skippedCount = files.length - audioFiles.length

  for (const [index, file] of audioFiles.entries()) {
    if (existingIds.has(fileIdentity(file))) {
      skippedCount += 1
      continue
    }
    const record = await createStoredTrack(file, index)
    if (usesNativeLibrary()) importedTracks.push(await (await import('./nativeLocalLibrary')).saveNativeLocalTrack(record))
    else await runRequest<IDBValidKey>('readwrite', (store) => store.put(record))
    existingIds.add(record.storageId)
    imported.push(record)
  }

  return {
    tracks: usesNativeLibrary() ? importedTracks : imported.map(runtimeTrack),
    importedCount: imported.length,
    skippedCount,
  }
}

export const saveDownloadedTrack = async (track: Track, audio: Blob, cover?: Blob): Promise<Track> => {
  if (!track.remote) throw new Error('缺少远端歌曲信息，无法保存下载')
  if (!audio.size) throw new Error('下载结果为空，未保存到本地音乐')
  const storageId = `download:${track.remote.source}:${track.remote.musicInfo.songmid}`
  const storedTrack: Track = {
    ...track,
    offline: true,
    localFileId: storageId,
    audioUrl: undefined,
    remote: { ...track.remote, playbackToken: undefined },
    sizeMb: Number((audio.size / 1024 / 1024).toFixed(1)),
  }
  const record: StoredLocalTrack = { storageId, track: storedTrack, audio, cover, addedAt: Date.now() }
  if (usesNativeLibrary()) return (await import('./nativeLocalLibrary')).saveNativeLocalTrack(record)
  await runRequest<IDBValidKey>('readwrite', (store) => store.put(record))
  return runtimeTrack(record)
}

export const removeLocalTrack = async (storageId: string) => {
  if (usesNativeLibrary()) return (await import('./nativeLocalLibrary')).removeNativeLocalTrack(storageId)
  await runRequest<undefined>('readwrite', (store) => store.delete(storageId))
}

export const clearLocalTracks = async () => {
  if (usesNativeLibrary()) return (await import('./nativeLocalLibrary')).clearNativeLocalTracks()
  await runRequest<undefined>('readwrite', (store) => store.clear())
}

export const releaseLocalTrackUrls = (track: Track) => {
  if (track.audioUrl?.startsWith('blob:')) URL.revokeObjectURL(track.audioUrl)
  if (track.cover.startsWith('blob:')) URL.revokeObjectURL(track.cover)
}
