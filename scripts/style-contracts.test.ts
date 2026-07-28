import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

const extractRule = (css: string, selector: string) => {
  const selectorIndex = css.indexOf(selector)
  expect(selectorIndex, `missing CSS selector: ${selector}`).toBeGreaterThanOrEqual(0)
  const openingBrace = css.indexOf('{', selectorIndex)
  const closingBrace = css.indexOf('}', openingBrace)
  return css.slice(openingBrace + 1, closingBrace)
}

describe('platform style contracts', () => {
  it('keeps product UI as the final cascade layer on both product surfaces', () => {
    const desktopEntry = readSource('src/platforms/desktop/DesktopApplication.tsx')
    const mobileEntry = readSource('src/platforms/mobile/MobileApplication.tsx')

    expect(desktopEntry.indexOf("import '../../product-ui.css'")).toBeGreaterThan(desktopEntry.indexOf("import './desktop.css'"))
    expect(mobileEntry.indexOf("import '../../product-ui.css'")).toBeGreaterThan(mobileEntry.indexOf("import './mobile.css'"))
  })

  it('preserves the centered desktop settings layout after the final cascade layer', () => {
    const productUi = readSource('src/product-ui.css')
    const sectionRule = extractRule(
      productUi,
      '.client-shell[data-platform-entry="desktop"][data-form-factor="desktop"] .settings-page-section,'
    )
    const selectSectionRule = extractRule(
      productUi,
      '.client-shell[data-platform-entry="desktop"][data-form-factor="desktop"] .settings-page-section:has(.glass-select)',
    )

    expect(sectionRule).toContain('width: min(760px, 100%)')
    expect(sectionRule).toContain('margin: 0 auto 14px')
    expect(sectionRule).toContain('padding: 0 18px 5px')
    expect(sectionRule).toContain('border: 1px solid var(--product-divider)')
    expect(selectSectionRule).toContain('overflow: visible')
  })

  it('keeps the desktop settings contract scoped away from mobile', () => {
    const productUi = readSource('src/product-ui.css')
    const desktopContract = extractRule(
      productUi,
      '.client-shell[data-platform-entry="desktop"][data-form-factor="desktop"] .settings-page-section,'
    )

    expect(desktopContract).not.toContain('data-platform-entry="mobile"')
    expect(productUi).toContain('html[data-ui-platform="mobile"] .client-shell[data-platform-entry="mobile"][data-form-factor="mobile"] .settings-page-section')
  })
})
