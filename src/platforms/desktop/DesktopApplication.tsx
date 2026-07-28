import { lazy, Suspense, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Check, Info, LibraryBig, MessageCircleMore, Minus, Moon, Palette, Settings2, Square, Sun, X } from 'lucide-react'
import { useEchoraController } from '../../App'
import BrandMark from '../../components/BrandMark'
import GlobalPlayer from '../../components/GlobalPlayer'
import LibrarySpace from '../../components/LibrarySpace'
import { isAiConfigured } from '../../listeningAgent'
import '../../styles.css'
import '../../material.css'
import './desktop.css'
// Product UI is the intentional final cascade layer for shared component polish.
import '../../product-ui.css'

const loadAgentSessionSpace = () => import('../../components/AgentSessionSpace')
const loadAccountSpace = () => import('../../components/AccountSpace')
const loadAudioEffectsPanel = () => import('../../components/AudioEffectsPanel')
const loadNowPlayingSpace = () => import('../../components/NowPlayingSpace')
const loadSettingsPanel = () => import('../../components/SettingsPanel')
const loadSourceStatusPanel = () => import('../../components/SourceStatusPanel')
const AgentSessionSpace = lazy(loadAgentSessionSpace)
const AccountSpace = lazy(loadAccountSpace)
const AudioEffectsPanel = lazy(loadAudioEffectsPanel)
const NowPlayingSpace = lazy(loadNowPlayingSpace)
const SettingsPanel = lazy(loadSettingsPanel)
const SourceStatusPanel = lazy(loadSourceStatusPanel)

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button className={`deck-toggle ${checked ? 'is-on' : ''}`} onClick={onChange} aria-pressed={checked} title={label} aria-label={label}><span /></button>
}

