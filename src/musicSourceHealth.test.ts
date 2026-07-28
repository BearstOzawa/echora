import { describe, expect, it } from 'vitest'
import { emptyMusicSourceHealth, readMusicSourceHealth, recordMusicSourceHealth, summarizeMusicSourceHealth } from './musicSourceHealth'

const memoryStorage = () => {
  let value = ''
  return { getItem: () => value || null, setItem: (_key: string, next: string) => { value = next } }
}

describe('music source health', () => {
  it('summarizes success rate, latency, failures and quality fallback', () => {
    const summary = summarizeMusicSourceHealth([
      { source: 'tx', outcome: 'success', latencyMs: 800, requestedQuality: 'flac', resolvedQuality: '320k', at: 1 },
      { source: 'tx', outcome: 'error', latencyMs: 1200, reason: '播放地址解析超时', at: 2 },
    ])
    expect(summary).toMatchObject({ sampleCount: 2, successRate: 50, averageLatencyMs: 1000, downgradeCount: 1, latestDowngrade: 'flac → 320k', latestFailure: '播放地址解析超时' })
  })

  it('persists a bounded rolling window per platform', () => {
    const storage = memoryStorage()
    for (let index = 0; index < 45; index += 1) recordMusicSourceHealth({ source: 'kg', outcome: 'success', latencyMs: index, at: 100 + index }, storage)
    const summary = readMusicSourceHealth(storage, 145).kg
    expect(summary).toMatchObject({ sampleCount: 40, successCount: 40, successRate: 100 })
  })

  it('returns an empty summary before real playback samples exist', () => {
    expect(emptyMusicSourceHealth()).toMatchObject({ sampleCount: 0, successRate: null, averageLatencyMs: null })
  })
})
