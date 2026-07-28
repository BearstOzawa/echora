import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './platforms/desktop/DesktopApplication'
import MobileApp from './platforms/mobile/MobileApplication'
import { createAgentSession, initialAgentSessions, writeAgentSessions } from './agentSessions'
import { initialTracks } from './testFixtures'
import { writePlaybackSession } from './playbackSession'
import { writeRemoteCatalog } from './remoteCatalog'
import { reconcileQueuePlaybackState, restoredPlaybackContext } from './playbackContext'
import { defaultAppSettings, writeAppSettings } from './appSettings'

const realTracks = initialTracks.map((track, index) => ({
  ...track,
  remote: {
    source: 'tx' as const,
    musicInfo: { songmid: `app-fixture-${index}`, name: track.title, singer: track.artist, albumName: track.album, source: 'tx' as const, interval: track.duration, types: [], _types: {}, typeUrl: {} },
    availableQualities: ['flac' as const],
  },
}))

const gatewayTrack = {
  source: 'tx',
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  durationSeconds: 269,
  cover: 'https://img.example.com/sunny.jpg',
  qualities: ['128k', '320k', 'flac'],
  sizeBytesByQuality: { flac: 55_397_039 },
  musicInfo: { songmid: 'sunny-live', name: '晴天', singer: '周杰伦', albumName: '叶惠美', source: 'tx', interval: '04:29', types: [], _types: {}, typeUrl: {} },
}

const seedPlayback = () => {
  writeRemoteCatalog(realTracks)
  writePlaybackSession({ tracks: realTracks, detachedTrack: null, downloadedTrackIds: [], activeTrackId: realTracks[2].id, isPlaying: false, playbackMode: 'sequence', playbackRate: 1, playProgress: 0, volume: 72, muted: false, quality: '无损', intensity: 64, novelty: 38, intent: '测试', sessionName: '测试播放', playbackContext: restoredPlaybackContext })
}

const seedSessions = () => writeAgentSessions([
  { ...initialAgentSessions[0], id: 'test-focus', title: '深夜专注', queueTrackIds: realTracks.map((track) => track.id) },
  { ...createAgentSession(realTracks.slice(2).map((track) => track.id)), id: 'test-commute', title: '下班通勤', status: 'paused' },
])

beforeAll(async () => {
  await Promise.all([
    import('./components/AgentSessionSpace'),
    import('./components/AccountSpace'),
    import('./components/AudioEffectsPanel'),
    import('./components/NowPlayingSpace'),
    import('./components/SettingsPanel'),
    import('./components/SourceStatusPanel'),
  ])
})

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

class ReadySourceWorker {
  onmessage: ((event: MessageEvent<Record<string, unknown>>) => void) | null = null
  onerror: (() => void) | null = null
  postMessage(message: Record<string, unknown>) {
    if (message.type !== 'init') return
    queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', capabilities: { sources: {
      tx: { qualitys: ['128k', '320k', 'flac'] },
      wy: { qualitys: ['128k', '320k'] },
      kw: { qualitys: ['128k', 'flac'] },
      kg: { qualitys: ['128k'] },
    } } } } as unknown as MessageEvent<Record<string, unknown>>))
  }
  terminate() {}
}

