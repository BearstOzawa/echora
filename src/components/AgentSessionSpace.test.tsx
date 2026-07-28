import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAgentSession, initialAgentSessions } from '../agentSessions'
import type { AgentMemory } from '../agentMemories'
import { initialTracks, searchCatalog } from '../testFixtures'
import AgentSessionSpace from './AgentSessionSpace'

afterEach(cleanup)

const testSessions = [
  { ...initialAgentSessions[0], id: 'test-focus', title: '深夜专注', summary: '测试会话', queueTrackIds: [1, 2, 3, 4, 5, 6] },
  { ...createAgentSession([3, 4, 5]), id: 'test-commute', title: '下班通勤', summary: '测试会话', status: 'paused' as const },
]
const testMemories: AgentMemory[] = [
  { id: 'test-memory-1', title: '偏好清晰人声', detail: '测试记忆', enabled: true, source: 'custom', createdAt: 1 },
  { id: 'test-memory-2', title: '夜间降低能量', detail: '测试记忆', enabled: true, source: 'custom', createdAt: 2 },
]

const renderSpace = ({ isThinking = false, agentMode = 'local', agentServiceMode, sessions = testSessions, navigationRequest = null, mobile = false }: { isThinking?: boolean; agentMode?: 'ai' | 'local'; agentServiceMode?: 'unconfigured' | 'echora' | 'custom'; sessions?: typeof testSessions; navigationRequest?: { key: number; view: 'conversation' | 'arrangement' } | null; mobile?: boolean } = {}) => {
  const actions = {
    onCreateSession: vi.fn(),
    onMemoriesChange: vi.fn(),
    onRenameSession: vi.fn(),
    onDeleteSession: vi.fn(),
    onSelectSession: vi.fn(),
    onTerminateSession: vi.fn(),
    onSubmit: vi.fn(),
    onPreferencesChange: vi.fn(),
    onApplyProposal: vi.fn(),
    onDismissProposal: vi.fn(),
    onUndo: vi.fn(),
    onPlayTrack: vi.fn(),
    onMoveTrack: vi.fn(),
    onReorderTrack: vi.fn(),
    onReorderTrackTo: vi.fn(),
    onRemoveTrack: vi.fn(),
    onArrangementZoomChange: vi.fn(),
    onOpenNowPlaying: vi.fn(),
    onConfigureAi: vi.fn(),
  }
  render(<AgentSessionSpace mobile={mobile} sessions={sessions} memories={testMemories} activeSessionId={sessions[0]?.id ?? ''} catalog={searchCatalog} activeTrackId={3} isPlaying runningSessionIds={isThinking && sessions[0] ? [sessions[0].id] : []} agentMode={agentMode} agentServiceMode={agentServiceMode} navigationRequest={navigationRequest} {...actions} />)
  return actions
}

