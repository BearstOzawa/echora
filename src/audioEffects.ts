export const effectProfiles = {
  '开阔声场': { detail: '扩展左右层次并保留中央人声，适合制作完整的流行与电子音乐。', traits: ['宽阔', '自然', '空间'], curve: [3, 2, 0, -1, 0, 2, 3, 4, 4, 3], bassBias: 0, room: .16, width: .18, compression: .32 },
  '人声向前': { detail: '减少低频遮蔽，强化人声主体与齿音控制。', traits: ['清晰', '贴近', '克制'], curve: [-3, -2, -1, 2, 5, 5, 4, 1, -1, -2], bassBias: -1.2, room: .025, width: .04, compression: .42 },
  '深潜低频': { detail: '提升超低频与鼓点重量，同时为中频保留余量。', traits: ['饱满', '有力', '下潜'], curve: [7, 6, 5, 3, 1, -1, -2, -1, 0, 1], bassBias: 3.2, room: .035, width: .08, compression: .58 },
  '现场距离': { detail: '增加早期反射与舞台宽度，保留现场动态而不过度混响。', traits: ['现场', '纵深', '空气感'], curve: [5, 3, 1, 0, 2, 3, 3, 4, 5, 4], bassBias: .8, room: .26, width: .16, compression: .28 },
  '细节增强': { detail: '控制低频掩蔽并抬升存在感，突出弱音、泛音与定位。', traits: ['通透', '精细', '明亮'], curve: [-2, -1, 1, 3, 5, 4, 4, 3, 2, 1], bassBias: -1, room: .018, width: .1, compression: .24 },
  '夜间柔化': { detail: '收敛高低频峰值并提高动态稳定性，降低长时间聆听疲劳。', traits: ['柔和', '安静', '耐听'], curve: [-2, -1, 1, 2, 2, 1, 0, -2, -3, -4], bassBias: -1.5, room: .035, width: .03, compression: .68 },
  '电子脉冲': { detail: '强化底鼓、贝斯弹性和高频瞬态，保持节拍速度感。', traits: ['动感', '速度', '弹性'], curve: [5, 4, 1, -1, -2, 1, 2, 3, 4, 5], bassBias: 1.8, room: .045, width: .15, compression: .62 },
  '原声木质': { detail: '保留弦乐起音与箱体共鸣，减少不自然的高频锐度。', traits: ['温暖', '原声', '松弛'], curve: [1, 2, 3, 4, 3, 2, 2, 1, 0, -1], bassBias: .3, room: .08, width: .07, compression: .2 },
  '摇滚驱动': { detail: '增加鼓组冲击和吉他存在感，并控制密集段落的峰值。', traits: ['直接', '密度', '冲击'], curve: [5, 4, 2, 0, -2, -1, 1, 3, 5, 5], bassBias: 1.5, room: .035, width: .09, compression: .64 },
  '古典空间': { detail: '保持大动态和乐器位置，以较轻的空间反射展开纵深。', traits: ['纵深', '动态', '平衡'], curve: [2, 2, 1, 0, 1, 2, 3, 3, 2, 2], bassBias: -.5, room: .14, width: .17, compression: .12 },
  '复古磁带': { detail: '收敛频宽与瞬态，形成温润但不过度失真的模拟听感。', traits: ['复古', '温润', '颗粒'], curve: [3, 2, 0, -1, -2, -1, 1, 2, 1, -1], bassBias: .8, room: .025, width: .02, compression: .5 },
  '纯净直出': { detail: '关闭空间扩展，仅保留轻量响度保护与接近原始的频响。', traits: ['原始', '均衡', '低干预'], curve: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bassBias: 0, room: 0, width: 0, compression: .12 },
} as const

export type EffectName = keyof typeof effectProfiles

export type AudioEffectsSettings = {
  enabled: boolean
  effect: EffectName
  bands: number[]
  intensity: number
  deviceProfile: string
  bass: number
  spatial: boolean
  normalize: boolean
  crossfade: number
}

