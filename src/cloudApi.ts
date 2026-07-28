export const productionCloudUrl = 'https://echora-cloud.lili.uno'
const defaultCloudUrl = productionCloudUrl

export const echoraCloudUrl = (import.meta.env.VITE_ECHORA_CLOUD_URL || defaultCloudUrl).replace(/\/$/, '')

export const cloudSessionStorageKey = 'echora.cloudSession.v1'
const installationStorageKey = 'echora.installationId'
const accountSnapshotKeys = [
  'echora.appSettings',
  'echora.audioEffects',
  'echora.appearance',
  'echora.palettes',
  'echora.followTrackPalette',
  'echora.lyricFontLevel',
  'echora.playlists',
  'echora.likedTracks',
  'echora.agentSessions.v1',
  'echora.agentMemories',
  'echora.playbackSession',
  'echora.userProfile',
] as const

const clearAccountSnapshot = (userId: string) => {
  accountSnapshotKeys.forEach((key) => localStorage.removeItem(key))
  localStorage.removeItem(`echora.cloudCursor.v1:${userId}`)
  localStorage.removeItem(`echora.cloudOutbox.v1:${userId}`)
  localStorage.removeItem(`echora.cloudInitialized.v1:${userId}`)
  ;['preferences:app', 'appearance:app', 'playlists:main', 'favorites:main', 'conversations:main', 'memories:main', 'recent:playback']
    .forEach((entry) => {
      const [collection, entityId] = entry.split(':')
      localStorage.removeItem(`echora.cloudShadow.v1:${userId}:${collection}:${entityId}`)
    })
}

export type CloudUser = {
  id: string
  username: string
  displayName: string
  role: 'user' | 'admin'
  avatarUrl: string | null
  createdAt: number
}

export type CloudSession = {
  token: string
  user: CloudUser
}

export type CloudAuthChallenge = {
  provider: 'turnstile'
  siteKey: string
  action: 'register' | 'login' | 'recover' | 'restore'
}

export type CloudSyncOperation = {
  operationId: string
  collection: 'preferences' | 'appearance' | 'playlists' | 'favorites' | 'conversations' | 'memories' | 'recent'
  entityId: string
  payload?: unknown
  deleted?: boolean
}

export type CloudSyncChange = {
  changeId: number
  collection: CloudSyncOperation['collection']
  entityId: string
  revision: number
  payload: unknown
  deleted: boolean
  deviceId: string
  updatedAt: number
}

export const readCloudSession = (storage: Pick<Storage, 'getItem'> = localStorage): CloudSession | null => {
  try {
    const value = JSON.parse(storage.getItem(cloudSessionStorageKey) || 'null') as Partial<CloudSession> | null
    if (!value?.token || !value.user?.id || !value.user.username) return null
    return value as CloudSession
  } catch {
    return null
  }
}

export const writeCloudSession = (session: CloudSession | null, storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage) => {
  if (session) storage.setItem(cloudSessionStorageKey, JSON.stringify(session))
  else storage.removeItem(cloudSessionStorageKey)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('echora:cloud-session', { detail: session }))
}

