import { Activity, AudioWaveform, Bluetooth, Car, Check, ChevronDown, ChevronUp, Gauge, Headphones, Laptop, MonitorSpeaker, RotateCcw, Smartphone, Speaker, Waves, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { defaultAudioEffects, deriveAudioEffectParameters, effectProfiles } from '../audioEffects'
import type { AudioEffectsProcessingState, AudioEffectsSettings, EffectName, LoudnessMode } from '../audioEffects'
import '../product-ui.css?echora-css=effects'

type View = 'effects' | 'devices' | 'equalizer'

const effectNames = Object.keys(effectProfiles) as EffectName[]
const recommendedEffectNames: EffectName[] = ['纯净直出', '人声向前', '开阔声场', '深潜低频', '夜间柔化', '细节增强']
const frequencies = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k']
const loudnessModes: Array<{ id: LoudnessMode; label: string; detail: string }> = [
  { id: 'off', label: '原始', detail: '保留动态' },
  { id: 'balanced', label: '均衡', detail: '稳定响度' },
  { id: 'strong', label: '增强', detail: '嘈杂环境' },
]

const desktopDeviceProfiles = [
  { id: 'headphones', label: '通用耳机', detail: '保持自然声场', icon: Headphones },
  { id: 'laptop', label: '笔记本扬声器', detail: '控制低频失真', icon: Laptop },
  { id: 'desktop', label: '桌面音箱', detail: '近场平衡', icon: MonitorSpeaker },
  { id: 'bluetooth', label: '蓝牙音箱', detail: '补偿传输与箱体', icon: Speaker },
  { id: 'car', label: '车载音响', detail: '降低座舱遮蔽', icon: Car },
  { id: 'dac', label: 'HiFi DAC', detail: '最少设备干预', icon: AudioWaveform },
]

const mobileDeviceProfiles = [
  { id: 'phone', label: '手机扬声器', detail: '保护小型单元', icon: Smartphone },
  { id: 'headphones', label: '通用耳机', detail: '保持自然声场', icon: Headphones },
  { id: 'earbuds', label: '无线耳机', detail: '收敛高频锐度', icon: Bluetooth },
  { id: 'bluetooth', label: '蓝牙音箱', detail: '补偿传输与箱体', icon: Speaker },
  { id: 'car', label: '车载音响', detail: '降低座舱遮蔽', icon: Car },
  { id: 'dac', label: '外接解码器', detail: '最少设备干预', icon: AudioWaveform },
]

const processingStates: Record<AudioEffectsProcessingState, { label: string; detail: string }> = {
  idle: { label: '等待播放', detail: '播放歌曲后显示处理状态' },
  ready: { label: '可用于当前歌曲', detail: '开启后立即进入实时处理链' },
  active: { label: '实时处理', detail: '当前歌曲正在应用声音空间' },
  bypassed: { label: '直连旁路', detail: '当前在线版本不允许浏览器接入音效处理' },
  system: { label: '系统播放', detail: 'iOS 当前使用后台媒体链路' },
}

type Props = {
  settings: AudioEffectsSettings
  processingState?: AudioEffectsProcessingState
  onChange: (settings: AudioEffectsSettings) => void
  onClose: () => void
  mobile?: boolean
}

export default function AudioEffectsPanel({ settings, processingState, onChange, onClose, mobile = false }: Props) {
  const [view, setView] = useState<View>('effects')
  const [showAllEffects, setShowAllEffects] = useState(false)
  const { enabled, effect, bands, intensity, deviceProfile, bass, clarity, spatial, spatialAmount, loudnessMode, crossfade } = settings
  const deviceProfiles = mobile ? mobileDeviceProfiles : desktopDeviceProfiles
  const activeProfile = effectProfiles[effect]
  const activeDevice = deviceProfiles.find((profile) => profile.id === deviceProfile) ?? deviceProfiles[0]
  const effectiveProcessingState = processingState ?? (enabled ? 'active' : 'ready')
  const processing = processingStates[effectiveProcessingState]
  const parameters = useMemo(() => deriveAudioEffectParameters(settings), [settings])
  const visibleEffects = showAllEffects
    ? effectNames
    : recommendedEffectNames.includes(effect) ? recommendedEffectNames : [effect, ...recommendedEffectNames.slice(0, 5)]

  useEffect(() => {
    if (!deviceProfiles.some((profile) => profile.id === deviceProfile)) {
      onChange({ ...settings, deviceProfile: deviceProfiles[0].id })
    }
  }, [deviceProfile, mobile])

  const selectEffect = (nextEffect: EffectName) => {
    onChange({ ...settings, effect: nextEffect, bands: [...effectProfiles[nextEffect].curve] })
  }

  const updateBand = (index: number, value: number) => onChange({ ...settings, bands: bands.map((band, bandIndex) => bandIndex === index ? value : band) })
  const setLoudnessMode = (nextMode: LoudnessMode) => onChange({ ...settings, loudnessMode: nextMode, normalize: nextMode !== 'off' })

  const resetEqualizer = () => {
    onChange({
      ...settings,
      bands: [...activeProfile.curve],
      bass: defaultAudioEffects.bass,
      clarity: defaultAudioEffects.clarity,
      spatial: defaultAudioEffects.spatial,
      spatialAmount: defaultAudioEffects.spatialAmount,
      normalize: defaultAudioEffects.normalize,
      loudnessMode: defaultAudioEffects.loudnessMode,
      crossfade: defaultAudioEffects.crossfade,
    })
  }

  return (
    <div className="header-popover effects-panel" role="dialog" aria-label="声音空间">
      <header className="effect-center-header">
        <div className="effect-brand">
          <AudioWaveform size={19} />
          <span><strong>声音空间</strong><small className={`effect-runtime is-${effectiveProcessingState}`} title={processing.detail}><i />{processing.label}</small></span>
        </div>
        <nav aria-label="声音设置">
          <button className={view === 'effects' ? 'is-active' : ''} onClick={() => setView('effects')}>预设</button>
          <button className={view === 'devices' ? 'is-active' : ''} onClick={() => setView('devices')}>设备</button>
          <button className={view === 'equalizer' ? 'is-active' : ''} onClick={() => setView('equalizer')}>调音</button>
        </nav>
        <div className="effect-header-actions">
          <button className={`effect-power ${enabled ? 'is-on' : ''}`} onClick={() => onChange({ ...settings, enabled: !enabled })} aria-label={enabled ? '关闭音效' : '开启音效'} aria-pressed={enabled}><i><b /></i></button>
          <button onClick={onClose} title="关闭" aria-label="关闭"><X size={17} /></button>
        </div>
      </header>

      <div className="sound-signal-chain" aria-label="当前声音处理链">
        <span><small>声音基底</small><strong>{enabled ? effect : '原始输出'}</strong></span><i />
        <span><small>播放设备</small><strong>{activeDevice.label}</strong></span><i />
        <span><small>自动余量</small><strong>{enabled && parameters.headroomDb < 0 ? `${parameters.headroomDb.toFixed(1)} dB` : '无需衰减'}</strong></span>
      </div>

      <div className={`effects-content ${enabled ? '' : 'is-disabled'}`}>
        {view === 'effects' && (
          <div className="sound-effects-layout">
            <section className="sound-preset-browser">
              <header><span><strong>{showAllEffects ? '全部预设' : '推荐预设'}</strong><small>按听感目标选择声音基底</small></span><button className="sound-browser-expand" onClick={() => setShowAllEffects((current) => !current)}>{showAllEffects ? '收起' : `全部 ${effectNames.length} 种`}{showAllEffects ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button></header>
              <div className="sound-preset-grid">{visibleEffects.map((name) => <button key={name} className={effect === name ? 'is-active' : ''} onClick={() => selectEffect(name)}><span><strong>{name}</strong><small>{effectProfiles[name].traits.slice(0, 2).join(' · ')}</small></span>{effect === name ? <Check size={15} /> : <i>{effectProfiles[name].curve.slice(0, 5).map((value, index) => <b key={index} style={{ height: `${5 + Math.abs(value) * 2}px` }} />)}</i>}</button>)}</div>
            </section>
            <aside className="sound-focus sound-preset-detail">
              <span className="sound-focus-label"><Activity size={13} /> 当前预设</span>
              <h2>{effect}</h2>
              <p>{activeProfile.detail}</p>
              <div className="sound-curve" aria-label={`${effect}频率轮廓`}>{activeProfile.curve.map((value, index) => <i key={index} style={{ height: `${34 + Math.abs(value) * 12}%` }} />)}</div>
              <div className="sound-traits">{activeProfile.traits.map((trait) => <span key={trait}>{trait}</span>)}</div>
              <div className="sound-macro-controls effect-options">
                <label className="effect-range"><span><strong>强度</strong><small>{intensity}%</small></span><input name="effect-intensity" type="range" min="0" max="100" value={intensity} onChange={(event) => onChange({ ...settings, intensity: Number(event.target.value) })} aria-label="音效强度" /></label>
                <label className="effect-range"><span><strong>低频</strong><small>{bass}%</small></span><input name="bass-boost" type="range" min="0" max="100" value={bass} onChange={(event) => onChange({ ...settings, bass: Number(event.target.value) })} aria-label="低频量" /></label>
                <label className="effect-range"><span><strong>细节</strong><small>{clarity}%</small></span><input name="clarity" type="range" min="0" max="100" value={clarity} onChange={(event) => onChange({ ...settings, clarity: Number(event.target.value) })} aria-label="细节量" /></label>
                <label className="effect-range"><span><strong>空间</strong><small>{spatial ? `${spatialAmount}%` : '关闭'}</small></span><input name="spatial-amount" type="range" min="0" max="100" value={spatialAmount} disabled={!spatial} onChange={(event) => onChange({ ...settings, spatialAmount: Number(event.target.value) })} aria-label="空间量" /></label>
              </div>
            </aside>
          </div>
        )}

        {view === 'devices' && (
          <div className="device-adaptation">
            <div><AudioWaveform size={20} /><span><strong>输出设备补偿</strong><small>在当前预设上修正通用设备特性，不切换系统输出</small></span></div>
            <section>{deviceProfiles.map((profile) => { const Icon = profile.icon; return <button key={profile.id} className={deviceProfile === profile.id ? 'is-active' : ''} onClick={() => onChange({ ...settings, deviceProfile: profile.id })}><Icon size={19} /><span><strong>{profile.label}</strong><small>{profile.detail}</small></span>{deviceProfile === profile.id && <Check size={14} />}</button> })}</section>
          </div>
        )}

        {view === 'equalizer' && (
          <div className="custom-eq-view">
            <div className="custom-eq-heading">
              <span><strong>十段均衡器</strong><small>频段调整会叠加在“{effect}”预设上</small></span>
              <div><button onClick={resetEqualizer}><RotateCcw size={14} /> 恢复预设</button></div>
            </div>
            <div className="equalizer" aria-label="十段均衡器">{bands.map((value, index) => <label className="eq-band" key={frequencies[index]}><span>{value > 0 ? `+${value}` : value}</span><input name={`equalizer-${frequencies[index]}`} type="range" min="-12" max="12" step="0.5" value={value} onChange={(event) => updateBand(index, Number(event.target.value))} aria-label={`${frequencies[index]} Hz`} /><small>{frequencies[index]}</small></label>)}</div>
            <div className="sound-processing-options effect-options">
              <section className="loudness-control"><span><Gauge size={16} /><span><strong>动态响度</strong><small>控制动态起伏与峰值</small></span></span><div>{loudnessModes.map((mode) => <button key={mode.id} className={loudnessMode === mode.id ? 'is-active' : ''} onClick={() => setLoudnessMode(mode.id)}><strong>{mode.label}</strong><small>{mode.detail}</small></button>)}</div></section>
              <button className="effect-option" onClick={() => onChange({ ...settings, spatial: !spatial })} aria-pressed={spatial}><span><Waves size={16} /><span><strong>声场扩展</strong><small>{spatial ? `空间量 ${spatialAmount}%` : '保持原始声道'}</small></span></span><i className={spatial ? 'is-on' : ''}><b /></i></button>
              <label className="effect-range"><span><strong>切歌淡入</strong><small>{crossfade === 0 ? '关闭' : `${crossfade} 秒`}</small></span><input name="crossfade" type="range" min="0" max="12" value={crossfade} onChange={(event) => onChange({ ...settings, crossfade: Number(event.target.value) })} /></label>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
