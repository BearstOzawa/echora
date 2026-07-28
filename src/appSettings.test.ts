import { beforeEach, describe, expect, it } from 'vitest'
import { defaultAppSettings, readAppSettings, writeAppSettings } from './appSettings'

describe('app settings storage', () => {
  beforeEach(() => localStorage.clear())

  it('uses stable defaults when no settings exist', () => {
    expect(readAppSettings()).toEqual(defaultAppSettings)
    expect(readAppSettings().musicSource).toEqual({ preferredQuality: 'high', downloadQuality: 'high', downloadFileNameFormat: 'artist-title', autoFallback: true })
  })

  it('round-trips supported settings', () => {
    const settings = { ...defaultAppSettings, resumePlayback: false, closeBehavior: 'background' as const, reduceMotion: true, ai: { ...defaultAppSettings.ai, provider: 'compatible' as const, baseUrl: 'https://ai.example.com/v1', model: 'music-agent', apiKey: 'local-test-key' } }
    writeAppSettings(settings)
    expect(readAppSettings()).toEqual(settings)
  })

  it('migrates older settings with AI defaults', () => {
    localStorage.setItem('echora.appSettings', JSON.stringify({ resumePlayback: false, closeBehavior: 'background', reduceMotion: true }))
    expect(readAppSettings()).toEqual({ ...defaultAppSettings, resumePlayback: false, closeBehavior: 'background', reduceMotion: true })
  })

  it('migrates and validates device playback controls independently', () => {
    localStorage.setItem('echora.appSettings', JSON.stringify({ playback: { systemMediaControls: false, keepAwakeWhilePlaying: true } }))
    expect(readAppSettings().playback).toEqual({ systemMediaControls: false, keepAwakeWhilePlaying: true })
    localStorage.setItem('echora.appSettings', JSON.stringify({ playback: { systemMediaControls: 'yes', keepAwakeWhilePlaying: 1 } }))
    expect(readAppSettings().playback).toEqual(defaultAppSettings.playback)
  })

  it('persists independent content collection limits and rejects unsupported values', () => {
    localStorage.setItem('echora.appSettings', JSON.stringify({ content: { featuredTrackLimit: 30, chartTrackLimit: 20 } }))
    expect(readAppSettings().content).toEqual({ ...defaultAppSettings.content, featuredTrackLimit: 30, chartTrackLimit: 20 })
    localStorage.setItem('echora.appSettings', JSON.stringify({ content: { featuredTrackLimit: 50, chartTrackLimit: 100 } }))
    expect(readAppSettings().content).toEqual(defaultAppSettings.content)
  })

  it('migrates and validates the managed playback cache limit', () => {
    localStorage.setItem('echora.appSettings', JSON.stringify({ storage: { playbackCacheLimitMb: 512 } }))
    expect(readAppSettings().storage).toEqual({ ...defaultAppSettings.storage, playbackCacheLimitMb: 512 })
    localStorage.setItem('echora.appSettings', JSON.stringify({ storage: { playbackCacheLimitMb: 999_999 } }))
    expect(readAppSettings().storage).toEqual(defaultAppSettings.storage)
  })

  it('discards retired local source fields', () => {
    localStorage.setItem('echora.appSettings', JSON.stringify({ musicSource: { scriptContent: '', sourceName: '', apiKey: 'optional-key', preferredQuality: 'high' } }))
    expect(readAppSettings().musicSource).toEqual(defaultAppSettings.musicSource)
  })

  it('keeps quality preferences independent from retired local credentials', () => {
    localStorage.setItem('echora.appSettings', JSON.stringify({ musicSource: { apiKey: '', preferredQuality: 'hires', downloadQuality: 'hires' } }))
    expect(readAppSettings().musicSource.preferredQuality).toBe('hires')
    expect(readAppSettings().musicSource.downloadQuality).toBe('hires')
  })

  it('migrates mature playback, discovery, local, download, and AI preferences', () => {
    localStorage.setItem('echora.appSettings', JSON.stringify({
      startupView: 'field',
      seekStepSeconds: 15,
      ai: { autoLearnPreferences: false },
      musicSource: { apiKey: 'personal-key', downloadQuality: 'hires', downloadFileNameFormat: 'title-artist' },
      content: { personalizedRecommendations: false },
      storage: { autoScanLocalFolders: false },
    }))
    expect(readAppSettings()).toMatchObject({
      startupView: 'field',
      seekStepSeconds: 15,
      ai: { autoLearnPreferences: false },
      musicSource: { downloadQuality: 'hires', downloadFileNameFormat: 'title-artist' },
      content: { personalizedRecommendations: false },
      storage: { autoScanLocalFolders: false },
    })
  })

  it('keeps playback preferences while ignoring external source definitions', () => {
    localStorage.setItem('echora.appSettings', JSON.stringify({ musicSource: {
      scriptFileName: 'custom.js',
      scriptContent: 'external source code',
      sourceName: 'external source',
      endpoint: 'https://untrusted.example.com',
      apiKey: 'personal-key',
      preferredQuality: 'hires',
      autoFallback: false,
    } }))
    expect(readAppSettings().musicSource).toEqual({
      ...defaultAppSettings.musicSource,
      preferredQuality: 'hires',
      downloadQuality: 'hires',
      autoFallback: false,
    })
  })

  it('falls back field by field for malformed values', () => {
    localStorage.setItem('echora.appSettings', JSON.stringify({ resumePlayback: 'yes', closeBehavior: 'minimize', reduceMotion: 1, ai: { provider: 'unknown', baseUrl: 3, model: false, apiKey: null } }))
    expect(readAppSettings()).toEqual(defaultAppSettings)
  })

  it('recovers from invalid JSON', () => {
    localStorage.setItem('echora.appSettings', '{broken')
    expect(readAppSettings()).toEqual(defaultAppSettings)
  })
})
