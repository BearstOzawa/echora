import { describe, expect, it } from 'vitest'
import type { OnlineSource, Track } from './types'
import { findSourceFallbackCandidates, isSameTrackVersion, rankSourceFallbacks, resolveSourceFallback, sourceFallbackKey } from './sourceFallback'

const track = (id: number, source: OnlineSource, overrides: Partial<Track> = {}): Track => ({
  id,
  title: '玛吉阿米',
  artist: '张博',
  album: '玛吉阿米',
  duration: '5:38',
  durationSeconds: 338,
  source: source === 'kg' ? '酷狗' : source === 'tx' ? 'QQ' : source === 'wy' ? '网易云' : source === 'kw' ? '酷我' : '咪咕',
  quality: 'MP3 320 kbps',
  cover: '',
  bpm: 0,
  musicalKey: '',
  x: 0,
  y: 0,
  offline: false,
  verified: true,
  sizeMb: 0,
  remote: {
    source,
    musicInfo: { songmid: String(id), name: '玛吉阿米', singer: '张博', albumName: '玛吉阿米', interval: '05:38', source, types: [], _types: {}, typeUrl: {} },
    availableQualities: ['320k'],
  },
  ...overrides,
})

describe('source fallback candidates', () => {
  it('matches the same release by normalized metadata or duration', () => {
    expect(isSameTrackVersion(track(1, 'kg'), track(2, 'tx', { album: '其他专辑', durationSeconds: 337 }))).toBe(true)
    expect(isSameTrackVersion(track(1, 'kg'), track(3, 'wy', { artist: '其他艺人' }))).toBe(false)
  })

  it('excludes duplicate entries from the failing platform', () => {
    const primary = track(1, 'kg')
    const candidates = findSourceFallbackCandidates(primary, [track(2, 'kg'), track(3, 'tx'), track(4, 'wy')])
    expect(candidates.map((candidate) => candidate.remote?.source)).toEqual(['tx', 'wy'])
  })

  it('does not retry candidates already attempted from the catalog', () => {
    const qq = track(3, 'tx')
    const attempted = new Set([sourceFallbackKey(qq)])
    expect(findSourceFallbackCandidates(track(1, 'kg'), [qq, track(4, 'kw')], attempted).map((candidate) => candidate.remote?.source)).toEqual(['kw'])
  })

  it('searches other platforms after every catalog candidate fails', async () => {
    const primary = track(1, 'kg')
    const duplicateKugou = track(2, 'kg')
    const catalogQq = track(3, 'tx')
    const searchedKuwo = track(4, 'kw')
    const attempts: OnlineSource[] = []
    const result = await resolveSourceFallback({
      track: primary,
      catalog: [duplicateKugou, catalogQq],
      availableSources: ['tx', 'wy', 'kw', 'kg'],
      search: async (_query, sources) => {
        expect(sources).toEqual(['tx', 'wy', 'kw'])
        return [catalogQq, searchedKuwo]
      },
      resolve: async (candidate) => {
        attempts.push(candidate.remote!.source)
        if (candidate.remote!.source === 'tx') throw new Error('unavailable')
        return 'playable-url'
      },
    })

    expect(attempts).toEqual(['tx', 'kw'])
    expect(result.match).toEqual({ track: searchedKuwo, value: 'playable-url' })
  })

  it('prefers a healthy platform and a candidate with the requested quality', async () => {
    const ranked = rankSourceFallbacks(['tx', 'wy', 'kw'], [
      { source: 'tx', catalogStatus: 'available', playbackStatus: 'error', health: { successRate: 30, averageLatencyMs: 1800 } },
      { source: 'wy', catalogStatus: 'available', playbackStatus: 'available', health: { successRate: 95, averageLatencyMs: 400 } },
      { source: 'kw', catalogStatus: 'available', playbackStatus: 'unchecked', health: { successRate: null, averageLatencyMs: null } },
    ])
    expect(ranked).toEqual(['wy', 'kw', 'tx'])
    expect(rankSourceFallbacks(['kw', 'mg'], [
      { source: 'kw', catalogStatus: 'available', playbackStatus: 'unchecked', health: { successRate: null, averageLatencyMs: null } },
      { source: 'mg', availability: 'limited', catalogStatus: 'available', playbackStatus: 'unchecked', health: { successRate: null, averageLatencyMs: null } },
    ])).toEqual(['kw', 'mg'])

    const attempts: OnlineSource[] = []
    await resolveSourceFallback({
      track: track(1, 'kg'),
      catalog: [track(2, 'wy', { remote: { ...track(2, 'wy').remote!, availableQualities: ['128k'] } }), track(3, 'kw')],
      availableSources: ranked,
      preferredQuality: '320k',
      search: async () => [],
      resolve: async (candidate) => { attempts.push(candidate.remote!.source); return 'ok' },
    })
    expect(attempts).toEqual(['kw'])
  })
})
