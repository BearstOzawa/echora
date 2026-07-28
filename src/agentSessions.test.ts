import { describe, expect, it } from 'vitest'
import { agentConstraintLimit, agentSessionsKey, agentTargetTrackCountMax, agentTargetTrackCountMin, createAgentSession, defaultAgentPreferences, initialAgentSessions, mergeAgentConstraints, readAgentSessions, writeAgentSessions } from './agentSessions'

const memoryStorage = () => {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  }
}

describe('agent sessions storage', () => {
  it('round-trips persistent conversations', () => {
    const storage = memoryStorage()
    writeAgentSessions(initialAgentSessions, storage)
    expect(readAgentSessions(storage)).toEqual(initialAgentSessions)
  })

  it('falls back when stored sessions are malformed', () => {
    const storage = memoryStorage()
    storage.setItem(agentSessionsKey, JSON.stringify([{ id: 'broken' }]))
    expect(readAgentSessions(storage)).toEqual(initialAgentSessions)
  })

  it('creates a resumable session around the current queue', () => {
    const session = createAgentSession([2, 4, 6], [{ id: 2, x: 18, y: 62 }])
    expect(session.queueTrackIds).toEqual([2, 4, 6])
    expect(session.trackLayout).toEqual([{ id: 2, x: 18, y: 62 }])
    expect(session.arrangementZoom).toBe(100)
    expect(session.messages[0].role).toBe('assistant')
    expect(session.status).toBe('active')
    expect(session.preferences).toEqual(defaultAgentPreferences)
  })

  it('migrates stored sessions created before proposal preferences existed', () => {
    const storage = memoryStorage()
    const legacy = JSON.parse(JSON.stringify(initialAgentSessions[0]))
    delete legacy.preferences
    legacy.messages.push({
      id: 'legacy-change',
      role: 'assistant',
      content: '旧编排',
      createdAt: 2,
      change: { summary: '旧编排', addedTrackIds: [], removedTrackIds: [], keptTrackIds: [], undoable: false },
    })
    storage.setItem(agentSessionsKey, JSON.stringify([legacy]))
    const [restored] = readAgentSessions(storage)
    expect(restored.preferences).toEqual(defaultAgentPreferences)
    expect(restored.messages.at(-1)?.change?.status).toBe('applied')
  })

  it('migrates overlapping legacy playback preferences to one explicit mode', () => {
    const storage = memoryStorage()
    const legacy = JSON.parse(JSON.stringify(initialAgentSessions[0]))
    legacy.preferences = {
      autoApply: false,
      targetTrackCount: 12,
      preserveCurrent: false,
      avoidAdjacentArtists: true,
      startPlaybackOnApply: false,
    }
    storage.setItem(agentSessionsKey, JSON.stringify([legacy]))
    expect(readAgentSessions(storage)[0].preferences).toEqual({
      autoApply: false,
      targetTrackCount: 10,
      avoidAdjacentArtists: true,
      playbackApplyMode: 'pause-first',
    })
  })

  it('preserves an intentionally empty session list', () => {
    const storage = memoryStorage()
    writeAgentSessions([], storage)
    expect(readAgentSessions(storage)).toEqual([])
  })

  it('migrates older target counts to the nearest supported preset', () => {
    const storage = memoryStorage()
    const custom = { ...initialAgentSessions[0], preferences: { ...defaultAgentPreferences, targetTrackCount: 37 } }
    writeAgentSessions([custom], storage)
    expect(readAgentSessions(storage)[0].preferences.targetTrackCount).toBe(40)

    writeAgentSessions([{ ...custom, preferences: { ...custom.preferences, targetTrackCount: 999 } }], storage)
    expect(readAgentSessions(storage)[0].preferences.targetTrackCount).toBe(agentTargetTrackCountMax)

    writeAgentSessions([{ ...custom, preferences: { ...custom.preferences, targetTrackCount: -1 } }], storage)
    expect(readAgentSessions(storage)[0].preferences.targetTrackCount).toBe(agentTargetTrackCountMin)
  })

  it('keeps fixed conditions unique and within the product limit', () => {
    const merged = mergeAgentConstraints(['基础条件', '已有条件'], ['新增一', '新增二', '新增三', '新增四', '新增五', '新增六'])
    expect(merged).toHaveLength(agentConstraintLimit)
    expect(merged[0]).toBe('基础条件')
    expect(new Set(merged).size).toBe(merged.length)
  })

  it('replaces an older condition when the conversation changes the same dimension', () => {
    const merged = mergeAgentConstraints(
      ['优先使用可用的高音质音源', '整体保持平缓、低干扰的节奏', '避免近期重复播放'],
      ['整体能量逐步增强'],
    )
    expect(merged).toContain('整体能量逐步增强')
    expect(merged).not.toContain('整体保持平缓、低干扰的节奏')
    expect(merged).toContain('避免近期重复播放')
  })
})
