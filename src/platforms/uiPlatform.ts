import { detectRuntimeCapabilities } from '../runtimeCapabilities'

export type UiPlatform = 'desktop' | 'mobile'

type DeviceNavigator = Pick<Navigator, 'userAgent' | 'maxTouchPoints'> & {
  userAgentData?: { mobile?: boolean }
}

const configuredPlatform = () => {
  const value = import.meta.env.VITE_ECHORA_UI_PLATFORM
  return value === 'desktop' || value === 'mobile' ? value : null
}

export const isMobileWebDevice = (device: DeviceNavigator = navigator): boolean => {
  if (device.userAgentData?.mobile === true) return true
  const userAgent = device.userAgent || ''
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return true
  // iPadOS may identify itself as macOS when requesting desktop websites.
  return /Macintosh/i.test(userAgent) && device.maxTouchPoints > 1
}

export const resolveUiPlatform = (): UiPlatform => {
  const configured = configuredPlatform()
  if (configured) return configured
  const runtime = detectRuntimeCapabilities()
  if (runtime.kind === 'mobile') return 'mobile'
  if (runtime.kind === 'desktop') return 'desktop'
  return isMobileWebDevice() ? 'mobile' : 'desktop'
}
