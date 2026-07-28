import { invoke } from '@tauri-apps/api/core'
import { readFile, stat } from '@tauri-apps/plugin-fs'
import { open } from '@tauri-apps/plugin-dialog'
import { importLocalAudioFiles } from './localLibrary'
import type { LocalImportResult } from './localLibrary'

export type LocalMusicFolder = {
  id: string
  name: string
  path: string
  addedAt: number
  lastScannedAt?: number
  trackCount: number
  available: boolean
}

export type LocalFolderScanResult = LocalImportResult & {
  discoveredCount: number
}

const scanBatchSize = 12

const audioMimeType = (name: string) => {
  const extension = name.split('.').pop()?.toLocaleLowerCase()
  if (extension === 'flac') return 'audio/flac'
  if (extension === 'm4a' || extension === 'aac') return 'audio/mp4'
  if (extension === 'ogg' || extension === 'opus') return 'audio/ogg'
  if (extension === 'wav') return 'audio/wav'
  if (extension === 'aif' || extension === 'aiff') return 'audio/aiff'
  return 'audio/mpeg'
}

const readAudioFile = async (path: string) => {
  const [bytes, metadata] = await Promise.all([readFile(path), stat(path)])
  const name = path.split(/[\\/]/).pop() || 'audio.mp3'
  return new File([bytes], name, {
    type: audioMimeType(name),
    lastModified: metadata.mtime?.getTime() ?? 0,
  })
}

export const listLocalMusicFolders = () => invoke<LocalMusicFolder[]>('list_music_folders')

export const chooseLocalMusicFolders = async (): Promise<LocalMusicFolder[]> => {
  const selection = await open({ directory: true, multiple: true, title: '添加音乐文件夹' })
  if (!selection) return []
  const paths = Array.isArray(selection) ? selection : [selection]
  return invoke<LocalMusicFolder[]>('register_music_folders', { paths })
}

export const removeLocalMusicFolder = (id: string) => invoke<LocalMusicFolder[]>('remove_music_folder', { id })

export const scanLocalMusicFolder = async (folder: LocalMusicFolder): Promise<LocalFolderScanResult> => {
  const paths = await invoke<string[]>('scan_music_folder', { id: folder.id })
  const result: LocalFolderScanResult = { tracks: [], importedCount: 0, skippedCount: 0, discoveredCount: paths.length }
  for (let index = 0; index < paths.length; index += scanBatchSize) {
    const settled = await Promise.allSettled(paths.slice(index, index + scanBatchSize).map(readAudioFile))
    const files = settled.flatMap((item) => item.status === 'fulfilled' ? [item.value] : [])
    result.skippedCount += settled.length - files.length
    if (!files.length) continue
    const batch = await importLocalAudioFiles(files)
    result.tracks.push(...batch.tracks)
    result.importedCount += batch.importedCount
    result.skippedCount += batch.skippedCount
  }
  return result
}
