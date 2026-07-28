import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BarChart3, Bot, CheckCircle2, ChevronLeft, ChevronRight, CircleHelp, Cloud, Database, Download, ExternalLink, Eye, EyeOff, FileAudio2, FolderPlus, FolderSync, Gauge, HardDrive, History, MonitorUp, Music2, RadioTower, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, X } from 'lucide-react'
import { chartTrackLimitOptions, defaultPlaybackSettings, featuredTrackLimitOptions, playbackCacheLimitOptions, seekStepOptions } from '../appSettings'
import type { AiProvider, AppSettings, ChartTrackLimit, DownloadFileNameFormat, FeaturedTrackLimit, MusicSourceQuality, PlaybackCacheLimit, SeekStepSeconds } from '../appSettings'
import type { MusicSourceStatus } from '../musicSource'
import type { RuntimeCapabilities } from '../runtimeCapabilities'
import { detectRuntimeCapabilities } from '../runtimeCapabilities'
import { estimateStorageUsage, formatStorageSize } from '../storageMaintenance'
import GlassSelect from './GlassSelect'
import BrandMark from './BrandMark'
import { applicationVersion, initialApplicationUpdateState } from '../applicationUpdate'
import type { ApplicationUpdateState } from '../applicationUpdate'
import type { LocalMusicFolder } from '../nativeMusicFolders'
import { readPlaybackCacheStats } from '../playbackCache'
import { supportsPlaybackWakeLock, supportsSystemMediaControls } from '../useSystemPlayback'
import type { CloudSession } from '../cloudApi'
import { useCloudSession } from '../useCloudSession'

function SettingToggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button className={`settings-toggle ${checked ? 'is-on' : ''}`} onClick={onChange} aria-label={label} aria-pressed={checked}><i /></button>
}

export type SettingsCategory = 'general' | 'source' | 'content' | 'local' | 'ai' | 'data' | 'about'

type Props = {
  settings: AppSettings
  sourceStatus?: MusicSourceStatus
  onChange: (settings: AppSettings) => void
  onClose: () => void
  onClearSession: () => void
  runtime?: RuntimeCapabilities
  initialView?: SettingsCategory | 'root'
  onClearCache?: () => Promise<void>
  onClearUsageData?: () => Promise<void>
  onClearLocalMusic?: () => Promise<void>
  localCount?: number
  localFolders?: LocalMusicFolder[]
  localFolderBusyIds?: string[]
  localLibraryLocation?: string
  onImportLocalFiles?: (files: File[]) => Promise<void>
  onAddLocalFolders?: () => Promise<void>
  onRescanLocalFolder?: (folder: LocalMusicFolder) => Promise<unknown>
  onRemoveLocalFolder?: (id: string) => Promise<void>
  presentation?: 'desktop' | 'mobile'
  updateState?: ApplicationUpdateState
  onCheckForUpdates?: () => Promise<unknown>
  onApplyUpdate?: () => Promise<void>
  cloudSession?: CloudSession | null
  echoraAiAvailable?: boolean
  echoraAiStatus?: 'checking' | 'available' | 'disabled' | 'unreachable'
  onOpenAccount?: () => void
}

const providerLabels: Record<AiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  compatible: 'OpenAI 兼容接口',
  ollama: 'Ollama',
}

const providerEndpoints: Record<AiProvider, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  compatible: '',
  ollama: 'http://127.0.0.1:11434/v1',
}

const qualityLabels: Record<MusicSourceQuality, string> = { high: '高品质', lossless: '无损', hires: 'Hi-Res' }
const sourcePhaseLabels: Record<MusicSourceStatus['phase'], string> = { checking: '载入中', ready: '已接入', degraded: '部分异常', error: '不可用' }

const categories = [
  { id: 'general', label: '通用', description: '启动、窗口与界面行为', icon: SlidersHorizontal, keywords: '启动 首页 音乐库 音乐场 恢复 播放 会话 快进 快退 步长 窗口 关闭 后台 退出 动效 动画 界面' },
  { id: 'source', label: '音乐与播放', description: '音质、下载与播放策略', icon: Music2, keywords: '音乐 服务 音质 无损 hires 自动切换 播放 下载 文件名 命名' },
  { id: 'content', label: '内容与发现', description: '推荐、榜单与在线集合', icon: Sparkles, keywords: '内容 首页 推荐 个性化 收藏 榜单 精选 集合 歌曲 数量' },
  { id: 'local', label: '本地与下载', description: '离线资料库与音乐来源', icon: HardDrive, keywords: '本地 下载 离线 文件 文件夹 导入 自动 扫描 路径 存储' },
  { id: 'ai', label: 'AI 服务', description: '模型、接口与记忆能力', icon: Bot, keywords: 'ai 人工智能 模型 服务商 接口 地址 api key 密钥 ollama openai anthropic 记忆 偏好 学习' },
  { id: 'data', label: '数据与存储', description: '缓存与设备空间', icon: Database, keywords: '数据 存储 缓存 清理 下载 本地 空间' },
  { id: 'about', label: '关于 Echora', description: '版本信息与软件更新', icon: CircleHelp, keywords: '关于 版本 更新 检查 发布 通道' },
] as const

const categoryCopy: Record<SettingsCategory, { title: string; description: string }> = {
  general: { title: '通用', description: '启动、窗口与操作' },
  source: { title: '音乐与播放', description: '音质、下载与播放策略' },
  content: { title: '内容与发现', description: '推荐、榜单与精选' },
  local: { title: '本地与下载', description: '离线资料库与音乐来源' },
  ai: { title: 'AI 服务', description: '模型服务与长期偏好' },
  data: { title: '数据与存储', description: '缓存与设备空间' },
  about: { title: '关于 Echora', description: '版本信息与软件更新' },
}

