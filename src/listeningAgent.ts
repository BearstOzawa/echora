import type { AgentMemory } from './agentMemories'
import type { AgentSession } from './agentSessions'
import type { AiSettings } from './appSettings'
import { platformBridge } from './platformBridge'
import { readCloudSession } from './cloudApi'
import type { Track } from './types'

export type ListeningPlan = {
  response: string
  title: string
  searchQueries: string[]
  targetIntensity: number
  targetNovelty: number
  keepCurrent: boolean
  replaceQueue: boolean
  avoidRecent: boolean
  constraints: string[]
  decisionSummary: string[]
}

export type ListeningAgentMode = 'ai' | 'local'

export type ListeningAgentResult = {
  mode: ListeningAgentMode
  plan: ListeningPlan
  fallbackReason?: string
  reasoning?: string[]
}

export type ListeningAgentInput = {
  message: string
  session: AgentSession
  memories: AgentMemory[]
  tracks: Track[]
  activeTrack?: Track | null
  activeTrackId: number
  intensity: number
  novelty: number
  ai: AiSettings
  cloudAuthenticated?: boolean
  signal?: AbortSignal
}

const planSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    response: { type: 'string' },
    title: { type: 'string' },
    searchQueries: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    targetIntensity: { type: 'integer', minimum: 0, maximum: 100 },
    targetNovelty: { type: 'integer', minimum: 0, maximum: 100 },
    keepCurrent: { type: 'boolean' },
    replaceQueue: { type: 'boolean' },
    avoidRecent: { type: 'boolean' },
    constraints: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    decisionSummary: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
  },
  required: ['response', 'title', 'searchQueries', 'targetIntensity', 'targetNovelty', 'keepCurrent', 'replaceQueue', 'avoidRecent', 'constraints', 'decisionSummary'],
} as const

const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value)))
const uniqueStrings = (values: unknown, limit: number) => Array.isArray(values)
  ? Array.from(new Set(values.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean))).slice(0, limit)
  : []

export const isAiConfigured = (settings: AiSettings, cloudAuthenticated = Boolean(readCloudSession())) => settings.mode === 'echora'
  ? cloudAuthenticated
  : Boolean(settings.baseUrl.trim()
  && settings.model.trim()
  && (settings.provider === 'ollama' || settings.apiKey.trim()))

const normalizePlan = (value: unknown, input: ListeningAgentInput): ListeningPlan => {
  if (!value || typeof value !== 'object') throw new Error('AI 没有返回有效的聆听计划')
  const plan = value as Partial<ListeningPlan>
  if (typeof plan.response !== 'string' || !plan.response.trim()) throw new Error('AI 返回的聆听计划缺少说明')
  return {
    response: plan.response.trim(),
    title: typeof plan.title === 'string' ? plan.title.trim().slice(0, 24) : '',
    searchQueries: uniqueStrings(plan.searchQueries, 3),
    targetIntensity: typeof plan.targetIntensity === 'number' ? clamp(plan.targetIntensity) : input.intensity,
    targetNovelty: typeof plan.targetNovelty === 'number' ? clamp(plan.targetNovelty) : input.novelty,
    keepCurrent: plan.keepCurrent === true,
    replaceQueue: plan.replaceQueue === true,
    avoidRecent: plan.avoidRecent === true,
    constraints: uniqueStrings(plan.constraints, 6),
    decisionSummary: uniqueStrings(plan.decisionSummary, 4),
  }
}

const extractJson = (content: string) => {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('AI 没有返回可解析的聆听计划')
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown
  } catch {
    throw new Error('AI 返回的聆听计划格式不正确')
  }
}

