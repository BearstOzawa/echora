import { join } from '@tauri-apps/api/path'
import { open, save } from '@tauri-apps/plugin-dialog'
import { exists, writeFile } from '@tauri-apps/plugin-fs'

export type NativeExportResult = {
  exportedCount: number
  cancelled: boolean
}

const fileExtension = (name: string) => name.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLocaleLowerCase() ?? 'mp3'

const availablePath = async (directory: string, fileName: string) => {
  const extension = fileName.match(/(\.[a-z0-9]{2,5})$/i)?.[1] ?? ''
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName
  let candidate = await join(directory, fileName)
  let suffix = 2
  while (await exists(candidate)) {
    candidate = await join(directory, `${baseName} ${suffix}${extension}`)
    suffix += 1
  }
  return candidate
}

const writeExportFile = async (path: string, file: File) => {
  await writeFile(path, new Uint8Array(await file.arrayBuffer()))
}

export const exportNativeAudioFiles = async (files: File[]): Promise<NativeExportResult> => {
  if (!files.length) return { exportedCount: 0, cancelled: false }

  if (files.length === 1) {
    const file = files[0]
    const extension = fileExtension(file.name)
    const destination = await save({
      title: '导出歌曲',
      defaultPath: file.name,
      filters: [{ name: '音频文件', extensions: [extension] }],
    })
    if (!destination) return { exportedCount: 0, cancelled: true }
    await writeExportFile(destination, file)
    return { exportedCount: 1, cancelled: false }
  }

  const destination = await open({ directory: true, multiple: false, title: '选择导出位置' })
  if (!destination || Array.isArray(destination)) return { exportedCount: 0, cancelled: true }
  for (const file of files) {
    await writeExportFile(await availablePath(destination, file.name), file)
  }
  return { exportedCount: files.length, cancelled: false }
}
