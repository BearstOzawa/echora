import { lazy, Suspense, useEffect, useState } from 'react'
import { Check, Info, Moon, Palette, Sun, X } from 'lucide-react'
import { useEchoraController } from '../../App'
import GlobalPlayer from '../../components/GlobalPlayer'
import LibrarySpace from '../../components/LibrarySpace'
import { isAiConfigured } from '../../listeningAgent'
import { resolveMobileShellNavigation } from '../../mobileNavigation'
import type { MobileLibraryNavigationLevel } from '../../mobileNavigation'
import '../../styles.css'
import '../../material.css'
import './mobile.css'
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

export default function MobileApplication() {
  const app = useEchoraController()
  const mobileOs = /Android/i.test(navigator.userAgent) ? 'android' : /iPad|iPhone|iPod/i.test(navigator.userAgent) ? 'ios' : 'web'
  const [libraryNavigationLevel, setLibraryNavigationLevel] = useState<MobileLibraryNavigationLevel>('root')
  const [lyricControlsOpen, setLyricControlsOpen] = useState(false)
  useMobileVisualViewport()

  const mobileNavigation = resolveMobileShellNavigation(app.workspace, libraryNavigationLevel)
  const isLibrarySubpage = mobileNavigation.level === 'detail' || mobileNavigation.level === 'search'

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

  return (
    <div className={`client-shell ${app.activeTrack ? 'has-global-player' : ''} ${isLibrarySubpage ? 'is-library-subpage' : ''}`} data-platform-entry="mobile" data-mobile-os={mobileOs} data-style={app.appearance} data-palette={app.activePalette} data-workspace={app.workspace} data-navigation-level={mobileNavigation.level} data-runtime={app.runtime.kind} data-form-factor="mobile" data-reduced-motion={app.appSettings.reduceMotion ? 'true' : 'false'}>
      {app.headerPanel === 'settings' && <Suspense fallback={null}><SettingsPanel presentation="mobile" initialView={app.settingsInitialView} settings={app.appSettings} sourceStatus={app.sourceStatus} runtime={app.runtime} localCount={app.downloadedTrackIds.length} localLibraryLocation={app.localLibraryLocation} updateState={app.applicationUpdate} onCheckForUpdates={() => app.checkApplicationUpdate()} onApplyUpdate={app.installApplicationUpdate} echoraAiAvailable={app.echoraAiAvailable} echoraAiStatus={app.echoraAiStatus} onOpenAccount={app.openAccount} onChange={app.setAppSettings} onClose={() => app.setHeaderPanel(null)} onClearSession={app.clearSavedPlaybackSession} onClearCache={app.clearContentCache} onClearUsageData={app.clearUsageData} onClearLocalMusic={app.clearLocalMusic} onImportLocalFiles={app.importLocalFiles} /></Suspense>}

      <div className={`client-body ${app.workspace === 'field' ? 'is-agent-session' : ''} ${app.workspace === 'nowPlaying' ? 'is-now-playing' : ''} ${app.workspace === 'library' ? 'is-library' : ''} ${app.workspace === 'account' ? 'is-account' : ''}`}>
        {app.workspace === 'field' && <Suspense fallback={null}><AgentSessionSpace mobile sessions={app.agentSessions} memories={app.agentMemories} userName={app.userProfile.displayName} activeSessionId={app.activeAgentSessionId} catalog={app.catalog} activeTrackId={app.activeTrackId} isPlaying={app.isPlaying} runningSessionIds={app.runningAgentSessionIds} agentMode={isAiConfigured(app.appSettings.ai, Boolean(app.cloudSession) && app.echoraAiAvailable) ? 'ai' : 'local'} agentServiceMode={isAiConfigured(app.appSettings.ai, Boolean(app.cloudSession) && app.echoraAiAvailable) ? app.appSettings.ai.mode : 'unconfigured'} navigationRequest={app.agentNavigation} onCreateSession={app.startAgentSession} onMemoriesChange={app.setAgentMemories} onRenameSession={app.renameAgentSession} onDeleteSession={app.deleteAgentSession} onSelectSession={app.selectAgentSession} onTerminateSession={app.terminateAgentSession} onSubmit={app.submitAgentMessage} onPreferencesChange={app.updateAgentPreferences} onApplyProposal={app.applyAgentProposal} onDismissProposal={app.dismissAgentProposal} onUndo={app.undoAgentChange} onPlayTrack={app.playAgentTrack} onMoveTrack={app.moveTrack} onReorderTrack={app.reorderTrack} onReorderTrackTo={app.reorderTrackTo} onRemoveTrack={app.removeTrackFromArrangement} onArrangementZoomChange={app.changeArrangementZoom} onOpenNowPlaying={app.openAgentNowPlaying} onConfigureAi={() => { app.setSettingsInitialView('ai'); app.setHeaderPanel('settings') }} /></Suspense>}
        <main className={`spatial-stage ${app.workspace === 'nowPlaying' ? 'is-now-playing-stage' : ''} ${app.workspace === 'library' ? 'is-library-stage' : ''}`}>
          <div className="workspace-retainer" hidden={app.workspace !== 'library'}><LibrarySpace mobile catalog={app.catalog} queueTracks={app.tracks} playbackContext={app.playbackContext} downloadedTrackIds={app.downloadedTrackIds} activeTrackId={app.activeTrackId} isPlaying={app.isPlaying} likedTrackIds={app.likedTrackIds} onToggleLike={app.toggleLike} onPlayTrack={app.playFromLibrary} onPlayTracks={app.playCollection} onPlayNext={app.playNext} onAddToQueue={app.addToQueue} onDownloadTrack={app.downloadFromLibrary} onCancelDownload={app.cancelDownload} onRemoveDownload={app.removeDownloadFromLibrary} onExportLocalTracks={(tracks) => void app.exportLocalTracks(tracks)} onRemoveFromQueue={app.removeFromPlaybackQueue} onNotice={app.showNotice} onSearchCatalog={app.searchLibraryCatalog} onLoadDiscovery={app.sourceStatus.phase === 'checking' ? undefined : app.loadLibraryDiscovery} onLoadChart={app.loadLibraryChart} busyTrackIds={app.busyTrackIds} downloadStates={app.downloadStates} runtime={app.runtime} contentSettings={app.appSettings.content} navigationRequest={app.libraryNavigation} onMobileSectionChange={app.setMobileLibrarySection} onMobileNavigationLevelChange={setLibraryNavigationLevel} userName={app.cloudSession?.user.displayName ?? '登录 Echora'} profileCaption={app.cloudSession ? `@${app.cloudSession.user.username}${!app.cloudOnline ? ' · 离线' : ''}` : '账户、设备与安全'} sourcePhase={app.sourceStatus.phase} onOpenAccount={() => { void loadAccountSpace(); app.openAccount() }} onOpenSettings={() => { void loadSettingsPanel(); app.setSettingsInitialView('root'); app.setHeaderPanel('settings') }} onOpenSources={() => { void loadSourceStatusPanel(); app.setHeaderPanel('sources') }} onOpenTheme={() => app.setHeaderPanel('theme')} /></div>
          {app.workspace === 'nowPlaying' && app.activeTrack && <Suspense fallback={null}><NowPlayingSpace track={app.activeTrack} isPlaying={app.isPlaying} progressStore={app.playbackProgressStore} lyrics={app.lyricsState.lines} lyricsStatus={app.lyricsState.status} lyricsMessage={app.lyricsState.message} relatedTracks={app.relatedTracks} reducedMotion={app.appSettings.reduceMotion} mobile onSeek={app.seekPlayback} onPlayTrack={app.playFromLibrary} onOpenArtist={(track) => app.navigateLibrary({ type: 'artist', track })} onOpenAlbum={(track) => app.navigateLibrary({ type: 'album', track })} onClose={app.closeNowPlaying} fontControlsOpen={lyricControlsOpen} onFontControlsOpenChange={setLyricControlsOpen} /></Suspense>}
        </main>
      </div>

      {app.headerPanel === 'effects' && <Suspense fallback={null}><div className="mobile-drawer-backdrop effects-drawer-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) app.setHeaderPanel(null) }}><AudioEffectsPanel mobile settings={app.audioEffects} onChange={app.setAudioEffects} onClose={() => app.setHeaderPanel(null)} /></div></Suspense>}
      {app.headerPanel === 'sources' && <Suspense fallback={null}><div className="mobile-drawer-backdrop source-drawer-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) app.setHeaderPanel(null) }}><SourceStatusPanel settings={app.appSettings.musicSource} status={app.sourceStatus} onRefresh={app.refreshMusicSourceStatus} onConfigure={() => { app.setSettingsInitialView('source'); app.setHeaderPanel('settings') }} onClose={() => app.setHeaderPanel(null)} /></div></Suspense>}
      {app.headerPanel === 'theme' && <div className="mobile-drawer-backdrop theme-drawer-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) app.setHeaderPanel(null) }}><section className="mobile-theme-sheet" role="dialog" aria-label="外观设置"><header><span><Palette size={18} /><strong>外观</strong></span><button onClick={() => app.setHeaderPanel(null)} aria-label="关闭外观设置"><X size={18} /></button></header><div className="mobile-appearance-modes"><button className={app.appearance === 'dark' ? 'is-active' : ''} onClick={() => app.setAppearance('dark')}><Moon size={18} /><span><strong>暗黑</strong><small>低照度玻璃界面</small></span>{app.appearance === 'dark' && <Check size={14} />}</button><button className={app.appearance === 'light' ? 'is-active' : ''} onClick={() => app.setAppearance('light')}><Sun size={18} /><span><strong>明亮</strong><small>清透浅色界面</small></span>{app.appearance === 'light' && <Check size={14} />}</button></div><div className="mobile-palette-grid">{app.palettes.map((item) => <button key={item.id} className={app.activePalette === item.id ? 'is-active' : ''} onClick={() => { app.setPaletteByAppearance((current) => ({ ...current, [app.appearance]: item.id })); app.setFollowTrackPalette(false) }} aria-label={`${item.label}配色`}><i style={{ backgroundColor: app.appearance === 'dark' ? item.dark : item.light }} />{app.activePalette === item.id && <Check size={12} />}<span>{item.label}</span></button>)}</div><button className={`mobile-theme-follow ${app.followTrackPalette ? 'is-on' : ''}`} onClick={() => app.setFollowTrackPalette(!app.followTrackPalette)}><span><strong>配色随音乐变化</strong><small>只改变强调色，明暗风格保持不变</small></span><i><b /></i></button></section></div>}
      {app.accountOpen && <Suspense fallback={null}><div className="mobile-drawer-backdrop account-drawer-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) app.closeAccount() }}><AccountSpace mobile presentation="dialog" profile={app.userProfile} runtime={app.runtime} onProfileChange={app.applyCloudProfile} onClose={app.closeAccount} /></div></Suspense>}

      {app.workspace === 'nowPlaying'
        ? <MobilePlayer app={app} onOpenLyricSettings={() => setLyricControlsOpen(true)} />
        : <div className={`mobile-bottom-chrome ${app.activeTrack ? 'has-player' : ''} ${mobileNavigation.showTabBar ? '' : 'is-subpage'}`}>
            <MobilePlayer app={app} />
            {mobileNavigation.showTabBar && <MobileNavigation app={app} />}
          </div>}

      {app.notice && <div className={`system-toast is-${app.notice.tone}`} role="status" aria-live="polite" aria-atomic="true">{app.notice.tone === 'success' ? <Check size={15} /> : <Info size={15} />}<span>{app.notice.message}</span></div>}
      {mobileOs === 'android' && <div className="mobile-system-bar-scrim" aria-hidden="true" />}
    </div>
  )
}

function useMobileVisualViewport() {
  useEffect(() => {
    const root = document.documentElement
    const viewport = window.visualViewport
    let stableHeight = Math.max(window.innerHeight, viewport?.height ?? 0)
    let lastViewportSignature = ''

    const isTextControlFocused = () => {
      const active = document.activeElement
      return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement
    }

    const updateViewport = () => {
      const height = Math.round(viewport?.height ?? window.innerHeight)
      const offsetTop = Math.max(0, Math.round(viewport?.offsetTop ?? 0))
      const focused = isTextControlFocused()

      if (!focused || height >= stableHeight * .88) stableHeight = Math.max(stableHeight, height)
      const keyboardOpen = focused && stableHeight - height > 120
      const viewportSignature = `${height}:${offsetTop}:${keyboardOpen}`
      if (viewportSignature === lastViewportSignature) return
      lastViewportSignature = viewportSignature

      root.style.setProperty('--mobile-visual-viewport-height', `${height}px`)
      root.style.setProperty('--mobile-visual-viewport-offset-top', `${offsetTop}px`)
      root.dataset.mobileKeyboard = keyboardOpen ? 'open' : 'closed'
    }

    updateViewport()
    viewport?.addEventListener('resize', updateViewport)
    viewport?.addEventListener('scroll', updateViewport)
    window.addEventListener('resize', updateViewport)
    document.addEventListener('focusin', updateViewport)
    document.addEventListener('focusout', updateViewport)

    return () => {
      viewport?.removeEventListener('resize', updateViewport)
      viewport?.removeEventListener('scroll', updateViewport)
      window.removeEventListener('resize', updateViewport)
      document.removeEventListener('focusin', updateViewport)
      document.removeEventListener('focusout', updateViewport)
      root.style.removeProperty('--mobile-visual-viewport-height')
      root.style.removeProperty('--mobile-visual-viewport-offset-top')
      delete root.dataset.mobileKeyboard
    }
  }, [])
}

function MobilePlayer({ app, onOpenLyricSettings }: { app: ReturnType<typeof useEchoraController>; onOpenLyricSettings?: () => void }) {
  if (!app.activeTrack) return null
  return <GlobalPlayer track={app.activeTrack} isPlaying={app.isPlaying} progressStore={app.playbackProgressStore} volume={app.volume} muted={app.muted} queue={app.tracks} playbackContext={app.playbackContext} playbackMode={app.playbackMode} playbackRate={app.playbackRate} liked={app.likedTrackIds.includes(app.activeTrack.id)} nowPlayingOpen={app.workspace === 'nowPlaying'} effectsOpen={app.headerPanel === 'effects'} sourceVariants={app.sourceVariants} variantBusy={app.resolvingTrackIds.includes(app.activeTrack.id)} enhancedQualityEnabled={app.enhancedQualityEnabled} onTogglePlay={() => app.isPlaying ? app.pausePlayback() : app.resumeTrackPlayback()} onNext={app.nextTrack} onPrevious={app.previousTrack} onSeek={app.seekPlayback} onVolumeChange={app.changeVolume} onToggleMute={app.toggleMute} onOpenNowPlaying={app.toggleNowPlaying} onOpenEffects={() => app.toggleHeaderPanel('effects')} onOpenArrangement={app.openPlaybackArrangement} onPlayTrack={app.playQueueTrack} onCyclePlaybackMode={app.cyclePlaybackMode} onPlaybackRateChange={app.setPlaybackRate} onToggleLike={() => app.toggleLike(app.activeTrack!)} onSourceChange={app.switchPlaybackSource} onQualityChange={app.switchPlaybackQuality} onDownloadTrack={app.runtime.hasLocalLibrary && !app.activeTrack.localFileId ? () => app.downloadFromLibrary(app.activeTrack) : undefined} onCancelDownload={() => app.cancelDownload(app.activeTrack.id)} onExportTrack={app.activeTrack.localFileId ? () => app.exportLocalTracks([app.activeTrack]) : undefined} onShareTrack={(method) => app.shareTrack(app.activeTrack, method)} onOpenLyricSettings={onOpenLyricSettings} downloadBusy={app.busyTrackIds.includes(app.activeTrack.id)} downloadState={app.downloadStates[app.activeTrack.id]} />
}

function MobileNavigation({ app }: { app: ReturnType<typeof useEchoraController> }) {
  return <nav className="mobile-bottom-navigation" aria-label="主要导航">
    <button className={app.workspace === 'library' && app.mobileLibrarySection === 'music' ? 'is-active' : ''} onClick={() => app.navigateLibrary({ type: 'home' })}><span>首页</span></button>
    <button className={app.workspace === 'library' && app.mobileLibrarySection === 'explore' ? 'is-active' : ''} onClick={() => app.navigateLibrary({ type: 'featured' })}><span>发现</span></button>
    <button className={app.workspace === 'field' ? 'is-active' : ''} onPointerDown={() => void loadAgentSessionSpace()} onFocus={() => void loadAgentSessionSpace()} onClick={() => app.openAgentView('conversation')}><span>音乐场</span><em>AI</em></button>
    <button className={app.workspace === 'library' && app.mobileLibrarySection === 'mine' ? 'is-active' : ''} onClick={() => app.navigateLibrary({ type: 'personal' })}><span>我的</span></button>
  </nav>
}
