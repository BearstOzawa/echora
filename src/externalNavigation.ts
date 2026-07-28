import type { RuntimeCapabilities } from './runtimeCapabilities'
import { detectRuntimeCapabilities } from './runtimeCapabilities'

const safeExternalUrl = (value: string) => {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('链接地址不受支持')
  return url.toString()
}

export const openExternalUrl = async (value: string, runtime: RuntimeCapabilities = detectRuntimeCapabilities()) => {
  const url = safeExternalUrl(value)
  if (runtime.native) {
    if (new URL(url).hostname === 'api-v2.yuafeng.cn') {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('open_enhanced_quality_registration')
    } else {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(url)
    }
    return
  }
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (!opened) window.location.assign(url)
}
