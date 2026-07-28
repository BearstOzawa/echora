import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pull: vi.fn(),
  push: vi.fn(),
  getCustomAi: vi.fn(),
  putCustomAi: vi.fn(),
  session: {
    token: 'token-1',
    user: { id: 'user-1', username: 'listener', displayName: 'Listener', role: 'user' as const, avatarUrl: null, createdAt: 1 },
  },
}))

vi.mock('./cloudApi', () => ({
  readCloudSession: () => mocks.session,
  cloudSync: { pull: mocks.pull, push: mocks.push },
  cloudCredentials: { getCustomAi: mocks.getCustomAi, putCustomAi: mocks.putCustomAi },
}))

import { flushCloudOutbox, queueCloudSnapshot, syncCustomAiCredential, synchronizeCloudData } from './cloudSync'
import { defaultAppSettings } from './appSettings'

describe('cloud sync', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.pull.mockReset()
    mocks.push.mockReset().mockResolvedValue({ accepted: [] })
    mocks.putCustomAi.mockReset().mockResolvedValue({ updatedAt: 1 })
  })

  it('deduplicates unchanged snapshots after a successful push', async () => {
    localStorage.setItem('echora.appSettings', JSON.stringify({ startupView: 'library' }))
    queueCloudSnapshot('preferences', 'app')
    queueCloudSnapshot('preferences', 'app')

    expect(JSON.parse(localStorage.getItem('echora.cloudOutbox.v1:user-1') || '[]')).toHaveLength(1)
    await flushCloudOutbox(mocks.session)
    queueCloudSnapshot('preferences', 'app')

    expect(mocks.push).toHaveBeenCalledTimes(1)
    expect(JSON.parse(localStorage.getItem('echora.cloudOutbox.v1:user-1') || '[]')).toEqual([])
  })

  it('uses cloud data on the first merge and uploads only missing collections', async () => {
    localStorage.setItem('echora.appSettings', JSON.stringify({ startupView: 'field' }))
    const remoteSettings = JSON.stringify({ startupView: 'library' })
    mocks.pull.mockResolvedValue({
      changes: [{ changeId: 8, collection: 'preferences', entityId: 'app', revision: 1, payload: { values: { 'echora.appSettings': remoteSettings, 'echora.audioEffects': null, 'echora.lyricFontLevel': null } }, deleted: false, deviceId: 'other', updatedAt: 1 }],
      cursor: 8,
      hasMore: false,
    })

    await synchronizeCloudData(mocks.session)

    expect(localStorage.getItem('echora.appSettings')).toBe(remoteSettings)
    const uploaded = mocks.push.mock.calls[0][0] as Array<{ collection: string }>
    expect(uploaded.some((operation) => operation.collection === 'preferences')).toBe(false)
    expect(uploaded.map((operation) => operation.collection)).toEqual(expect.arrayContaining(['appearance', 'playlists', 'favorites', 'conversations', 'memories', 'recent']))
    expect(localStorage.getItem('echora.cloudInitialized.v1:user-1')).toBe('true')
  })

  it('wraps custom AI credentials in the Cloud contract', async () => {
    await syncCustomAiCredential({ ...defaultAppSettings.ai, mode: 'custom', provider: 'compatible', baseUrl: 'https://ai.example/v1', model: 'music-model', apiKey: 'secret' })
    expect(mocks.putCustomAi).toHaveBeenCalledWith({ provider: 'compatible', baseUrl: 'https://ai.example/v1', model: 'music-model', apiKey: 'secret' })
  })
})