export default function DesktopApplication() {
  const app = useEchoraController()
  const isNativeDesktop = app.runtime.kind === 'desktop'
  const [windowMaximized, setWindowMaximized] = useState(false)

  useEffect(() => {
    if (!isNativeDesktop) return
    let unlisten: (() => void) | undefined
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const currentWindow = getCurrentWindow()
      const update = async () => setWindowMaximized(await currentWindow.isMaximized())
      await update()
      unlisten = await currentWindow.onResized(() => { void update() })
    })
    return () => unlisten?.()
  }, [isNativeDesktop])

  return (
    <div className={`client-shell ${app.activeTrack ? 'has-global-player' : ''}`} data-platform-entry="desktop" data-style={app.appearance} data-palette={app.activePalette} data-workspace={app.workspace} data-runtime={app.runtime.kind} data-form-factor="desktop" data-window-maximized={windowMaximized ? 'true' : 'false'} data-reduced-motion={app.appSettings.reduceMotion ? 'true' : 'false'}>
      <header className="client-header" data-tauri-drag-region onPointerDown={app.startWindowDrag}>
        <div className="brand-lockup" data-tauri-drag-region>
          {isNativeDesktop && <div className="window-controls">
            <button className="window-close" onClick={() => app.controlWindow('close')} title="关闭" aria-label="关闭"><X size={9} /></button>
            <button className="window-minimize" onClick={() => app.controlWindow('minimize')} title="最小化" aria-label="最小化"><Minus size={9} /></button>
            <button className="window-maximize" onClick={() => app.controlWindow('maximize')} title="最大化" aria-label="最大化"><Square size={8} /></button>
          </div>}
          <button className="brand-home-button" onClick={() => app.navigateLibrary({ type: 'home' })} title="返回音乐首页" aria-label="Echora，返回音乐首页">
            <span className="brand-glyph" aria-hidden="true"><BrandMark /></span>
            <span className="brand-copy"><strong className="brand-wordmark">Echora</strong></span>
          </button>
        </div>

        <nav className="workspace-switch" aria-label="工作空间">
          <button className={app.navigationWorkspace === 'library' ? 'is-active' : ''} onClick={() => app.changeWorkspace('library')}><LibraryBig size={16} /><span>音乐库</span></button>
          <button className={`workspace-agent-button ${app.navigationWorkspace === 'field' ? 'is-active' : ''}`} onPointerEnter={() => void loadAgentSessionSpace()} onFocus={() => void loadAgentSessionSpace()} onClick={() => app.openAgentView('conversation')}><MessageCircleMore size={16} /><span>音乐场</span><em className="workspace-ai-badge">AI</em></button>
        </nav>

        <div className="header-signal" ref={app.headerControlsRef}>
          <div className="header-control theme-control">
            <button className={`theme-menu-trigger ${app.headerPanel === 'theme' ? 'is-active' : ''}`} onClick={() => app.toggleHeaderPanel('theme')} title="选择主题" aria-label="选择主题"><Palette size={18} /></button>
            {app.headerPanel === 'theme' && <div className="theme-menu" role="dialog" aria-label="外观设置">
              <div className="theme-menu-head"><span><strong>外观</strong><small>界面与应用标识同步预览</small></span><em>{app.followTrackPalette ? '随音乐' : app.activePaletteDefinition.label}</em></div>
              <div className="theme-live-preview" style={{ '--preview-accent': app.activeAccent } as CSSProperties}><span className="theme-preview-mark" /><div><i /><i /><i /></div><b /></div>
              <div className="appearance-options" aria-label="明暗风格">
                <button className={app.appearance === 'dark' ? 'is-active' : ''} onClick={() => app.setAppearance('dark')}><span><Moon size={16} /><strong>暗黑</strong></span><small>低照度玻璃界面</small>{app.appearance === 'dark' && <Check size={14} />}</button>
                <button className={app.appearance === 'light' ? 'is-active' : ''} onClick={() => app.setAppearance('light')}><span><Sun size={16} /><strong>明亮</strong></span><small>清透浅色界面</small>{app.appearance === 'light' && <Check size={14} />}</button>
              </div>
              <div className="palette-section"><span><strong>主题色</strong><small>{app.appearance === 'dark' ? '暗黑模式' : '明亮模式'}</small></span><div className="palette-grid">
                {app.palettes.map((item) => <button key={item.id} className={app.activePalette === item.id ? 'is-active' : ''} onClick={() => { app.setPaletteByAppearance((current) => ({ ...current, [app.appearance]: item.id })); app.setFollowTrackPalette(false) }} title={`${item.label}主题色`} aria-label={`${item.label}配色`}><i style={{ backgroundColor: app.appearance === 'dark' ? item.dark : item.light }} />{app.activePalette === item.id && <Check size={12} />}</button>)}
              </div></div>
              <div className="theme-auto-row"><span><strong>配色随音乐变化</strong><small>只改变强调色，明暗风格保持不变</small></span><Toggle checked={app.followTrackPalette} onChange={() => app.setFollowTrackPalette(!app.followTrackPalette)} label="配色随音乐变化" /></div>
            </div>}
          </div>
          <div className="header-control source-control">
            <button className={`signal-live ${app.headerPanel === 'sources' ? 'is-active' : ''} is-status-${app.sourceStatus.phase} ${app.sourceConfigured ? '' : 'is-unconfigured'}`} onPointerEnter={() => void loadSourceStatusPanel()} onFocus={() => void loadSourceStatusPanel()} onClick={() => app.toggleHeaderPanel('sources')} title={`音乐服务：${app.sourcePhaseLabels[app.sourceStatus.phase]}`} aria-label={`音乐服务：${app.sourcePhaseLabels[app.sourceStatus.phase]}`}><i /><span>服务</span></button>
            {app.headerPanel === 'sources' && <Suspense fallback={null}><SourceStatusPanel settings={app.appSettings.musicSource} status={app.sourceStatus} onRefresh={app.refreshMusicSourceStatus} onConfigure={() => { app.setSettingsInitialView('source'); app.setHeaderPanel('settings') }} /></Suspense>}
          </div>
          <div className="header-control settings-control">
            <button className={app.headerPanel === 'settings' ? 'is-active' : ''} onPointerEnter={() => void loadSettingsPanel()} onFocus={() => void loadSettingsPanel()} onClick={() => { app.setSettingsInitialView('general'); app.toggleHeaderPanel('settings') }} title="应用设置" aria-label="应用设置"><Settings2 size={18} /></button>
            {app.headerPanel === 'settings' && <Suspense fallback={null}><SettingsPanel presentation="desktop" initialView={app.settingsInitialView} settings={app.appSettings} sourceStatus={app.sourceStatus} runtime={app.runtime} localCount={app.downloadedTrackIds.length} localFolders={app.localMusicFolders} localFolderBusyIds={app.localFolderBusyIds} localLibraryLocation={app.localLibraryLocation} updateState={app.applicationUpdate} onCheckForUpdates={() => app.checkApplicationUpdate()} onApplyUpdate={app.installApplicationUpdate} echoraAiAvailable={app.echoraAiAvailable} echoraAiStatus={app.echoraAiStatus} onOpenAccount={app.openAccount} onChange={app.setAppSettings} onClose={() => app.setHeaderPanel(null)} onClearSession={app.clearSavedPlaybackSession} onClearCache={app.clearContentCache} onClearUsageData={app.clearUsageData} onClearLocalMusic={app.clearLocalMusic} onImportLocalFiles={app.importLocalFiles} onAddLocalFolders={app.addLocalMusicFolders} onRescanLocalFolder={app.scanMusicFolder} onRemoveLocalFolder={app.forgetLocalMusicFolder} /></Suspense>}
          </div>
          <div className="header-control"><button className={`avatar-button ${app.accountOpen ? 'is-active' : ''}`} onPointerEnter={() => void loadAccountSpace()} onFocus={() => void loadAccountSpace()} onClick={app.openAccount} title={app.cloudSession ? app.cloudSession.user.displayName : '登录 Echora'} aria-label="Echora 账户"><span>{(app.cloudSession?.user.displayName ?? 'Echora').slice(0, 1).toLocaleUpperCase()}</span></button></div>
        </div>
      </header>

      <DesktopContent app={app} />
      {app.accountOpen && <Suspense fallback={null}><div className="account-modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) app.closeAccount() }}><AccountSpace presentation="dialog" profile={app.userProfile} runtime={app.runtime} onProfileChange={app.applyCloudProfile} onClose={app.closeAccount} /></div></Suspense>}
      {app.notice && <div className={`system-toast is-${app.notice.tone}`} role="status" aria-live="polite" aria-atomic="true">{app.notice.tone === 'success' ? <Check size={15} /> : <Info size={15} />}<span>{app.notice.message}</span></div>}
    </div>
  )
}

