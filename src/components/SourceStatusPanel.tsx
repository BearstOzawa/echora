import { Activity, AlertCircle, CheckCircle2, CircleDashed, Gauge, RadioTower, RefreshCw, Settings2, X } from 'lucide-react'
import type { MusicSourceSettings } from '../appSettings'
import type { MusicSourceStatus } from '../musicSource'
import { sourceBrandKey } from '../sourceBrand'

type Props = {
  settings: MusicSourceSettings
  status: MusicSourceStatus
  onRefresh: () => void
  onConfigure: () => void
  onClose?: () => void
}

const preferredQualityLabels = { high: '高品质', lossless: '无损', hires: 'Hi-Res' }
const qualityLabels = { '128k': '标准', '320k': '高品', flac: '无损', flac24bit: 'Hi-Res' }
const phaseLabels: Record<MusicSourceStatus['phase'], string> = { checking: '载入中', ready: '内容可用', degraded: '部分异常', error: '不可用' }

const checkedTime = (timestamp: number | null) => timestamp
  ? new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  : '尚未完成检测'

const healthLine = (provider: MusicSourceStatus['providers'][number]) => {
  const health = provider.health
  if (!health.sampleCount || health.successRate === null) return ''
  const latency = health.averageLatencyMs === null ? '' : health.averageLatencyMs < 1000 ? `${health.averageLatencyMs}ms` : `${(health.averageLatencyMs / 1000).toFixed(1)}s`
  return [`近 ${health.sampleCount} 次`, `${health.successRate}%`, latency, health.downgradeCount ? `降级 ${health.downgradeCount}` : ''].filter(Boolean).join(' · ')
}

export default function SourceStatusPanel({ settings, status, onRefresh, onConfigure, onClose }: Props) {
  const registeredCount = status.providers.filter((provider) => provider.registered).length
  const playbackErrorCount = status.providers.filter((provider) => provider.playbackStatus === 'error').length
  const StatusIcon = status.phase === 'checking' ? CircleDashed : status.phase === 'ready' ? CheckCircle2 : AlertCircle

  const providerState = (provider: MusicSourceStatus['providers'][number]) => {
    if (!provider.registered) return { className: 'is-unregistered', label: '当前未启用' }
    if (provider.playbackStatus === 'error') return { className: 'is-playback-error', label: '最近播放异常' }
    if (provider.catalogStatus === 'error') return { className: 'is-playback-error', label: '内容服务异常' }
    if (provider.availability === 'limited') return { className: 'is-playback-idle is-limited', label: '部分歌曲自动切换版本' }
    if (provider.playbackStatus === 'available') return { className: 'is-playback-available', label: '最近播放正常' }
    if (provider.catalogStatus === 'available') return { className: 'is-playback-idle', label: '内容可用 · 待播放验证' }
    if (provider.catalogStatus === 'empty') return { className: 'is-playback-idle', label: '内容服务已响应' }
    return { className: 'is-playback-idle', label: '能力已载入 · 待验证' }
  }

  return (
    <div className="header-popover source-panel" role="dialog" aria-label="音乐服务状态">
      <div className="popover-heading source-panel-heading">
        <span><RadioTower size={16} /><strong>音乐服务</strong></span>
        <em className={`source-phase is-${status.phase}`}><StatusIcon size={13} />{phaseLabels[status.phase]}</em>
        {onClose && <div className="source-panel-mobile-actions"><button onClick={onRefresh} disabled={status.phase === 'checking'} aria-label="重新连接音乐服务"><RefreshCw size={16} /></button><button onClick={onConfigure} aria-label="音乐与播放设置"><Settings2 size={16} /></button><button onClick={onClose} aria-label="关闭音乐服务"><X size={17} /></button></div>}
      </div>

      <section className={`source-runtime-state is-${status.phase}`}>
        <StatusIcon size={18} />
        <span><strong>{status.message}</strong><small>{status.phase === 'checking' ? '正在载入平台能力' : `检测时间 ${checkedTime(status.checkedAt)}`}</small></span>
      </section>

      <section className="source-provider-section">
        <header><span>平台状态</span><small>{registeredCount} / {status.providers.length} 已启用{playbackErrorCount ? ` · ${playbackErrorCount} 异常` : ''}</small></header>
        <div className="source-provider-list">
          {status.providers.map((provider) => {
            const state = providerState(provider)
            return (
              <div className={state.className} key={provider.source} data-music-source={sourceBrandKey(provider.source)} title={provider.playbackMessage || provider.catalogMessage || undefined}>
                <i />
                <span><strong>{provider.name}</strong><small>{state.label}</small>{healthLine(provider) && <small className="source-health-line" title={provider.health.latestFailure || provider.health.latestDowngrade || undefined}>{healthLine(provider)}</small>}</span>
                <div aria-label={`${provider.name}支持音质`}>{provider.qualities.map((quality) => <em key={quality}>{qualityLabels[quality]}</em>)}</div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="source-service-summary">
        <div><Gauge size={15} /><span><small>播放策略</small><strong>{preferredQualityLabels[settings.preferredQuality]}优先 · {settings.autoFallback ? '自动切换平台与音质' : '保持首选音质'}</strong></span></div>
      </section>

      {status.activity && (
        <section className={`source-last-activity is-${status.activity.kind}`}>
          <Activity size={15} />
          <span><small>{status.activity.kind === 'success' ? '最近播放成功' : '最近播放异常'}</small><strong>{status.activity.message}</strong></span>
          <time>{checkedTime(status.activity.at)}</time>
        </section>
      )}

      <div className="source-panel-footer">
        <button className="source-refresh-button" onClick={onRefresh} disabled={status.phase === 'checking'} title="重新连接音乐服务" aria-label="重新连接音乐服务"><RefreshCw size={15} /></button>
        <button onClick={onConfigure}><Settings2 size={14} /> 音乐与播放设置</button>
      </div>
    </div>
  )
}
