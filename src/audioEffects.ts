export const effectProfiles = {
  '开阔声场': { detail: '展开左右层次，保持中央人声稳定，适合流行与电子音乐。', traits: ['宽阔', '平衡', '自然'], curve: [1.5, 1, 0, -.5, 0, .5, 1, 1.5, 1.5, 1], bassBias: 0, clarityBias: .6, room: .12, width: .22, compression: .24 },
  '人声向前': { detail: '减少低频遮蔽，提升人声主体与咬字清晰度。', traits: ['清晰', '贴近', '克制'], curve: [-1.5, -1, -.5, 1, 2.5, 2.5, 1.5, .5, -.5, -1], bassBias: -.5, clarityBias: .8, room: .025, width: .04, compression: .36 },
  '深潜低频': { detail: '增加低频下潜与鼓点重量，同时控制中频遮蔽。', traits: ['饱满', '有力', '下潜'], curve: [3.5, 3, 2, 1, 0, -.5, -1, -.5, 0, .5], bassBias: 1.2, clarityBias: 0, room: .03, width: .08, compression: .52 },
  '现场距离': { detail: '加入受控早期反射和舞台宽度，保留现场动态。', traits: ['现场', '纵深', '空气感'], curve: [1.5, 1, 0, 0, .5, 1, 1.5, 2, 2, 1.5], bassBias: .2, clarityBias: .5, room: .19, width: .2, compression: .2 },
  '细节增强': { detail: '降低低频掩蔽，突出弱音、泛音和声部定位。', traits: ['通透', '精细', '明亮'], curve: [-1, -.5, .5, 1, 1.8, 1.8, 2, 1.5, 1, .5], bassBias: -.4, clarityBias: 1.4, room: .015, width: .1, compression: .18 },
  '夜间柔化': { detail: '收敛高低频峰值与动态落差，适合低音量长时间聆听。', traits: ['柔和', '安静', '耐听'], curve: [-1, -.5, .5, 1, 1, .5, 0, -1, -1.5, -2], bassBias: -.4, clarityBias: -.6, room: .025, width: .03, compression: .55 },
  '电子脉冲': { detail: '强化底鼓弹性与高频瞬态，保持节拍速度感。', traits: ['动感', '速度', '弹性'], curve: [2.5, 2, 0, -.5, -1, .5, 1, 1.5, 2, 2.5], bassBias: .8, clarityBias: .5, room: .035, width: .15, compression: .5 },
  '原声木质': { detail: '保留弦乐起音和箱体共鸣，降低不自然的高频锐度。', traits: ['温暖', '原声', '松弛'], curve: [0, .5, 1, 1.5, 1, .5, .8, .5, 0, -.5], bassBias: .1, clarityBias: .2, room: .065, width: .07, compression: .16 },
  '摇滚驱动': { detail: '增加鼓组冲击和吉他存在感，控制密集段落峰值。', traits: ['直接', '密度', '冲击'], curve: [2, 1.5, .5, 0, -.5, 0, 1, 1.5, 2, 1.5], bassBias: .6, clarityBias: .5, room: .025, width: .09, compression: .54 },
  '古典空间': { detail: '保留大动态和乐器位置，以轻量反射展开纵深。', traits: ['纵深', '动态', '平衡'], curve: [.5, .5, 0, 0, .5, 1, 1.2, 1, .5, .5], bassBias: -.2, clarityBias: .2, room: .1, width: .15, compression: .08 },
  '复古磁带': { detail: '收敛频宽和瞬态，形成温润、轻颗粒的模拟听感。', traits: ['复古', '温润', '颗粒'], curve: [1.5, 1, 0, -.5, -1, -.5, .5, .8, 0, -1.5], bassBias: .4, clarityBias: -1, room: .02, width: .02, compression: .42 },
  '纯净直出': { detail: '保持原始频响和声场，仅启用必要的削波保护。', traits: ['原始', '均衡', '低干预'], curve: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bassBias: 0, clarityBias: 0, room: 0, width: 0, compression: .06 },
} as const

export type EffectName = keyof typeof effectProfiles
export type LoudnessMode = 'off' | 'balanced' | 'strong'
export type AudioEffectsProcessingState = 'idle' | 'ready' | 'active' | 'bypassed' | 'system'

export type AudioEffectsSettings = {
  enabled: boolean
  effect: EffectName
  bands: number[]
  intensity: number
  deviceProfile: string
  bass: number
  clarity: number
  spatial: boolean
  spatialAmount: number
  normalize: boolean
  loudnessMode: LoudnessMode
  crossfade: number
}

export const equalizerFrequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
export const audioEffectsStorageKey = 'echora.audioEffects'

export const defaultAudioEffects: AudioEffectsSettings = {
  enabled: false,
  effect: '开阔声场',
  bands: [...effectProfiles['开阔声场'].curve],
  intensity: 68,
  deviceProfile: 'headphones',
  bass: 24,
  clarity: 52,
  spatial: true,
  spatialAmount: 46,
  normalize: true,
  loudnessMode: 'balanced',
  crossfade: 3,
}

export const requiresAudioProcessing = (settings: Pick<AudioEffectsSettings, 'enabled'>) => settings.enabled

const bounded = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

