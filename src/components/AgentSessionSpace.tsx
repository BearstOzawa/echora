import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertCircle,
  ArrowUp,
  Brain,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  History,
  Cpu,
  ListMusic,
  Menu,
  MessageCircleMore,
  Mic,
  MoreHorizontal,
  PencilLine,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  Plus,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Waypoints,
  X,
} from 'lucide-react'
import { agentConstraintLimit, agentTargetTrackCountPresets, sortAgentSessions } from '../agentSessions'
import type { AgentPreferences, AgentSession } from '../agentSessions'
import { agentMemoryLimit, createAgentMemory } from '../agentMemories'
import type { AgentMemory } from '../agentMemories'
import type { Track } from '../types'
import type { ListeningAgentMode } from '../listeningAgent'
import { applyTrackLayout } from '../queueLayout'
import ContextMenu from './ContextMenu'
import type { ContextMenuItem } from './ContextMenu'
import useLongPress from '../useLongPress'
import FieldCanvas from './FieldCanvas'
import MobileArrangement from './MobileArrangement'
import ArtworkImage from './ArtworkImage'
import useSpeechInput from '../useSpeechInput'

type Props = {
  mobile?: boolean
  sessions: AgentSession[]
  memories: AgentMemory[]
  userName?: string
  activeSessionId: string
  catalog: Track[]
  activeTrackId: number
  isPlaying: boolean
  runningSessionIds: string[]
  agentMode: ListeningAgentMode
  agentServiceMode?: 'unconfigured' | 'echora' | 'custom'
  navigationRequest: AgentNavigationRequest | null
  onCreateSession: () => void
  onMemoriesChange: (memories: AgentMemory[]) => void
  onRenameSession: (id: string, title: string) => void
  onDeleteSession: (id: string) => void
  onSelectSession: (id: string) => void
  onTerminateSession: (id: string) => void
  onSubmit: (message: string) => void
  onPreferencesChange: (sessionId: string, preferences: AgentPreferences) => void
  onApplyProposal: (messageId: string, selectedTrackIds: number[]) => void
  onDismissProposal: (messageId: string) => void
  onUndo: () => void
  onPlayTrack: (id: number) => void
  onMoveTrack: (id: number, x: number, y: number) => void
  onReorderTrack: (id: number, direction: -1 | 1) => void
  onReorderTrackTo: (id: number, targetIndex: number) => void
  onRemoveTrack: (id: number) => void
  onArrangementZoomChange: (sessionId: string, zoom: number) => void
  onOpenNowPlaying: (id: number) => void
  onConfigureAi?: () => void
}

export type AgentNavigationRequest = { key: number; view: 'conversation' | 'arrangement' }

type SessionActivityItem = {
  id: string
  kind: 'request' | 'proposal' | 'applied' | 'dismissed' | 'agent' | 'failed'
  title: string
  detail: string
  status: string
  createdAt: number
}

const contextualSuggestions = ({ session, tracks, activeTrack, intensity, novelty, memories }: {
  session: AgentSession
  tracks: Track[]
  activeTrack?: Track
  intensity: number
  novelty: number
  memories: AgentMemory[]
}) => {
  const latestUserMessage = [...session.messages].reverse().find((message) => message.role === 'user')?.content
    .trim()
    .replace(/[。！？!?]+$/g, '')
  const recentTopic = latestUserMessage
    ? latestUserMessage.length > 16 ? `${latestUserMessage.slice(0, 16)}…` : latestUserMessage
    : ''
  if (!tracks.length) {
    const remembered = memories.find((memory) => memory.enabled)
    return [
      recentTopic ? `延续「${recentTopic}」扩展候选` : remembered ? `按「${remembered.title}」建立编排` : '生成一份适合当前时段的新歌编排',
      /通勤|开车|地铁/.test(latestUserMessage ?? '') ? '保持通勤节奏，并减少近期重复' : '生成一份能量渐进的编排',
      /轻|安静|舒缓|低干扰/.test(latestUserMessage ?? '') ? '保持平缓听感，并扩展相邻风格' : '以轻松人声作品作为开场',
      `生成 ${session.preferences.targetTrackCount} 首编排提案`,
    ]
  }

  const pendingProposal = [...session.messages].reverse().find((message) => message.change?.status === 'pending')
  const artists = tracks.map((track) => track.artist)
  const hasRepeatedArtist = new Set(artists).size < artists.length
  const latestConstraint = session.constraints.at(1)
  const result = [
    pendingProposal
      ? recentTopic ? `按「${recentTopic}」调整当前提案` : '缩减提案并强化主题主线'
      : recentTopic ? `延续「${recentTopic}」优化衔接` : activeTrack ? `保留《${activeTrack.title}》，降低后续能量` : '保留当前编排，降低后续能量',
    activeTrack ? `保留《${activeTrack.title}》，降低后续能量` : latestConstraint ? `继续遵守「${latestConstraint}」` : '',
    intensity >= 65 ? '让后半段逐步收束' : '让后半段逐步提升能量',
    hasRepeatedArtist ? '减少同一艺人的连续出现' : `调整为 ${session.preferences.targetTrackCount} 首完整编排`,
    novelty >= 65 ? '提高熟悉作品的占比' : '提高新作品的探索比例',
  ]
  return Array.from(new Set(result.filter(Boolean))).slice(0, 4)
}