export const equalizerFrequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
export const audioEffectsStorageKey = 'echora.audioEffects'

export const defaultAudioEffects: AudioEffectsSettings = {
  enabled: false,
  effect: '开阔声场',
  bands: [...effectProfiles['开阔声场'].curve],
  intensity: 62,
  deviceProfile: 'headphones',
  bass: 28,
  spatial: true,
  normalize: true,
  crossfade: 4,
}

export const requiresAudioProcessing = (settings: Pick<AudioEffectsSettings, 'enabled'>) => settings.enabled

const bounded = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

export const readAudioEffects = (storage: Pick<Storage, 'getItem' | 'removeItem'> = localStorage): AudioEffectsSettings => {
  try {
    const stored = JSON.parse(storage.getItem(audioEffectsStorageKey) ?? '{}') as Partial<AudioEffectsSettings>
    const effect = stored.effect && stored.effect in effectProfiles ? stored.effect : defaultAudioEffects.effect
    return {
      enabled: typeof stored.enabled === 'boolean' ? stored.enabled : defaultAudioEffects.enabled,
      effect,
      bands: Array.isArray(stored.bands) && stored.bands.length === 10 ? stored.bands.map((value, index) => bounded(value, effectProfiles[effect].curve[index], -12, 12)) : [...effectProfiles[effect].curve],
      intensity: bounded(stored.intensity, defaultAudioEffects.intensity, 0, 100),
      deviceProfile: typeof stored.deviceProfile === 'string' ? stored.deviceProfile : defaultAudioEffects.deviceProfile,
      bass: bounded(stored.bass, defaultAudioEffects.bass, 0, 100),
      spatial: typeof stored.spatial === 'boolean' ? stored.spatial : defaultAudioEffects.spatial,
      normalize: typeof stored.normalize === 'boolean' ? stored.normalize : defaultAudioEffects.normalize,
      crossfade: bounded(stored.crossfade, defaultAudioEffects.crossfade, 0, 12),
    }
  } catch {
    storage.removeItem(audioEffectsStorageKey)
    return defaultAudioEffects
  }
}

export const writeAudioEffects = (settings: AudioEffectsSettings, storage: Pick<Storage, 'setItem'> = localStorage) => storage.setItem(audioEffectsStorageKey, JSON.stringify(settings))

const deviceBassCompensation: Record<string, number> = { phone: 2.8, headphones: 0, earbuds: .8, laptop: 2.4, desktop: .4, bluetooth: 1.2, car: 1.8, dac: 0 }
const deviceSpatialScale: Record<string, number> = { phone: .42, headphones: 1, earbuds: .82, laptop: .55, desktop: .8, bluetooth: .6, car: .45, dac: .7 }

export const deriveAudioEffectParameters = (settings: AudioEffectsSettings) => {
  const amount = settings.enabled ? settings.intensity / 100 : 0
  const profile = effectProfiles[settings.effect]
  const bandGains = settings.bands.map((gain) => amount === 0 ? 0 : gain * amount)
  const bassGain = settings.enabled ? (settings.bass / 100 * 7 + (deviceBassCompensation[settings.deviceProfile] ?? 0) + profile.bassBias) * amount : 0
  const peakBoost = Math.max(0, bassGain, ...bandGains)
  return {
    bandGains,
    bassGain,
    wetGain: settings.enabled && settings.spatial ? profile.room * amount * (deviceSpatialScale[settings.deviceProfile] ?? .7) : 0,
    stereoCrossfeed: settings.enabled && settings.spatial ? -profile.width * amount * (deviceSpatialScale[settings.deviceProfile] ?? .7) : 0,
    preampGain: Math.pow(10, -(peakBoost * .62) / 20),
    compressor: settings.enabled && settings.normalize,
    compressorAmount: settings.enabled && settings.normalize ? profile.compression * amount : 0,
    fadeSeconds: settings.enabled ? settings.crossfade : 0,
  }
}
