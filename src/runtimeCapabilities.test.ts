import { describe, expect, it } from 'vitest'
import { detectRuntimeCapabilities } from './runtimeCapabilities'

describe('runtime capabilities', () => {
  it('keeps browser downloads outside the Echora local library', () => {
    const runtime = detectRuntimeCapabilities()
    expect(runtime).toMatchObject({ kind: 'web', hasLocalLibrary: false, downloadBehavior: 'browser', canImportFolder: false, canExportLocalFiles: false })
  })
})
