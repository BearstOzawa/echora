import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initialAgentSessions } from './agentSessions'
import { arrangeListeningTracks, createListeningPlan, createLocalListeningPlan, interleaveDiscoveredTracks, preferCanonicalTrackVersions } from './listeningAgent'
import { initialTracks } from './testFixtures'

const input = {
  message: '我想听周杰伦的歌，适合通勤',
  session: initialAgentSessions[0],
  memories: [{ id: 'memory-1', title: '不要连续播放同一位艺人', detail: '用户添加', enabled: true, source: 'custom' as const, createdAt: 1 }],
  tracks: initialTracks.slice(0, 4),
  activeTrackId: initialTracks[1].id,
  intensity: 64,
  novelty: 38,
  ai: { provider: 'openai' as const, baseUrl: 'https://api.openai.com/v1', model: '', apiKey: '' },
}

beforeEach(() => {
  localStorage.setItem('echora.cloudSession.v1', JSON.stringify({ token: 'test-session', user: { id: 'user-1', username: 'listener' } }))
})

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('listening agent planning', () => {
  it('turns an explicit local request into a source-search plan', () => {
    const plan = createLocalListeningPlan(input)
    expect(plan.searchQueries).toEqual(['周杰伦'])
    expect(plan.replaceQueue).toBe(true)
    expect(plan.title).toBe('通勤路上')
    expect(plan.avoidRecent).toBe(true)
  })

  it('keeps the active track while replacing the rest with discovered music', () => {
    const discovered = initialTracks.slice(4).map((track, index) => ({ ...track, id: track.id + 100 + index }))
    const plan = { ...createLocalListeningPlan({ ...input, message: '换成新的音乐，但保留当前这首' }), replaceQueue: true, avoidRecent: true }
    const arranged = arrangeListeningTracks(plan, input.tracks, discovered, input.activeTrackId, 8)
    expect(arranged[0].id).toBe(input.activeTrackId)
    expect(arranged.some((track) => track.id === discovered[0].id)).toBe(true)
    expect(arranged.filter((track) => input.tracks.some((current) => current.id === track.id))).toHaveLength(1)
  })

  it('balances candidates across complementary search directions', () => {
    const first = initialTracks.slice(0, 3)
    const second = initialTracks.slice(3, 6)
    expect(interleaveDiscoveredTracks([first, second]).map((track) => track.id)).toEqual([
      first[0].id, second[0].id, first[1].id, second[1].id, first[2].id, second[2].id,
    ])
  })

  it('prefers canonical recordings unless the request explicitly asks for another version', () => {
    const canonical = { ...initialTracks[0], id: 101, title: '晴天', album: '叶惠美' }
    const remix = { ...initialTracks[1], id: 102, title: '晴天 DJ版', album: '热门混音' }
    const live = { ...initialTracks[2], id: 103, title: '晴天 (Live)', album: '巡回演唱会' }
    expect(preferCanonicalTrackVersions([[remix, canonical, live]], ['晴天 周杰伦'])[0]).toEqual([canonical])
    expect(preferCanonicalTrackVersions([[remix, canonical]], ['晴天 DJ版'])[0]).toEqual([remix, canonical])
    expect(preferCanonicalTrackVersions([[live]], ['晴天 周杰伦'])[0]).toEqual([live])
  })

  it('uses the OpenAI Responses endpoint and normalizes a structured plan', async () => {
    const responsePlan = {
      response: '先检索通勤需要的华语作品，再逐步提高能量。',
      title: '早高峰通勤',
      searchQueries: ['华语通勤', '周杰伦'],
      targetIntensity: 72,
      targetNovelty: 55,
      keepCurrent: false,
      replaceQueue: true,
      avoidRecent: true,
      constraints: ['避免连续同艺人'],
      decisionSummary: ['优先满足指定艺人', '按通勤节奏组织过渡'],
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output: [{ type: 'reasoning', summary: [{ text: '先锁定用户指定的艺人，再平衡通勤节奏。' }] }, { content: [{ type: 'output_text', text: JSON.stringify(responsePlan) }] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await createListeningPlan({ ...input, ai: { provider: 'openai', baseUrl: 'https://api.openai.com/v1/', model: 'gpt-test', apiKey: 'test-key' } })
    expect(result).toEqual({ mode: 'ai', plan: responsePlan, reasoning: responsePlan.decisionSummary })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://echora-cloud.lili.uno/v1/ai/custom/request')
    const gatewayRequest = JSON.parse(String(request.body))
    expect(gatewayRequest.url).toBe('https://api.openai.com/v1/responses')
    expect(gatewayRequest.provider).toBe('openai')
    const body = JSON.parse(gatewayRequest.body)
    expect(body.store).toBe(false)
    expect(body.instructions).toContain('你只负责规划')
    expect(body.instructions).toContain('constraints 只返回这轮中新出现')
    expect(body.instructions).toContain('单曲搜索')
    expect(body.instructions).toContain('不要编造具体歌曲')
    expect(body.text.format).toMatchObject({ type: 'json_schema', name: 'listening_plan', strict: true })
    expect(body.input).toContain('不要连续播放同一位艺人')
    expect(body.input).toContain('用户添加')
  })

  it('falls back to a usable local plan when the AI service cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const result = await createListeningPlan({ ...input, ai: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-test', apiKey: 'test-key' } })
    expect(result.mode).toBe('local')
    expect(result.fallbackReason).toBe('无法连接 Echora Cloud')
    expect(result.plan.searchQueries).toEqual(['周杰伦'])
    expect(result.plan.replaceQueue).toBe(true)
  })

  it('propagates an explicit cancellation instead of creating a local fallback', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn((_url: string, request: RequestInit) => new Promise((_resolve, reject) => {
      request.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })))
    const result = createListeningPlan({ ...input, ai: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-test', apiKey: 'test-key' }, signal: controller.signal })
    controller.abort()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  })
})