export const installationId = (storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage) => {
  const existing = storage.getItem(installationStorageKey)
  if (existing) return existing
  const created = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `install-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  storage.setItem(installationStorageKey, created)
  return created
}

const platformName = () => {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) return /Android|iPhone|iPad/i.test(navigator.userAgent) ? 'Echora Mobile' : 'Echora Desktop'
  return 'Echora Web'
}

export class CloudApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly data?: unknown) {
    super(message)
  }
}

export const cloudAuthChallenge = (error: unknown): CloudAuthChallenge | null => {
  if (!(error instanceof CloudApiError) || error.code !== 'challenge_required' || !error.data || typeof error.data !== 'object') return null
  const challenge = (error.data as { challenge?: Partial<CloudAuthChallenge> }).challenge
  if (challenge?.provider !== 'turnstile' || !challenge.siteKey || !['register', 'login', 'recover', 'restore'].includes(String(challenge.action))) return null
  return challenge as CloudAuthChallenge
}

export const cloudRequest = async <T>(path: string, init: RequestInit = {}, options: { authenticated?: boolean } = {}): Promise<T> => {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  headers.set('X-Echora-Device', installationId())
  headers.set('X-Echora-Device-Name', platformName())
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const session = readCloudSession()
  if (session?.token) headers.set('Authorization', `Bearer ${session.token}`)
  else if (options.authenticated) throw new CloudApiError(401, 'authentication_required', '请先登录 Echora')
  let response: Response
  try {
    response = await fetch(`${echoraCloudUrl}${path}`, { ...init, headers })
  } catch {
    throw new CloudApiError(0, 'network_unavailable', '无法连接 Echora Cloud')
  }
  if (response.status === 204) return undefined as T
  const data = await response.json().catch(() => ({})) as any
  if (!response.ok) {
    if (response.status === 401 && session) {
      clearAccountSnapshot(session.user.id)
      writeCloudSession(null)
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('echora:cloud-data-applied'))
    }
    throw new CloudApiError(response.status, String(data.error || 'request_failed'), String(data.message || data.error || '请求未完成'), data)
  }
  return data as T
}

export const cloudAuth = {
  register: async (input: { username: string; password: string; displayName?: string }, turnstileToken?: string) => {
    const data = await cloudRequest<{ token: string; recoveryCode: string; user: CloudUser }>('/v1/auth/register', { method: 'POST', body: JSON.stringify({ ...input, turnstileToken }) })
    writeCloudSession({ token: data.token, user: data.user })
    return data
  },
  login: async (username: string, password: string, turnstileToken?: string) => {
    const data = await cloudRequest<{ token: string; user: CloudUser }>('/v1/auth/login', { method: 'POST', body: JSON.stringify({ username, password, turnstileToken }) })
    writeCloudSession(data)
    return data
  },
  logout: async () => {
    const session = readCloudSession()
    try { await cloudRequest('/v1/auth/logout', { method: 'POST' }, { authenticated: true }) } finally {
      if (session) clearAccountSnapshot(session.user.id)
      writeCloudSession(null)
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('echora:cloud-data-applied'))
    }
  },
  me: async () => {
    const data = await cloudRequest<{ user: CloudUser }>('/v1/me', {}, { authenticated: true })
    const session = readCloudSession()
    if (session) writeCloudSession({ ...session, user: data.user })
    return data.user
  },
  updateProfile: async (displayName: string) => {
    const data = await cloudRequest<{ user: CloudUser }>('/v1/me', { method: 'PUT', body: JSON.stringify({ displayName }) }, { authenticated: true })
    const session = readCloudSession()
    if (session) writeCloudSession({ ...session, user: data.user })
    return data.user
  },
  changePassword: (currentPassword: string, newPassword: string) => cloudRequest<{ recoveryCode: string }>('/v1/me/password', {
    method: 'PUT',
    body: JSON.stringify({ currentPassword, newPassword }),
  }, { authenticated: true }),
  recover: (username: string, recoveryCode: string, newPassword: string, turnstileToken?: string) => cloudRequest<{ recoveryCode: string }>('/v1/auth/recover', {
    method: 'POST',
    body: JSON.stringify({ username, recoveryCode, newPassword, turnstileToken }),
  }),
  devices: async () => (await cloudRequest<{ devices: Array<{ id: string; deviceId: string; name: string; createdAt: number; lastSeenAt: number; expiresAt: number; current: boolean }> }>('/v1/me/devices', {}, { authenticated: true })).devices,
  revokeDevice: (sessionId: string) => cloudRequest<void>(`/v1/me/devices/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }, { authenticated: true }),
}

export const cloudCapabilities = {
  ai: async () => (await cloudRequest<{ echoraAi: { available: boolean } }>('/v1/ai/status')).echoraAi,
}

export const cloudSync = {
  pull: (cursor = 0) => cloudRequest<{ changes: CloudSyncChange[]; cursor: number; hasMore: boolean }>(`/v1/sync?cursor=${Math.max(0, cursor)}&limit=250`, {}, { authenticated: true }),
  push: (operations: CloudSyncOperation[]) => cloudRequest<{ accepted: Array<{ operationId: string; collection: string; entityId: string; revision: number; changeId: number }> }>('/v1/sync', {
    method: 'POST',
    body: JSON.stringify({ operations }),
  }, { authenticated: true }),
}

export const cloudCredentials = {
  getCustomAi: async () => (await cloudRequest<{ credential: { provider: string; baseUrl: string; model: string; apiKey: string } | null }>('/v1/me/credentials/custom-ai', {}, { authenticated: true })).credential,
  putCustomAi: (credential: { provider: string; baseUrl: string; model: string; apiKey: string }) => cloudRequest<{ updatedAt: number }>('/v1/me/credentials/custom-ai', {
    method: 'PUT',
    body: JSON.stringify({ credential }),
  }, { authenticated: true }),
  deleteCustomAi: () => cloudRequest<void>('/v1/me/credentials/custom-ai', { method: 'DELETE' }, { authenticated: true }),
}