const normalizeReasoning = (values: unknown[]) => Array.from(new Set(values
  .flatMap((value) => typeof value === 'string' ? value.split(/\n+/) : [])
  .map((value) => value.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
  .filter(Boolean)))
  .slice(0, 4)
  .map((value) => value.slice(0, 240))

const responseError = (data: any, status: number) => String(data?.error?.message ?? data?.message ?? `AI 服务返回 ${status}`)

const requestJson = async (url: string, init: RequestInit, provider: AiSettings['provider'], signal?: AbortSignal) => {
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', abortFromCaller, { once: true })
  const timer = window.setTimeout(() => controller.abort(), 50_000)
  try {
    const response = await platformBridge.requestJson<any>('ai.request', {
      method: 'POST',
      body: {
        url,
        provider,
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        body: init.body,
      },
      signal: controller.signal,
    })
    const data = response.data
    if (!response.ok) throw new Error(responseError(data, response.status))
    return data
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('AI 服务响应超时')
    if (error instanceof TypeError || error instanceof Error && /failed to fetch|networkerror|load failed/i.test(error.message)) throw new Error('无法连接 AI 服务，请检查接口地址和网络')
    throw error
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', abortFromCaller)
  }
}

const endpoint = (baseUrl: string, path: string) => {
  const base = baseUrl.trim().replace(/\/+$/, '')
  const suffix = path.replace(/^\/+/, '')
  return base.toLocaleLowerCase().endsWith(`/${suffix.toLocaleLowerCase()}`) ? base : `${base}/${suffix}`
}

const agentInstructions = `你是 Echora 音乐场的音乐策划 Agent。你的职责是把用户的连续对话转换为可执行的音乐检索与编排计划；你应具备流媒体产品、音乐策展、DJ 编排和检索系统的基本判断。
你只负责规划：不能声称已经搜索到歌曲、已经替换队列或已经开始播放。真正的检索、版权可用性检查、去重与应用由客户端完成。
只输出符合 JSON Schema 的对象，不要附加 Markdown 或解释。

决策顺序：
1. 先识别硬条件：指定歌曲、艺人、专辑、语种、地区、年代、曲风、版本、场景、排除项与是否保留当前歌曲。硬条件不得被宽泛的情绪描述覆盖；本轮明确要求高于长期记忆。
2. 再识别编排意图：是替换主题、补充新歌、调整顺序、改变能量，还是只减少重复。没有必要引入新歌曲时 searchQueries 必须为空。
3. 最后形成检索策略。searchQueries 最多 3 项，按重要性排序且彼此互补。每项必须是音乐平台“单曲搜索”可命中的短检索锚点，不是歌单标题或自然语言愿望。

检索规则：
4. 用户指定歌曲、艺人或专辑时，优先返回准确名称，不得改写实体、臆造相似歌名或混入无关艺人。指定实体通常放在第一项。
5. 开放式推荐不要只返回“通勤音乐”“好听的歌”“氛围感”这类宽泛词。应组合语种、成熟曲风、年代或可靠的艺人锚点，形成 2-3 个互补方向；宁可使用艺人或曲风锚点，也不要编造具体歌曲。
6. 除非用户明确要求，避免把 DJ、伴奏、翻唱、片段、铃声、加速版、慢速版、现场版当作默认方向。版本要求必须写入检索词。
7. 多个检索方向要有可解释的分工，例如“主风格 / 相邻风格 / 新鲜探索”，不要写三个同义词。第一项是主方向，不能被探索项喧宾夺主。

编排规则：
8. 用户明确切换歌曲、艺人、专辑、曲风或主题时 replaceQueue=true；只要求变轻、提速、打散、减少重复或微调顺序时 replaceQueue=false。
9. keepCurrent=true 仅表示正在播放的歌曲必须保留在提案中，不表示立即播放。avoidRecent=true 表示降低曲目重复，并避免相邻同艺人；默认应保持艺人、专辑与来源的适度分散。
10. targetIntensity 与 targetNovelty 以当前值为基准。轻微调整通常变化 8-18，强烈调整可变化 20-35；除非用户明确要求极端效果，不要直接推到 0 或 100。编排应考虑开场、过渡、峰值和收束，不要让能量无理由跳变。
11. constraints 只返回这轮中新出现、后续回合仍应持续遵守的会话规则；临时搜索词、一次性操作和已有固定条件不要重复写入。
12. 当前会话历史只服务于本会话；enabledMemories 才能跨会话使用。冲突时依次遵循：本轮明确要求 > 当前会话固定条件 > 启用的长期记忆 > 默认产品策略。
13. decisionSummary 返回 2-4 条可直接展示给用户的决策依据，每条只说明一个判断，例如“优先满足指定艺人”“降低相邻同艺人概率”“用中速作品完成过渡”。这是简洁的产品说明，不要输出隐含推理、逐字思维链、空泛步骤或重复 response。
14. response 用一到两句自然、克制的中文说明“准备如何检索和组织”，不虚构候选数量、歌曲名称、音质、版权状态或执行结果。title 只在新会话尚未形成主题时给出简洁名称。`

const agentContext = (input: ListeningAgentInput) => JSON.stringify({
  request: input.message,
  session: {
    title: input.session.title,
    goal: input.session.goal,
    constraints: input.session.constraints,
    preferences: {
      targetTrackCount: input.session.preferences.targetTrackCount,
      avoidAdjacentArtists: input.session.preferences.avoidAdjacentArtists,
    },
    recentMessages: input.session.messages.slice(-12).map(({ role, content, change }) => ({ role, content, change: change ? { summary: change.summary, status: change.status } : undefined })),
  },
  enabledMemories: input.memories.filter((memory) => memory.enabled).map((memory) => ({ title: memory.title, detail: memory.detail })),
  currentState: {
    intensity: input.intensity,
    novelty: input.novelty,
    activeTrack: (() => {
      const track = input.activeTrack ?? input.tracks.find((item) => item.id === input.activeTrackId)
      return track ? { title: track.title, artist: track.artist, album: track.album, source: track.source, bpm: track.bpm, musicalKey: track.musicalKey } : null
    })(),
    queue: input.tracks.slice(0, 24).map((track) => ({ title: track.title, artist: track.artist, album: track.album, source: track.source, bpm: track.bpm, musicalKey: track.musicalKey, quality: track.quality })),
  },
})

const requestOpenAiPlan = async (input: ListeningAgentInput) => {
  const data = await requestJson(endpoint(input.ai.baseUrl, 'responses'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.ai.apiKey.trim()}` },
    body: JSON.stringify({
      model: input.ai.model.trim(),
      store: false,
      instructions: agentInstructions,
      input: agentContext(input),
      text: { format: { type: 'json_schema', name: 'listening_plan', strict: true, schema: planSchema } },
    }),
  }, input.ai.provider, input.signal)
  const content = typeof data?.output_text === 'string'
    ? data.output_text
    : (Array.isArray(data?.output) ? data.output.flatMap((item: any) => Array.isArray(item?.content) ? item.content : []).find((item: any) => item?.type === 'output_text')?.text : '')
  const reasoning = normalizeReasoning(Array.isArray(data?.output) ? data.output.flatMap((item: any) => item?.type === 'reasoning' && Array.isArray(item?.summary) ? item.summary.map((summary: any) => summary?.text) : []) : [])
  return { value: extractJson(String(content ?? '')), reasoning }
}

const requestManagedPlan = async (input: ListeningAgentInput) => {
  const response = await platformBridge.requestJson<{ content?: string; reasoning?: unknown[]; message?: string }>('ai.managed', {
    method: 'POST',
    body: { instructions: agentInstructions, input: agentContext(input), schema: planSchema },
    signal: input.signal,
  })
  if (!response.ok) throw new Error(response.data?.message || `Echora AI 返回 ${response.status}`)
  return {
    value: extractJson(String(response.data.content || '')),
    reasoning: normalizeReasoning(Array.isArray(response.data.reasoning) ? response.data.reasoning : []),
  }
}

const requestAnthropicPlan = async (input: ListeningAgentInput) => {
  const data = await requestJson(endpoint(input.ai.baseUrl, 'v1/messages'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': input.ai.apiKey.trim(),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: input.ai.model.trim(),
      max_tokens: 1200,
      system: `${agentInstructions}\nJSON Schema: ${JSON.stringify(planSchema)}`,
      messages: [{ role: 'user', content: agentContext(input) }],
    }),
  }, input.ai.provider, input.signal)
  const content = Array.isArray(data?.content) ? data.content.find((item: any) => item?.type === 'text')?.text : ''
  const reasoning = normalizeReasoning(Array.isArray(data?.content) ? data.content.filter((item: any) => item?.type === 'thinking').map((item: any) => item?.thinking) : [])
  return { value: extractJson(String(content ?? '')), reasoning }
}

const requestCompatiblePlan = async (input: ListeningAgentInput) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (input.ai.apiKey.trim()) headers.Authorization = `Bearer ${input.ai.apiKey.trim()}`
  const data = await requestJson(endpoint(input.ai.baseUrl, 'chat/completions'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: input.ai.model.trim(),
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${agentInstructions}\nJSON Schema: ${JSON.stringify(planSchema)}` },
        { role: 'user', content: agentContext(input) },
      ],
    }),
  }, input.ai.provider, input.signal)
  const rawContent = data?.choices?.[0]?.message?.content
  const content = Array.isArray(rawContent) ? rawContent.map((part: any) => part?.text ?? '').join('') : rawContent
  const reasoning = normalizeReasoning([data?.choices?.[0]?.message?.reasoning_content, data?.choices?.[0]?.message?.reasoning])
  return { value: extractJson(String(content ?? '')), reasoning }
}

