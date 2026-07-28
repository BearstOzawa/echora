import { beforeEach, describe, expect, it } from 'vitest'
import { agentMemoryLimit, createAgentMemory, defaultAgentMemories, learnAgentMemoriesFromConversation, learnAgentMemory, mergeAgentMemories, readAgentMemories, writeAgentMemories } from './agentMemories'

beforeEach(() => localStorage.clear())

describe('agent memories', () => {
  it('starts with useful local defaults', () => {
    expect(readAgentMemories()).toEqual(defaultAgentMemories)
  })

  it('persists user controls without restoring deleted memories', () => {
    const custom = createAgentMemory('不要连续播放同一位艺人', 42)
    writeAgentMemories([{ ...custom, enabled: false }])
    expect(readAgentMemories()).toEqual([{ ...custom, enabled: false }])
  })

  it('falls back when stored memory data is malformed', () => {
    localStorage.setItem('echora.agentMemories', '{bad json')
    expect(readAgentMemories()).toEqual(defaultAgentMemories)
  })

  it('only learns from explicit durable requests', () => {
    expect(learnAgentMemory('接下来轻一点', 42)).toBeNull()
    expect(learnAgentMemory('记住：以后不要连续播放同一位艺人', 42)).toMatchObject({
      id: 'memory-learned-42',
      title: '以后不要连续播放同一位艺人',
      source: 'learned',
      enabled: true,
    })
  })

  it('promotes a repeated session preference into long-term memory', () => {
    expect(learnAgentMemoriesFromConversation(['后面轻一点'], '接下来还是轻一点', 55)).toEqual([
      expect.objectContaining({
        id: 'memory-learned-55-2',
        title: '偏好平缓、低干扰的聆听节奏',
        source: 'learned',
      }),
    ])
    expect(learnAgentMemoriesFromConversation([], '接下来轻一点', 56)).toEqual([])
  })

  it('updates a learned habit instead of creating duplicate memories', () => {
    const existing = learnAgentMemoriesFromConversation(['后面轻一点'], '接下来还是轻一点', 55)[0]
    const observation = learnAgentMemoriesFromConversation([], '今晚还是轻一点', 66, [existing])[0]
    const merged = mergeAgentMemories([existing], [observation])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ evidenceCount: 2, updatedAt: 66 })
  })

  it('keeps long-term memory within its local product limit', () => {
    const observations = Array.from({ length: agentMemoryLimit + 4 }, (_, index) => createAgentMemory(`记忆 ${index}`, index + 1))
    expect(mergeAgentMemories([], observations)).toHaveLength(agentMemoryLimit)
  })
})
