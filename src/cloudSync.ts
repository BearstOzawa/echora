import { cloudCredentials, cloudSync, readCloudSession } from './cloudApi'
import type { CloudSession, CloudSyncChange, CloudSyncOperation } from './cloudApi'
import type { AppSettings } from './appSettings'

const cursorKey = (userId: string) => `echora.cloudCursor.v1:${userId}`
const outboxKey = (userId: string) => `echora.cloudOutbox.v1:${userId}`
const initializedKey = (userId: string) => `echora.cloudInitialized.v1:${userId}`
const shadowKey = (userId: string, collection: string, entityId: string) => `echora.cloudShadow.v1:${userId}:${collection}:${entityId}`

const storageMappings: Array<{ collection: CloudSyncOperation['collection']; entityId: string; keys: string[] }> = [
  { collection: 'preferences', entityId: 'app', keys: ['echora.appSettings', 'echora.audioEffects', 'echora.lyricFontLevel'] },
  { collection: 'appearance', entityId: 'app', keys: ['echora.appearance', 'echora.palettes', 'echora.followTrackPalette'] },
  { collection: 'playlists', entityId: 'main', keys: ['echora.playlists'] },
  { collection: 'favorites', entityId: 'main', keys: ['echora.likedTracks'] },
  { collection: 'conversations', entityId: 'main', keys: ['echora.agentSessions.v1'] },
  { collection: 'memories', entityId: 'main', keys: ['echora.agentMemories'] },
  { collection: 'recent', entityId: 'playback', keys: ['echora.playbackSession'] },
]

const mappingKey = (collection: string, entityId: string) => `${collection}:${entityId}`
const readOutbox = (userId: string): CloudSyncOperation[] => {
  try {
    const value = JSON.parse(localStorage.getItem(outboxKey(userId)) || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

const writeOutbox = (userId: string, operations: CloudSyncOperation[]) => localStorage.setItem(outboxKey(userId), JSON.stringify(operations))

export const hasPendingCloudChanges = (userId: string) => readOutbox(userId).length > 0

const snapshotFor = (mapping: typeof storageMappings[number]) => ({
  values: Object.fromEntries(mapping.keys.map((key) => [key, localStorage.getItem(key)])),
})

const snapshotSignature = (payload: unknown) => JSON.stringify(payload)
const rememberSnapshot = (userId: string, collection: string, entityId: string, payload: unknown) => {
  localStorage.setItem(shadowKey(userId, collection, entityId), snapshotSignature(payload))
}

const applyChange = (change: CloudSyncChange) => {
  const mapping = storageMappings.find((item) => item.collection === change.collection && item.entityId === change.entityId)
  if (!mapping || change.deleted || !change.payload || typeof change.payload !== 'object') return
  const values = (change.payload as { values?: Record<string, unknown> }).values
  if (!values || typeof values !== 'object') return
  mapping.keys.forEach((key) => {
    const value = values[key]
    if (typeof value === 'string') localStorage.setItem(key, value)
    else if (value === null) localStorage.removeItem(key)
  })
}

export const queueCloudSnapshot = (collection: CloudSyncOperation['collection'], entityId: string) => {
  const session = readCloudSession()
  if (!session) return
  const mapping = storageMappings.find((item) => item.collection === collection && item.entityId === entityId)
  if (!mapping) return
  const operations = readOutbox(session.user.id)
  const payload = snapshotFor(mapping)
  const signature = snapshotSignature(payload)
  if (localStorage.getItem(shadowKey(session.user.id, collection, entityId)) === signature) return
  const queued = operations.find((item) => mappingKey(item.collection, item.entityId) === mappingKey(collection, entityId))
  if (queued && snapshotSignature(queued.payload) === signature) return
  const operation: CloudSyncOperation = {
    operationId: `${collection}-${entityId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    collection,
    entityId,
    payload,
  }
  const next = operations.filter((item) => mappingKey(item.collection, item.entityId) !== mappingKey(collection, entityId))
  writeOutbox(session.user.id, [...next, operation])
  window.dispatchEvent(new Event('echora:cloud-outbox'))
}

export const flushCloudOutbox = async (session: CloudSession) => {
  const operations = readOutbox(session.user.id)
  if (!operations.length) return
  for (let index = 0; index < operations.length; index += 100) await cloudSync.push(operations.slice(index, index + 100))
  operations.forEach((operation) => rememberSnapshot(session.user.id, operation.collection, operation.entityId, operation.payload ?? null))
  writeOutbox(session.user.id, [])
}

const pullAll = async (userId: string, initialCursor: number) => {
  let cursor = initialCursor
  const changes: CloudSyncChange[] = []
  do {
    const page = await cloudSync.pull(cursor)
    changes.push(...page.changes)
    cursor = page.cursor
    if (!page.hasMore) break
  } while (true)
  localStorage.setItem(cursorKey(userId), String(cursor))
  return changes
}

export const synchronizeCloudData = async (session: CloudSession) => {
  const initialized = localStorage.getItem(initializedKey(session.user.id)) === 'true'
  const cursor = initialized ? Math.max(0, Number(localStorage.getItem(cursorKey(session.user.id)) || 0)) : 0
  const changes = await pullAll(session.user.id, cursor)
  const latest = new Map<string, CloudSyncChange>()
  changes.forEach((change) => latest.set(mappingKey(change.collection, change.entityId), change))

  if (!initialized) {
    const missing: CloudSyncOperation[] = []
    storageMappings.forEach((mapping) => {
      const remote = latest.get(mappingKey(mapping.collection, mapping.entityId))
      if (remote) {
        applyChange(remote)
        rememberSnapshot(session.user.id, remote.collection, remote.entityId, remote.payload)
      }
      else missing.push({
        operationId: `initial-${mapping.collection}-${mapping.entityId}-${Date.now().toString(36)}`,
        collection: mapping.collection,
        entityId: mapping.entityId,
        payload: snapshotFor(mapping),
      })
    })
    if (missing.length) {
      await cloudSync.push(missing)
      missing.forEach((operation) => rememberSnapshot(session.user.id, operation.collection, operation.entityId, operation.payload ?? null))
    }
    localStorage.setItem(initializedKey(session.user.id), 'true')
  } else {
    changes.forEach((change) => {
      applyChange(change)
      rememberSnapshot(session.user.id, change.collection, change.entityId, change.payload)
    })
  }

  await flushCloudOutbox(session)
  window.dispatchEvent(new Event('echora:cloud-data-applied'))
}

export const syncCustomAiCredential = async (settings: AppSettings['ai']) => {
  if (settings.mode === 'echora') return
  if (!settings.baseUrl.trim() || !settings.model.trim()) return
  await cloudCredentials.putCustomAi({ provider: settings.provider, baseUrl: settings.baseUrl, model: settings.model, apiKey: settings.apiKey })
}

export const loadCustomAiCredential = () => cloudCredentials.getCustomAi()
