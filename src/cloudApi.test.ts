import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudApiError, cloudAuth, cloudAuthChallenge, cloudCapabilities, cloudCredentials, cloudRequest, cloudSessionStorageKey, productionCloudUrl } from './cloudApi'

describe('cloud API session boundaries', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('sends custom credentials in the canonical credential envelope', async () => {
    localStorage.setItem(cloudSessionStorageKey, JSON.stringify({ token: 'token-1', user: { id: 'user-1', username: 'listener' } }))
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ updatedAt: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await cloudCredentials.putCustomAi({ provider: 'openai', baseUrl: 'https://api.example/v1', model: 'music', apiKey: 'secret' })

    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(request.body))).toEqual({ credential: { provider: 'openai', baseUrl: 'https://api.example/v1', model: 'music', apiKey: 'secret' } })
  })

  it('clears account snapshots when the server expires a session', async () => {
    localStorage.setItem(cloudSessionStorageKey, JSON.stringify({ token: 'token-1', user: { id: 'user-1', username: 'listener' } }))
    localStorage.setItem('echora.playlists', '[1]')
    localStorage.setItem('echora.cloudOutbox.v1:user-1', '[{}]')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'session_expired', message: '登录状态已失效' }), { status: 401, headers: { 'Content-Type': 'application/json' } })))

    await expect(cloudRequest('/v1/me', {}, { authenticated: true })).rejects.toThrow('登录状态已失效')
    expect(localStorage.getItem(cloudSessionStorageKey)).toBeNull()
    expect(localStorage.getItem('echora.playlists')).toBeNull()
    expect(localStorage.getItem('echora.cloudOutbox.v1:user-1')).toBeNull()
  })

  it('reads managed AI availability independently from account state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ echoraAi: { available: false } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(cloudCapabilities.ai()).resolves.toEqual({ available: false })
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1/ai/status')
  })

  it('changes a signed-in password without using a recovery code', async () => {
    localStorage.setItem(cloudSessionStorageKey, JSON.stringify({ token: 'token-1', user: { id: 'user-1', username: 'listener' } }))
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ recoveryCode: 'next-code' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(cloudAuth.changePassword('current-password', 'next-password')).resolves.toEqual({ recoveryCode: 'next-code' })
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1/me/password')
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ currentPassword: 'current-password', newPassword: 'next-password' })
  })

  it('uses the Echora Cloud custom domain by default', async () => {
    expect(productionCloudUrl).toBe('https://echora-cloud.lili.uno')
  })

  it('recognizes an authentication challenge and returns its token to Cloud', async () => {
    const challenge = { provider: 'turnstile' as const, siteKey: 'site-key', action: 'login' as const }
    expect(cloudAuthChallenge(new CloudApiError(403, 'challenge_required', '需要完成人机验证', { challenge }))).toEqual(challenge)
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: 'session-token', user: { id: 'user-1', username: 'listener', displayName: '聆听者', avatarUrl: null, createdAt: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await cloudAuth.login('listener', 'initial-password', 'turnstile-token')

    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ username: 'listener', password: 'initial-password', turnstileToken: 'turnstile-token' })
  })
})
