import { lazy } from 'react'
import { resolveUiPlatform } from './uiPlatform'

const DesktopApplication = lazy(() => import('./desktop/DesktopApplication'))
const MobileApplication = lazy(() => import('./mobile/MobileApplication'))

export default function Application() {
  const PlatformApplication = resolveUiPlatform() === 'mobile' ? MobileApplication : DesktopApplication
  return <PlatformApplication />
}
