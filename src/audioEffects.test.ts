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
    expect(parameters.bassGain).toBeCloseTo(1.4)
    expect(parameters.wetGain).toBeCloseTo(.08)
    expect(parameters.compressor).toBe(true)
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
