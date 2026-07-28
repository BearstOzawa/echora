import type { Track } from './types'
import type { PlaybackApplyMode } from './playbackContext'

export type AgentRunStatus = 'running' | 'complete' | 'failed' | 'cancelled'

export type AgentPreferences = {
  autoApply: boolean
  targetTrackCount: number
  avoidAdjacentArtists: boolean
  playbackApplyMode: PlaybackApplyMode
}

export type AgentQueueProposal = {
  queueTrackIds: number[]
  tracks?: Track[]
  trackLayout: AgentTrackPosition[]
  targetIntensity: number
  targetNovelty: number
}

export type AgentChangeSet = {
  summary: string
  addedTrackIds: number[]
  removedTrackIds: number[]
  keptTrackIds: number[]
  undoable: boolean
  status?: 'pending' | 'applied' | 'dismissed'
  proposal?: AgentQueueProposal
}

export type AgentMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  reasoning?: string[]
  change?: AgentChangeSet
}

export type AgentRun = {
  id: string
  status: AgentRunStatus
  label: string
  detail: string
  createdAt: number
}

export type AgentTrackPosition = {
  id: number
  x: number
  y: number
}

export type AgentSession = {
  id: string
  title: string
  summary: string
  goal: string
  status: 'active' | 'paused'
  updatedAt: number
  constraints: string[]
  memories: string[]
  queueTrackIds: number[]
  trackLayout?: AgentTrackPosition[]
  arrangementZoom?: number
  preferences: AgentPreferences
  intensity: number
  novelty: number
  previousQueueTrackIds: number[] | null
  previousTrackLayout?: AgentTrackPosition[] | null
  messages: AgentMessage[]
  runs: AgentRun[]
}

export const agentSessionsKey = 'echora.agentSessions.v1'

export const defaultAgentPreferences: AgentPreferences = {
  autoApply: false,
  targetTrackCount: 20,
  avoidAdjacentArtists: true,
  playbackApplyMode: 'continue-current',
}

export const agentTargetTrackCountPresets = [10, 20, 30, 40, 50] as const
export const agentTargetTrackCountMin = 10
export const agentTargetTrackCountMax = 50

export const normalizeAgentTargetTrackCount = (value: number) => agentTargetTrackCountPresets.reduce((closest, preset) => (
  Math.abs(preset - value) < Math.abs(closest - value) ? preset : closest
), agentTargetTrackCountPresets[0])

export const agentConstraintLimit = 6

const constraintFamily = (constraint: string) => {
  if (/能量|节奏|平静|舒缓|提速|清醒|热烈/.test(constraint)) return 'energy'
  if (/新鲜|陌生|熟悉|探索|新歌/.test(constraint)) return 'novelty'
  if (/当前(?:歌曲|播放)|这首|保留当前|固定当前/.test(constraint)) return 'current-track'
  if (/连续|相邻|同一位?艺人|同一位?歌手|重复播放/.test(constraint)) return 'artist-spacing'
  if (/通勤|驾驶|专注|工作|学习|阅读|睡眠|睡前|运动|跑步|健身|聚会|派对/.test(constraint)) return 'scene'
  if (/音质|无损|高码率|Hi-Res/.test(constraint)) return 'quality'
  return ''
}

export const mergeAgentConstraints = (current: string[], additions: string[], limit = agentConstraintLimit) => {
  const baseline = current[0]
  const normalizedAdditions = Array.from(new Set(additions.map((item) => item.trim()).filter(Boolean)))
  const replacementFamilies = new Set(normalizedAdditions.map(constraintFamily).filter(Boolean))
  const retained = current.slice(1).filter((item) => {
    const family = constraintFamily(item)
    return !family || !replacementFamilies.has(family)
  })
  const candidates = Array.from(new Set([...normalizedAdditions, ...retained].map((item) => item.trim()).filter(Boolean)))
  return baseline ? [baseline, ...candidates.filter((item) => item !== baseline)].slice(0, limit) : candidates.slice(0, limit)
}

