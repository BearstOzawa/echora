export type RuntimeKind = 'web' | 'desktop' | 'mobile'

export type RuntimeCapabilities = {
  kind: RuntimeKind
  native: boolean
  canControlWindow: boolean
  canImportFolder: boolean
  hasLocalLibrary: boolean
  downloadBehavior: 'browser' | 'offline-library'
  canExportLocalFiles: boolean
  localLibraryLabel: string
  downloadSuccessLabel: string
  credentialStorageLabel: string
}

const isMobileDevice = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

export const detectRuntimeCapabilities = (): RuntimeCapabilities => {
  const native = '__TAURI_INTERNALS__' in window
  const mobile = isMobileDevice()
  if (native && mobile) return {
    kind: 'mobile',
    native: true,
    canControlWindow: false,
    canImportFolder: false,
    hasLocalLibrary: true,
    downloadBehavior: 'offline-library',
    canExportLocalFiles: true,
    localLibraryLabel: '下载内容保存在应用私有存储中，可离线播放或导出；卸载应用时会一并移除。',
    downloadSuccessLabel: '已保存到应用离线音乐',
    credentialStorageLabel: '凭据仅保存在这台设备的应用设置中。',
  }
  if (native) return {
    kind: 'desktop',
    native: true,
    canControlWindow: true,
    canImportFolder: true,
    hasLocalLibrary: true,
    downloadBehavior: 'offline-library',
    canExportLocalFiles: true,
    localLibraryLabel: '下载内容保存在应用本地音乐中；也可以导入文件或音乐文件夹。',
    downloadSuccessLabel: '已保存到应用本地音乐',
    credentialStorageLabel: '凭据仅保存在这台电脑的应用设置中。',
  }
  return {
    kind: 'web',
    native: false,
    canControlWindow: false,
    canImportFolder: false,
    hasLocalLibrary: false,
    downloadBehavior: 'browser',
    canExportLocalFiles: false,
    localLibraryLabel: '网页下载由浏览器管理，不会占用 Echora 的本地音乐空间。',
    downloadSuccessLabel: '已交给浏览器下载',
    credentialStorageLabel: '凭据仅保存在当前浏览器的应用设置中。',
  }
}
