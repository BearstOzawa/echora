export type AgentMemory = {
  id: string
  title: string
  detail: string
  enabled: boolean
  source: 'learned' | 'custom'
  createdAt: number
  updatedAt?: number
  evidenceCount?: number
}

const storageKey = 'echora.agentMemories'

export const defaultAgentMemories: AgentMemory[] = []
export const agentMemoryLimit = 24

const legacyDemoMemoryIds = new Set(['memory-clear-vocals', 'memory-low-energy-evening'])

const isAgentMemory = (value: unknown): value is AgentMemory => {
  if (!value || typeof value !== 'object') return false
  const memory = value as Partial<AgentMemory>
  return typeof memory.id === 'string'
    && typeof memory.title === 'string'
    && typeof memory.detail === 'string'
    && typeof memory.enabled === 'boolean'
    && (memory.source === 'learned' || memory.source === 'custom')
    && typeof memory.createdAt === 'number'
}

export const readAgentMemories = (): AgentMemory[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as unknown
    if (stored === null) return defaultAgentMemories
    return Array.isArray(stored) && stored.every(isAgentMemory)
      ? stored
        .filter((memory) => !legacyDemoMemoryIds.has(memory.id))
        .map((memory) => ({ ...memory, updatedAt: memory.updatedAt ?? memory.createdAt, evidenceCount: Math.max(1, memory.evidenceCount ?? 1) }))
        .slice(0, agentMemoryLimit)
      : defaultAgentMemories
  } catch {
    return defaultAgentMemories
  }
}

export const writeAgentMemories = (memories: AgentMemory[]) => {
  localStorage.setItem(storageKey, JSON.stringify(memories))
}

export const createAgentMemory = (title: string, createdAt = Date.now()): AgentMemory => ({
  id: `memory-${createdAt}`,
  title: title.trim(),
  detail: '由你添加，将作为后续会话的默认上下文',
  enabled: true,
  source: 'custom',
  createdAt,
  updatedAt: createdAt,
  evidenceCount: 1,
})

const durableMemoryPattern = /(?:记住|以后|今后|每次|总是|不要再|我(?:很)?喜欢|我不喜欢)/

export const learnAgentMemory = (message: string, createdAt = Date.now()): AgentMemory | null => {
  const normalized = message.trim().replace(/^[，。,:：\s]+|[，。,.！!？?\s]+$/g, '')
  if (!normalized || !durableMemoryPattern.test(normalized)) return null
  const title = normalized.replace(/^(?:请)?记住[：:\s]*/, '').slice(0, 60)
  if (!title) return null
  return {
    id: `memory-learned-${createdAt}`,
    title,
    detail: '从你的明确长期要求中记录，可随时停用或删除',
    enabled: true,
    source: 'learned',
    createdAt,
    updatedAt: createdAt,
    evidenceCount: 1,
  }
}

const learnedSignals: Array<{ title: string; pattern: RegExp }> = [
  { title: '调整编排时优先保留正在播放的歌曲', pattern: /保留(?:当前|这首)|这首别动/ },
  { title: '避免连续播放同一位艺人', pattern: /(?:避免|不要|减少).*?(?:连续|相邻).*?(?:同一|相同).*?(?:艺人|歌手)/ },
  { title: '偏好平缓、低干扰的聆听节奏', pattern: /轻一点|安静|舒缓|低能量|低干扰/ },
  { title: '偏好逐渐增强能量的编排', pattern: /更有能量|更清醒|逐渐.*?(?:增强|提速)|运动|跑步|健身/ },
  { title: '偏好在编排中加入陌生作品', pattern: /没听过|陌生|发现新|加入新歌|增加新歌/ },
  { title: '偏好优先选择高音质版本', pattern: /高音质|无损|Hi-Res|高码率/ },
  { title: '偏好器乐或弱人声内容', pattern: /纯音乐|器乐|不要人声|少人声|弱人声/ },
  { title: '偏好现场或舞台版本', pattern: /现场版|Live|演唱会|舞台版/i },
]

export const learnAgentMemoriesFromConversation = (previousUserMessages: string[], message: string, createdAt = Date.now(), existingMemories: AgentMemory[] = []): AgentMemory[] => {
  const explicit = learnAgentMemory(message, createdAt)
  if (explicit) return [explicit]
  const conversation = [...previousUserMessages, message]
  return learnedSignals.flatMap((signal, index) => {
    const occurrences = conversation.filter((content) => signal.pattern.test(content)).length
    const alreadyLearned = existingMemories.some((memory) => memory.source === 'learned' && memory.title === signal.title)
    if ((!alreadyLearned && occurrences < 2) || !signal.pattern.test(message)) return []
    return [{
      id: `memory-learned-${createdAt}-${index}`,
      title: signal.title,
      detail: alreadyLearned ? '这一偏好再次出现在会话中，已更新使用记录' : '根据你在会话中的重复要求归纳，可随时停用或删除',
      enabled: true,
      source: 'learned' as const,
      createdAt,
      updatedAt: createdAt,
      evidenceCount: 1,
    }]
  })
}

export const mergeAgentMemories = (current: AgentMemory[], observations: AgentMemory[], limit = agentMemoryLimit) => {
  if (!observations.length) return current
  const next = [...current]
  observations.forEach((observation) => {
    const existingIndex = next.findIndex((memory) => memory.title.trim() === observation.title.trim())
    if (existingIndex < 0) {
      next.push(observation)
      return
    }
    const existing = next[existingIndex]
    const evidenceCount = Math.max(1, existing.evidenceCount ?? 1) + 1
    next[existingIndex] = {
      ...existing,
      enabled: existing.enabled,
      updatedAt: observation.updatedAt ?? observation.createdAt,
      evidenceCount,
      detail: existing.source === 'custom'
        ? existing.detail
        : `已在 ${evidenceCount} 次相关表达中得到确认，可随时停用或删除`,
    }
  })
  return next
    .sort((left, right) => {
      if (left.source !== right.source) return left.source === 'custom' ? -1 : 1
      return (right.updatedAt ?? right.createdAt) - (left.updatedAt ?? left.createdAt)
    })
    .slice(0, limit)
}