function DesktopContent({ app }: { app: ReturnType<typeof useEchoraController> }) {
  const [lyricControlsOpen, setLyricControlsOpen] = useState(false)

  useEffect(() => {
    if (app.workspace !== 'nowPlaying') setLyricControlsOpen(false)
  }, [app.workspace])

  useEffect(() => {
    if (!app.activeTrack) return
    const preload = () => {
      void loadNowPlayingSpace()
      void loadAudioEffectsPanel()
    }
    const idleWindow = window as Window & { requestIdleCallback?: Window['requestIdleCallback']; cancelIdleCallback?: Window['cancelIdleCallback'] }
    if (typeof idleWindow.requestIdleCallback === 'function') {
      const idleId = idleWindow.requestIdleCallback(preload, { timeout: 1200 })
      return () => idleWindow.cancelIdleCallback?.(idleId)
    }
    const timer = window.setTimeout(preload, 300)
    return () => window.clearTimeout(timer)
  }, [app.activeTrack?.id])

  return <>
    <div className={`client-body ${app.workspace === 'field' ? 'is-agent-session' : ''} ${app.workspace === 'nowPlaying' ? 'is-now-playing' : ''} ${app.workspace === 'library' ? 'is-library' : ''} ${app.workspace === 'account' ? 'is-account' : ''}`}>
      {app.workspace === 'field' && <Suspense fallback={null}><AgentSessionSpace sessions={app.agentSessions} memories={app.agentMemories} userName={app.userProfile.displayName} activeSessionId={app.activeAgentSessionId} catalog={app.catalog} activeTrackId={app.activeTrackId} isPlaying={app.isPlaying} runningSessionIds={app.runningAgentSessionIds} agentMode={isAiConfigured(app.appSettings.ai, Boolean(app.cloudSession) && app.echoraAiAvailable) ? 'ai' : 'local'} agentServiceMode={isAiConfigured(app.appSettings.ai, Boolean(app.cloudSession) && app.echoraAiAvailable) ? app.appSettings.ai.mode : 'unconfigured'} navigationRequest={app.agentNavigation} onCreateSession={app.startAgentSession} onMemoriesChange={app.setAgentMemories} onRenameSession={app.renameAgentSession} onDeleteSession={app.deleteAgentSession} onSelectSession={app.selectAgentSession} onTerminateSession={app.terminateAgentSession} onSubmit={app.submitAgentMessage} onPreferencesChange={app.updateAgentPreferences} onApplyProposal={app.applyAgentProposal} onDismissProposal={app.dismissAgentProposal} onUndo={app.undoAgentChange} onPlayTrack={app.playAgentTrack} onMoveTrack={app.moveTrack} onReorderTrack={app.reorderTrack} onReorderTrackTo={app.reorderTrackTo} onRemoveTrack={app.removeTrackFromArrangement} onArrangementZoomChange={app.changeArrangementZoom} onOpenNowPlaying={app.openAgentNowPlaying} onConfigureAi={() => { app.setSettingsInitialView('ai'); app.setHeaderPanel('settings') }} /></Suspense>}
      <main className={`spatial-stage ${app.workspace === 'nowPlaying' ? 'is-now-playing-stage' : ''} ${app.workspace === 'library' ? 'is-library-stage' : ''}`}>
        <div className="workspace-retainer" hidden={app.workspace !== 'library'}><LibrarySpace mobile={false} catalog={app.catalog} queueTracks={app.tracks} playbackContext={app.playbackContext} downloadedTrackIds={app.downloadedTrackIds} activeTrackId={app.activeTrackId} isPlaying={app.isPlaying} likedTrackIds={app.likedTrackIds} onToggleLike={app.toggleLike} onPlayTrack={app.playFromLibrary} onPlayTracks={app.playCollection} onPlayNext={app.playNext} onAddToQueue={app.addToQueue} onDownloadTrack={app.downloadFromLibrary} onCancelDownload={app.cancelDownload} onRemoveDownload={app.removeDownloadFromLibrary} onExportLocalTracks={(tracks) => void app.exportLocalTracks(tracks)} onRemoveFromQueue={app.removeFromPlaybackQueue} onNotice={app.showNotice} onSearchCatalog={app.searchLibraryCatalog} onLoadDiscovery={app.sourceStatus.phase === 'checking' ? undefined : app.loadLibraryDiscovery} onLoadChart={app.loadLibraryChart} busyTrackIds={app.busyTrackIds} downloadStates={app.downloadStates} runtime={app.runtime} contentSettings={app.appSettings.content} navigationRequest={app.libraryNavigation} /></div>
        {app.workspace === 'nowPlaying' && app.activeTrack && <Suspense fallback={null}><NowPlayingSpace track={app.activeTrack} isPlaying={app.isPlaying} progressStore={app.playbackProgressStore} lyrics={app.lyricsState.lines} lyricsStatus={app.lyricsState.status} lyricsMessage={app.lyricsState.message} relatedTracks={app.relatedTracks} reducedMotion={app.appSettings.reduceMotion} mobile={false} onSeek={app.seekPlayback} onPlayTrack={app.playFromLibrary} onOpenArtist={(track) => app.navigateLibrary({ type: 'artist', track })} onOpenAlbum={(track) => app.navigateLibrary({ type: 'album', track })} fontControlsOpen={lyricControlsOpen} onFontControlsOpenChange={setLyricControlsOpen} /></Suspense>}
      </main>
    </div>
    <DesktopPlayer app={app} onOpenLyricSettings={() => setLyricControlsOpen(true)} />
    {app.headerPanel === 'effects' && <Suspense fallback={null}><AudioEffectsPanel settings={app.audioEffects} onChange={app.setAudioEffects} onClose={() => app.setHeaderPanel(null)} /></Suspense>}
  </>
}