const relativeTime = (timestamp: number) => {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

export default function AgentSessionSpace({
  mobile = false,
  sessions,
  memories,
  userName = '访客',
  activeSessionId,
  catalog,
  activeTrackId,
  isPlaying,
  runningSessionIds = [],
  agentMode,
  agentServiceMode = agentMode === 'ai' ? 'echora' : 'unconfigured',
  navigationRequest,
  onCreateSession,
  onMemoriesChange,
  onRenameSession,
  onDeleteSession,
  onSelectSession,
  onTerminateSession,
  onSubmit,
  onPreferencesChange,
  onApplyProposal,
  onDismissProposal,
  onUndo,
  onPlayTrack,
  onMoveTrack,
  onReorderTrack,
  onReorderTrackTo,
  onRemoveTrack,
  onArrangementZoomChange,
  onOpenNowPlaying,
  onConfigureAi,
}: Props) {
  const [view, setView] = useState<'conversation' | 'arrangement'>('conversation')
  const [sideView, setSideView] = useState<'state' | 'activity'>('state')
  const [input, setInput] = useState('')
  const speech = useSpeechInput(setInput)
  const [memoryManagerOpen, setMemoryManagerOpen] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [memoryDraft, setMemoryDraft] = useState('')
  const [sessionMenu, setSessionMenu] = useState<{ session: AgentSession; x: number; y: number } | null>(null)
  const [sessionEditor, setSessionEditor] = useState<{ mode: 'rename' | 'delete'; session: AgentSession } | null>(null)
  const [sessionTitleDraft, setSessionTitleDraft] = useState('')
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
  const [expandedProposals, setExpandedProposals] = useState<Record<string, boolean>>({})
  const [proposalSelections, setProposalSelections] = useState<Record<string, number[]>>({})
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(false)
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false)
  const [composerCollapsed, setComposerCollapsed] = useState(false)
  const conversationRef = useRef<HTMLDivElement>(null)
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0]
  const orderedSessions = sortAgentSessions(sessions)
  const isThinking = Boolean(activeSession && runningSessionIds.includes(activeSession.id))
  const activityItems = useMemo<SessionActivityItem[]>(() => {
    if (!activeSession) return []
    return activeSession.messages.flatMap<SessionActivityItem>((message) => {
      if (message.id.includes('welcome')) return []
      if (message.role === 'user') return [{
        id: `activity-${message.id}`,
        kind: 'request' as const,
        title: '提出新要求',
        detail: message.content,
        status: '已接收',
        createdAt: message.createdAt,
      }]
      if (message.change) {
        const status = message.change.status ?? 'applied'
        return [{
          id: `activity-${message.id}`,
          kind: status === 'pending' ? 'proposal' as const : status === 'dismissed' ? 'dismissed' as const : 'applied' as const,
          title: status === 'pending' ? '生成编排提案' : status === 'dismissed' ? '放弃编排提案' : '应用编排版本',
          detail: message.change.summary,
          status: status === 'pending' ? '待确认' : status === 'dismissed' ? '已放弃' : '已应用',
          createdAt: message.createdAt,
        }]
      }
      const failed = /没有完成|失败|无法|已停止/.test(message.content)
      return [{
        id: `activity-${message.id}`,
        kind: failed ? 'failed' as const : 'agent' as const,
        title: failed ? '回合未完成' : 'Agent 更新',
        detail: message.content,
        status: failed ? '未更改编排' : '已完成',
        createdAt: message.createdAt,
      }]
    }).sort((left, right) => right.createdAt - left.createdAt).slice(0, 18)
  }, [activeSession])

  useEffect(() => {
    if (navigationRequest) setView(navigationRequest.view)
  }, [navigationRequest?.key, navigationRequest?.view])

  useEffect(() => {
    setPreferencesOpen(false)
    setInput('')
    setSuggestionsExpanded(false)
    setSessionDrawerOpen(false)
  }, [activeSessionId])

  useEffect(() => {
    if (view !== 'conversation') return
    const stream = conversationRef.current
    if (!stream) return
    if (mobile) {
      const scrollToBottom = () => {
        if (typeof stream.scrollTo === 'function') stream.scrollTo({ top: stream.scrollHeight, behavior: isThinking ? 'smooth' : 'auto' })
        else stream.scrollTop = stream.scrollHeight
      }
      const frame = window.requestAnimationFrame(scrollToBottom)
      return () => window.cancelAnimationFrame(frame)
    }
    const latestTurn = stream.querySelector<HTMLElement>('.conversation-turn:last-of-type')
    const targetTop = latestTurn ? Math.max(0, latestTurn.offsetTop - 12) : 0
    if (typeof stream.scrollTo === 'function') stream.scrollTo({ top: targetTop, behavior: isThinking ? 'smooth' : 'auto' })
    else stream.scrollTop = targetTop
  }, [activeSessionId, activeSession?.messages.length, isThinking, mobile, view])

  useEffect(() => {
    if (!memoryManagerOpen && !preferencesOpen && !sessionEditor) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMemoryManagerOpen(false)
      setPreferencesOpen(false)
      setSessionEditor(null)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [memoryManagerOpen, preferencesOpen, sessionEditor])

  const sessionLongPress = useLongPress<HTMLElement>(({ clientX, clientY, currentTarget }) => {
    const session = sessions.find((item) => item.id === currentTarget.dataset.sessionId)
    if (session) setSessionMenu({ session, x: clientX, y: clientY })
  })

  if (!activeSession) {
    return (
      <section className="agent-session-workspace is-empty">
        <header className="workspace-pane-header workspace-pane-rail agent-rail-header"><span><strong>会话</strong></span><button onClick={onCreateSession} title="新建会话" aria-label="新建会话"><Plus size={17} /></button></header>
        <header className="workspace-pane-header workspace-pane-main agent-main-header"><div className="workspace-pane-title"><span><small>AI 音乐场</small><strong>创建音乐会话</strong></span></div></header>
        <aside className="session-rail"><div className="session-list session-list-empty"><MessageCircleMore size={20} /><span>还没有会话</span></div></aside>
        <main className="session-main"><div className="agent-empty-state"><span><Sparkles size={24} /></span><strong>创建音乐会话</strong><p>每个会话独立保存目标、约束、对话与编排版本。</p><button onClick={onCreateSession}><Plus size={16} /> 新建会话</button></div></main>
      </section>
    )
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const message = input.trim()
    if (!message || isThinking) return
    speech.reset()
    onSubmit(message)
    setInput('')
  }

  const sessionTracks = applyTrackLayout(
    activeSession.queueTrackIds
      .map((id) => catalog.find((track) => track.id === id))
      .filter((track): track is Track => Boolean(track)),
    activeSession.trackLayout,
    activeSession.intensity,
    activeSession.novelty,
  )
  const queueDurationMinutes = sessionTracks.length ? Math.max(1, Math.round(sessionTracks.reduce((total, track) => total + track.durationSeconds, 0) / 60)) : 0
  const enabledMemories = memories.filter((memory) => memory.enabled)
  const activeTrack = sessionTracks.find((track) => track.id === activeTrackId)
  const suggestions = contextualSuggestions({ session: activeSession, tracks: sessionTracks, activeTrack, intensity: activeSession.intensity, novelty: activeSession.novelty, memories })
  const updatePreferences = (patch: Partial<AgentPreferences>) => onPreferencesChange(activeSession.id, { ...activeSession.preferences, ...patch })
  const addMemory = (event: FormEvent) => {
    event.preventDefault()
    const title = memoryDraft.trim()
    if (!title || memories.length >= agentMemoryLimit) return
    onMemoriesChange([...memories, createAgentMemory(title)])
    setMemoryDraft('')
  }

  const toggleMemory = (id: string) => onMemoriesChange(memories.map((memory) => memory.id === id ? { ...memory, enabled: !memory.enabled } : memory))
  const removeMemory = (id: string) => onMemoriesChange(memories.filter((memory) => memory.id !== id))

  const openSessionEditor = (mode: 'rename' | 'delete', session: AgentSession) => {
    setSessionTitleDraft(session.title)
    setSessionEditor({ mode, session })
  }

  const sessionMenuItems = (session: AgentSession): ContextMenuItem[] => {
    return [
      { label: '重命名会话', icon: PencilLine, onSelect: () => openSessionEditor('rename', session) },
      { label: '删除会话', icon: Trash2, danger: true, onSelect: () => openSessionEditor('delete', session) },
    ]
  }

  const openSessionMenu = (session: AgentSession, x: number, y: number) => setSessionMenu({ session, x, y })

  const submitSessionEditor = (event: FormEvent) => {
    event.preventDefault()
    if (!sessionEditor) return
    if (sessionEditor.mode === 'rename') {
      const title = sessionTitleDraft.trim()
      if (!title) return
      onRenameSession(sessionEditor.session.id, title)
    } else {
      onDeleteSession(sessionEditor.session.id)
    }
    setSessionEditor(null)
  }

  return (
    <section className={`agent-session-workspace ${mobile ? 'is-mobile-agent' : ''} ${sessionDrawerOpen ? 'is-session-drawer-open' : ''} ${railCollapsed ? 'is-rail-collapsed' : ''} ${inspectorCollapsed ? 'is-inspector-collapsed' : ''}`}>
      <header className="workspace-pane-header workspace-pane-rail agent-rail-header">
        <span><strong>会话</strong></span>
        <div className="agent-pane-actions">
          {!railCollapsed && <button onClick={onCreateSession} title="新建会话" aria-label="新建会话"><Plus size={17} /></button>}
          <button onClick={() => setRailCollapsed((collapsed) => !collapsed)} title={railCollapsed ? '展开会话栏' : '收起会话栏'} aria-label={railCollapsed ? '展开会话栏' : '收起会话栏'}>{railCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>
        </div>
      </header>

      <header className="workspace-pane-header workspace-pane-main agent-main-header">
        {mobile && <button className="mobile-session-menu" onClick={() => setSessionDrawerOpen(true)} aria-label="打开会话列表"><Menu size={20} /></button>}
        <div className="workspace-pane-title">
          <span><small>{isThinking ? (agentMode === 'ai' ? 'AI 正在编排' : '本地策略正在编排') : (agentMode === 'ai' ? 'AI Agent 会话' : '本地策略会话')}</small><strong>{activeSession.title}</strong></span>
          <em>{sessionTracks.length} 首</em>
        </div>
        <div className="agent-mobile-header-actions"><nav className="session-view-switch" aria-label="会话视图">
          <button className={view === 'conversation' ? 'is-active' : ''} onClick={() => setView('conversation')}>{!mobile && <MessageCircleMore size={16} />} 对话</button>
          <button className={view === 'arrangement' ? 'is-active' : ''} onClick={() => setView('arrangement')}>{!mobile && <Waypoints size={16} />} 编排</button>
        </nav></div>
      </header>

      <header className="workspace-pane-header workspace-pane-inspector agent-inspector-header">
        <span><strong>上下文</strong><small>目标、约束与当前编排</small></span>
        <button onClick={() => setInspectorCollapsed((collapsed) => !collapsed)} title={inspectorCollapsed ? '展开上下文栏' : '收起上下文栏'} aria-label={inspectorCollapsed ? '展开上下文栏' : '收起上下文栏'}>{inspectorCollapsed ? <PanelRightOpen size={17} /> : <PanelRightClose size={17} />}</button>
      </header>

      <aside className="session-rail">
        {mobile && <header className="mobile-session-drawer-header"><span><strong>音乐会话</strong><small>按最近使用排序</small></span><div><button onClick={onCreateSession} aria-label="新建音乐会话"><Plus size={19} /></button><button onClick={() => setSessionDrawerOpen(false)} aria-label="关闭会话列表"><X size={19} /></button></div></header>}
        <div className="session-list" aria-label="音乐会话">
          {orderedSessions.map((session) => (
            <div key={session.id} className={`session-item supports-long-press ${session.id === activeSession.id ? 'is-active' : ''}`} data-session-id={session.id} {...sessionLongPress} onContextMenu={(event) => {
              event.preventDefault()
              openSessionMenu(session, event.clientX, event.clientY)
            }}>
              <button className="session-select" onClick={() => { onSelectSession(session.id); setSessionDrawerOpen(false) }}>
                <i className={runningSessionIds.includes(session.id) || session.status === 'active' ? 'is-live' : ''} />
                <span><strong>{session.title}</strong><small>{session.summary}</small></span>
                <time>{runningSessionIds.includes(session.id) ? '生成中' : session.id === activeSession.id ? '现在' : relativeTime(session.updatedAt)}</time>
              </button>
              <button className="session-more" onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect()
                openSessionMenu(session, bounds.right - 8, bounds.bottom + 5)
              }} title="管理会话" aria-label={`管理会话 ${session.title}`}><MoreHorizontal size={17} /></button>
            </div>
          ))}
        </div>

        <div className="session-memory">
          <span className="session-section-label">长期记忆</span>
          {enabledMemories.slice(0, 2).map((memory) => (
            <div key={memory.id}>{memory.source === 'learned' ? <Brain size={15} /> : <Pin size={15} />}<span><strong>{memory.title}</strong><small>{memory.detail}</small></span></div>
          ))}
          {!enabledMemories.length && <p className="memory-preview-empty">暂未启用长期记忆</p>}
          <button onClick={() => setMemoryManagerOpen(true)}><MoreHorizontal size={16} /> 管理长期记忆</button>
        </div>
      </aside>
      {mobile && sessionDrawerOpen && <button className="mobile-session-drawer-backdrop" onClick={() => setSessionDrawerOpen(false)} aria-label="关闭会话抽屉" />}

      <main className="session-main">
        {view === 'conversation' ? (
          <div className="conversation-view">
            <div className={`conversation-stream ${activeSession.messages.some((message) => message.role === 'user') ? 'has-user-turns' : 'is-pristine'}`} ref={conversationRef}>
              <div className="conversation-intro selectable-copy">
                <span>本次目标</span>
                <h1>{activeSession.goal}</h1>
                <p>本会话持续继承当前编排、固定条件与反馈。</p>
              </div>

              {activeSession.messages.map((message, index) => {
                const proposalIds = message.change?.proposal?.queueTrackIds ?? (message.change ? [...message.change.addedTrackIds, ...message.change.keptTrackIds] : [])
                const proposalSnapshots = new Map((message.change?.proposal?.tracks ?? []).map((track) => [track.id, track]))
                const proposalTracks = proposalIds.map((id) => catalog.find((track) => track.id === id) ?? proposalSnapshots.get(id)).filter((track): track is Track => Boolean(track))
                const changeStatus = message.change?.status ?? 'applied'
                const proposalExpanded = Boolean(expandedProposals[message.id])
                const previewTracks = proposalExpanded ? proposalTracks : proposalTracks.slice(0, 4)
                const selectedIds = proposalSelections[message.id] ?? proposalIds
                const selectedSet = new Set(selectedIds)
                const canUndo = message.role === 'assistant' && changeStatus === 'applied' && message.change?.undoable && index === activeSession.messages.length - 1 && activeSession.previousQueueTrackIds
                return (
                  <article className={`conversation-turn is-${message.role} selectable-copy`} key={message.id}>
                    <header>
                      <span>{message.role === 'assistant' ? <Sparkles size={16} /> : userName.slice(0, 1).toLocaleUpperCase()}</span>
                      <strong>{message.role === 'assistant' ? 'Echora' : userName}</strong>
                      <time>{relativeTime(message.createdAt)}</time>
                    </header>
                    {message.role === 'assistant' && message.reasoning?.length ? <details className="agent-reasoning-summary"><summary><Brain size={14} /><span>编排依据</span><small>{message.reasoning.length} 项判断</small><ChevronDown size={14} /></summary><div>{message.reasoning.map((item, reasoningIndex) => <p key={item}><i>{reasoningIndex + 1}</i><span>{item}</span></p>)}</div></details> : null}
                    <p>{message.content}</p>
                    {message.change && (
                      <div className={`agent-change-set is-${changeStatus}`}>
                        <header><span><Waypoints size={16} /><strong>{message.change.summary}</strong></span><small>{changeStatus === 'pending' ? '待确认' : changeStatus === 'dismissed' ? '已放弃' : '已应用'}</small></header>
                        {proposalTracks.length > 0 && (
                          <div className="change-track-toolbar">
                            <span className={changeStatus === 'pending' ? 'change-selection-summary' : ''}>{changeStatus === 'pending' ? <><i><Check size={12} /></i><strong>已选 {selectedIds.length} 首</strong><small>/ {proposalTracks.length}</small></> : `${proposalTracks.length} 首歌曲`}</span>
                            <span>
                              {changeStatus === 'pending' && <button onClick={() => setProposalSelections((current) => ({ ...current, [message.id]: selectedIds.length === proposalIds.length ? [] : proposalIds }))}>{selectedIds.length === proposalIds.length ? <><X size={13} /> 取消全选</> : <><Check size={13} /> 全选</>}</button>}
                              {proposalTracks.length > 4 && <button onClick={() => setExpandedProposals((current) => ({ ...current, [message.id]: !proposalExpanded }))}>{proposalExpanded ? <><ChevronUp size={14} /> 收起</> : <><ChevronDown size={14} /> 展开全部</>}</button>}
                            </span>
                          </div>
                        )}
                        {previewTracks.length > 0 && (
                          <div className={`change-track-strip ${proposalExpanded ? 'is-expanded' : ''}`}>
                            {previewTracks.map((track) => <button key={track.id} className={selectedSet.has(track.id) ? 'is-selected' : ''} disabled={changeStatus === 'dismissed'} aria-pressed={changeStatus === 'pending' ? selectedSet.has(track.id) : undefined} onClick={() => {
                              if (changeStatus === 'applied') {
                                onPlayTrack(track.id)
                                return
                              }
                              if (changeStatus !== 'pending') return
                              setProposalSelections((current) => ({
                                ...current,
                                [message.id]: selectedSet.has(track.id) ? selectedIds.filter((id) => id !== track.id) : [...selectedIds, track.id],
                              }))
                            }}>
                              <ArtworkImage src={track.cover} alt="" /><span><strong>{track.title}</strong><small>{track.artist}</small></span>
                              {changeStatus === 'pending' && <i className="proposal-track-check">{selectedSet.has(track.id) && <Check size={10} />}</i>}
                            </button>)}
                          </div>
                        )}
                        <footer>
                          <span>{changeStatus === 'pending' ? `应用后使用 ${selectedIds.length} 首` : message.change.addedTrackIds.length ? `新增 ${message.change.addedTrackIds.length} 首` : '未新增歌曲'} · {message.change.removedTrackIds.length ? `移除 ${message.change.removedTrackIds.length} 首` : '保留当前队列'}</span>
                          <span className="change-actions">
                            {changeStatus === 'pending' && <button onClick={() => onDismissProposal(message.id)}>放弃</button>}
                            {changeStatus === 'pending' && <button className="is-primary" disabled={!selectedIds.length} onClick={() => onApplyProposal(message.id, selectedIds)}><Check size={14} /> 应用编排</button>}
                            {canUndo && <button onClick={onUndo}><RotateCcw size={14} /> 撤销本次调整</button>}
                          </span>
                        </footer>
                      </div>
                    )}
                  </article>
                )
              })}

              {isThinking && (
                <article className="conversation-turn is-assistant is-running selectable-copy">
                  <header><span><Activity size={16} /></span><strong>Echora</strong><time>正在编排</time></header>
                  <div className="agent-thinking-card">
                    <div className="agent-thinking-heading"><span><i /><strong>{activeSession.runs.find((run) => run.status === 'running')?.label ?? '正在思考'}</strong></span><button onClick={() => onTerminateSession(activeSession.id)}><Square size={12} fill="currentColor" /> 停止</button></div>
                    <p>{activeSession.runs.find((run) => run.status === 'running')?.detail ?? `正在结合 ${enabledMemories.length} 条长期记忆`}</p>
                    <div className="agent-thinking-steps"><span className="is-complete">读取约束</span><span className={/检索|整理|组织/.test(activeSession.runs.find((run) => run.status === 'running')?.label ?? '') ? 'is-complete' : 'is-active'}>检索候选</span><span className={/组织/.test(activeSession.runs.find((run) => run.status === 'running')?.label ?? '') ? 'is-active' : ''}>组织顺序</span></div>
                  </div>
                </article>
              )}
            </div>

            <div className={`conversation-composer-area ${mobile && composerCollapsed ? 'is-collapsed' : ''}`}>
              {mobile && composerCollapsed ? (
                <button className="composer-expand-bar" onClick={() => {
                  setComposerCollapsed(false)
                }} aria-label="展开输入框"><MessageCircleMore size={17} /><span>{input.trim() || '继续这次音乐会话'}</span><ChevronUp size={17} /></button>
              ) : <>
                <div className={`composer-suggestions ${suggestionsExpanded ? 'is-expanded' : ''}`}>
                  {suggestions.map((suggestion, index) => <button className={index > 0 ? 'is-extra' : ''} key={suggestion} onClick={() => setInput(suggestion)}>{suggestion}</button>)}
                  {suggestions.length > 1 && <button className="composer-suggestions-toggle" onClick={() => setSuggestionsExpanded((expanded) => !expanded)} aria-expanded={suggestionsExpanded}>{suggestionsExpanded ? <><ChevronUp size={13} /> 收起</> : <><ChevronDown size={13} /> 更多建议</>}</button>}
                </div>
                <form className="conversation-composer" onSubmit={submit}>
                  <textarea ref={composerInputRef} name="agent-message" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      event.currentTarget.form?.requestSubmit()
                    }
                  }} placeholder="描述下一步，例如：保留这首，后续降低能量" aria-label="继续这次音乐会话" rows={2} />
                  {mobile && <button type="button" className="composer-collapse-toggle" onClick={() => {
                    setSuggestionsExpanded(false)
                    setComposerCollapsed(true)
                  }} title="收起输入框" aria-label="收起输入框"><ChevronDown size={16} /></button>}
                  <footer className="conversation-composer-meta">
                    <span className="composer-context"><b>{agentMode === 'ai' ? 'AI Agent' : '本地策略'}</b> · 继承 {activeSession.messages.filter((message) => message.role === 'user').length} 轮上下文</span>
                    <span className="composer-meta-actions">
                      {speech.message && <span className={`composer-inline-speech is-${speech.status}`} role="status"><Mic size={12} /><span>{speech.message}</span></span>}
                      <button type="button" className="composer-preferences" onClick={() => setPreferencesOpen(true)} aria-label="会话偏好"><SlidersHorizontal size={13} /><span className="composer-preferences-label">{mobile ? `偏好 · ${activeSession.preferences.targetTrackCount} 首` : `偏好 · ${activeSession.preferences.targetTrackCount} 首 · ${activeSession.preferences.autoApply ? '自动应用' : '确认后应用'}`}</span></button>
                      <AgentModeControl mode={agentServiceMode} onConfigure={onConfigureAi} />
                    </span>
                  </footer>
                  <button type="button" className={`composer-voice ${speech.listening ? 'is-listening' : ''} ${speech.requesting ? 'is-requesting' : ''}`} disabled={!speech.supported || speech.requesting} onClick={() => speech.listening ? speech.stop() : void speech.start(input)} title={speech.supported ? (speech.requesting ? '等待麦克风授权' : speech.listening ? '正在听，点击结束' : '语音输入') : '当前环境暂不支持语音识别'} aria-label={speech.requesting ? '等待麦克风授权' : speech.listening ? '正在听，点击结束' : '语音输入'} aria-pressed={speech.listening}><Mic size={14} /></button>
                  {isThinking
                    ? <button type="button" className="composer-submit is-stop" onClick={() => onTerminateSession(activeSession.id)} title="停止生成" aria-label="停止生成"><Square size={14} fill="currentColor" /></button>
                    : <button className="composer-submit" disabled={!input.trim()} title="发送" aria-label="发送"><ArrowUp size={18} /></button>}
                </form>
              </>}
            </div>
          </div>
        ) : (
          <div className="agent-arrangement-view">
            {mobile ? <MobileArrangement
              tracks={sessionTracks}
              activeTrackId={activeTrackId}
              isPlaying={isPlaying}
              durationMinutes={queueDurationMinutes}
              onPlayTrack={onPlayTrack}
              onReorderTrack={onReorderTrack}
              onReorderTrackTo={onReorderTrackTo}
              onRemoveTrack={onRemoveTrack}
            /> : <FieldCanvas
              embedded
              tracks={sessionTracks}
              activeTrackId={activeTrackId}
              isPlaying={isPlaying}
              onPlayTrack={onPlayTrack}
              onMoveTrack={onMoveTrack}
              onReorderTrack={onReorderTrack}
              onReorderTrackTo={onReorderTrackTo}
              onRemoveTrack={onRemoveTrack}
              onOpenNowPlaying={onOpenNowPlaying}
              initialZoom={activeSession.arrangementZoom ?? 100}
              onZoomChange={(zoom) => onArrangementZoomChange(activeSession.id, zoom)}
              title={activeSession.title}
              durationMinutes={queueDurationMinutes}
              commandBar={null}
            />}
          </div>
        )}
      </main>

      <aside className="session-inspector" aria-label="会话状态">
        <nav className="inspector-tabs" aria-label="会话状态视图">
          <button className={sideView === 'state' ? 'is-active' : ''} onClick={() => setSideView('state')}><ListMusic size={15} /> 状态</button>
          <button className={sideView === 'activity' ? 'is-active' : ''} onClick={() => setSideView('activity')}><History size={15} /> 动态</button>
        </nav>

        {sideView === 'state' ? (
          <div className="inspector-content">
            <section className="inspector-goal selectable-copy">
              <span className="session-section-label">当前目标</span>
              <p>{activeSession.goal}</p>
            </section>
            <section className="inspector-constraints selectable-copy">
              <header><span className="session-section-label">已固定条件</span><small>{activeSession.constraints.length} / {agentConstraintLimit}</small></header>
              <div className="inspector-constraint-list">
              {activeSession.constraints.map((constraint) => <div key={constraint}><Pin size={13} /><span>{constraint}</span></div>)}
              </div>
            </section>
            <section className="inspector-queue">
              <header><span className="session-section-label">当前编排</span><small>{sessionTracks.length} 首 · 约 {queueDurationMinutes} 分钟</small></header>
              {sessionTracks.slice(0, 5).map((track, index) => (
                <button key={track.id} className={track.id === activeTrackId ? 'is-active' : ''} onClick={() => onPlayTrack(track.id)}>
                  <span>{track.id === activeTrackId ? <span className={`mini-levels ${isPlaying ? 'is-playing' : ''}`} aria-hidden="true"><i /><i /><i /></span> : String(index + 1).padStart(2, '0')}</span>
                  <ArtworkImage src={track.cover} alt="" />
                  <span><strong>{track.title}</strong><small>{track.artist} · {track.duration}{track.bpm > 0 ? ` · ${track.bpm} BPM` : ''}</small></span>
                </button>
              ))}
              <button className="open-arrangement" onClick={() => setView('arrangement')}><Waypoints size={15} /> 查看完整编排</button>
            </section>
          </div>
        ) : (
          <div className="inspector-content inspector-activity selectable-copy">
            <section className="activity-overview">
              <span><strong>{activeSession.messages.filter((message) => message.role === 'user').length}</strong><small>轮对话</small></span>
              <span><strong>{activeSession.messages.filter((message) => message.change).length}</strong><small>个编排版本</small></span>
              <span><strong>{activityItems.length ? relativeTime(activityItems[0].createdAt) : '暂无'}</strong><small>最近活动</small></span>
            </section>
            <div className="activity-heading"><span className="session-section-label">会话时间线</span><small>最近 {activityItems.length} 条</small></div>
            <div className="activity-timeline">
              {isThinking && <div className="activity-row is-running"><i><Activity size={12} /></i><span><header><strong>Agent 正在编排</strong><em>进行中</em></header><small>读取会话上下文、固定条件与长期记忆</small><time>现在</time></span></div>}
              {activityItems.map((item) => <div key={item.id} className={`activity-row is-${item.kind}`}>
                <i>{item.kind === 'request' ? <MessageCircleMore size={12} /> : item.kind === 'failed' ? <AlertCircle size={12} /> : item.kind === 'dismissed' ? <X size={12} /> : item.kind === 'applied' ? <Check size={12} /> : <Waypoints size={12} />}</i>
                <span><header><strong>{item.title}</strong><em>{item.status}</em></header><small>{item.detail}</small><time>{relativeTime(item.createdAt)}</time></span>
              </div>)}
            </div>
            {!activityItems.length && !isThinking && <p className="empty-runs">发送第一条要求后，这次会话的关键变化会记录在这里。</p>}
          </div>
        )}
      </aside>

      {sessionMenu && <ContextMenu x={sessionMenu.x} y={sessionMenu.y} items={sessionMenuItems(sessionMenu.session)} onClose={() => setSessionMenu(null)} />}

      {sessionEditor && (
        <div className="session-editor-backdrop" onPointerDown={() => setSessionEditor(null)}>
          <form className="session-editor" role="dialog" aria-label={sessionEditor.mode === 'rename' ? '重命名会话' : '删除会话'} onSubmit={submitSessionEditor} onPointerDown={(event) => event.stopPropagation()}>
            <header>
              <span>{sessionEditor.mode === 'rename' ? <PencilLine size={19} /> : <Trash2 size={19} />}</span>
              <div><strong>{sessionEditor.mode === 'rename' ? '重命名会话' : '删除会话'}</strong><small>{sessionEditor.session.title}</small></div>
              <button type="button" onClick={() => setSessionEditor(null)} title="关闭" aria-label="关闭会话管理"><X size={18} /></button>
            </header>
            {sessionEditor.mode === 'rename' ? (
              <label><span>会话名称</span><input name="session-title" autoFocus value={sessionTitleDraft} maxLength={32} onChange={(event) => setSessionTitleDraft(event.target.value)} aria-label="会话名称" /><small>{sessionTitleDraft.trim().length}/32</small></label>
            ) : (
              <div className="session-delete-warning"><strong>删除这次会话？</strong><p>对话、固定条件和编排记录将从本机移除，且无法恢复。</p></div>
            )}
            <footer>
              <button type="button" onClick={() => setSessionEditor(null)}>取消</button>
              <button className={sessionEditor.mode === 'delete' ? 'is-danger' : 'is-primary'} disabled={sessionEditor.mode === 'rename' && !sessionTitleDraft.trim()}>{sessionEditor.mode === 'rename' ? '保存修改' : '删除会话'}</button>
            </footer>
          </form>
        </div>
      )}

      {preferencesOpen && (
        <div className="agent-preferences-backdrop" onPointerDown={() => setPreferencesOpen(false)}>
          <section className="agent-preferences-panel" role="dialog" aria-label="会话偏好" onPointerDown={(event) => event.stopPropagation()}>
            <header>
              <span><SlidersHorizontal size={19} /></span>
              <div><strong>会话偏好</strong><small>只影响“{activeSession.title}”</small></div>
              {mobile && <button className="agent-preferences-mobile-done" onClick={() => setPreferencesOpen(false)}>完成</button>}
              <button onClick={() => setPreferencesOpen(false)} title="关闭" aria-label="关闭会话偏好"><X size={18} /></button>
            </header>
            <div className="agent-preferences-content">
              <section className="preference-apply-mode">
                <span><strong>生成结果</strong><small>{activeSession.preferences.autoApply ? '完成后按播放策略应用' : '生成提案，确认后应用'}</small></span>
                <button className={`settings-toggle ${activeSession.preferences.autoApply ? 'is-on' : ''}`} onClick={() => updatePreferences({ autoApply: !activeSession.preferences.autoApply })} aria-label="自动应用生成结果" aria-pressed={activeSession.preferences.autoApply}><i /></button>
              </section>
              <section className="preference-track-count">
                <span><strong>目标歌曲数</strong><small>Agent 会按这个规模检索并组织歌曲</small></span>
                <div aria-label="目标歌曲数">
                  {agentTargetTrackCountPresets.map((count) => <button key={count} className={activeSession.preferences.targetTrackCount === count ? 'is-active' : ''} onClick={() => updatePreferences({ targetTrackCount: count })} aria-label={`${count} 首`}>{count}</button>)}
                </div>
              </section>
              <section className="preference-playback-mode">
                <span><strong>应用后的播放</strong><small>确认或自动应用编排时，如何处理正在播放的歌曲</small></span>
                <div role="radiogroup" aria-label="应用后的播放方式">
                  <button role="radio" aria-checked={activeSession.preferences.playbackApplyMode === 'continue-current'} className={activeSession.preferences.playbackApplyMode === 'continue-current' ? 'is-active' : ''} onClick={() => updatePreferences({ playbackApplyMode: 'continue-current' })}>播完当前歌曲</button>
                  <button role="radio" aria-checked={activeSession.preferences.playbackApplyMode === 'play-first'} className={activeSession.preferences.playbackApplyMode === 'play-first' ? 'is-active' : ''} onClick={() => updatePreferences({ playbackApplyMode: 'play-first' })}>立即播放首曲</button>
                  <button role="radio" aria-checked={activeSession.preferences.playbackApplyMode === 'pause-first'} className={activeSession.preferences.playbackApplyMode === 'pause-first' ? 'is-active' : ''} onClick={() => updatePreferences({ playbackApplyMode: 'pause-first' })}>仅替换队列</button>
                </div>
              </section>
              <section>
                <span><strong>避免连续同艺人</strong><small>在编排允许时打散相邻的同一艺人作品</small></span>
                <button className={`settings-toggle ${activeSession.preferences.avoidAdjacentArtists ? 'is-on' : ''}`} onClick={() => updatePreferences({ avoidAdjacentArtists: !activeSession.preferences.avoidAdjacentArtists })} aria-label="避免连续同艺人" aria-pressed={activeSession.preferences.avoidAdjacentArtists}><i /></button>
              </section>
            </div>
            {!mobile && <footer><span>AI 服务连接仍在“应用设置”中管理。</span><button onClick={() => setPreferencesOpen(false)}>完成</button></footer>}
          </section>
        </div>
      )}

      {memoryManagerOpen && (
        <div className="memory-manager-backdrop" onPointerDown={() => setMemoryManagerOpen(false)}>
          <section className="memory-manager" role="dialog" aria-label="管理长期记忆" onPointerDown={(event) => event.stopPropagation()}>
            <header>
              <span><Brain size={19} /></span>
              <div><strong>长期记忆</strong><small>{enabledMemories.length} 条已启用 · 共 {memories.length} / {agentMemoryLimit} 条</small></div>
              <button onClick={() => setMemoryManagerOpen(false)} title="关闭" aria-label="关闭长期记忆"><X size={18} /></button>
            </header>

            <div className="memory-manager-intro">
              <strong>用于后续会话的默认上下文</strong>
              <p>启用的内容会用于后续编排，并保存在账户中。</p>
            </div>

            <div className="memory-manager-list">
              {memories.map((memory) => (
                <article key={memory.id}>
                  <span className="memory-kind-icon">{memory.source === 'learned' ? <Brain size={16} /> : <Pin size={16} />}</span>
                  <span><strong>{memory.title}</strong><small>{memory.detail}</small><em>{memory.source === 'learned' ? `由会话习惯归纳${(memory.evidenceCount ?? 1) > 1 ? ` · ${memory.evidenceCount} 次确认` : ''}` : '手动添加'}</em></span>
                  <button className={`settings-toggle memory-toggle ${memory.enabled ? 'is-on' : ''}`} onClick={() => toggleMemory(memory.id)} aria-label={`${memory.enabled ? '停用' : '启用'} ${memory.title}`} aria-pressed={memory.enabled}><i /></button>
                  <button className="memory-delete" onClick={() => removeMemory(memory.id)} title="删除" aria-label={`删除 ${memory.title}`}><Trash2 size={15} /></button>
                </article>
              ))}
              {!memories.length && <div className="memory-manager-empty"><Brain size={20} /><strong>暂无长期记忆</strong><small>可手动添加偏好或规则。</small></div>}
            </div>

            <form className="memory-manager-add" onSubmit={addMemory}>
              <label htmlFor="memory-draft">添加一条记忆</label>
              <div><input id="memory-draft" value={memoryDraft} maxLength={60} disabled={memories.length >= agentMemoryLimit} onChange={(event) => setMemoryDraft(event.target.value)} placeholder={memories.length >= agentMemoryLimit ? '已达到长期记忆上限' : '例如：不要连续播放同一位艺人'} /><button disabled={!memoryDraft.trim() || memories.length >= agentMemoryLimit}><Plus size={16} /> 添加</button></div>
              <small><ShieldCheck size={13} /> {memories.length >= agentMemoryLimit ? '已达上限，删除不再需要的内容后可继续添加' : '习惯会随会话更新，也可手动添加、停用或删除'}</small>
            </form>
          </section>
        </div>
      )}
    </section>
  )
}

function AgentModeControl({ mode, onConfigure }: { mode: 'unconfigured' | 'echora' | 'custom'; onConfigure?: () => void }) {
  const title = mode === 'echora' ? 'Echora AI' : mode === 'custom' ? '自定义 AI' : '未配置 AI'
  const detail = mode === 'echora' ? '由 Echora Cloud 提供' : mode === 'custom' ? '使用账户中的模型配置' : '当前使用本地编排'
  const icon = mode === 'echora' ? <Sparkles size={14} /> : mode === 'custom' ? <Cpu size={14} /> : <Bot size={14} />
  return (
    <button
      type="button"
      className={`composer-ai-state is-${mode}`}
      aria-label={`${title}，${detail}，打开设置`}
      title={`${title} · ${detail}`}
      data-tooltip={`${title} · ${detail}`}
      onClick={onConfigure}
    >
      {icon}
    </button>
  )
}