const resolveInitialCategory = (view: Props['initialView']): SettingsCategory => view === 'root' || !view ? 'general' : view

export default function SettingsPanel({ settings, sourceStatus, onChange, onClose, onClearSession, runtime = detectRuntimeCapabilities(), initialView = 'general', onClearCache = async () => {}, onClearUsageData = async () => {}, onClearLocalMusic = async () => {}, localCount = 0, localFolders = [], localFolderBusyIds = [], localLibraryLocation = '', onImportLocalFiles = async () => {}, onAddLocalFolders = async () => {}, onRescanLocalFolder = async () => {}, onRemoveLocalFolder = async () => {}, presentation = 'desktop', updateState = initialApplicationUpdateState, onCheckForUpdates = async () => {}, onApplyUpdate = async () => {}, cloudSession, echoraAiAvailable = true, echoraAiStatus, onOpenAccount }: Props) {
  const internalCloud = useCloudSession()
  cloudSession = cloudSession ?? internalCloud.session
  const [category, setCategory] = useState<SettingsCategory>(() => resolveInitialCategory(initialView))
  const [mobileRoute, setMobileRoute] = useState<'root' | SettingsCategory>(() => initialView === 'general' || initialView === 'root' ? 'root' : initialView)
  const [searchQuery, setSearchQuery] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [storageUsage, setStorageUsage] = useState<string>('正在计算')
  const [playbackCacheUsage, setPlaybackCacheUsage] = useState<string>('正在计算')
  const [cacheConfirming, setCacheConfirming] = useState(false)
  const [destructiveConfirming, setDestructiveConfirming] = useState<'usage' | 'local' | null>(null)
  const [dataStatus, setDataStatus] = useState('')
  const [localStatus, setLocalStatus] = useState('')
  const [sourceLinkStatus, setSourceLinkStatus] = useState('')
  const [isImportingLocal, setIsImportingLocal] = useState(false)
  const modalRef = useRef<HTMLElement>(null)
  const contentScrollRef = useRef<HTMLDivElement>(null)
  const localFileInputRef = useRef<HTMLInputElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const update = <Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]) => onChange({ ...settings, [key]: value })
  const updateAi = <Key extends keyof AppSettings['ai']>(key: Key, value: AppSettings['ai'][Key]) => update('ai', { ...settings.ai, [key]: value })
  const updateMusicSource = <Key extends keyof AppSettings['musicSource']>(key: Key, value: AppSettings['musicSource'][Key]) => update('musicSource', { ...settings.musicSource, [key]: value })
  const updateContent = <Key extends keyof AppSettings['content']>(key: Key, value: AppSettings['content'][Key]) => update('content', { ...settings.content, [key]: value })
  const updateStorage = <Key extends keyof AppSettings['storage']>(key: Key, value: AppSettings['storage'][Key]) => update('storage', { ...settings.storage, [key]: value })
  const playbackSettings = settings.playback ?? defaultPlaybackSettings
  const updatePlayback = <Key extends keyof AppSettings['playback']>(key: Key, value: AppSettings['playback'][Key]) => update('playback', { ...playbackSettings, [key]: value })
  const selectProvider = (provider: AiProvider) => update('ai', { ...settings.ai, provider, baseUrl: providerEndpoints[provider] })
  const openCategory = (nextCategory: SettingsCategory) => { setCategory(nextCategory); setMobileRoute(nextCategory) }
  const requiresApiKey = settings.ai.provider !== 'ollama'
  const aiConfigured = settings.ai.mode === 'echora' ? Boolean(cloudSession) && echoraAiAvailable : Boolean(settings.ai.baseUrl.trim() && settings.ai.model.trim() && (!requiresApiKey || settings.ai.apiKey.trim()))
  const managedAiStatus = echoraAiStatus ?? (echoraAiAvailable ? 'available' : 'disabled')
  const managedAiLabel = !cloudSession ? '需要登录' : managedAiStatus === 'checking' ? '正在连接' : managedAiStatus === 'available' ? '可用' : managedAiStatus === 'unreachable' ? '无法连接' : '暂不可用'
  const managedAiDetail = !cloudSession ? '登录后使用' : managedAiStatus === 'available' ? `@${cloudSession.user.username}` : managedAiStatus === 'checking' ? '正在检查服务状态' : managedAiStatus === 'unreachable' ? '请检查网络或稍后重试' : '服务尚未启用'
  const sourceReady = sourceStatus?.phase === 'ready'
  const canUseSystemMediaControls = supportsSystemMediaControls()
  const canKeepPlaybackAwake = supportsPlaybackWakeLock()
  const sourceStateLabel = sourceStatus ? sourcePhaseLabels[sourceStatus.phase] : '连接中'
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase()
  const visibleCategories = useMemo(() => categories.filter((item) => {
    if (item.id === 'local' && !runtime.hasLocalLibrary) return false
    return !normalizedSearch || `${item.label} ${item.description} ${item.keywords}`.toLocaleLowerCase().includes(normalizedSearch)
  }).map((item) => item.id === 'about' && runtime.kind === 'web' ? { ...item, description: '产品与 Web 版信息' } : item), [normalizedSearch, runtime.hasLocalLibrary, runtime.kind])
  const visibleCategoryKey = visibleCategories.map((item) => item.id).join(',')
  const activeCategory = visibleCategories.some((item) => item.id === category) ? category : visibleCategories[0]?.id ?? null

  useEffect(() => {
    if (activeCategory && activeCategory !== category) setCategory(activeCategory)
  }, [activeCategory, category, visibleCategoryKey])

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const backdrop = modalRef.current?.parentElement
    const backgroundElements = backdrop?.parentElement
      ? Array.from(backdrop.parentElement.children)
        .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== backdrop)
        .map((element) => ({ element, inert: element.hasAttribute('inert'), ariaHidden: element.getAttribute('aria-hidden') }))
      : []
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !modalRef.current) return
      const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]'))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    const previousOverflow = document.body.style.overflow
    backgroundElements.forEach(({ element }) => {
      element.setAttribute('inert', '')
      element.setAttribute('aria-hidden', 'true')
    })
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleDialogKeys)
    modalRef.current?.focus({ preventScroll: true })
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleDialogKeys)
      backgroundElements.forEach(({ element, inert, ariaHidden }) => {
        if (!inert) element.removeAttribute('inert')
        if (ariaHidden === null) element.removeAttribute('aria-hidden')
        else element.setAttribute('aria-hidden', ariaHidden)
      })
      previousFocus?.focus()
    }
  }, [])

  useEffect(() => {
    if (contentScrollRef.current) contentScrollRef.current.scrollTop = 0
  }, [activeCategory])

  const refreshStorageUsage = () => void Promise.all([estimateStorageUsage(), readPlaybackCacheStats(runtime)]).then(([estimate, playback]) => {
    setStorageUsage(estimate ? formatStorageSize(estimate.usage + (playback?.bytes ?? 0)) : playback ? formatStorageSize(playback.bytes) : '由系统管理')
    setPlaybackCacheUsage(playback ? `${formatStorageSize(playback.bytes)} · ${playback.entries} 首` : runtime.kind === 'web' ? '由浏览器管理' : '尚无缓存')
  })
  useEffect(() => {
    if (activeCategory === 'data') refreshStorageUsage()
  }, [activeCategory])

  const clearCache = async () => {
    if (!cacheConfirming) {
      setCacheConfirming(true)
      setDataStatus('再次点击以确认，不会删除离线音乐和用户数据')
      return
    }
    await onClearCache()
    setCacheConfirming(false)
    setDataStatus('内容缓存已清理，首页将在下次打开时重新加载')
    refreshStorageUsage()
  }

  const runDestructiveDataAction = async (action: 'usage' | 'local') => {
    if (destructiveConfirming !== action) {
      setDestructiveConfirming(action)
      setDataStatus(action === 'usage'
        ? '再次点击以清除播放记录、AI 会话和长期记忆；歌单、收藏与设置将保留'
        : '再次点击以删除应用管理的下载与导入音乐；外部音乐文件夹及原文件将保留')
      return
    }
    if (action === 'usage') await onClearUsageData()
    else await onClearLocalMusic()
  }

  const importLocalFiles = async (files: FileList | null) => {
    const selected = Array.from(files ?? [])
    if (!selected.length) return
    setIsImportingLocal(true)
    setLocalStatus('正在加入离线音乐')
    try {
      await onImportLocalFiles(selected)
      setLocalStatus(`已处理 ${selected.length} 个文件`)
    } catch (error) {
      setLocalStatus(error instanceof Error ? error.message : '未能添加所选文件')
    } finally {
      setIsImportingLocal(false)
      if (localFileInputRef.current) localFileInputRef.current.value = ''
    }
  }

  const formatFolderScan = (folder: LocalMusicFolder) => {
    if (!folder.available) return '文件夹当前不可用'
    if (!folder.lastScannedAt) return '尚未扫描'
    return `${folder.trackCount} 首 · 更新于 ${new Date(folder.lastScannedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
  }

  const selectedCopy = activeCategory
    ? activeCategory === 'about' && runtime.kind === 'web' ? { title: '关于 Echora', description: '产品与 Web 版信息' } : categoryCopy[activeCategory]
    : { title: '未找到设置', description: `没有与“${searchQuery.trim()}”相关的设置。` }
  const updateActionLabel = updateState.result?.action?.type === 'web-refresh'
    ? '立即刷新'
    : updateState.result?.action?.type === 'apk-download'
      ? '下载安装包'
      : updateState.result?.action?.type === 'ipa-download'
        ? '下载安装包'
        : updateState.result?.action?.type === 'tauri-update'
          ? '立即更新'
          : '下载安装包'
  const updateStatusLabel = updateState.phase === 'checking'
    ? '正在检查'
    : updateState.phase === 'available'
      ? updateState.result?.mandatory ? '需要更新' : '新版本可用'
      : updateState.phase === 'current'
        ? '最新版本'
        : updateState.phase === 'unavailable'
          ? '暂不可用'
          : updateState.phase === 'error'
            ? '检查未完成'
            : '未检查'
  const updateSurfaceLabel = runtime.kind === 'web' ? 'Web 版' : runtime.kind === 'desktop' ? '桌面客户端' : '移动客户端'
  const updateDeliveryCopy = runtime.kind === 'web'
    ? '新版本发布后可直接刷新使用，本地数据保持不变。'
    : runtime.kind === 'desktop'
      ? '安装更新后保留本地音乐、歌单与设置。'
      : '安装更新后保留离线音乐、歌单与设置。'
  const updateCheckedAt = updateState.checkedAt ? new Date(updateState.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null
  const releasePublishedAt = updateState.result?.publishedAt ? new Date(updateState.result.publishedAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) : null
  const portalTarget = document.querySelector<HTMLElement>('.client-shell') ?? document.body

  return createPortal(
    <div className="settings-modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={modalRef} className={`settings-modal is-${presentation} ${mobileRoute === 'root' ? 'is-mobile-root' : 'is-mobile-detail'}`} role="dialog" aria-modal="true" aria-label="应用设置" tabIndex={-1} onPointerDown={(event) => event.stopPropagation()}>
        <aside className="settings-navigation">
          <header className="settings-navigation-brand"><div><strong>应用设置</strong><small>偏好与设备</small></div><button className="settings-mobile-close" onClick={onClose} aria-label="关闭设置"><X size={18} /></button></header>
          <label className="settings-search"><Search size={17} /><input name="settings-search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索设置" aria-label="搜索设置" />{searchQuery && <button onClick={() => setSearchQuery('')} title="清除搜索" aria-label="清除设置搜索"><X size={15} /></button>}</label>
          <nav className="settings-category-nav" aria-label="设置分类">
            {visibleCategories.map((item) => {
              const Icon = item.icon
              return <button key={item.id} className={activeCategory === item.id ? 'is-active' : ''} aria-current={activeCategory === item.id ? 'page' : undefined} onClick={() => openCategory(item.id)}><Icon size={18} /><span><strong>{item.label}</strong><small>{item.description}</small></span><ChevronRight className="settings-category-chevron" size={17} /></button>
            })}
          </nav>
          {!visibleCategories.length && <div className="settings-navigation-empty"><Search size={18} /><span>没有匹配的分类</span></div>}
          <footer><HardDrive size={15} /><span>{runtime.kind === 'web' ? '当前浏览器' : runtime.kind === 'desktop' ? '当前电脑' : '当前设备'}</span></footer>
        </aside>

        <div className="settings-content">
          <header className="settings-content-header">
            {presentation === 'mobile' && <button className="settings-mobile-back" onClick={() => setMobileRoute('root')} aria-label="返回设置"><ChevronLeft size={21} /></button>}
            <div><h2>{selectedCopy.title}</h2><p>{selectedCopy.description}</p></div>
            <button onClick={onClose} title="关闭" aria-label="关闭应用设置"><X size={19} /></button>
          </header>

          <div ref={contentScrollRef} className="settings-content-scroll">
            {!activeCategory && <div className="settings-search-empty"><Search size={28} /><strong>没有找到相关设置</strong><span>尝试搜索“音质”“缓存”或“模型”</span></div>}

            {activeCategory === 'general' && <>
              <section className="settings-page-section">
                <header><History size={18} /><span><strong>启动与恢复</strong><small>启动页与播放状态</small></span></header>
                <div className="settings-page-row is-choice-row"><span><strong>启动页</strong><small>应用打开后的默认位置</small></span><div className="settings-choice" aria-label="启动页"><button className={settings.startupView === 'library' ? 'is-active' : ''} onClick={() => update('startupView', 'library')}>音乐库</button><button className={settings.startupView === 'field' ? 'is-active' : ''} onClick={() => update('startupView', 'field')}>音乐场</button></div></div>
                <div className="settings-page-row"><span><strong>恢复上次播放</strong><small>队列、歌曲、进度与音量</small></span><SettingToggle checked={settings.resumePlayback} onChange={() => settings.resumePlayback ? onClearSession() : update('resumePlayback', true)} label="恢复上次播放" /></div>
              </section>
              {runtime.canControlWindow && <section className="settings-page-section">
                <header><MonitorUp size={18} /><span><strong>窗口行为</strong><small>关闭主窗口后的操作</small></span></header>
                <div className="settings-page-row is-choice-row"><span><strong>关闭窗口时</strong><small>隐藏到后台可继续播放</small></span><div className="settings-choice" aria-label="关闭窗口时"><button className={settings.closeBehavior === 'background' ? 'is-active' : ''} onClick={() => update('closeBehavior', 'background')}>隐藏到后台</button><button className={settings.closeBehavior === 'quit' ? 'is-active' : ''} onClick={() => update('closeBehavior', 'quit')}>退出应用</button></div></div>
              </section>}
              <section className="settings-page-section">
                <header><Gauge size={18} /><span><strong>操作与反馈</strong><small>调整常用播放操作和动态反馈</small></span></header>
                <div className="settings-page-row is-choice-row"><span><strong>快进与快退</strong><small>歌曲模式下按左右方向键时跳转的时间</small></span><div className="settings-choice is-compact" aria-label="快进与快退步长">{seekStepOptions.map((seconds) => <button key={seconds} className={settings.seekStepSeconds === seconds ? 'is-active' : ''} onClick={() => update('seekStepSeconds', seconds as SeekStepSeconds)}>{seconds} 秒</button>)}</div></div>
                <div className="settings-page-row"><span><strong>减少动态效果</strong><small>弱化浮层、波形和装饰动画，保留必要的状态反馈</small></span><SettingToggle checked={settings.reduceMotion} onChange={() => update('reduceMotion', !settings.reduceMotion)} label="减少动态效果" /></div>
              </section>
            </>}

            {activeCategory === 'source' && <>
              <section className="settings-page-section"><header><RadioTower size={18} /><span><strong>在线音乐</strong><small>由 Echora Cloud 统一维护平台连接与解析策略</small></span></header><div className="settings-page-row is-field-row"><span><strong>服务状态</strong><small>QQ 音乐、网易云、酷我、酷狗与咪咕</small></span><div className="settings-static-field"><RadioTower size={16} /><span><strong>{sourceStatus?.message ?? '正在连接'}</strong><small>{sourceStateLabel}</small></span></div></div></section>
              <section className="settings-page-section">
                <header><Music2 size={18} /><span><strong>播放偏好</strong><small>选择默认音质以及内容不可用时的处理方式</small></span></header>
                <div className="settings-page-row"><span><strong>默认音质</strong><small>优先请求；不可用时按播放策略降级</small></span><GlassSelect ariaLabel="默认音质" value={settings.musicSource.preferredQuality} options={[{ value: 'high', label: '高品质', description: '320K' }, { value: 'lossless', label: '无损', description: 'FLAC' }, { value: 'hires', label: 'Hi-Res', description: '高解析度' }]} onChange={(value) => updateMusicSource('preferredQuality', value as MusicSourceQuality)} /></div>
                <div className="settings-page-row"><span><strong>不可用时自动切换</strong><small>按歌曲可用性选择其他平台或更低音质</small></span><SettingToggle checked={settings.musicSource.autoFallback} onChange={() => updateMusicSource('autoFallback', !settings.musicSource.autoFallback)} label="音质不可用时自动切换" /></div>
              </section>
              {(canUseSystemMediaControls || canKeepPlaybackAwake) && <section className="settings-page-section">
                <header><MonitorUp size={18} /><span><strong>设备控制</strong><small>让播放与当前设备的系统能力保持一致</small></span></header>
                {canUseSystemMediaControls && <div className="settings-page-row"><span><strong>系统媒体控制</strong><small>在锁屏、耳机和系统媒体面板中显示歌曲并控制播放</small></span><SettingToggle checked={playbackSettings.systemMediaControls} onChange={() => updatePlayback('systemMediaControls', !playbackSettings.systemMediaControls)} label="系统媒体控制" /></div>}
                {canKeepPlaybackAwake && <div className="settings-page-row"><span><strong>播放时保持屏幕唤醒</strong><small>播放期间保持屏幕常亮；锁屏或离开应用后由系统接管</small></span><SettingToggle checked={playbackSettings.keepAwakeWhilePlaying} onChange={() => updatePlayback('keepAwakeWhilePlaying', !playbackSettings.keepAwakeWhilePlaying)} label="播放时保持屏幕唤醒" /></div>}
              </section>}
              <section className="settings-page-section">
                <header><Download size={18} /><span><strong>下载偏好</strong><small>下载与离线保存使用独立于在线播放的规格</small></span></header>
                <div className="settings-page-row is-field-row"><span><strong>下载音质</strong><small>保存到设备时优先请求的音频规格</small></span><GlassSelect ariaLabel="下载音质" value={settings.musicSource.downloadQuality} options={[{ value: 'high', label: '高品质', description: '320K' }, { value: 'lossless', label: '无损', description: 'FLAC' }, { value: 'hires', label: 'Hi-Res', description: '高解析度' }]} onChange={(value) => updateMusicSource('downloadQuality', value as MusicSourceQuality)} /></div>
                <div className="settings-page-row is-field-row"><span><strong>文件名称</strong><small>用于浏览器下载和本地歌曲导出</small></span><GlassSelect ariaLabel="下载文件名称" value={settings.musicSource.downloadFileNameFormat} options={[{ value: 'artist-title', label: '艺人 - 歌曲', description: '便于按艺人整理' }, { value: 'title-artist', label: '歌曲 - 艺人', description: '便于按歌曲浏览' }]} onChange={(value) => updateMusicSource('downloadFileNameFormat', value as DownloadFileNameFormat)} /></div>
              </section>
              <section className={`settings-page-status ${sourceReady ? 'is-ready' : ''}`}><span>{sourceReady ? <CheckCircle2 size={19} /> : <RadioTower size={19} />}</span><div><strong>{sourceStatus?.message ?? '正在连接音乐服务'}</strong><small>{sourceStateLabel} · {qualityLabels[settings.musicSource.preferredQuality]}优先 · 服务策略由 Echora 维护</small></div></section>
            </>}

            {activeCategory === 'content' && <>
              <section className="settings-page-section">
                <header><Sparkles size={18} /><span><strong>推荐方式</strong><small>控制每日推荐如何使用当前设备上的收藏偏好</small></span></header>
                <div className="settings-page-row"><span><strong>根据收藏调整推荐</strong><small>使用账户中的收藏偏好优化推荐</small></span><SettingToggle checked={settings.content.personalizedRecommendations} onChange={() => updateContent('personalizedRecommendations', !settings.content.personalizedRecommendations)} label="根据收藏调整推荐" /></div>
              </section>
              <section className="settings-page-section content-limit-section">
                <header><BarChart3 size={18} /><span><strong>榜单集</strong><small>控制进入平台榜单时加载的歌曲数量</small></span></header>
                <div className="content-limit-setting"><span><strong>每个榜单最多加载</strong><small>数量越多，首次打开需要的时间可能越长</small></span><div className="content-limit-options" role="radiogroup" aria-label="榜单集歌曲数">{chartTrackLimitOptions.map((limit) => <button key={limit} role="radio" aria-checked={settings.content.chartTrackLimit === limit} className={settings.content.chartTrackLimit === limit ? 'is-active' : ''} onClick={() => updateContent('chartTrackLimit', limit as ChartTrackLimit)}>{`${limit} 首`}</button>)}</div></div>
              </section>
              <section className="settings-page-section content-limit-section">
                <header><Sparkles size={18} /><span><strong>精选集</strong><small>控制主题推荐与首页聚合的歌曲数量</small></span></header>
                <div className="content-limit-setting"><span><strong>每个精选集最多收录</strong><small>同时用于每日推荐与全平台新热聚合</small></span><div className="content-limit-options" role="radiogroup" aria-label="精选集歌曲数">{featuredTrackLimitOptions.map((limit) => <button key={limit} role="radio" aria-checked={settings.content.featuredTrackLimit === limit} className={settings.content.featuredTrackLimit === limit ? 'is-active' : ''} onClick={() => updateContent('featuredTrackLimit', limit as FeaturedTrackLimit)}>{`${limit} 首`}</button>)}</div></div>
              </section>
              <section className="settings-page-note"><ShieldCheck size={18} /><span><strong>个人音乐始终完整显示</strong><small>喜欢、本地、当前编排和我的歌单不会被集合数量限制截断。</small></span></section>
            </>}

            {activeCategory === 'local' && <>
              <section className="settings-page-section local-storage-section">
                <header><HardDrive size={18} /><span><strong>离线资料库</strong><small>下载与导入内容统一保存在 Echora</small></span></header>
                <div className="settings-page-row is-field-row"><span><strong>存储位置</strong><small>删除本地副本后，将释放对应存储空间</small></span><div className="settings-static-field local-library-location"><HardDrive size={16} /><span><strong>{localCount} 首离线音乐</strong><small title={localLibraryLocation}>{localLibraryLocation || runtime.localLibraryLabel}</small></span></div></div>
              </section>

              <section className="settings-page-section local-source-section">
                <header><FolderPlus size={18} /><span><strong>{runtime.kind === 'desktop' ? '音乐文件夹' : '从设备添加'}</strong><small>{runtime.kind === 'desktop' ? '添加常用目录，Echora 会识别其中的音频' : '从系统文件选择器加入音频'}</small></span></header>
                {runtime.kind === 'desktop' && <div className="local-folder-list">
                  {localFolders.map((folder) => {
                    const busy = localFolderBusyIds.includes(folder.id)
                    return <article key={folder.id} className={`${folder.available ? '' : 'is-unavailable'} ${busy ? 'is-busy' : ''}`}><span className="local-folder-icon"><HardDrive size={18} /></span><span className="local-folder-copy"><strong>{folder.name}</strong><small title={folder.path}>{folder.path}</small><em>{busy ? '正在扫描音乐文件' : formatFolderScan(folder)}</em></span><span className="local-folder-actions"><button onClick={() => void onRescanLocalFolder(folder)} disabled={busy || !folder.available} title="重新扫描" aria-label={`重新扫描 ${folder.name}`}><FolderSync size={16} /></button><button onClick={() => void onRemoveLocalFolder(folder.id)} disabled={busy} title="移除来源" aria-label={`移除来源 ${folder.name}`}><X size={16} /></button></span></article>
                  })}
                  {!localFolders.length && <div className="local-folder-empty"><FolderPlus size={19} /><span><strong>尚未添加音乐文件夹</strong><small>添加常用目录后，其中的音频会加入离线资料库。</small></span></div>}
                </div>}
                <div className="local-source-actions">
                  {runtime.kind === 'desktop' && <button className="is-primary" onClick={() => void onAddLocalFolders()}><FolderPlus size={17} /><span><strong>添加音乐文件夹</strong><small>支持选择多个目录</small></span></button>}
                  <button className={runtime.kind === 'mobile' ? 'is-primary' : ''} onClick={() => localFileInputRef.current?.click()} disabled={isImportingLocal}><FileAudio2 size={17} /><span><strong>{isImportingLocal ? '正在添加' : '导入音频文件'}</strong><small>{runtime.kind === 'mobile' ? '从设备文件中选择' : '适合零散音频文件'}</small></span></button>
                </div>
                <input ref={localFileInputRef} className="visually-hidden" type="file" accept={runtime.kind === 'mobile' ? '.mp3,.flac,.m4a,.aac,.ogg,.opus,.wav' : 'audio/*,.mp3,.flac,.m4a,.aac,.ogg,.opus,.wav,.aiff,.aif,.ape,.wma'} multiple onChange={(event) => void importLocalFiles(event.target.files)} aria-label="选择本地音频文件" />
              </section>
              {runtime.kind === 'desktop' && <section className="settings-page-section">
                <header><FolderSync size={18} /><span><strong>资料库更新</strong><small>管理已添加音乐文件夹的后台扫描方式</small></span></header>
                <div className="settings-page-row"><span><strong>启动后扫描音乐文件夹</strong><small>在后台识别新增音频，不阻塞音乐库打开</small></span><SettingToggle checked={settings.storage.autoScanLocalFolders} onChange={() => updateStorage('autoScanLocalFolders', !settings.storage.autoScanLocalFolders)} label="启动后扫描音乐文件夹" /></div>
              </section>}
              {localStatus && <div className="data-settings-status" role="status">{localStatus}</div>}
              {runtime.kind === 'desktop' && <section className="settings-page-note"><ShieldCheck size={18} /><span><strong>文件夹仅作为音乐来源</strong><small>移除来源不会影响已经加入离线资料库的歌曲。</small></span></section>}
              {runtime.kind === 'mobile' && <section className="settings-page-note"><ShieldCheck size={18} /><span><strong>离线内容由 Echora 管理</strong><small>本地歌曲可在音乐列表中导出或移除。</small></span></section>}
            </>}

            {activeCategory === 'ai' && <>
              <section className="settings-page-section">
                <header><Bot size={18} /><span><strong>AI 模式</strong><small>Echora AI 或自定义模型</small></span></header>
                <div className="settings-page-row is-choice-row"><span><strong>音乐场</strong><small>选择 AI 服务</small></span><div className="settings-choice"><button className={settings.ai.mode === 'echora' ? 'is-active' : ''} onClick={() => updateAi('mode', 'echora')}>Echora AI</button><button className={settings.ai.mode === 'custom' ? 'is-active' : ''} onClick={() => updateAi('mode', 'custom')}>自定义 AI</button></div></div>
                {settings.ai.mode === 'echora' ? <div className="settings-page-row is-field-row"><span><strong>账户</strong><small>使用 Echora AI 需要登录</small></span><div className="settings-account-action-field"><Cloud size={16} /><span><strong>{managedAiLabel}</strong><small>{managedAiDetail}</small></span>{!cloudSession && onOpenAccount && <button type="button" onClick={onOpenAccount}>登录</button>}</div></div> : <>
                  <div className="settings-page-row is-field-row"><span><strong>服务商</strong><small>凭据加密保存在账户中</small></span><GlassSelect ariaLabel="AI 服务商" value={settings.ai.provider} options={[{ value: 'openai', label: 'OpenAI', description: 'Responses API' }, { value: 'anthropic', label: 'Anthropic', description: 'Messages API' }, { value: 'compatible', label: 'OpenAI 兼容接口', description: 'Chat Completions' }, { value: 'ollama', label: 'Ollama', description: '本地模型' }]} onChange={(value) => selectProvider(value as AiProvider)} /></div>
                  <label className="settings-page-row is-field-row"><span><strong>接口地址</strong><small>模型服务的 API 基础地址</small></span><input name="ai-base-url" type="url" aria-label="AI 接口地址" value={settings.ai.baseUrl} onChange={(event) => updateAi('baseUrl', event.target.value)} placeholder="https://api.example.com/v1" spellCheck={false} /></label>
                  <label className="settings-page-row is-field-row"><span><strong>模型</strong><small>服务端提供的模型标识</small></span><input name="ai-model" aria-label="AI 模型" value={settings.ai.model} onChange={(event) => updateAi('model', event.target.value)} placeholder="输入模型标识" spellCheck={false} /></label>
                  <label className="settings-page-row is-field-row"><span><strong>API 密钥</strong><small>{cloudSession ? '加密保存在账户中' : '登录后保存到账户'}</small></span><div className="ai-secret-field"><input name="ai-api-key" type={showApiKey ? 'text' : 'password'} aria-label="AI API 密钥" value={settings.ai.apiKey} onChange={(event) => updateAi('apiKey', event.target.value)} placeholder={requiresApiKey ? '输入 API 密钥' : '选填'} autoComplete="off" spellCheck={false} /><button type="button" onClick={() => setShowApiKey((visible) => !visible)} title={showApiKey ? '隐藏密钥' : '显示密钥'} aria-label={showApiKey ? '隐藏 API 密钥' : '显示 API 密钥'}>{showApiKey ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
                </>}
              </section>
              <section className="settings-page-section">
                <header><Sparkles size={18} /><span><strong>长期偏好</strong><small>从会话中归纳稳定习惯</small></span></header>
                <div className="settings-page-row"><span><strong>自动学习明确偏好</strong><small>仅记录重复或明确表达的长期要求</small></span><SettingToggle checked={settings.ai.autoLearnPreferences !== false} onChange={() => updateAi('autoLearnPreferences', settings.ai.autoLearnPreferences === false)} label="自动学习明确偏好" /></div>
              </section>
              <section className={`settings-page-status ${aiConfigured ? 'is-ready' : ''}`}><span>{aiConfigured ? <CheckCircle2 size={19} /> : <Bot size={19} />}</span><div><strong>{aiConfigured ? 'AI 服务可用' : settings.ai.mode === 'echora' ? !cloudSession ? '登录后启用 Echora AI' : managedAiStatus === 'unreachable' ? '无法连接 Echora Cloud' : managedAiStatus === 'checking' ? '正在连接 Echora Cloud' : 'Echora AI 暂不可用' : '连接信息不完整'}</strong><small>{aiConfigured ? settings.ai.mode === 'echora' ? '异常时切换至本地编排' : `${providerLabels[settings.ai.provider]} · ${settings.ai.model}` : settings.ai.mode === 'echora' && managedAiStatus === 'unreachable' ? '音乐场已切换至本地编排' : '音乐场将使用本地编排'}</small></div></section>
              <section className="settings-page-note"><ShieldCheck size={18} /><span><strong>数据范围</strong><small>仅发送音乐场所需的会话上下文。</small></span></section>
            </>}

            {activeCategory === 'data' && <>
              <section className="settings-page-section data-settings-section">
                <header><Database size={18} /><span><strong>缓存与空间</strong><small>{runtime.kind === 'web' ? '浏览器' : '本机'}已使用约 {storageUsage}</small></span></header>
                <div className="settings-section-body">
                  {runtime.kind === 'web' ? (
                    <div className="settings-page-row is-field-row"><span><strong>播放缓存</strong><small>网页端由浏览器按站点存储策略自动管理</small></span><span className="settings-inline-value"><strong>系统管理</strong><small>不占用 Echora 本地音乐空间</small></span></div>
                  ) : (
                    <div className="settings-page-row is-field-row"><span><strong>播放缓存上限</strong><small>当前 {playbackCacheUsage}，达到上限后优先回收最早使用的歌曲</small></span><GlassSelect ariaLabel="播放缓存上限" value={String(settings.storage.playbackCacheLimitMb)} options={playbackCacheLimitOptions.map((limit) => ({ value: String(limit), label: limit < 1024 ? `${limit} MB` : `${limit / 1024} GB`, description: limit === 2048 ? '推荐' : limit < 1024 ? '节省空间' : limit > 2048 ? '保留更多歌曲' : '均衡' }))} onChange={(value) => updateStorage('playbackCacheLimitMb', Number(value) as PlaybackCacheLimit)} /></div>
                  )}
                  <p>清理不影响歌单、收藏、会话、凭据与本地音乐。</p>
                  <div className="data-action-list">
                    <div className={`data-action-row is-maintenance ${cacheConfirming ? 'is-confirming' : ''}`}><span><i><Trash2 size={17} /></i><span><strong>{cacheConfirming ? '确认清理缓存' : '清理缓存'}</strong><small>移除可重建的发现、榜单、搜索和播放缓存</small></span></span><button className="data-action-button" aria-label={cacheConfirming ? '确认清理缓存' : '清理缓存'} onClick={clearCache}>{cacheConfirming ? '确认清理' : '清理'}</button></div>
                  </div>
                </div>
              </section>
              <section className="settings-page-section data-settings-section">
                <header><History size={18} /><span><strong>设备数据</strong><small>管理当前设备上的历史快照与音乐资源</small></span></header>
                <div className="settings-section-body">
                  <div className="data-action-list">
                    <div className={`data-action-row ${destructiveConfirming === 'usage' ? 'is-confirming' : ''}`}><span><i><History size={17} /></i><span><strong>{destructiveConfirming === 'usage' ? '确认清除本机历史' : '清除本机历史'}</strong><small>移除播放快照；账户数据不受影响</small></span></span><button className="data-action-button" onClick={() => void runDestructiveDataAction('usage')}>{destructiveConfirming === 'usage' ? '确认清除' : '清除'}</button></div>
                    {runtime.hasLocalLibrary && <div className={`data-action-row ${destructiveConfirming === 'local' ? 'is-confirming' : ''}`}><span><i><HardDrive size={17} /></i><span><strong>{destructiveConfirming === 'local' ? '确认清除本地音乐' : '清除本地音乐'}</strong><small>删除 {localCount} 首应用管理的下载与导入音乐；外部文件夹和原文件不受影响</small></span></span><button className="data-action-button" onClick={() => void runDestructiveDataAction('local')} disabled={!localCount}>{destructiveConfirming === 'local' ? '确认清除' : '清除'}</button></div>}
                  </div>
                </div>
              </section>
              {dataStatus && <div className="data-settings-status" role="status">{dataStatus}</div>}
              <section className="settings-page-note"><ShieldCheck size={18} /><span><strong>账户数据</strong><small>离线更改将在恢复连接后提交。</small></span></section>
            </>}

            {activeCategory === 'about' && <>
              <section className="settings-page-section application-update-section">
                <div className="application-product-identity"><span className="application-product-mark"><BrandMark /></span><span><strong>Echora</strong><small>智能音乐工作空间</small></span></div>
                <div className="application-version-summary">
                  {runtime.kind === 'web'
                    ? <div><span>使用方式</span><strong>Web 版</strong><small><em>当前浏览器</em><em>云端</em></small></div>
                    : <><div><span>当前版本</span><strong>v{applicationVersion}</strong><small><em>{updateSurfaceLabel}</em><em>正式版</em></small></div><span className={`application-update-badge is-${updateState.phase}`}>{updateStatusLabel}</span></>}
                </div>
              </section>
              {runtime.native && <section className="settings-page-section application-update-control">
                <header><RefreshCw size={18} /><span><strong>软件更新</strong><small>自动匹配适用于当前设备的版本</small></span></header>
                <div className="application-update-message" role="status" aria-live="polite">
                  <div><strong>{updateState.message}</strong><small>{updateCheckedAt ? `上次检查 ${updateCheckedAt}` : '可随时手动检查新版本'}</small></div>
                  <button disabled={updateState.phase === 'checking'} onClick={() => void onCheckForUpdates()}>{updateState.phase === 'checking' ? '检查中' : updateState.checkedAt ? '重新检查' : '检查更新'}</button>
                </div>
                {updateState.phase === 'available' && updateState.result && <div className="application-release-notes"><div><strong>v{updateState.result.latestVersion} 更新内容</strong>{releasePublishedAt && <small>{releasePublishedAt}</small>}</div><p>{updateState.result.releaseNotes || '包含稳定性与体验改进。'}</p></div>}
                {updateState.phase === 'available' && updateState.result?.action && <div className="application-update-actions"><button className="is-primary" onClick={() => void onApplyUpdate()}>{updateActionLabel}<ExternalLink size={16} /></button></div>}
              </section>}
              {runtime.native && <section className="settings-page-note"><ShieldCheck size={18} /><span><strong>{updateSurfaceLabel}</strong><small>{updateDeliveryCopy}</small></span></section>}
            </>}
          </div>
        </div>
      </section>
    </div>,
    portalTarget,
  )
}