function DesktopPlayer({ app, onOpenLyricSettings }: { app: ReturnType<typeof useEchoraController>; onOpenLyricSettings: () => void }) {
  if (!app.activeTrack) return null
  return <GlobalPlayer track={app.activeTrack} isPlaying={app.isPlaying} progressStore={app.playbackProgressStore} volume={app.volume} muted={app.muted} queue={app.tracks} playbackContext={app.playbackContext} playbackMode={app.playbackMode} playbackRate={app.playbackRate} liked={app.likedTrackIds.includes(app.activeTrack.id)} nowPlayingOpen={app.workspace === 'nowPlaying'} effectsOpen={app.headerPanel === 'effects'} sourceVariants={app.sourceVariants} variantBusy={app.resolvingTrackIds.includes(app.activeTrack.id)} enhancedQualityEnabled={app.enhancedQualityEnabled} onTogglePlay={() => app.isPlaying ? app.pausePlayback() : app.resumeTrackPlayback()} onNext={app.nextTrack} onPrevious={app.previousTrack} onSeek={app.seekPlayback} onVolumeChange={app.changeVolume} onToggleMute={app.toggleMute} onOpenNowPlaying={app.toggleNowPlaying} onOpenEffects={() => app.toggleHeaderPanel('effects')} onOpenArrangement={app.openPlaybackArrangement} onPlayTrack={app.playQueueTrack} onCyclePlaybackMode={app.cyclePlaybackMode} onPlaybackRateChange={app.setPlaybackRate} onToggleLike={() => app.toggleLike(app.activeTrack!)} onSourceChange={app.switchPlaybackSource} onQualityChange={app.switchPlaybackQuality} onDownloadTrack={app.runtime.hasLocalLibrary && !app.activeTrack.localFileId ? () => app.downloadFromLibrary(app.activeTrack) : undefined} onCancelDownload={() => app.cancelDownload(app.activeTrack.id)} onExportTrack={app.activeTrack.localFileId ? () => app.exportLocalTracks([app.activeTrack]) : undefined} onShareTrack={(method) => app.shareTrack(app.activeTrack, method)} onOpenLyricSettings={app.workspace === 'nowPlaying' ? onOpenLyricSettings : undefined} downloadBusy={app.busyTrackIds.includes(app.activeTrack.id)} downloadState={app.downloadStates[app.activeTrack.id]} />
}