export const sortAgentSessions = (sessions: AgentSession[]) => [...sessions].sort((left, right) => right.updatedAt - left.updatedAt)

const now = Date.now()

export const initialAgentSessions: AgentSession[] = [
  {
    id: 'welcome',
    title: '新的音乐会话',
    summary: '尚未设置聆听目标',
    goal: '建立一份新的音乐编排',
    status: 'active',
    updatedAt: now,
    constraints: ['优先使用可用的高音质音源'],
    memories: [],
    queueTrackIds: [],
    trackLayout: [],
    arrangementZoom: 100,
    preferences: { ...defaultAgentPreferences },
    intensity: 64,
    novelty: 38,
    previousQueueTrackIds: null,
    previousTrackLayout: null,
    messages: [
      { id: 'message-welcome', role: 'assistant', content: '描述场景、音乐偏好或指定曲目，Echora 会生成一份可确认的编排提案。', createdAt: now },
    ],
    runs: [],
  },
]

const legacyDemoSessionIds = new Set(['late-focus', 'commute', 'discovery'])

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')
const isNumberArray = (value: unknown): value is number[] => Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item))
const isTrackLayout = (value: unknown): value is AgentTrackPosition[] => Array.isArray(value) && value.every((item) => {
  if (!item || typeof item !== 'object') return false
  const position = item as Partial<AgentTrackPosition>
  return typeof position.id === 'number' && Number.isFinite(position.id)
    && typeof position.x === 'number' && Number.isFinite(position.x)
    && typeof position.y === 'number' && Number.isFinite(position.y)
})

type StoredAgentPreferences = Partial<AgentPreferences> & {
  preserveCurrent?: boolean
  startPlaybackOnApply?: boolean
}

const isPlaybackApplyMode = (value: unknown): value is PlaybackApplyMode => value === 'continue-current' || value === 'play-first' || value === 'pause-first'

const isPreferences = (value: unknown): value is StoredAgentPreferences => {
  if (!value || typeof value !== 'object') return false
  const preferences = value as StoredAgentPreferences
  return typeof preferences.autoApply === 'boolean'
    && typeof preferences.targetTrackCount === 'number'
    && Number.isFinite(preferences.targetTrackCount)
    && typeof preferences.avoidAdjacentArtists === 'boolean'
    && (preferences.playbackApplyMode === undefined || isPlaybackApplyMode(preferences.playbackApplyMode))
    && (preferences.preserveCurrent === undefined || typeof preferences.preserveCurrent === 'boolean')
    && (preferences.startPlaybackOnApply === undefined || typeof preferences.startPlaybackOnApply === 'boolean')
}

const normalizePreferences = (preferences?: StoredAgentPreferences): AgentPreferences => {
  const targetTrackCount = preferences?.targetTrackCount ?? defaultAgentPreferences.targetTrackCount
  const legacyApplyMode: PlaybackApplyMode = preferences?.startPlaybackOnApply
    ? 'play-first'
    : preferences?.preserveCurrent === false ? 'pause-first' : 'continue-current'
  return {
    autoApply: preferences?.autoApply ?? defaultAgentPreferences.autoApply,
    targetTrackCount: normalizeAgentTargetTrackCount(targetTrackCount),
    avoidAdjacentArtists: preferences?.avoidAdjacentArtists ?? defaultAgentPreferences.avoidAdjacentArtists,
    playbackApplyMode: isPlaybackApplyMode(preferences?.playbackApplyMode) ? preferences.playbackApplyMode : legacyApplyMode,
  }
}

const isMessage = (value: unknown): value is AgentMessage => {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<AgentMessage>
  return typeof message.id === 'string'
    && (message.role === 'user' || message.role === 'assistant')
    && typeof message.content === 'string'
    && typeof message.createdAt === 'number'
    && (message.reasoning === undefined || isStringArray(message.reasoning))
}

