import type { Workspace } from './types'

export type MobileLibraryNavigationLevel = 'root' | 'detail' | 'search'
export type MobileShellNavigationLevel = MobileLibraryNavigationLevel | 'fullscreen'

type MobileShellNavigation = {
  level: MobileShellNavigationLevel
  showTabBar: boolean
}

export const resolveMobileShellNavigation = (
  workspace: Workspace,
  libraryLevel: MobileLibraryNavigationLevel,
): MobileShellNavigation => {
  if (workspace === 'nowPlaying') return { level: 'fullscreen', showTabBar: false }
  if (workspace === 'account') return { level: 'detail', showTabBar: false }
  if (workspace === 'library' && libraryLevel !== 'root') return { level: libraryLevel, showTabBar: false }
  return { level: 'root', showTabBar: true }
}
