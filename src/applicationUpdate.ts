import type { RuntimeCapabilities } from './runtimeCapabilities'
import { detectRuntimeCapabilities } from './runtimeCapabilities'

export type UpdateAction = {
  type: 'web-refresh' | 'tauri-update' | 'github-release' | 'apk-download' | 'ipa-download'
  url: string
  label?: string
  signature?: string
  sha256?: string
}

export type UpdateCheckResult = {
  currentVersion: string
  latestVersion: string
  minimumVersion: string
  currentBuildId: string | null
  latestBuildId: string | null
  updateAvailable: boolean
  mandatory: boolean
  eligible: boolean
  channel: string
  publishedAt: string
  releaseNotes: string
  action: UpdateAction | null
}

export type ApplicationUpdateState = {
  phase: 'idle' | 'checking' | 'current' | 'available' | 'unavailable' | 'error'
  message: string
  checkedAt: number | null
  result: UpdateCheckResult | null
}

type NativeUpdateContext = {
  os: string
  arch: string
  version: string
}

export const applicationVersion = __ECHORA_VERSION__
export const applicationBuildId = __ECHORA_BUILD_ID__
export const applicationUpdateChannel = 'stable'

export const initialApplicationUpdateState: ApplicationUpdateState = {
  phase: 'idle',
  message: '尚未检查',
  checkedAt: null,
  result: null,
}

const defaultUpdateEndpoint = 'https://echora-cloud.lili.uno'
const updateEndpoint = () => (import.meta.env.VITE_ECHORA_UPDATE_ENDPOINT?.trim() || defaultUpdateEndpoint).replace(/\/$/, '')

const installationId = () => {
  const key = 'echora.installationId'
  const existing = localStorage.getItem(key)
  if (existing) return existing
  const created = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  localStorage.setItem(key, created)
  return created
}

const browserTarget = (runtime: RuntimeCapabilities) => {
  const userAgent = navigator.userAgent.toLocaleLowerCase()
  const os = runtime.kind === 'mobile'
    ? userAgent.includes('android') ? 'android' : 'ios'
    : runtime.kind === 'desktop'
      ? userAgent.includes('windows') ? 'windows' : userAgent.includes('linux') ? 'linux' : 'darwin'
      : 'browser'
  return {
    platform: runtime.native ? runtime.kind : 'web',
    os,
    arch: runtime.native ? 'unknown' : 'universal',
    version: applicationVersion,
  }
}

const runtimeTarget = async (runtime: RuntimeCapabilities) => {
  const fallback = browserTarget(runtime)
  if (!runtime.native) return fallback
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const context = await invoke<NativeUpdateContext>('get_update_context')
    return { platform: runtime.kind, os: context.os === 'macos' ? 'darwin' : context.os, arch: context.arch, version: context.version }
  } catch {
    return fallback
  }
}

const responseMessage = (result: UpdateCheckResult) => {
  if (!result.updateAvailable) return '已是最新版本'
  return result.mandatory
    ? `请更新至 v${result.latestVersion}`
    : `v${result.latestVersion} 已发布`
}

export const checkForApplicationUpdate = async (runtime = detectRuntimeCapabilities(), signal?: AbortSignal): Promise<ApplicationUpdateState> => {
  if (!runtime.native) return initialApplicationUpdateState
  const endpoint = updateEndpoint()
  if (!endpoint) return {
    phase: 'unavailable',
    message: '当前版本暂不提供在线更新',
    checkedAt: Date.now(),
    result: null,
  }
  try {
    const target = await runtimeTarget(runtime)
    const product = target.platform === 'desktop'
      ? 'echora-desktop'
      : target.os === 'android' ? 'echora-android' : 'echora-ios'
    const params = new URLSearchParams({
      product,
      platform: target.platform,
      os: target.os,
      arch: target.arch,
      current: target.version,
      channel: applicationUpdateChannel,
      installationId: installationId(),
      buildId: applicationBuildId,
    })
    const response = await fetch(`${endpoint}/v1/check?${params}`, { signal, headers: { Accept: 'application/json' } })
    const payload = await response.json().catch(() => ({})) as Partial<UpdateCheckResult> & { error?: string }
    if (!response.ok) {
      const unpublished = response.status === 503 && payload.error === 'release channel has not been published'
      throw new Error(unpublished ? '尚未发布可用版本' : response.status === 503 ? '更新服务暂时不可用' : '暂时无法检查更新')
    }
    const result = payload as UpdateCheckResult
    if (!result.currentVersion || !result.latestVersion || typeof result.updateAvailable !== 'boolean') throw new Error('暂时无法检查更新')
    return {
      phase: result.updateAvailable ? 'available' : 'current',
      message: responseMessage(result),
      checkedAt: Date.now(),
      result,
    }
  } catch (error) {
    if (signal?.aborted) throw error
    const message = error instanceof Error && ['尚未发布可用版本', '更新服务暂时不可用', '暂时无法检查更新'].includes(error.message) ? error.message : '暂时无法检查更新'
    return {
      phase: message === '尚未发布可用版本' ? 'unavailable' : 'error',
      message,
      checkedAt: Date.now(),
      result: null,
    }
  }
}

const safeUpdateUrl = (value: string) => {
  const url = new URL(value, window.location.href)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('更新地址不受支持')
  return url
}

export const applyApplicationUpdate = async (state: ApplicationUpdateState, runtime = detectRuntimeCapabilities()) => {
  const action = state.result?.action
  if (!action) throw new Error('当前没有可执行的更新')
  const url = safeUpdateUrl(action.url)
  if (action.type === 'web-refresh') {
    if (url.origin === window.location.origin) window.location.reload()
    else window.location.assign(url.toString())
    return
  }
  if (runtime.native) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url.toString())
    return
  }
  window.open(url.toString(), '_blank', 'noopener,noreferrer')
}