describe('App agent session integration', () => {
  const flushDeferredView = async () => {
    await act(async () => {
      for (let index = 0; index < 8; index += 1) await Promise.resolve()
    })
  }
  const enterListening = async () => {
    fireEvent.click(screen.getByRole('navigation', { name: '工作空间' }).querySelectorAll('button')[1])
    await flushDeferredView()
    expect(screen.getByRole('navigation', { name: '会话视图' })).toBeTruthy()
  }

  it('opens in the music library by default', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: /音乐库/ }).classList.contains('is-active')).toBe(true)
    const agentEntry = screen.getByRole('navigation', { name: '工作空间' }).querySelectorAll('button')[1]
    expect(agentEntry.textContent).toContain('音乐场')
    expect(agentEntry.querySelector('.workspace-ai-badge')?.textContent).toBe('AI')
    expect(screen.getByText('每日推荐')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: '继续这次音乐会话' })).toBeNull()
    expect(screen.queryByRole('button', { name: '音频输出' })).toBeNull()
    expect(screen.queryByRole('button', { name: /本地音乐/ })).toBeNull()
  })

  it('opens the configured startup space without coupling it to viewport size', async () => {
    writeAppSettings({ ...defaultAppSettings, startupView: 'field' })
    render(<App />)
    expect(screen.getByRole('button', { name: /音乐场/ }).classList.contains('is-active')).toBe(true)
    await flushDeferredView()
    expect(screen.getByRole('navigation', { name: '会话视图' })).toBeTruthy()
  })

  it('presents appearance as a live theme preview instead of a bare color picker', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '选择主题' }))
    expect(screen.getByRole('dialog', { name: '外观设置' })).toBeTruthy()
    expect(screen.getByText('界面与应用标识同步预览')).toBeTruthy()
    expect(screen.getByRole('button', { name: /暗黑/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /明亮/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '薄荷配色' }))
    expect(document.querySelector('.client-shell')?.getAttribute('data-palette')).toBe('mint')
  })

  it('does not render desktop window controls in the web runtime', () => {
    render(<App />)
    expect(screen.queryByRole('button', { name: '关闭' })).toBeNull()
    expect(screen.queryByRole('button', { name: '最小化' })).toBeNull()
    expect(screen.queryByRole('button', { name: '最大化' })).toBeNull()
  })

  it('opens the desktop account without replacing the active workspace', async () => {
    render(<App />)
    const shell = document.querySelector('.client-shell')
    expect(shell?.getAttribute('data-workspace')).toBe('library')

    fireEvent.click(screen.getByRole('button', { name: 'Echora 账户' }))
    await flushDeferredView()

    expect(screen.getByRole('dialog', { name: '账户' })).toBeTruthy()
    expect(shell?.getAttribute('data-workspace')).toBe('library')
    fireEvent.click(screen.getByRole('button', { name: '关闭账户' }))
    expect(screen.queryByRole('dialog', { name: '账户' })).toBeNull()
  })

  it('uses an independent mobile application shell', () => {
    render(<MobileApp />)

    expect(screen.queryByRole('navigation', { name: '工作空间' })).toBeNull()
    const navigation = screen.getByRole('navigation', { name: '主要导航' })
    const dock = document.querySelector('.mobile-bottom-chrome')
    expect(dock?.classList.contains('has-player')).toBe(false)
    expect(within(dock as HTMLElement).queryByRole('contentinfo', { name: '全局播放器' })).toBeNull()
    const mobileNavigation = within(navigation)
    expect(navigation.querySelectorAll('button')).toHaveLength(4)
    fireEvent.click(mobileNavigation.getByRole('button', { name: '发现' }))
    expect(screen.getByRole('heading', { name: '发现' })).toBeTruthy()
    fireEvent.click(mobileNavigation.getByRole('button', { name: '我的' }))
    expect(screen.getByRole('heading', { name: '我的' })).toBeTruthy()
    expect(navigation.querySelector('button[aria-label="搜索"]')).toBeNull()
    fireEvent.click(mobileNavigation.getByRole('button', { name: '首页' }))
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect(screen.getByRole('textbox', { name: '搜索歌曲、专辑或艺人' })).toBeTruthy()
    expect(document.querySelector('.client-shell')?.getAttribute('data-form-factor')).toBe('mobile')
  })

  it('releases mobile input focus before changing workspaces', async () => {
    writeAppSettings({ ...defaultAppSettings, startupView: 'field' })
    render(<MobileApp />)
    await flushDeferredView()
    const composer = screen.getByRole('textbox', { name: '继续这次音乐会话' })
    composer.focus()
    expect(document.activeElement).toBe(composer)

    fireEvent.click(screen.getByRole('navigation', { name: '主要导航' }).querySelector('button')!)

    expect(document.activeElement).not.toBe(composer)
  })

  it('keeps the mobile player and navigation in one continuous bottom dock', () => {
    seedPlayback()
    render(<MobileApp />)

    const dock = document.querySelector('.mobile-bottom-chrome')
    expect(dock).toBeTruthy()
    expect(within(dock as HTMLElement).getByRole('contentinfo', { name: '全局播放器' })).toBeTruthy()
    expect(within(dock as HTMLElement).getByRole('navigation', { name: '主要导航' })).toBeTruthy()
  })

  it('keeps mobile conversation preferences beside the voice and send actions', async () => {
    render(<MobileApp />)
    fireEvent.click(screen.getByRole('button', { name: /音乐场/ }))
    await flushDeferredView()

    expect(screen.getByRole('button', { name: '会话偏好' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '未配置 AI，当前使用本地编排，打开设置' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '语音输入' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '发送' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '会话偏好' }))
    expect(screen.getByRole('dialog', { name: '会话偏好' })).toBeTruthy()
  })

  it('supports seek, volume, and exit shortcuts in song mode without changing other workspaces', () => {
    seedPlayback()
    render(<App />)
    fireEvent.click(screen.getByTitle('进入歌曲模式'))

    const progress = screen.getByRole('slider', { name: '播放进度' }) as HTMLInputElement
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(Number(progress.value)).toBeGreaterThan(2)

    fireEvent.keyDown(document, { key: 'ArrowUp' })
    fireEvent.click(screen.getByRole('button', { name: '音量' }))
    expect(screen.getByText('77%')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByText('每日推荐')).toBeTruthy()
  })

  it('keeps a real local-planning follow-up and completed run in the same session', async () => {
    seedPlayback()
    render(<App />)
    await enterListening()
    const composer = screen.getByRole('textbox', { name: '继续这次音乐会话' })
    fireEvent.change(composer, { target: { value: '接下来轻一点，但保留当前这首' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    expect(screen.getByText('接下来轻一点，但保留当前这首')).toBeTruthy()
    expect(screen.getByText('正在理解本轮要求')).toBeTruthy()
    expect(screen.getByText('读取约束')).toBeTruthy()

    await act(async () => {
      for (let index = 0; index < 8; index += 1) await Promise.resolve()
    })

    expect(screen.getByText(/保留当前会话上下文/)).toBeTruthy()
    expect(screen.getByText(/按目标能量重排/)).toBeTruthy()
    expect(screen.getByText('待确认')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Blue Static.*Night Current/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: '播放' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '应用编排' }))
    expect(screen.getByText('已应用')).toBeTruthy()
    expect(screen.getByRole('button', { name: '播放' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '撤销本次调整' })).toBeTruthy()
  })

  it('can auto-apply a proposal without interrupting the retained active track', async () => {
    seedPlayback()
    writeAgentSessions([{
      ...initialAgentSessions[0],
      id: 'auto-apply-session',
      queueTrackIds: realTracks.map((track) => track.id),
      preferences: { ...initialAgentSessions[0].preferences, autoApply: true, targetTrackCount: 8 },
    }])
    render(<App />)
    await enterListening()
    const composer = screen.getByRole('textbox', { name: '继续这次音乐会话' })
    fireEvent.change(composer, { target: { value: '接下来轻一点' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(screen.getByText('已应用')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '应用编排' })).toBeNull()
    expect(screen.getByRole('button', { name: /Blue Static.*Night Current/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: '播放' })).toBeTruthy()
  })

  it('preserves playback and progress when an applied queue retains the active track', () => {
    expect(reconcileQueuePlaybackState([9, 3, 7], 3, true, 42, 'continue-current')).toEqual({ activeTrackId: 3, isPlaying: true, playProgress: 42, detached: false })
    expect(reconcileQueuePlaybackState([9, 7], 3, true, 42, 'pause-first')).toEqual({ activeTrackId: 9, isPlaying: false, playProgress: 0, detached: false })
    expect(reconcileQueuePlaybackState([9, 7], 3, true, 42, 'continue-current')).toEqual({ activeTrackId: 3, isPlaying: true, playProgress: 42, detached: true })
  })

  it('applies an AI arrangement without inserting the current song into it', async () => {
    seedPlayback()
    writeAgentSessions([{
      ...initialAgentSessions[0],
      id: 'proposal-with-detached-playback',
      queueTrackIds: [realTracks[0].id],
      messages: [{
        id: 'proposal-message',
        role: 'assistant',
        content: '已生成新的编排。',
        createdAt: Date.now(),
        change: {
          summary: '新的单曲编排',
          addedTrackIds: [realTracks[0].id],
          removedTrackIds: [],
          keptTrackIds: [],
          undoable: false,
          status: 'pending',
          proposal: { queueTrackIds: [realTracks[0].id], tracks: [realTracks[0]], trackLayout: [{ id: realTracks[0].id, x: 160, y: 160 }], targetIntensity: 52, targetNovelty: 44 },
        },
      }],
    }])
    render(<App />)
    await enterListening()
    fireEvent.click(screen.getByRole('button', { name: '应用编排' }))

    const player = screen.getByRole('contentinfo', { name: '全局播放器' })
    expect(player.textContent).toContain(realTracks[2].title)
    fireEvent.click(screen.getByRole('button', { name: '播放队列，共 1 首' }))
    const queue = screen.getByRole('dialog', { name: '播放队列' })
    expect(queue.textContent).toContain('当前歌曲结束后进入此队列')
    expect(queue.textContent).toContain(realTracks[0].title)
    expect(queue.textContent).not.toContain(realTracks[2].title)
  })

  it('builds an empty listening session from real source search results', async () => {
    vi.stubGlobal('Worker', ReadySourceWorker)
    const fetchMock = vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(url.includes('/v1/music/status')
      ? { providers: ['tx', 'wy', 'kw', 'kg'].map((source) => ({ source, enabled: true })), qualities: ['128k', '320k', 'flac'] }
      : { tracks: [gatewayTrack] }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    await enterListening()

    const composer = screen.getByRole('textbox', { name: '继续这次音乐会话' })
    fireEvent.change(composer, { target: { value: '我想听周杰伦的歌' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/v1\/music\/search\?query=.*&sources=tx%2Cwy%2Ckw%2Ckg/), expect.objectContaining({ signal: undefined }))
    expect(screen.getByText(/已从音乐服务找到 1 首候选/)).toBeTruthy()
    expect(screen.getAllByText('晴天').length).toBeGreaterThan(0)
    expect(screen.queryByRole('contentinfo', { name: '全局播放器' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '应用编排' }))
    expect(screen.getByRole('contentinfo', { name: '全局播放器' })).toBeTruthy()
  })

  it('opens the arrangement tab from the global queue', async () => {
    seedPlayback()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /播放队列，共/ }))
    fireEvent.click(screen.getByRole('button', { name: '编排' }))
    await flushDeferredView()
    expect(screen.getByText('高强度')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: '继续这次音乐会话' })).toBeNull()
  })

  it('keeps manual edits synchronized when the playing queue is linked to a session', async () => {
    seedPlayback()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /播放队列，共/ }))
    fireEvent.click(screen.getByRole('button', { name: '编排' }))
    await flushDeferredView()
    expect(screen.getByText('高强度')).toBeTruthy()
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Slow Satellites, Mira Vale' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '后移一位' }))

    fireEvent.click(screen.getByRole('button', { name: /播放队列，共/ }))
    const queueItems = screen.getByRole('dialog', { name: '播放队列' }).querySelectorAll('.global-queue-list > button')
    expect(queueItems[0].textContent).toContain('Glass Hours')
    expect(within(screen.getByRole('dialog', { name: '播放队列' })).getByRole('button', { name: '编排' })).toBeTruthy()
  })

  it('switches to the next session after deleting the active session', async () => {
    seedSessions()
    render(<App />)
    await enterListening()
    fireEvent.click(screen.getByRole('button', { name: '管理会话 深夜专注' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除会话' }))
    fireEvent.click(screen.getByRole('button', { name: '删除会话' }))
    expect(screen.queryByRole('button', { name: '管理会话 深夜专注' })).toBeNull()
    expect(screen.getAllByText('下班通勤').length).toBeGreaterThan(1)
  })

  it('does not replace global playback when switching music-field sessions', async () => {
    seedPlayback()
    writeAgentSessions([
      { ...initialAgentSessions[0], id: 'session-a', title: '会话 A', queueTrackIds: [realTracks[0].id] },
      { ...createAgentSession([realTracks[1].id]), id: 'session-b', title: '会话 B', status: 'paused' },
    ])
    render(<App />)
    await enterListening()
    const player = screen.getByRole('contentinfo', { name: '全局播放器' })
    expect(player.textContent).toContain(realTracks[2].title)
    const nextSession = Array.from(document.querySelectorAll<HTMLButtonElement>('.session-select')).find((button) => button.textContent?.includes('会话 B'))!
    fireEvent.click(nextSession)
    expect(player.textContent).toContain(realTracks[2].title)
    expect(player.textContent).not.toContain(realTracks[1].title)
  })

  it('deletes the final listening session without clearing global playback', async () => {
    seedPlayback()
    writeAgentSessions([{ ...initialAgentSessions[0], id: 'only-session', title: '唯一会话', queueTrackIds: realTracks.map((track) => track.id) }])
    render(<App />)
    await enterListening()
    fireEvent.click(screen.getByRole('button', { name: '管理会话 唯一会话' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除会话' }))
    fireEvent.click(screen.getByRole('button', { name: '删除会话' }))
    expect(screen.getAllByText('创建音乐会话').length).toBeGreaterThan(0)
    expect(screen.getByRole('contentinfo', { name: '全局播放器' })).toBeTruthy()
  })

  it('opens playback settings from a runtime-verified music service status', async () => {
    vi.stubGlobal('Worker', ReadySourceWorker)
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(url.includes('/v1/music/status') ? {
      providers: ['tx', 'wy', 'kw', 'kg'].map((source) => ({ source, enabled: true })),
      qualities: ['128k', '320k', 'flac'],
    } : {
      tracks: [],
      sourceStatuses: ['tx', 'wy', 'kw', 'kg'].map((source) => ({ source, status: 'available', message: '内容服务可用' })),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /音乐服务：/ }))
    await flushDeferredView()
    expect(screen.getByText('4 个音乐平台内容可用')).toBeTruthy()
    expect(screen.getAllByText('内容可用 · 待播放验证').length).toBe(4)
    expect(screen.getAllByText('QQ 音乐').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '音乐与播放设置' }))
    await flushDeferredView()
    expect(screen.getByRole('dialog', { name: '应用设置' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '音乐与播放' })).toBeTruthy()
  })

  it('restores a manual arrangement after switching sessions', async () => {
    seedPlayback()
    seedSessions()
    render(<App />)
    await enterListening()
    fireEvent.click(screen.getByRole('button', { name: '编排' }))
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Slow Satellites, Mira Vale' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '后移一位' }))

    const selectSession = (title: string) => {
      const button = Array.from(document.querySelectorAll<HTMLButtonElement>('.session-select')).find((item) => item.textContent?.includes(title))
      expect(button).toBeTruthy()
      fireEvent.click(button!)
    }
    selectSession('下班通勤')
    selectSession('深夜专注')

    const nodes = Array.from(document.querySelectorAll<HTMLButtonElement>('.track-node'))
    expect(nodes[0].getAttribute('aria-label')).toBe('Glass Hours, North Assembly')
    expect(nodes[1].getAttribute('aria-label')).toBe('Slow Satellites, Mira Vale')
  })

  it('uses the Echora brand as a music-home shortcut', async () => {
    render(<App />)
    await enterListening()
    fireEvent.click(screen.getByRole('button', { name: 'Echora，返回音乐首页' }))
    expect(screen.getByText('每日推荐')).toBeTruthy()
  })

  it('opens song-mode artist and album links in the music library', async () => {
    seedPlayback()
    render(<App />)
    fireEvent.click(screen.getByTitle('进入歌曲模式'))
    await flushDeferredView()
    fireEvent.click(screen.getByRole('button', { name: realTracks[2].artist }))
    expect(screen.getByText(`${realTracks[2].artist} 的热门作品与专辑。`)).toBeTruthy()
  })
})
