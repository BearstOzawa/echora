import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applicationVersion, checkForApplicationUpdate } from './applicationUpdate'
import type { RuntimeCapabilities } from './runtimeCapabilities'

const webRuntime: RuntimeCapabilities = {
  kind: 'web',
  native: false,
  canControlWindow: false,
  canImportFolder: false,
  hasLocalLibrary: false,
  downloadBehavior: 'browser',
  canExportLocalFiles: false,
  localLibraryLabel: 'test',
  downloadSuccessLabel: 'test',
  credentialStorageLabel: 'test',
}

const desktopRuntime: RuntimeCapabilities = {
  ...webRuntime,
  kind: 'desktop',
  native: true,
  canControlWindow: true,
  canImportFolder: true,
  hasLocalLibrary: true,
  downloadBehavior: 'offline-library',
  canExportLocalFiles: true,
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('application update service', () => {
  it('does not run application update checks in the Web client', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const state = await checkForApplicationUpdate(webRuntime)
    expect(state).toEqual({ phase: 'idle', message: '尚未检查', checkedAt: null, result: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses the Echora update service for installed applications', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      currentVersion: applicationVersion,
      latestVersion: applicationVersion,
      updateAvailable: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const state = await checkForApplicationUpdate(desktopRuntime)
    expect(state.phase).toBe('current')
    expect(state.message).toBe('已是最新版本')
    expect(String(fetchMock.mock.calls[0][0])).toContain('https://echora-cloud.lili.uno/v1/check')
  })

  it('sends the current runtime context and normalizes available updates', async () => {
    vi.stubEnv('VITE_ECHORA_UPDATE_ENDPOINT', 'https://updates.example')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      currentVersion: applicationVersion,
      latestVersion: '0.2.0',
      minimumVersion: '0.1.0',
      currentBuildId: 'old',
      latestBuildId: 'new',
      updateAvailable: true,
      mandatory: false,
      eligible: true,
      channel: 'stable',
      publishedAt: '2026-07-20T10:00:00Z',
      releaseNotes: '更新说明',
      action: { type: 'tauri-update', url: 'https://echora.example/update' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const state = await checkForApplicationUpdate(desktopRuntime)
    expect(state.phase).toBe('available')
    const requested = new URL(String(fetchMock.mock.calls[0][0]))
    expect(requested.searchParams.get('product')).toBe('echora-desktop')
    expect(requested.searchParams.get('platform')).toBe('desktop')
    expect(requested.searchParams.get('current')).toBe(applicationVersion)
    expect(requested.searchParams.get('installationId')).toBeTruthy()
  })

  it('distinguishes an unpublished channel from a connection failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: 'release channel has not been published',
    }), { status: 503, headers: { 'Content-Type': 'application/json' } }))

    const state = await checkForApplicationUpdate(desktopRuntime)
    expect(state).toMatchObject({ phase: 'unavailable', message: '尚未发布可用版本' })
  })
})