const sceneQuery = (message: string) => {
  if (/通勤|开车|地铁/.test(message)) return '通勤音乐'
  if (/专注|工作|学习|阅读/.test(message)) return '专注轻音乐'
  if (/睡眠|入睡|睡前/.test(message)) return '睡眠轻音乐'
  if (/运动|跑步|健身/.test(message)) return '运动音乐'
  if (/聚会|派对/.test(message)) return '派对音乐'
  return ''
}

const extractLocalSearchQuery = (message: string) => {
  const quoted = message.match(/[“"']([^”"']{1,40})[”"']/)?.[1]?.trim()
  if (quoted) return quoted
  const requested = message.match(/(?:想听|听听|播放|来点|找找?|加入|推荐)(?:一些|一点|几首)?\s*([^，。,.！？!?]{1,36}?)(?:的歌|的音乐|歌曲|音乐|吧|，|。|$)/)?.[1]?.trim()
  if (requested) return requested
  return sceneQuery(message)
}

export const createLocalListeningPlan = (input: ListeningAgentInput): ListeningPlan => {
  const message = input.message
  const memoryContext = input.memories
    .filter((memory) => memory.enabled)
    .map((memory) => `${memory.title} ${memory.detail}`)
    .join(' ')
  const calm = /轻|安静|慢|柔和|低能量|舒缓/.test(message)
  const energetic = /清醒|能量|热烈|提速|更快|运动|跑步|健身/.test(message)
  const discovery = /新|陌生|发现|没听过|推荐/.test(message)
  const keepCurrent = /保留|留下|固定|这首别动/.test(message) || /保留当前|当前(?:歌曲|这首).*?(?:保留|别动)/.test(memoryContext)
  const avoidRecent = /不重复|不要重复|少听过|换一批/.test(message) || /(?:避免|不要|减少).*?(?:连续|相邻).*?(?:同一|相同).*?(?:艺人|歌手)/.test(memoryContext)
  const explicitQuery = extractLocalSearchQuery(message)
  const hasRetainedActiveTrack = Boolean(keepCurrent && input.activeTrack)
  const needsMusic = input.tracks.length === 0 && !hasRetainedActiveTrack || Boolean(explicitQuery) || discovery
  const fallbackQuery = sceneQuery(message) || (discovery ? '新歌' : input.tracks.length === 0 && !hasRetainedActiveTrack ? '华语流行' : '')
  const searchQueries = needsMusic ? uniqueStrings([explicitQuery || fallbackQuery], 3) : []
  const targetIntensity = calm ? input.intensity - 18 : energetic ? input.intensity + 18 : input.intensity
  const targetNovelty = discovery || avoidRecent ? Math.max(82, input.novelty) : input.novelty
  const title = /通勤/.test(message) ? '通勤路上' : /专注|工作|学习/.test(message) ? '专注时段' : discovery ? '音乐发现' : ''
  const scene = sceneQuery(message)
  const action = searchQueries.length ? `我会先从音乐服务检索“${searchQueries.join('、')}”，再结合当前编排完成衔接。` : '我会保留当前会话上下文，并按这次要求调整后续顺序。'
  return {
    response: action,
    title,
    searchQueries,
    targetIntensity: clamp(targetIntensity),
    targetNovelty: clamp(targetNovelty),
    keepCurrent,
    replaceQueue: input.tracks.length === 0 && !hasRetainedActiveTrack || Boolean(explicitQuery && !keepCurrent),
    avoidRecent,
    constraints: [
      ...(keepCurrent ? ['固定当前歌曲'] : []),
      ...(avoidRecent ? ['避免近期重复播放'] : []),
      ...(calm ? ['整体保持平缓、低干扰的节奏'] : []),
      ...(energetic ? ['整体能量逐步增强'] : []),
      ...(discovery ? ['提高新鲜度并加入陌生作品'] : []),
      ...(scene ? [`当前场景：${scene}`] : []),
    ],
    decisionSummary: [
      explicitQuery ? `优先检索“${explicitQuery}”相关的原始录音版本` : '先依据场景与能量目标确定候选范围',
      keepCurrent ? '将当前歌曲保留在新编排中' : searchQueries.length ? '新编排不继承未明确要求的旧曲目' : '在现有编排内调整顺序与过渡',
      avoidRecent ? '分散相邻艺人与近期重复' : '保持歌曲之间的节奏连续性',
    ],
  }
}