export const readAudioEffects = (storage: Pick<Storage, 'getItem' | 'removeItem'> = localStorage): AudioEffectsSettings => {
  try {
    const stored = JSON.parse(storage.getItem(audioEffectsStorageKey) ?? '{}') as Partial<AudioEffectsSettings>
    const effect = stored.effect && stored.effect in effectProfiles ? stored.effect : defaultAudioEffects.effect
    const loudnessMode: LoudnessMode = stored.loudnessMode === 'off' || stored.loudnessMode === 'balanced' || stored.loudnessMode === 'strong'
      ? stored.loudnessMode
      : stored.normalize === false ? 'off' : defaultAudioEffects.loudnessMode
    return {
      enabled: typeof stored.enabled === 'boolean' ? stored.enabled : defaultAudioEffects.enabled,
      effect,
      bands: Array.isArray(stored.bands) && stored.bands.length === 10 ? stored.bands.map((value, index) => bounded(value, effectProfiles[effect].curve[index], -12, 12)) : [...effectProfiles[effect].curve],
      intensity: bounded(stored.intensity, defaultAudioEffects.intensity, 0, 100),
      deviceProfile: typeof stored.deviceProfile === 'string' ? stored.deviceProfile : defaultAudioEffects.deviceProfile,
      bass: bounded(stored.bass, defaultAudioEffects.bass, 0, 100),
      clarity: bounded(stored.clarity, defaultAudioEffects.clarity, 0, 100),
      spatial: typeof stored.spatial === 'boolean' ? stored.spatial : defaultAudioEffects.spatial,
      spatialAmount: bounded(stored.spatialAmount, defaultAudioEffects.spatialAmount, 0, 100),
      normalize: loudnessMode !== 'off',
      loudnessMode,
      crossfade: bounded(stored.crossfade, defaultAudioEffects.crossfade, 0, 12),
    }
  } catch {
    storage.removeItem(audioEffectsStorageKey)
    return defaultAudioEffects
  }
}

export const writeAudioEffects = (settings: AudioEffectsSettings, storage: Pick<Storage, 'setItem'> = localStorage) => storage.setItem(audioEffectsStorageKey, JSON.stringify(settings))

const deviceProfiles: Record<string, { curve: number[]; bass: number; spatial: number }> = {
  phone: { curve: [-5, -3, -1, 1.2, 1, .5, 0, -.8, -1.5, -2], bass: -.8, spatial: .42 },
  headphones: { curve: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bass: 0, spatial: 1 },
  earbuds: { curve: [-1.5, -.8, 0, .4, .7, .6, 0, -.4, -.8, -.5], bass: .2, spatial: .82 },
  laptop: { curve: [-4, -2.5, -.8, 1, .8, .4, 0, -.6, -1.2, -2], bass: -.6, spatial: .55 },
  desktop: { curve: [0, .3, .4, 0, 0, 0, 0, .3, .3, 0], bass: .2, spatial: .8 },
  bluetooth: { curve: [-1, 0, .5, .6, .3, 0, 0, -.4, -.8, -1], bass: .3, spatial: .6 },
  car: { curve: [.5, .5, -.5, -.8, -.4, 0, .7, .8, .4, 0], bass: .4, spatial: .45 },
  dac: { curve: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bass: 0, spatial: .7 },
}

export const deriveAudioEffectParameters = (settings: AudioEffectsSettings) => {
  const amount = settings.enabled ? settings.intensity / 100 : 0
  const profile = effectProfiles[settings.effect]
  const device = deviceProfiles[settings.deviceProfile] ?? deviceProfiles.headphones
  const bandGains = settings.bands.map((gain, index) => amount === 0 ? 0 : (gain + (device.curve[index] ?? 0)) * amount)
  const bassGain = settings.enabled ? (settings.bass / 100 * 4.5 + device.bass + profile.bassBias) * amount : 0
  const clarityGain = settings.enabled ? (((settings.clarity - 50) / 50) * 2.2 + profile.clarityBias) * amount : 0
  const spatialAmount = settings.enabled && settings.spatial ? settings.spatialAmount / 100 : 0
  const spatialScale = spatialAmount * device.spatial
  const widthDelta = profile.width * amount * spatialScale
  const stereoCrossfeed = widthDelta === 0 ? 0 : -widthDelta / 2
  const wetGain = profile.room * amount * spatialScale
  const lowPeak = bassGain + Math.max(0, ...bandGains.slice(0, 4))
  const highPeak = clarityGain + Math.max(0, ...bandGains.slice(6))
  const peakBoost = Math.max(0, lowPeak, highPeak, ...bandGains)
  const headroomDb = peakBoost > 0 ? -(peakBoost + 1) : 0
  const loudnessMode = settings.normalize ? settings.loudnessMode : 'off'
  const compressor = settings.enabled && loudnessMode !== 'off'
  const compressorAmount = compressor
    ? Math.min(1, profile.compression * amount + (loudnessMode === 'strong' ? .34 : .12))
    : 0
  return {
    bandGains,
    bassGain,
    clarityGain,
    wetGain,
    dryGain: Math.max(.9, 1 - wetGain * .32),
    stereoDirect: 1 + widthDelta / 2,
    stereoCrossfeed,
    preampGain: Math.pow(10, headroomDb / 20),
    headroomDb,
    compressor,
    compressorAmount,
    makeupGain: loudnessMode === 'strong' ? 1.1 : loudnessMode === 'balanced' ? 1.02 : 1,
    limiterThreshold: -1.2,
    fadeSeconds: settings.enabled ? settings.crossfade : 0,
  }
}
