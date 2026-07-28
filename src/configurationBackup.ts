export type ConfigurationScope = 'basic' | 'full'

export type ConfigurationBackup = {
  product: 'echora'
  version: 1
  scope: ConfigurationScope
  createdAt: string
  values: Record<string, string | null>
}

export const basicConfigurationKeys = [
  'echora.appSettings',
  'echora.audioEffects',
  'echora.appearance',
  'echora.palettes',
  'echora.followTrackPalette',
  'echora.lyricFontLevel',
  'echora.userProfile',
] as const

export const fullConfigurationKeys = [
  ...basicConfigurationKeys,
  'echora.playlists',
  'echora.likedTracks',
  'echora.agentSessions.v1',
  'echora.agentMemories',
  'echora.playbackSession',
] as const

type BackupStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const keysForScope = (scope: ConfigurationScope) => scope === 'full' ? fullConfigurationKeys : basicConfigurationKeys

export const createConfigurationBackup = (scope: ConfigurationScope, storage: Pick<Storage, 'getItem'> = localStorage, createdAt = new Date()): ConfigurationBackup => ({
  product: 'echora',
  version: 1,
  scope,
  createdAt: createdAt.toISOString(),
  values: Object.fromEntries(keysForScope(scope).map((key) => [key, storage.getItem(key)])),
})

export const parseConfigurationBackup = (text: string): ConfigurationBackup => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('配置文件不是有效的 JSON')
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('配置文件结构不正确')
  const backup = parsed as Partial<ConfigurationBackup>
  if (backup.product !== 'echora' || backup.version !== 1 || backup.scope !== 'basic' && backup.scope !== 'full' || !backup.values || typeof backup.values !== 'object') {
    throw new Error('这不是受支持的 Echora 配置文件')
  }
  const expectedKeys = new Set<string>(keysForScope(backup.scope))
  const values = Object.fromEntries(Object.entries(backup.values).filter(([key, value]) => expectedKeys.has(key) && (typeof value === 'string' || value === null)))
  if (!Object.keys(values).length) throw new Error('配置文件中没有可导入的数据')
  return { product: 'echora', version: 1, scope: backup.scope, createdAt: typeof backup.createdAt === 'string' ? backup.createdAt : new Date(0).toISOString(), values }
}

export const applyConfigurationBackup = (backup: ConfigurationBackup, storage: BackupStorage = localStorage) => {
  keysForScope(backup.scope).forEach((key) => {
    if (!(key in backup.values)) return
    const value = backup.values[key]
    if (typeof value === 'string') storage.setItem(key, value)
    else storage.removeItem(key)
  })
}

export const configurationFileName = (scope: ConfigurationScope, date = new Date()) => `echora-${scope === 'full' ? 'full' : 'settings'}-${date.toISOString().slice(0, 10)}.json`
