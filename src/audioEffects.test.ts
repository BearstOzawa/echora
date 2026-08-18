import { beforeEach, describe, expect, it } from 'vitest'
import { audioEffectsStorageKey, defaultAudioEffects, deriveAudioEffectParameters, readAudioEffects, requiresAudioProcessing, writeAudioEffects } from './audioEffects'

beforeEach(() => localStorage.clear())

describe('audio effects settings', () => {
  it('defaults new installations to direct playback without an audio graph', () => {
    expect(defaultAudioEffects.enabled).toBe(false)
    expect(requiresAudioProcessing(defaultAudioEffects)).toBe(false)
    expect(requiresAudioProcessing({ enabled: true })).toBe(true)
  })

  it('turns every processing stage into a neutral path when disabled', () => {
    const parameters = deriveAudioEffectParameters({ ...defaultAudioEffects, enabled: false })
    expect(parameters.bandGains).toEqual(Array(10).fill(0))
    expect(parameters).toMatchObject({ bassGain: 0, wetGain: 0, stereoCrossfeed: 0, preampGain: 1, compressor: false, fadeSeconds: 0 })
  })

  it('scales equalizer, bass, and spatial processing by intensity', () => {
    const parameters = deriveAudioEffectParameters({ ...defaultAudioEffects, enabled: true, intensity: 50, bands: [6, 0, 0, 0, 0, 0, 0, 0, 0, 0], bass: 40 })
    expect(parameters.bandGains[0]).toBe(3)
    expect(parameters.bassGain).toBeCloseTo(.9)
    expect(parameters.wetGain).toBeCloseTo(.0276)
    expect(parameters.compressor).toBe(true)
  })

  it('layers output-device compensation onto the selected sound profile', () => {
    const headphones = deriveAudioEffectParameters({ ...defaultAudioEffects, enabled: true, intensity: 100, deviceProfile: 'headphones' })
    const phone = deriveAudioEffectParameters({ ...defaultAudioEffects, enabled: true, intensity: 100, deviceProfile: 'phone' })
    expect(phone.bandGains).not.toEqual(headphones.bandGains)
    expect(phone.bandGains[0]).toBeLessThan(headphones.bandGains[0])
    expect(Math.abs(phone.stereoCrossfeed)).toBeLessThan(Math.abs(headphones.stereoCrossfeed))
  })

  it('automatically reserves headroom for stacked boosts', () => {
    const neutral = deriveAudioEffectParameters({ ...defaultAudioEffects, enabled: true, effect: '纯净直出', intensity: 100, bands: Array(10).fill(0), bass: 0, clarity: 50 })
    const boosted = deriveAudioEffectParameters({ ...defaultAudioEffects, enabled: true, intensity: 100, bands: [8, 6, 4, 0, 0, 0, 0, 0, 0, 0], bass: 80 })
    expect(neutral.headroomDb).toBe(0)
    expect(neutral.preampGain).toBe(1)
    expect(boosted.headroomDb).toBeLessThan(-1)
    expect(boosted.preampGain).toBeLessThan(1)
  })

  it('keeps stereo widening level-stable and separates loudness strengths', () => {
    const balanced = deriveAudioEffectParameters({ ...defaultAudioEffects, enabled: true, intensity: 100, loudnessMode: 'balanced', normalize: true })
    const strong = deriveAudioEffectParameters({ ...defaultAudioEffects, enabled: true, intensity: 100, loudnessMode: 'strong', normalize: true })
    expect(balanced.stereoDirect + balanced.stereoCrossfeed).toBeCloseTo(1)
    expect(strong.compressorAmount).toBeGreaterThan(balanced.compressorAmount)
    expect(strong.makeupGain).toBeGreaterThan(balanced.makeupGain)
  })

  it('gives presets distinct spatial and dynamic behavior with clipping headroom', () => {
    const live = deriveAudioEffectParameters({ ...defaultAudioEffects, enabled: true, effect: '现场距离', bands: [...defaultAudioEffects.bands] })
    const direct = deriveAudioEffectParameters({ ...defaultAudioEffects, enabled: true, effect: '纯净直出', bands: Array(10).fill(0) })
    expect(live.wetGain).toBeGreaterThan(direct.wetGain)
    expect(Math.abs(live.stereoCrossfeed)).toBeGreaterThan(Math.abs(direct.stereoCrossfeed))
    expect(live.preampGain).toBeLessThan(1)
    expect(live.compressorAmount).not.toBe(direct.compressorAmount)
  })

  it('persists the shared settings used by the panel and playback graph', () => {
    writeAudioEffects({ ...defaultAudioEffects, effect: '人声向前', intensity: 74 })
    expect(JSON.parse(localStorage.getItem(audioEffectsStorageKey)!)).toMatchObject({ effect: '人声向前', intensity: 74 })
    expect(readAudioEffects()).toMatchObject({ effect: '人声向前', intensity: 74 })
  })
})
