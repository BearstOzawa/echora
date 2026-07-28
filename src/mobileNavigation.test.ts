import { describe, expect, it } from 'vitest'
import { resolveMobileShellNavigation } from './mobileNavigation'

describe('resolveMobileShellNavigation', () => {
  it.each([
    ['library', 'root', 'root', true],
    ['library', 'detail', 'detail', false],
    ['library', 'search', 'search', false],
    ['field', 'detail', 'root', true],
    ['account', 'root', 'detail', false],
    ['nowPlaying', 'root', 'fullscreen', false],
  ] as const)('maps %s / %s to %s with tab bar %s', (workspace, libraryLevel, level, showTabBar) => {
    expect(resolveMobileShellNavigation(workspace, libraryLevel)).toEqual({ level, showTabBar })
  })
})
