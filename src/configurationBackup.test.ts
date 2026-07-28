import { describe, expect, it } from 'vitest'
import { applyConfigurationBackup, createConfigurationBackup, parseConfigurationBackup } from './configurationBackup'

const memoryStorage = () => {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  }
}

describe('configuration backup', () => {
  it('keeps basic exports focused on dependencies and appearance', () => {
    const storage = memoryStorage()
    storage.setItem('echora.appSettings', '{"ai":{"model":"test"}}')
    storage.setItem('echora.agentSessions.v1', '[{"id":"private-session"}]')
    const backup = createConfigurationBackup('basic', storage, new Date('2026-07-15T00:00:00Z'))
    expect(backup.values['echora.appSettings']).toContain('test')
    expect(backup.values['echora.agentSessions.v1']).toBeUndefined()
  })

  it('round-trips full local state without including rebuildable catalog cache', () => {
    const source = memoryStorage()
    source.setItem('echora.agentSessions.v1', '[{"id":"session-1"}]')
    source.setItem('echora.agentMemories', '[{"id":"memory-1"}]')
    source.setItem('echora.remoteCatalog', '[{"id":99}]')
    const parsed = parseConfigurationBackup(JSON.stringify(createConfigurationBackup('full', source)))
    const target = memoryStorage()
    applyConfigurationBackup(parsed, target)
    expect(target.getItem('echora.agentSessions.v1')).toContain('session-1')
    expect(target.getItem('echora.agentMemories')).toContain('memory-1')
    expect(target.getItem('echora.remoteCatalog')).toBeNull()
  })

  it('rejects unrelated JSON files', () => {
    expect(() => parseConfigurationBackup('{"hello":"world"}')).toThrow('受支持的 Echora 配置文件')
  })

  it('does not erase existing settings omitted by a partial compatible backup', () => {
    const target = memoryStorage()
    target.setItem('echora.audioEffects', '{"effect":"夜间柔化"}')
    applyConfigurationBackup({ product: 'echora', version: 1, scope: 'basic', createdAt: new Date(0).toISOString(), values: { 'echora.appSettings': '{"resumePlayback":false}' } }, target)
    expect(target.getItem('echora.audioEffects')).toContain('夜间柔化')
  })
})
