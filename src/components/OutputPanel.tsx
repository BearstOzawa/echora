import { Check, Headphones, MonitorSpeaker, Volume2 } from 'lucide-react'
import VolumeControl from './VolumeControl'

type Props = {
  device: string
  volume: number
  muted: boolean
  onDeviceChange: (device: string) => void
  onVolumeChange: (volume: number) => void
  onToggleMute: () => void
}

const devices = [
  { name: 'MacBook 扬声器', detail: '系统默认', icon: MonitorSpeaker },
  { name: 'AirPods Pro', detail: '空间音频可用', icon: Headphones },
  { name: 'USB Audio DAC', detail: '24-bit / 96 kHz', icon: Volume2 },
]

export default function OutputPanel({ device, volume, muted, onDeviceChange, onVolumeChange, onToggleMute }: Props) {
  return (
    <div className="header-popover output-panel" role="dialog" aria-label="音频输出">
      <div className="popover-heading"><strong>音频输出</strong><span>{device}</span></div>
      <div className="device-list">
        {devices.map((item) => {
          const Icon = item.icon
          return (
            <button key={item.name} className={device === item.name ? 'is-active' : ''} onClick={() => onDeviceChange(item.name)}>
              <Icon size={17} />
              <span><strong>{item.name}</strong><small>{item.detail}</small></span>
              {device === item.name && <Check size={14} />}
            </button>
          )
        })}
      </div>
      <VolumeControl className="output-volume" volume={volume} muted={muted} onVolumeChange={onVolumeChange} onToggleMute={onToggleMute} inline />
    </div>
  )
}
