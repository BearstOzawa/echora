import { afterEach, describe, expect, it, vi } from 'vitest'
import { isMobileWebDevice, resolveUiPlatform } from './uiPlatform'

afterEach(() => vi.unstubAllGlobals())

describe('resolveUiPlatform', () => {
  it('keeps the desktop Web application when a desktop browser is narrow', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 })
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    expect(resolveUiPlatform()).toBe('desktop')
  })

  it('selects the mobile Web application for a phone before mounting', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148', maxTouchPoints: 5 })
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
    expect(resolveUiPlatform()).toBe('mobile')
  })

  it('recognizes iPadOS desktop-mode user agents as mobile devices', () => {
    expect(isMobileWebDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 })).toBe(true)
  })

  it('does not treat a touch-enabled desktop as a mobile device', () => {
    expect(isMobileWebDevice({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints: 10 })).toBe(false)
  })
})
