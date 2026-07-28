import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultAppSettings } from '../appSettings'
import SettingsPanel from './SettingsPanel'

const desktopRuntime = {
  kind: 'desktop' as const,
  native: true,
  canControlWindow: true,
  canImportFolder: true,
  hasLocalLibrary: true,
  downloadBehavior: 'offline-library' as const,
  canExportLocalFiles: true,
  localLibraryLabel: '测试',
  downloadSuccessLabel: '测试',
  credentialStorageLabel: '测试',
}

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'mediaSession')
  Reflect.deleteProperty(navigator, 'wakeLock')
})

describe('SettingsPanel', () => {
  it('uses an explicit segmented choice for close behavior', () => {
    const onChange = vi.fn()
    render(<SettingsPanel settings={defaultAppSettings} runtime={desktopRuntime} onChange={onChange} onClose={vi.fn()} onClearSession={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '隐藏到后台' }))
    expect(onChange).toHaveBeenCalledWith({ ...defaultAppSettings, closeBehavior: 'background' })
  })

  it('does not show desktop close behavior in the web runtime', () => {
    render(<SettingsPanel settings={defaultAppSettings} onChange={vi.fn()} onClose={vi.fn()} onClearSession={vi.fn()} />)
    expect(screen.queryByText('关闭窗口时')).toBeNull()
    expect(screen.queryByRole('button', { name: /本地与下载/ })).toBeNull()
    expect(screen.getByText('操作与反馈')).toBeTruthy()
  })

  it('exposes clear and close as separate actions', () => {
    const onClose = vi.fn()
    const onClearSession = vi.fn()
    render(<SettingsPanel settings={defaultAppSettings} onChange={vi.fn()} onClose={onClose} onClearSession={onClearSession} />)
    fireEvent.click(screen.getByRole('button', { name: '恢复上次播放' }))
    fireEvent.click(screen.getByRole('button', { name: '关闭应用设置' }))
    expect(onClearSession).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('configures startup and playback interaction preferences', () => {
    const onChange = vi.fn()
    render(<SettingsPanel settings={defaultAppSettings} onChange={onChange} onClose={vi.fn()} onClearSession={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '音乐场' }))
    fireEvent.click(screen.getByRole('button', { name: '10 秒' }))
    expect(onChange).toHaveBeenNthCalledWith(1, { ...defaultAppSettings, startupView: 'field' })
    expect(onChange).toHaveBeenNthCalledWith(2, { ...defaultAppSettings, seekStepSeconds: 10 })
  })

  it('switches categories inside one settings dialog', () => {
    const onChange = vi.fn()
    const settings = { ...defaultAppSettings, ai: { ...defaultAppSettings.ai, mode: 'custom' as const } }
    render(<SettingsPanel settings={settings} onChange={onChange} onClose={vi.fn()} onClearSession={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /AI 服务/ }))
    expect(screen.getByRole('dialog', { name: '应用设置' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'AI 服务' })).toBeTruthy()
    const providerSelect = screen.getByRole('combobox', { name: 'AI 服务商' })
    fireEvent.click(providerSelect)
    fireEvent.click(screen.getByRole('option', { name: /Anthropic/ }))
    expect(onChange).toHaveBeenCalledWith({ ...settings, ai: { ...settings.ai, provider: 'anthropic', baseUrl: 'https://api.anthropic.com' } })
    onChange.mockClear()

    fireEvent.change(screen.getByRole('textbox', { name: 'AI 模型' }), { target: { value: 'music-agent' } })
    expect(onChange).toHaveBeenCalledWith({ ...settings, ai: { ...settings.ai, model: 'music-agent' } })

    fireEvent.click(screen.getByRole('button', { name: /通用/ }))
    expect(screen.getByRole('dialog', { name: '应用设置' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '通用' })).toBeTruthy()
  })

  it('focuses the dialog without preselecting search and resets content scroll between categories', () => {
    render(<SettingsPanel settings={defaultAppSettings} onChange={vi.fn()} onClose={vi.fn()} onClearSession={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: '应用设置' })
    const scroller = document.querySelector<HTMLElement>('.settings-content-scroll')!
    expect(document.activeElement).toBe(dialog)
    expect(document.activeElement).not.toBe(screen.getByRole('textbox', { name: '搜索设置' }))

    scroller.scrollTop = 92
    fireEvent.click(screen.getByRole('button', { name: /音乐与播放/ }))
    expect(scroller.scrollTop).toBe(0)
  })

  it('makes background content inert while the settings dialog is open', () => {
    const shell = document.createElement('div')
    const backgroundButton = document.createElement('button')
    shell.className = 'client-shell'
    backgroundButton.textContent = '背景操作'
    shell.append(backgroundButton)
    document.body.append(shell)

    const view = render(<SettingsPanel settings={defaultAppSettings} onChange={vi.fn()} onClose={vi.fn()} onClearSession={vi.fn()} />)
    expect(backgroundButton.hasAttribute('inert')).toBe(true)
    expect(backgroundButton.getAttribute('aria-hidden')).toBe('true')

    view.unmount()
    expect(backgroundButton.hasAttribute('inert')).toBe(false)
    expect(backgroundButton.hasAttribute('aria-hidden')).toBe(false)
    shell.remove()
  })

  it('keeps API keys masked until explicitly revealed', () => {
    const settings = { ...defaultAppSettings, ai: { ...defaultAppSettings.ai, mode: 'custom' as const, apiKey: 'secret-key' } }
    render(<SettingsPanel settings={settings} onChange={vi.fn()} onClose={vi.fn()} onClearSession={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /AI 服务/ }))
    const keyInput = screen.getByLabelText('AI API 密钥') as HTMLInputElement
    expect(keyInput.type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: '显示 API 密钥' }))
    expect(keyInput.type).toBe('text')
  })

  it('exposes playback preferences without exposing source implementation details', () => {
    const onChange = vi.fn()
    render(<SettingsPanel settings={defaultAppSettings} onChange={onChange} onClose={vi.fn()} onClearSession={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /音乐与播放/ }))
    expect(screen.getByRole('heading', { name: '音乐与播放' })).toBeTruthy()
    expect(screen.queryByLabelText('导入 LX 音源文件')).toBeNull()
    expect(screen.queryByLabelText('音乐源接口地址')).toBeNull()
    expect(screen.getByText(/由 Echora Cloud 统一维护平台连接与解析策略/)).toBeTruthy()
    const qualitySelect = screen.getByRole('combobox', { name: '默认音质' })
    expect(qualitySelect.textContent).toContain('高品质')
    expect(screen.getByRole('combobox', { name: '下载音质' }).textContent).toContain('高品质')
    expect(screen.getByRole('combobox', { name: '下载文件名称' }).textContent).toContain('艺人 - 歌曲')
    fireEvent.click(qualitySelect)
    expect(screen.getByRole('option', { name: /无损/ }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('option', { name: /Hi-Res/ }).hasAttribute('disabled')).toBe(false)
    expect(screen.queryByText(/v1\.2\.0|音乐解析KEY|前往注册/)).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows supported device playback controls and persists them separately', () => {
    const onChange = vi.fn()
    Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: {} })
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: vi.fn() } })
    render(<SettingsPanel settings={defaultAppSettings} onChange={onChange} onClose={vi.fn()} onClearSession={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /音乐与播放/ }))
    expect(screen.getByText('设备控制')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '系统媒体控制' }))
    fireEvent.click(screen.getByRole('button', { name: '播放时保持屏幕唤醒' }))
    expect(onChange).toHaveBeenNthCalledWith(1, { ...defaultAppSettings, playback: { ...defaultAppSettings.playback, systemMediaControls: false } })
    expect(onChange).toHaveBeenNthCalledWith(2, { ...defaultAppSettings, playback: { ...defaultAppSettings.playback, keepAwakeWhilePlaying: true } })
  })

  it('keeps resolver implementation out of user settings', () => {
    render(<SettingsPanel settings={defaultAppSettings} initialView="source" onChange={vi.fn()} onClose={vi.fn()} onClearSession={vi.fn()} />)
    expect(screen.getByText('在线音乐')).toBeTruthy()
    expect(screen.queryByText(/音乐源版本|解析密钥|脚本内容|接口地址/)).toBeNull()
  })

  it('keeps account management outside application settings', () => {
    const onOpenAccount = vi.fn()
    render(<SettingsPanel settings={defaultAppSettings} initialView="ai" cloudSession={null} onOpenAccount={onOpenAccount} onChange={vi.fn()} onClose={vi.fn()} onClearSession={vi.fn()} />)
    expect(screen.queryByText('账户与同步')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(onOpenAccount).toHaveBeenCalledOnce()
  })

  it('configures chart and featured collection sizes independently', () => {
    const onChange = vi.fn()
    render(<SettingsPanel settings={defaultAppSettings} onChange={onChange} onClose={vi.fn()} onClearSession={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /内容与发现/ }))
    expect(screen.getByRole('heading', { name: '内容与发现' })).toBeTruthy()
    const chartLimitGroup = screen.getByRole('radiogroup', { name: '榜单集歌曲数' })
    expect(within(chartLimitGroup).getAllByRole('radio').every((button) => button.childElementCount === 0)).toBe(true)
    fireEvent.click(within(chartLimitGroup).getByRole('radio', { name: '30 首' }))
    fireEvent.click(within(screen.getByRole('radiogroup', { name: '精选集歌曲数' })).getByRole('radio', { name: '10 首' }))
    expect(onChange).toHaveBeenNthCalledWith(1, { ...defaultAppSettings, content: { ...defaultAppSettings.content, chartTrackLimit: 30 } })
    expect(onChange).toHaveBeenNthCalledWith(2, { ...defaultAppSettings, content: { ...defaultAppSettings.content, featuredTrackLimit: 10 } })
    expect(screen.getByText(/个人音乐始终完整显示/)).toBeTruthy()
  })

  it('controls recommendation personalization and AI preference learning separately', () => {
    const onChange = vi.fn()
    render(<SettingsPanel settings={defaultAppSettings} onChange={onChange} onClose={vi.fn()} onClearSession={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /内容与发现/ }))
    fireEvent.click(screen.getByRole('button', { name: '根据收藏调整推荐' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...defaultAppSettings, content: { ...defaultAppSettings.content, personalizedRecommendations: false } })
    fireEvent.click(screen.getByRole('button', { name: /AI 服务/ }))
    fireEvent.click(screen.getByRole('button', { name: '自动学习明确偏好' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...defaultAppSettings, ai: { ...defaultAppSettings.ai, autoLearnPreferences: false } })
  })

  it('manages desktop music folders from local and download settings', () => {
    const onChange = vi.fn()
    const onAddLocalFolders = vi.fn().mockResolvedValue(undefined)
    const onRescanLocalFolder = vi.fn().mockResolvedValue(undefined)
    const onRemoveLocalFolder = vi.fn().mockResolvedValue(undefined)
    const folder = { id: 'folder-music', name: 'Music', path: '/Users/test/Music', addedAt: 1, lastScannedAt: 2, trackCount: 24, available: true }
    render(<SettingsPanel settings={defaultAppSettings} runtime={desktopRuntime} localFolders={[folder]} localLibraryLocation="/Users/test/Library/Application Support/Echora/music" onAddLocalFolders={onAddLocalFolders} onRescanLocalFolder={onRescanLocalFolder} onRemoveLocalFolder={onRemoveLocalFolder} onChange={onChange} onClose={vi.fn()} onClearSession={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /本地与下载/ }))
    expect(screen.getByText('/Users/test/Music')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /添加音乐文件夹/ }))
    fireEvent.click(screen.getByRole('button', { name: '重新扫描 Music' }))
    fireEvent.click(screen.getByRole('button', { name: '移除来源 Music' }))
    expect(onAddLocalFolders).toHaveBeenCalledOnce()
    expect(onRescanLocalFolder).toHaveBeenCalledWith(folder)
    expect(onRemoveLocalFolder).toHaveBeenCalledWith(folder.id)
    fireEvent.click(screen.getByRole('button', { name: '启动后扫描音乐文件夹' }))
    expect(onChange).toHaveBeenCalledWith({ ...defaultAppSettings, storage: { ...defaultAppSettings.storage, autoScanLocalFolders: false } })
  })

  it('clears rebuildable cache only after an explicit confirmation', async () => {
    const onClearCache = vi.fn().mockResolvedValue(undefined)
    render(<SettingsPanel settings={defaultAppSettings} onChange={vi.fn()} onClose={vi.fn()} onClearSession={vi.fn()} onClearCache={onClearCache} />)
    fireEvent.click(screen.getByRole('button', { name: /数据与存储/ }))
    const clearButton = screen.getByRole('button', { name: /清理缓存/ })
    fireEvent.click(clearButton)
    expect(onClearCache).not.toHaveBeenCalled()
    expect(screen.getByText(/不会删除离线音乐和用户数据/)).toBeTruthy()
    fireEvent.click(clearButton)
    expect(onClearCache).toHaveBeenCalledOnce()
  })

  it('configures the native playback cache and keeps local music as a separate resource action', () => {
    const onChange = vi.fn()
    const onClearLocalMusic = vi.fn().mockResolvedValue(undefined)
    render(<SettingsPanel settings={defaultAppSettings} runtime={desktopRuntime} initialView="data" localCount={3} onChange={onChange} onClose={vi.fn()} onClearSession={vi.fn()} onClearLocalMusic={onClearLocalMusic} />)
    fireEvent.click(screen.getByRole('combobox', { name: '播放缓存上限' }))
    fireEvent.click(screen.getByRole('option', { name: /512 MB/ }))
    expect(onChange).toHaveBeenCalledWith({ ...defaultAppSettings, storage: { ...defaultAppSettings.storage, playbackCacheLimitMb: 512 } })
    const localAction = screen.getByText('清除本地音乐').closest('.data-action-row')!
    fireEvent.click(within(localAction as HTMLElement).getByRole('button', { name: '清除' }))
    expect(onClearLocalMusic).not.toHaveBeenCalled()
    fireEvent.click(within(localAction as HTMLElement).getByRole('button', { name: '确认清除' }))
    expect(onClearLocalMusic).toHaveBeenCalledOnce()
  })

  it('clears only the local playback snapshot from device data', () => {
    const onClearUsageData = vi.fn().mockResolvedValue(undefined)
    render(<SettingsPanel settings={defaultAppSettings} initialView="data" onChange={vi.fn()} onClose={vi.fn()} onClearSession={vi.fn()} onClearUsageData={onClearUsageData} />)
    fireEvent.click(screen.getByRole('button', { name: '清除' }))
    expect(onClearUsageData).not.toHaveBeenCalled()
    expect(screen.getByText(/账户数据不受影响/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认清除' }))
    expect(onClearUsageData).toHaveBeenCalledOnce()
  })

  it('does not expose configuration backup or full reset after cloud migration', () => {
    render(<SettingsPanel settings={defaultAppSettings} initialView="data" onChange={vi.fn()} onClose={vi.fn()} onClearSession={vi.fn()} />)
    expect(screen.queryByText(/配置备份|导入配置|导出备份|重置 Echora|开始重置/)).toBeNull()
    expect(screen.getByText('账户数据')).toBeTruthy()
  })

  it('searches settings categories and supports Escape to close', () => {
    const onClose = vi.fn()
    render(<SettingsPanel settings={defaultAppSettings} onChange={vi.fn()} onClose={onClose} onClearSession={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox', { name: '搜索设置' }), { target: { value: '缓存' } })
    expect(screen.getByRole('heading', { name: '数据与存储' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /音乐与播放/ })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('presents Web identity without application update controls', () => {
    render(<SettingsPanel settings={defaultAppSettings} initialView="about" onChange={vi.fn()} onClose={vi.fn()} onClearSession={vi.fn()} />)
    expect(screen.getByRole('heading', { name: '关于 Echora' })).toBeTruthy()
    expect(screen.getByText('Web 版')).toBeTruthy()
    expect(screen.queryByText('软件更新')).toBeNull()
    expect(screen.queryByRole('button', { name: '检查更新' })).toBeNull()
    expect(screen.queryByText(/GitHub Releases/)).toBeNull()
    expect(screen.queryByText(/Worker/)).toBeNull()
    expect(screen.queryByText(/构建/)).toBeNull()
  })

  it('shows release information and a clear primary update action', () => {
    render(<SettingsPanel settings={defaultAppSettings} runtime={desktopRuntime} initialView="about" updateState={{
      phase: 'available',
      message: 'v0.2.0 已发布',
      checkedAt: new Date('2026-07-20T10:00:00Z').getTime(),
      result: {
        currentVersion: '0.1.0',
        latestVersion: '0.2.0',
        minimumVersion: '0.1.0',
        currentBuildId: 'old',
        latestBuildId: 'new',
        updateAvailable: true,
        mandatory: false,
        eligible: true,
        channel: 'stable',
        publishedAt: '2026-07-20T10:00:00Z',
        releaseNotes: '优化播放与更新体验。',
        action: { type: 'tauri-update', url: 'https://echora.example/update' },
      },
    }} onChange={vi.fn()} onClose={vi.fn()} onClearSession={vi.fn()} />)
    expect(screen.getByText('新版本可用')).toBeTruthy()
    expect(screen.getByText('v0.2.0 更新内容')).toBeTruthy()
    expect(screen.getByRole('button', { name: '立即更新' })).toBeTruthy()
  })
})
