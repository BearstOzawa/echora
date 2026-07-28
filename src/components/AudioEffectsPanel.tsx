import { AudioWaveform, Bluetooth, Car, Check, ChevronDown, ChevronUp, Headphones, Laptop, MonitorSpeaker, RotateCcw, SlidersHorizontal, Smartphone, Sparkles, Speaker, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { effectProfiles } from '../audioEffects'
import type { AudioEffectsSettings, EffectName } from '../audioEffects'
type View = 'effects' | 'devices' | 'equalizer'

const effectNames = Object.keys(effectProfiles) as EffectName[]
const recommendedEffectNames: EffectName[] = ['纯净直出', '人声向前', '开阔声场', '深潜低频', '夜间柔化', '细节增强']
const frequencies = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k']
const desktopDeviceProfiles = [
  { id: 'headphones', label: '通用耳机', detail: '均衡声场', icon: Headphones },
  { id: 'laptop', label: '笔记本扬声器', detail: '补偿低频', icon: Laptop },
  { id: 'desktop', label: '桌面音箱', detail: '近场优化', icon: MonitorSpeaker },
  { id: 'bluetooth', label: '蓝牙音箱', detail: '动态补偿', icon: Speaker },
  { id: 'car', label: '车载音响', detail: '驾驶舱声场', icon: Car },
  { id: 'dac', label: 'HiFi DAC', detail: '保持原始动态', icon: AudioWaveform },
]

const mobileDeviceProfiles = [
  { id: 'phone', label: '手机扬声器', detail: '补偿小型单元', icon: Smartphone },
  { id: 'headphones', label: '通用耳机', detail: '均衡声场', icon: Headphones },
  { id: 'earbuds', label: '无线耳机', detail: '优化蓝牙听感', icon: Bluetooth },
  { id: 'bluetooth', label: '蓝牙音箱', detail: '动态补偿', icon: Speaker },
  { id: 'car', label: '车载音响', detail: '驾驶舱声场', icon: Car },
  { id: 'dac', label: '外接解码器', detail: '保持原始动态', icon: AudioWaveform },
]

type Props = { settings: AudioEffectsSettings; onChange: (settings: AudioEffectsSettings) => void; onClose: () => void; mobile?: boolean }

export default function AudioEffectsPanel({ settings, onChange, onClose, mobile = false }: Props) {
  const [view, setView] = useState<View>('effects')
  const [showAllEffects, setShowAllEffects] = useState(false)
  const { enabled, effect, bands, intensity, deviceProfile, bass, spatial, normalize, crossfade } = settings
  const deviceProfiles = mobile ? mobileDeviceProfiles : desktopDeviceProfiles
  const activeProfile = effectProfiles[effect]
  const activeDevice = deviceProfiles.find((profile) => profile.id === deviceProfile) ?? deviceProfiles[0]
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

  const resetEqualizer = () => {
    onChange({ ...settings, bands: [...activeProfile.curve], bass: 28, spatial: true, normalize: true, crossfade: 4 })
  }

  return (
    <div className="header-popover effects-panel" role="dialog" aria-label="声音空间">
      <header className="effect-center-header">
        <div className="effect-brand"><AudioWaveform size={19} /><span><strong>声音空间</strong><small>音效、设备与均衡器分层生效</small></span></div>
        <nav aria-label="声音设置">
          <button className={view === 'effects' ? 'is-active' : ''} onClick={() => setView('effects')}>音效</button>
          <button className={view === 'devices' ? 'is-active' : ''} onClick={() => setView('devices')}>设备</button>
          <button className={view === 'equalizer' ? 'is-active' : ''} onClick={() => setView('equalizer')}>均衡器</button>
        </nav>
        <div className="effect-header-actions"><button className={`effect-power ${enabled ? 'is-on' : ''}`} onClick={() => onChange({ ...settings, enabled: !enabled })} aria-label={enabled ? '关闭音效' : '开启音效'} aria-pressed={enabled}><i><b /></i></button><button onClick={onClose} title="关闭" aria-label="关闭"><X size={17} /></button></div>
      </header>

      <div className="sound-signal-chain" aria-label="当前声音处理链">
        <span><small>音效</small><strong>{enabled ? effect : '已关闭'}</strong></span><i />
        <span><small>设备补偿</small><strong>{activeDevice.label}</strong></span><i />
        <span><small>手动调音</small><strong>{bands.some((value, index) => value !== activeProfile.curve[index]) ? '已调整' : '跟随预设'}</strong></span>
      </div>

      <div className={`effects-content ${enabled ? '' : 'is-disabled'}`}>
        {view === 'effects' && (
          <div className="sound-effects-layout">
            <section className="sound-preset-browser">
              <header><span><strong>{showAllEffects ? '全部音效' : '推荐音效'}</strong><small>从听感目标选择声音基底</small></span><button className="sound-browser-expand" onClick={() => setShowAllEffects((current) => !current)}>{showAllEffects ? '收起' : `全部 ${effectNames.length} 种`}{showAllEffects ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button></header>
              <div className="sound-preset-grid">{visibleEffects.map((name) => <button key={name} className={effect === name ? 'is-active' : ''} onClick={() => selectEffect(name)}><span><strong>{name}</strong><small>{effectProfiles[name].traits.slice(0, 2).join(' · ')}</small></span>{effect === name ? <Check size={15} /> : <i>{effectProfiles[name].curve.slice(0, 5).map((value, index) => <b key={index} style={{ height: `${5 + Math.abs(value) * 1.2}px` }} />)}</i>}</button>)}</div>
            </section>
            <aside className="sound-focus sound-preset-detail">
              <span className="sound-focus-label"><Sparkles size={13} /> 当前听感</span>
              <h2>{effect}</h2>
              <p>{activeProfile.detail}</p>
              <div className="sound-curve" aria-label={`${effect}频率轮廓`}>{activeProfile.curve.map((value, index) => <i key={index} style={{ height: `${36 + Math.abs(value) * 7}%` }} />)}</div>
              <div className="sound-traits">{activeProfile.traits.map((trait) => <span key={trait}>{trait}</span>)}</div>
              <label className="sound-intensity"><span><strong>作用强度</strong><small>{intensity}%</small></span><input name="effect-intensity" type="range" min="0" max="100" value={intensity} onChange={(event) => onChange({ ...settings, intensity: Number(event.target.value) })} /></label>
            </aside>
          </div>
        )}

        {view === 'devices' && (
          <div className="device-adaptation"><div><AudioWaveform size={20} /><span><strong>播放设备调校</strong><small>在“{effect}”音效上补偿设备特性，不会切换系统输出设备</small></span></div><section>{deviceProfiles.map((profile) => { const Icon = profile.icon; return <button key={profile.id} className={deviceProfile === profile.id ? 'is-active' : ''} onClick={() => onChange({ ...settings, deviceProfile: profile.id })}><Icon size={19} /><span><strong>{profile.label}</strong><small>{profile.detail}</small></span>{deviceProfile === profile.id && <Check size={14} />}</button> })}</section></div>
        )}

        {view === 'equalizer' && (
          <div className="custom-eq-view">
            <div className="custom-eq-heading"><span><strong>十段均衡器</strong><small>在“{effect}”音效上微调频段</small></span><button onClick={resetEqualizer}><RotateCcw size={14} /> 恢复预设</button></div>
            <div className="equalizer" aria-label="十段均衡器">{bands.map((value, index) => <label className="eq-band" key={frequencies[index]}><span>{value > 0 ? `+${value}` : value}</span><input name={`equalizer-${frequencies[index]}`} type="range" min="-12" max="12" value={value} onChange={(event) => updateBand(index, Number(event.target.value))} aria-label={`${frequencies[index]} Hz`} /><small>{frequencies[index]}</small></label>)}</div>
            <div className="effect-options">
              <label className="effect-range"><span><strong>低音增强</strong><small>{bass}%</small></span><input name="bass-boost" type="range" min="0" max="100" value={bass} onChange={(event) => onChange({ ...settings, bass: Number(event.target.value) })} /></label>
              <label className="effect-range"><span><strong>切歌淡入</strong><small>{crossfade} 秒</small></span><input name="crossfade" type="range" min="0" max="12" value={crossfade} onChange={(event) => onChange({ ...settings, crossfade: Number(event.target.value) })} /></label>
              <button className="effect-option" onClick={() => onChange({ ...settings, spatial: !spatial })} aria-pressed={spatial}><span><Sparkles size={15} /><strong>空间音频</strong></span><i className={spatial ? 'is-on' : ''}><b /></i></button>
              <button className="effect-option" onClick={() => onChange({ ...settings, normalize: !normalize })} aria-pressed={normalize}><span><SlidersHorizontal size={15} /><strong>响度均衡</strong></span><i className={normalize ? 'is-on' : ''}><b /></i></button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
