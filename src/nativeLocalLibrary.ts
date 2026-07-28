import { convertFileSrc } from '@tauri-apps/api/core'
import { appLocalDataDir, join } from '@tauri-apps/api/path'
import { BaseDirectory, exists, mkdir, readDir, readTextFile, remove, rename, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'
import type { StoredLocalTrack } from './localLibrary'
import type { Track } from './types'
import { brandMarkPath } from './brandAssets'

const libraryDirectory = 'music'
const indexPath = `${libraryDirectory}/library.json`
const temporaryIndexPath = `${libraryDirectory}/library.next.json`

type NativeLocalTrackRecord = {
  storageId: string
  track: Track
  audioPath: string
  coverPath?: string
  addedAt: number
}

let mutationQueue: Promise<void> = Promise.resolve()

const stableToken = (value: string) => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const audioExtension = (audio: Blob) => {
  if (audio instanceof File) return audio.name.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLocaleLowerCase() ?? 'audio'
  if (/flac/i.test(audio.type)) return 'flac'
  if (/mp4|m4a/i.test(audio.type)) return 'm4a'
  if (/aac/i.test(audio.type)) return 'aac'
  if (/ogg/i.test(audio.type)) return 'ogg'
  if (/wav/i.test(audio.type)) return 'wav'
  return 'mp3'
}

const coverExtension = (cover: Blob) => {
  if (/png/i.test(cover.type)) return 'png'
  if (/webp/i.test(cover.type)) return 'webp'
  if (/gif/i.test(cover.type)) return 'gif'
  return 'jpg'
}

const isNativeRecord = (value: unknown): value is NativeLocalTrackRecord => {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<NativeLocalTrackRecord>
  return typeof record.storageId === 'string'
    && typeof record.audioPath === 'string'
    && typeof record.addedAt === 'number'
    && Boolean(record.track && typeof record.track === 'object' && typeof record.track.id === 'number')
}

const ensureLibraryDirectory = () => mkdir(libraryDirectory, { baseDir: BaseDirectory.AppLocalData, recursive: true })

export const getNativeLocalLibraryLocation = async () => join(await appLocalDataDir(), libraryDirectory)

const readIndex = async (): Promise<NativeLocalTrackRecord[]> => {
  await ensureLibraryDirectory()
  if (!await exists(indexPath, { baseDir: BaseDirectory.AppLocalData })) return []
  try {
    const value = JSON.parse(await readTextFile(indexPath, { baseDir: BaseDirectory.AppLocalData })) as unknown
    if (!Array.isArray(value) || !value.every(isNativeRecord)) throw new Error('invalid index')
    return value
  } catch {
    throw new Error('本地音乐索引无法读取，请检查应用数据目录')
  }
}

const writeIndex = async (records: NativeLocalTrackRecord[]) => {
  await writeTextFile(temporaryIndexPath, JSON.stringify(records), { baseDir: BaseDirectory.AppLocalData })
  await rename(temporaryIndexPath, indexPath, {
    oldPathBaseDir: BaseDirectory.AppLocalData,
    newPathBaseDir: BaseDirectory.AppLocalData,
  })
}

const removeIfPresent = async (path: string | undefined) => {
  if (!path || !await exists(path, { baseDir: BaseDirectory.AppLocalData })) return
  await remove(path, { baseDir: BaseDirectory.AppLocalData })
}

const storageWriteError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  if (/ENOSPC|no space|space left|quota|disk full/i.test(message)) return new Error('设备存储空间不足，未能保存音乐')
  return new Error('本地音乐写入失败，请检查设备存储后重试')
}

const writeFileAtomically = async (path: string, bytes: Uint8Array) => {
  const temporaryPath = `${path}.next`
  await removeIfPresent(temporaryPath)
  try {
    await writeFile(temporaryPath, bytes, { baseDir: BaseDirectory.AppLocalData })
    await rename(temporaryPath, path, {
      oldPathBaseDir: BaseDirectory.AppLocalData,
      newPathBaseDir: BaseDirectory.AppLocalData,
    })
  } catch (error) {
    await removeIfPresent(temporaryPath)
    throw storageWriteError(error)
  }
}

const runtimeTrack = async (record: NativeLocalTrackRecord): Promise<Track> => {
  const root = await appLocalDataDir()
  return {
    ...record.track,
    audioUrl: convertFileSrc(await join(root, record.audioPath)),
    cover: record.coverPath ? convertFileSrc(await join(root, record.coverPath)) : record.track.cover,
  }
}

const enqueueMutation = <T,>(operation: () => Promise<T>) => {
  const result = mutationQueue.then(operation, operation)
  mutationQueue = result.then(() => undefined, () => undefined)
  return result
}

export const readNativeLocalTracks = async (): Promise<Track[]> => {
  const records = await readIndex()
  return Promise.all(records.sort((left, right) => right.addedAt - left.addedAt).map(runtimeTrack))
}

export const saveNativeLocalTrack = (record: StoredLocalTrack): Promise<Track> => enqueueMutation(async () => {
  const records = await readIndex()
  const previous = records.find((item) => item.storageId === record.storageId)
  const token = stableToken(record.storageId)
  const audioPath = `${libraryDirectory}/${token}.${audioExtension(record.audio)}`
  const coverPath = record.cover ? `${libraryDirectory}/${token}.${coverExtension(record.cover)}` : undefined
  await writeFileAtomically(audioPath, new Uint8Array(await record.audio.arrayBuffer()))
  if (record.cover) await writeFileAtomically(coverPath!, new Uint8Array(await record.cover.arrayBuffer()))
  const nativeRecord: NativeLocalTrackRecord = {
    storageId: record.storageId,
    track: { ...record.track, audioUrl: undefined, cover: record.cover ? brandMarkPath : record.track.cover },
    audioPath,
    coverPath,
    addedAt: record.addedAt,
  }
  await writeIndex([nativeRecord, ...records.filter((item) => item.storageId !== record.storageId)])
  if (previous?.audioPath !== audioPath) await removeIfPresent(previous?.audioPath)
  if (previous?.coverPath !== coverPath) await removeIfPresent(previous?.coverPath)
  return runtimeTrack(nativeRecord)
})

export const removeNativeLocalTrack = (storageId: string): Promise<void> => enqueueMutation(async () => {
  const records = await readIndex()
  const record = records.find((item) => item.storageId === storageId)
  if (!record) return
  await writeIndex(records.filter((item) => item.storageId !== storageId))
  await removeIfPresent(record.audioPath)
  await removeIfPresent(record.coverPath)
})

export const clearNativeLocalTracks = (): Promise<void> => enqueueMutation(async () => {
  const records = await readIndex()
  await writeIndex([])
  await Promise.all(records.flatMap((record) => [removeIfPresent(record.audioPath), removeIfPresent(record.coverPath)]))
  const entries = await readDir(libraryDirectory, { baseDir: BaseDirectory.AppLocalData })
  const managedFile = /^[0-9a-f]{8}\.(?:mp3|flac|m4a|aac|ogg|wav|audio|jpg|png|webp|gif)(?:\.next)?$/i
  await Promise.all(entries.flatMap((entry) => entry.name && managedFile.test(entry.name)
    ? [removeIfPresent(`${libraryDirectory}/${entry.name}`)]
    : []))
})
