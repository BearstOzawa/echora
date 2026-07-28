// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Android soak analysis', () => {
  it('separates action samples from steady playback and reports recovery', () => {
    const directory = mkdtempSync(join(tmpdir(), 'echora-soak-'))
    const input = join(directory, 'soak.csv')
    writeFileSync(input, [
      'timestamp,elapsed_seconds,action,total_pss_kb,total_rss_kb,swap_pss_kb,media_session,playing,position_ms',
      '2026-07-25T00:00:00Z,0,start,102400,150000,1024,1,1,1000',
      '2026-07-25T00:05:00Z,300,,103424,151000,2048,1,1,301000',
      '2026-07-25T00:10:00Z,600,next,104448,152000,2048,1,0,0',
      '2026-07-25T00:15:00Z,900,,103424,151000,1024,1,1,300000',
    ].join('\n'))

    const output = execFileSync(process.execPath, ['scripts/analyze-android-soak.mjs', input], { encoding: 'utf8' })
    const result = JSON.parse(output)

    expect(result).toMatchObject({
      playingRate: 75,
      steadyPlayingRate: 100,
      nextTrackRecoveryRate: 100,
      timing: { medianSampleGapSeconds: 300, maxSampleGapSeconds: 300, longestContinuousWindowMinutes: 15, reliable: true },
      position: { available: true, advanceRate: 100, startSeconds: 1, endSeconds: 300, longestStallMinutes: 0 },
    })
    expect(result.nextTrackRecoveries).toEqual([{ triggeredAtSeconds: 600, observedAfterSeconds: 300, recovered: true }])
    expect(result.swapMb).toEqual({ start: 1, end: 1, min: 1, max: 2 })
  })

  it('does not report a suspended interval as continuous coverage', () => {
    const directory = mkdtempSync(join(tmpdir(), 'echora-soak-gap-'))
    const input = join(directory, 'soak.csv')
    writeFileSync(input, [
      'timestamp,elapsed_seconds,action,total_pss_kb,total_rss_kb,swap_pss_kb,media_session,playing',
      '2026-07-25T00:00:00Z,0,start,102400,150000,1024,1,1',
      '2026-07-25T00:05:00Z,300,,103424,151000,2048,1,1',
      '2026-07-25T00:10:00Z,600,,104448,152000,2048,1,1',
      '2026-07-25T00:40:00Z,2400,,103424,151000,1024,1,1',
    ].join('\n'))

    const output = execFileSync(process.execPath, ['scripts/analyze-android-soak.mjs', input], { encoding: 'utf8' })
    expect(JSON.parse(output).timing).toEqual({
      medianSampleGapSeconds: 300,
      maxSampleGapSeconds: 1800,
      longestContinuousWindowMinutes: 10,
      reliable: false,
    })
    expect(JSON.parse(output).position.available).toBe(false)
  })

  it('detects a playing state whose position is stalled', () => {
    const directory = mkdtempSync(join(tmpdir(), 'echora-soak-stalled-'))
    const input = join(directory, 'soak.csv')
    writeFileSync(input, [
      'timestamp,elapsed_seconds,action,total_pss_kb,total_rss_kb,swap_pss_kb,media_session,playing,position_ms',
      '2026-07-25T00:00:00Z,0,start,102400,150000,1024,1,1,25000',
      '2026-07-25T00:00:30Z,30,,102400,150000,1024,1,1,25000',
      '2026-07-25T00:01:00Z,60,,102400,150000,1024,1,1,25000',
    ].join('\n'))

    const output = execFileSync(process.execPath, ['scripts/analyze-android-soak.mjs', input], { encoding: 'utf8' })
    expect(JSON.parse(output).position).toEqual({
      available: true,
      advanceRate: 0,
      startSeconds: 25,
      endSeconds: 25,
      longestStallMinutes: 1,
    })
  })

  it('keeps the intentional lock-cycle sampling delay in the continuous window', () => {
    const directory = mkdtempSync(join(tmpdir(), 'echora-soak-lock-'))
    const input = join(directory, 'soak.csv')
    writeFileSync(input, [
      'timestamp,elapsed_seconds,action,total_pss_kb,total_rss_kb,swap_pss_kb,media_session,playing,position_ms',
      '2026-07-25T00:00:00Z,0,start,102400,150000,1024,1,1,1000',
      '2026-07-25T00:00:30Z,30,,102400,150000,1024,1,1,31000',
      '2026-07-25T00:02:00Z,120,lock-cycle,102400,150000,1024,1,1,121000',
      '2026-07-25T00:02:30Z,150,,102400,150000,1024,1,1,151000',
    ].join('\n'))

    const output = execFileSync(process.execPath, ['scripts/analyze-android-soak.mjs', input], { encoding: 'utf8' })
    expect(JSON.parse(output).timing).toEqual({
      medianSampleGapSeconds: 30,
      maxSampleGapSeconds: 90,
      longestContinuousWindowMinutes: 2.5,
      reliable: true,
    })
  })
})