describe('AgentSessionSpace', () => {
  it('does not repeat the active state as a redundant list heading', () => {
    renderSpace()
    expect(screen.queryByText('正在进行')).toBeNull()
    expect(screen.getByText('现在')).toBeTruthy()
  })

  it('continues the active session from the persistent composer', () => {
    const actions = renderSpace()
    const composer = screen.getByRole('textbox', { name: '继续这次音乐会话' })
    fireEvent.change(composer, { target: { value: '后半段更清醒，但保留当前这首' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    expect(actions.onSubmit).toHaveBeenCalledWith('后半段更清醒，但保留当前这首')
  })

  it('explains unavailable speech recognition instead of exposing a dead control', () => {
    renderSpace()
    const voice = screen.getByRole('button', { name: '语音输入' })
    expect(voice.hasAttribute('disabled')).toBe(true)
    expect(voice.getAttribute('title')).toBe('当前环境暂不支持语音识别')
  })

  it('collapses and restores the composer on mobile', () => {
    renderSpace({ mobile: true })
    fireEvent.click(screen.getByRole('button', { name: '收起输入框' }))
    expect(screen.queryByRole('textbox', { name: '继续这次音乐会话' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '展开输入框' }))
    expect(screen.getByRole('textbox', { name: '继续这次音乐会话' })).toBeTruthy()
  })

  it('keeps a pristine mobile conversation in top-reading order', () => {
    const pristineSession = {
      ...testSessions[0],
      messages: testSessions[0].messages.filter((message) => message.role !== 'user'),
    }
    renderSpace({ mobile: true, sessions: [pristineSession, testSessions[1]] })
    expect(document.querySelector('.conversation-stream.is-pristine')).toBeTruthy()
    expect(document.querySelector('.conversation-stream.has-user-turns')).toBeNull()
  })

  it('shows the execution mode while keeping session navigation available', () => {
    const actions = renderSpace({ isThinking: true, agentMode: 'ai' })
    expect(screen.getByText('AI 正在编排')).toBeTruthy()
    expect(screen.getByRole('button', { name: '新建会话' }).hasAttribute('disabled')).toBe(false)
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>('.session-select')).every((button) => !button.disabled)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '停止生成' }))
    expect(actions.onTerminateSession).toHaveBeenCalledWith('test-focus')
  })

  it('explains local fallback and opens AI configuration', () => {
    const actions = renderSpace({ agentMode: 'local' })
    expect(document.querySelector('.conversation-view > .agent-mode-notice')).toBeNull()
    expect(document.querySelector('.agent-main-header .agent-mode-status')).toBeNull()
    expect(document.querySelector('.composer-meta-actions .composer-ai-state.is-unconfigured')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '未配置 AI，当前使用本地编排，打开设置' }))
    expect(actions.onConfigureAi).toHaveBeenCalledOnce()
  })

  it.each([
    ['echora', 'Echora AI', '由 Echora Cloud 提供'],
    ['custom', '自定义 AI', '使用账户中的模型配置'],
  ] as const)('shows the configured %s service as a composer settings action', (agentServiceMode, title, detail) => {
    const actions = renderSpace({ agentMode: 'ai', agentServiceMode })
    expect(document.querySelector('.conversation-view > .agent-mode-notice')).toBeNull()
    const status = screen.getByRole('button', { name: `${title}，${detail}，打开设置` })
    expect(status.classList.contains(`is-${agentServiceMode}`)).toBe(true)
    expect(status.getAttribute('data-tooltip')).toBe(`${title} · ${detail}`)
    fireEvent.click(status)
    expect(actions.onConfigureAi).toHaveBeenCalledOnce()
  })

  it('opens the only session preferences entry from the composer', () => {
    const actions = renderSpace()
    expect(screen.getAllByRole('button', { name: '会话偏好' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '会话偏好' }))
    expect(screen.getByRole('dialog', { name: '会话偏好' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /首$/ }).map((button) => button.getAttribute('aria-label'))).toEqual(['10 首', '20 首', '30 首', '40 首', '50 首'])
    expect(screen.queryByRole('spinbutton', { name: '自定义目标歌曲数' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '30 首' }))
    expect(actions.onPreferencesChange).toHaveBeenCalledWith('test-focus', expect.objectContaining({ targetTrackCount: 30, autoApply: false }))
    fireEvent.click(screen.getByRole('radio', { name: '立即播放首曲' }))
    expect(actions.onPreferencesChange).toHaveBeenCalledWith('test-focus', expect.objectContaining({ playbackApplyMode: 'play-first' }))
  })

  it('builds composer suggestions from the active track and session preferences', () => {
    renderSpace()
    expect(screen.getByRole('button', { name: '保留《Blue Static》，降低后续能量' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '调整为 20 首完整编排' })).toBeTruthy()
  })

  it('uses the local profile name and derives an activity timeline from conversation changes', () => {
    const active = {
      ...testSessions[0],
      messages: [
        { id: 'message-user-test', role: 'user' as const, content: '保留人声，后半段更轻一点', createdAt: Date.now() - 2_000 },
        { id: 'message-agent-test', role: 'assistant' as const, content: '已经形成新的编排提案。', createdAt: Date.now() - 1_000, change: { summary: '调整后半段能量', addedTrackIds: [5], removedTrackIds: [1], keptTrackIds: [2, 3], undoable: false, status: 'pending' as const } },
      ],
    }
    const actions = {
      onCreateSession: vi.fn(), onMemoriesChange: vi.fn(), onRenameSession: vi.fn(), onDeleteSession: vi.fn(), onSelectSession: vi.fn(), onTerminateSession: vi.fn(), onSubmit: vi.fn(), onPreferencesChange: vi.fn(), onApplyProposal: vi.fn(), onDismissProposal: vi.fn(), onUndo: vi.fn(), onPlayTrack: vi.fn(), onMoveTrack: vi.fn(), onReorderTrack: vi.fn(), onReorderTrackTo: vi.fn(), onRemoveTrack: vi.fn(), onArrangementZoomChange: vi.fn(), onOpenNowPlaying: vi.fn(),
    }
    render(<AgentSessionSpace sessions={[active]} memories={testMemories} userName="小林" activeSessionId={active.id} catalog={searchCatalog} activeTrackId={3} isPlaying={false} runningSessionIds={[]} agentMode="ai" navigationRequest={null} {...actions} />)
    expect(screen.getByText('小林')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '动态' }))
    expect(screen.getByText('提出新要求')).toBeTruthy()
    expect(screen.getByText('生成编排提案')).toBeTruthy()
    expect(screen.getAllByText('调整后半段能量').length).toBeGreaterThanOrEqual(1)
  })

  it('keeps provider reasoning collapsed after completion', () => {
    const active = {
      ...testSessions[0],
      messages: [{ id: 'reasoning-message', role: 'assistant' as const, content: '已形成新的音乐编排。', reasoning: ['识别本轮要求中的艺人和场景约束', '按能量曲线组织候选歌曲'], createdAt: Date.now() }],
    }
    renderSpace({ sessions: [active] })
    const summary = screen.getByText('编排依据').closest('details')!
    expect(summary.hasAttribute('open')).toBe(false)
    fireEvent.click(screen.getByText('编排依据'))
    expect(summary.hasAttribute('open')).toBe(true)
    expect(screen.getByText('按能量曲线组织候选歌曲')).toBeTruthy()
  })

  it('opens a requested arrangement view instead of the conversation view', () => {
    renderSpace({ navigationRequest: { key: 1, view: 'arrangement' } })
    expect(screen.getByText('高强度')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: '继续这次音乐会话' })).toBeNull()
  })

  it('requires an explicit decision for a pending proposal', () => {
    const proposalSession = {
      ...testSessions[0],
      messages: [...testSessions[0].messages, {
        id: 'proposal-message',
        role: 'assistant' as const,
        content: '已生成 12 首编排提案，确认后应用。',
        createdAt: 2,
        change: {
          summary: '编排 12 首歌曲',
          addedTrackIds: [4, 5, 6],
          removedTrackIds: [1],
          keptTrackIds: [2, 3],
          undoable: false,
          status: 'pending' as const,
          proposal: { queueTrackIds: [1, 2, 3, 4, 5, 6], trackLayout: [], targetIntensity: 60, targetNovelty: 50 },
        },
      }],
    }
    const actions = renderSpace({ sessions: [proposalSession, testSessions[1]] })
    expect(screen.getByText('待确认')).toBeTruthy()
    expect(document.querySelector('.change-selection-summary')?.textContent).toContain('已选 6 首')
    fireEvent.click(screen.getByRole('button', { name: '展开全部' }))
    expect(document.querySelectorAll('.change-track-strip > button')).toHaveLength(6)
    const firstProposalTrack = document.querySelector<HTMLButtonElement>('.change-track-strip > button')!
    expect(firstProposalTrack.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(firstProposalTrack)
    expect(firstProposalTrack.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: '应用编排' }))
    expect(actions.onApplyProposal).toHaveBeenCalledWith('proposal-message', [2, 3, 4, 5, 6])
    fireEvent.click(screen.getByRole('button', { name: '放弃' }))
    expect(actions.onDismissProposal).toHaveBeenCalledWith('proposal-message')
  })

  it('switches the same session between conversation and arrangement views', () => {
    renderSpace()
    fireEvent.click(screen.getByRole('button', { name: '编排' }))
    expect(screen.getByText('高强度')).toBeTruthy()
    expect(screen.getByRole('button', { name: /恢复默认大小/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '重新生成' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '对话' }))
    expect(screen.getByRole('textbox', { name: '继续这次音乐会话' })).toBeTruthy()
  })

  it('uses a direct editable play order on mobile instead of the desktop canvas', () => {
    const actions = renderSpace({ mobile: true })
    fireEvent.click(screen.getByRole('button', { name: '编排' }))
    expect(screen.getByRole('region', { name: '移动编排' })).toBeTruthy()
    expect(screen.queryByText('高强度')).toBeNull()
    expect(screen.queryByRole('button', { name: /恢复默认大小/ })).toBeNull()

    expect(screen.queryByRole('button', { name: '调整顺序' })).toBeNull()
    const dragHandle = screen.getByRole('button', { name: /拖动调整 Slow Satellites 的顺序/ })
    fireEvent.pointerDown(dragHandle, { pointerId: 1, clientY: 100 })
    fireEvent.pointerMove(dragHandle, { pointerId: 1, clientY: 170 })
    fireEvent.pointerUp(dragHandle, { pointerId: 1, clientY: 170 })
    expect(actions.onReorderTrackTo).toHaveBeenCalledWith(initialTracks[0].id, 1)

    const trackButton = screen.getByRole('button', { name: '播放 Slow Satellites' })
    const trackRow = trackButton.closest('.mobile-arrangement-track')!
    fireEvent.pointerDown(trackButton, { pointerId: 2, clientX: 90, clientY: 100 })
    expect(trackRow.classList.contains('is-swiping')).toBe(false)
    expect(trackRow.classList.contains('is-revealed')).toBe(false)
    expect(trackRow.querySelector('.mobile-arrangement-swipe-delete')).toBeNull()
    fireEvent.pointerUp(trackButton, { pointerId: 2, clientX: 90, clientY: 100 })

    fireEvent.pointerDown(trackButton, { pointerId: 2, clientX: 90, clientY: 100 })
    fireEvent.pointerMove(trackButton, { pointerId: 2, clientX: 20, clientY: 100 })
    fireEvent.pointerUp(trackButton, { pointerId: 2, clientX: 20, clientY: 100 })
    expect(trackRow.classList.contains('is-revealed')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '移除 Slow Satellites' }))
    expect(actions.onRemoveTrack).toHaveBeenCalledWith(initialTracks[0].id)
  })

  it('reveals mobile arrangement removal through the native touch path', () => {
    renderSpace({ mobile: true })
    fireEvent.click(screen.getByRole('button', { name: '编排' }))
    const trackButton = screen.getByRole('button', { name: '播放 Slow Satellites' })
    const trackRow = trackButton.closest('.mobile-arrangement-track')!

    fireEvent.touchStart(trackButton, { touches: [{ clientX: 100, clientY: 100 }] })
    fireEvent.touchMove(trackButton, { touches: [{ clientX: 24, clientY: 100 }] })
    fireEvent.touchEnd(trackButton, { changedTouches: [{ clientX: 24, clientY: 100 }] })

    expect(trackRow.classList.contains('is-revealed')).toBe(true)
    expect(screen.getByRole('button', { name: '移除 Slow Satellites' })).toBeTruthy()
  })

  it('collapses and restores both session context rails', () => {
    renderSpace()
    const workspace = document.querySelector('.agent-session-workspace')!
    fireEvent.click(screen.getByRole('button', { name: '收起会话栏' }))
    fireEvent.click(screen.getByRole('button', { name: '收起上下文栏' }))
    expect(workspace.classList.contains('is-rail-collapsed')).toBe(true)
    expect(workspace.classList.contains('is-inspector-collapsed')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '展开会话栏' }))
    fireEvent.click(screen.getByRole('button', { name: '展开上下文栏' }))
    expect(workspace.classList.contains('is-rail-collapsed')).toBe(false)
    expect(workspace.classList.contains('is-inspector-collapsed')).toBe(false)
  })

  it('supports manual arrangement actions and persists zoom changes', () => {
    const actions = renderSpace()
    fireEvent.click(screen.getByRole('button', { name: '编排' }))
    const track = screen.getByRole('button', { name: 'Slow Satellites, Mira Vale' })
    fireEvent.contextMenu(track)
    fireEvent.click(screen.getByRole('menuitem', { name: '后移一位' }))
    expect(actions.onReorderTrack).toHaveBeenCalledWith(initialTracks[0].id, 1)

    fireEvent.contextMenu(track)
    fireEvent.click(screen.getByRole('menuitem', { name: '移出当前编排' }))
    expect(actions.onRemoveTrack).toHaveBeenCalledWith(initialTracks[0].id)

    fireEvent.wheel(document.querySelector('.composition-area')!, { deltaY: -100 })
    expect(actions.onArrangementZoomChange).toHaveBeenCalledWith(testSessions[0].id, 108)
  })

  it('lets the user explicitly manage long-term memory', () => {
    const actions = renderSpace()
    fireEvent.click(screen.getByRole('button', { name: '管理长期记忆' }))
    expect(screen.getByRole('dialog', { name: '管理长期记忆' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: `停用 ${testMemories[0].title}` }))
    expect(actions.onMemoriesChange).toHaveBeenCalledWith([
      { ...testMemories[0], enabled: false },
      testMemories[1],
    ])

    fireEvent.change(screen.getByRole('textbox', { name: '添加一条记忆' }), { target: { value: '不要连续播放同一位艺人' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    expect(actions.onMemoriesChange).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ title: '不要连续播放同一位艺人', enabled: true, source: 'custom' }),
    ]))
  })

  it('renames a session from its management menu', () => {
    const actions = renderSpace()
    fireEvent.click(screen.getByRole('button', { name: '管理会话 深夜专注' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名会话' }))
    fireEvent.change(screen.getByRole('textbox', { name: '会话名称' }), { target: { value: '夜间写作' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    expect(actions.onRenameSession).toHaveBeenCalledWith(testSessions[0].id, '夜间写作')
  })

  it('requires confirmation before deleting a session', () => {
    const actions = renderSpace()
    fireEvent.click(screen.getByRole('button', { name: '管理会话 下班通勤' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除会话' }))
    expect(actions.onDeleteSession).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '删除会话' }))
    expect(actions.onDeleteSession).toHaveBeenCalledWith(testSessions[1].id)
  })

  it('allows the final session to be deleted and renders a new-session empty state', () => {
    const actions = renderSpace({ sessions: [testSessions[0]] })
    fireEvent.click(screen.getByRole('button', { name: '管理会话 深夜专注' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除会话' }))
    fireEvent.click(screen.getByRole('button', { name: '删除会话' }))
    expect(actions.onDeleteSession).toHaveBeenCalledWith(testSessions[0].id)
    cleanup()
    const emptyActions = renderSpace({ sessions: [] })
    expect(screen.getAllByText('创建音乐会话').length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByRole('button', { name: '新建会话' })[0])
    expect(emptyActions.onCreateSession).toHaveBeenCalled()
  })
})