const uniqueTracks = (tracks: Track[]) => Array.from(new Map(tracks.map((track) => [track.id, track])).values())

export const interleaveDiscoveredTracks = (groups: Track[][]) => {
  const seen = new Set<number>()
  const result: Track[] = []
  const maxLength = Math.max(0, ...groups.map((group) => group.length))
  for (let index = 0; index < maxLength; index += 1) {
    groups.forEach((group) => {
      const track = group[index]
      if (!track || seen.has(track.id)) return
      seen.add(track.id)
      result.push(track)
    })
  }
  return result
}

const versionKeywords = [
  /\b(?:dj|remix|cover|live|instrumental|karaoke|sped\s*up|slowed)\b/i,
  /(?:伴奏|翻唱|现场版?|演唱会版?|纯音乐|铃声|片段|加速版?|慢速版?|抖音版?|DJ版?)/i,
]

const mentionsSpecialVersion = (value: string) => versionKeywords.some((pattern) => pattern.test(value))

export const preferCanonicalTrackVersions = (groups: Track[][], searchQueries: string[]) => groups.map((group, index) => {
  const query = searchQueries[index] ?? ''
  if (mentionsSpecialVersion(query)) return group
  const canonical = group.filter((track) => !mentionsSpecialVersion(`${track.title} ${track.album}`))
  return canonical.length ? canonical : group
})