const isRun = (value: unknown): value is AgentRun => {
  if (!value || typeof value !== 'object') return false
  const run = value as Partial<AgentRun>
  return typeof run.id === 'string'
    && (run.status === 'running' || run.status === 'complete' || run.status === 'failed' || run.status === 'cancelled')
    && typeof run.label === 'string'
    && typeof run.detail === 'string'
    && typeof run.createdAt === 'number'
}

type StoredAgentSession = Omit<AgentSession, 'preferences' | 'intensity' | 'novelty'> & { preferences?: StoredAgentPreferences; intensity?: number; novelty?: number }

const isSession = (value: unknown): value is StoredAgentSession => {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<AgentSession>
  return typeof session.id === 'string'
    && typeof session.title === 'string'
    && typeof session.summary === 'string'
    && typeof session.goal === 'string'
    && (session.status === 'active' || session.status === 'paused')
    && typeof session.updatedAt === 'number'
    && isStringArray(session.constraints)
    && isStringArray(session.memories)
    && isNumberArray(session.queueTrackIds)
    && (session.trackLayout === undefined || isTrackLayout(session.trackLayout))
    && (session.arrangementZoom === undefined || typeof session.arrangementZoom === 'number' && Number.isFinite(session.arrangementZoom))
    && (session.preferences === undefined || isPreferences(session.preferences))
    && (session.intensity === undefined || typeof session.intensity === 'number' && Number.isFinite(session.intensity))
    && (session.novelty === undefined || typeof session.novelty === 'number' && Number.isFinite(session.novelty))
    && (session.previousQueueTrackIds === null || isNumberArray(session.previousQueueTrackIds))
    && (session.previousTrackLayout === undefined || session.previousTrackLayout === null || isTrackLayout(session.previousTrackLayout))
    && Array.isArray(session.messages)
    && session.messages.every(isMessage)
    && Array.isArray(session.runs)
    && session.runs.every(isRun)
}

type SessionStorage = Pick<Storage, 'getItem' | 'setItem'>

export const readAgentSessions = (storage: SessionStorage = localStorage): AgentSession[] => {
  try {
    const parsed = JSON.parse(storage.getItem(agentSessionsKey) ?? 'null') as unknown
    if (parsed === null) return initialAgentSessions
    if (!Array.isArray(parsed) || !parsed.every(isSession)) return initialAgentSessions
    const sessions = parsed
      .filter((session) => !legacyDemoSessionIds.has(session.id))
      .map((session) => ({
        ...session,
        preferences: normalizePreferences(session.preferences),
        intensity: Math.min(100, Math.max(0, session.intensity ?? 64)),
        novelty: Math.min(100, Math.max(0, session.novelty ?? 38)),
        messages: session.messages.map((message) => message.change && !message.change.status
          ? { ...message, change: { ...message.change, status: 'applied' as const } }
          : message),
      }))
    return sortAgentSessions(sessions)
  } catch {
    return initialAgentSessions
  }
}

export const writeAgentSessions = (sessions: AgentSession[], storage: SessionStorage = localStorage) => {
  storage.setItem(agentSessionsKey, JSON.stringify(sessions))
}

export const createAgentSession = (queueTrackIds: number[], trackLayout: AgentTrackPosition[] = []): AgentSession => {
  const createdAt = Date.now()
  return {
    id: `session-${createdAt}`,
    title: '新的音乐会话',
    summary: '尚未设置聆听目标',
    goal: '从一句话开始建立这次聆听',
    status: 'active',
    updatedAt: createdAt,
    constraints: ['优先使用可用的高音质音源'],
    memories: [],
    queueTrackIds,
    trackLayout,
    arrangementZoom: 100,
    preferences: { ...defaultAgentPreferences },
    intensity: 64,
    novelty: 38,
    previousQueueTrackIds: null,
    previousTrackLayout: null,
    messages: [{ id: `message-${createdAt}`, role: 'assistant', content: '描述场景、音乐偏好或指定曲目，Echora 会结合当前播放生成一份可确认的编排提案。', createdAt }],
    runs: [],
  }
}