const avoidAdjacentArtists = (tracks: Track[]) => {
  const pending = [...tracks]
  const arranged: Track[] = []
  while (pending.length) {
    const previousArtist = arranged[arranged.length - 1]?.artist
    const index = pending.findIndex((track) => track.artist !== previousArtist)
    arranged.push(...pending.splice(index < 0 ? 0 : index, 1))
  }
  return arranged
}

export const arrangeListeningTracks = (plan: ListeningPlan, currentTracks: Track[], discoveredTracks: Track[], activeTrackId: number, targetCount: number, activeTrackOverride?: Track | null) => {
  const activeTrack = currentTracks.find((track) => track.id === activeTrackId) ?? activeTrackOverride ?? undefined
  const discoveries = uniqueTracks(discoveredTracks).filter((track) => !currentTracks.some((current) => current.id === track.id))
  let nextTracks: Track[]
  if (plan.replaceQueue && discoveredTracks.length) {
    nextTracks = plan.keepCurrent && activeTrack ? [activeTrack, ...discoveredTracks.filter((track) => track.id !== activeTrack.id)] : discoveredTracks
  } else if (discoveries.length) {
    const insertionIndex = activeTrack ? Math.max(1, currentTracks.findIndex((track) => track.id === activeTrack.id) + 1) : currentTracks.length
    nextTracks = [...currentTracks.slice(0, insertionIndex), ...discoveries, ...currentTracks.slice(insertionIndex)]
  } else {
    nextTracks = [...currentTracks]
  }

  nextTracks = uniqueTracks(nextTracks)
  if (plan.avoidRecent) nextTracks = avoidAdjacentArtists(nextTracks)
  if (!discoveredTracks.length && nextTracks.some((track) => track.bpm > 0)) {
    const energyDirection = plan.targetIntensity >= 55 ? -1 : 1
    nextTracks.sort((left, right) => energyDirection * (left.bpm - right.bpm))
  }
  if (plan.keepCurrent && activeTrack) nextTracks = [activeTrack, ...nextTracks.filter((track) => track.id !== activeTrack.id)]
  return nextTracks.slice(0, Math.max(1, targetCount))
}

export const createListeningPlan = async (input: ListeningAgentInput): Promise<ListeningAgentResult> => {
  if (!isAiConfigured(input.ai, input.cloudAuthenticated)) {
    const plan = createLocalListeningPlan(input)
    return { mode: 'local', plan, reasoning: plan.decisionSummary }
  }
  try {
    const response = input.ai.mode === 'echora'
      ? await requestManagedPlan(input)
      : input.ai.provider === 'openai'
      ? await requestOpenAiPlan(input)
      : input.ai.provider === 'anthropic'
        ? await requestAnthropicPlan(input)
        : await requestCompatiblePlan(input)
    const plan = normalizePlan(response.value, input)
    const result: ListeningAgentResult = { mode: 'ai', plan, reasoning: plan.decisionSummary }
    return result
  } catch (error) {
    if (input.signal?.aborted || error instanceof DOMException && error.name === 'AbortError') throw error
    const fallbackReason = error instanceof Error ? error.message : 'AI 服务暂时不可用'
    const plan = createLocalListeningPlan(input)
    return { mode: 'local', plan, reasoning: plan.decisionSummary, fallbackReason }
  }
}
