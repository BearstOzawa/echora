import { readFileSync } from 'node:fs'

const input = process.argv[2]
if (!input) {
  console.error('Usage: node scripts/analyze-android-soak.mjs <soak.csv>')
  process.exit(1)
}

const lines = readFileSync(input, 'utf8').trim().split(/\r?\n/)
const headers = lines[0].split(',')
const positionIndex = headers.indexOf('position_ms')
const rows = lines.slice(1).map((line) => {
  const values = line.split(',')
  const [timestamp, elapsedSeconds, action, totalPssKb, totalRssKb, swapPssKb, mediaSession, playing] = values
  return {
    timestamp,
    elapsedSeconds: Number(elapsedSeconds),
    action,
    totalPssKb: Number(totalPssKb),
    totalRssKb: Number(totalRssKb),
    swapPssKb: Number(swapPssKb),
    mediaSession: Number(mediaSession),
    playing: Number(playing),
    positionMs: positionIndex >= 0 ? Number(values[positionIndex]) : null,
  }
}).filter((row) => Number.isFinite(row.elapsedSeconds) && row.totalPssKb > 0)

if (rows.length < 2) {
  console.error('Not enough valid samples')
  process.exit(1)
}

const steadyRows = rows.filter((row) => row.elapsedSeconds >= Math.min(600, rows.at(-1).elapsedSeconds * .2))
const slopePerSecond = (samples) => {
  const xAverage = samples.reduce((sum, row) => sum + row.elapsedSeconds, 0) / samples.length
  const yAverage = samples.reduce((sum, row) => sum + row.totalPssKb, 0) / samples.length
  const numerator = samples.reduce((sum, row) => sum + (row.elapsedSeconds - xAverage) * (row.totalPssKb - yAverage), 0)
  const denominator = samples.reduce((sum, row) => sum + (row.elapsedSeconds - xAverage) ** 2, 0)
  return denominator ? numerator / denominator : 0
}
const pssValues = rows.map((row) => row.totalPssKb)
const swapValues = rows.map((row) => row.swapPssKb)
const playingSamples = rows.filter((row) => row.playing).length
const mediaSamples = rows.filter((row) => row.mediaSession).length
const lockSamples = rows.filter((row) => row.action.includes('lock-cycle'))
const steadyPlaybackRows = rows.filter((row) => !row.action.includes('next') && !row.action.includes('lock-cycle'))
const steadyPlayingSamples = steadyPlaybackRows.filter((row) => row.playing).length
const nextTrackRecoveries = rows.flatMap((row, index) => {
  if (!row.action.includes('next')) return []
  const observation = rows.slice(index + 1).find((candidate) => !candidate.action.includes('next'))
  return observation ? [{
    triggeredAtSeconds: row.elapsedSeconds,
    observedAfterSeconds: observation.elapsedSeconds - row.elapsedSeconds,
    recovered: Boolean(observation.playing),
  }] : []
})
const positionPairs = rows.slice(1).map((row, index) => ({ previous: rows[index], row }))
  .filter(({ previous, row }) => previous.playing && row.playing
    && Number.isFinite(previous.positionMs) && Number.isFinite(row.positionMs)
    && !row.action.includes('next'))
const positionProgress = positionPairs.map(({ previous, row }) => {
  const delta = row.positionMs - previous.positionMs
  return { gap: row.elapsedSeconds - previous.elapsedSeconds, advanced: delta >= 1_000 || delta <= -1_000 }
})
let currentPositionStallSeconds = 0
let longestPositionStallSeconds = 0
positionProgress.forEach(({ gap, advanced }) => {
  currentPositionStallSeconds = advanced ? 0 : currentPositionStallSeconds + gap
  longestPositionStallSeconds = Math.max(longestPositionStallSeconds, currentPositionStallSeconds)
})
const durationSeconds = rows.at(-1).elapsedSeconds
const sampleGaps = rows.slice(1).map((row, index) => ({
  gap: row.elapsedSeconds - rows[index].elapsedSeconds,
  expectedLockDelay: row.action.includes('lock-cycle') ? 60 : 0,
})).filter((sample) => sample.gap > 0)
const regularSampleGaps = sampleGaps.filter((sample) => !sample.expectedLockDelay).map((sample) => sample.gap)
const sortedSampleGaps = [...(regularSampleGaps.length ? regularSampleGaps : sampleGaps.map((sample) => sample.gap))].sort((left, right) => left - right)
const medianSampleGapSeconds = sortedSampleGaps.length ? sortedSampleGaps[Math.floor(sortedSampleGaps.length / 2)] : 0
const maxSampleGapSeconds = sampleGaps.length ? Math.max(...sampleGaps.map((sample) => sample.gap)) : 0
const reliableGapLimit = Math.max(60, medianSampleGapSeconds * 1.75)
let currentWindowStart = rows[0].elapsedSeconds
let longestContinuousWindowSeconds = 0
sampleGaps.forEach(({ gap, expectedLockDelay }, index) => {
  if (gap <= reliableGapLimit + expectedLockDelay) return
  longestContinuousWindowSeconds = Math.max(longestContinuousWindowSeconds, rows[index].elapsedSeconds - currentWindowStart)
  currentWindowStart = rows[index + 1].elapsedSeconds
})
longestContinuousWindowSeconds = Math.max(longestContinuousWindowSeconds, rows.at(-1).elapsedSeconds - currentWindowStart)
const timingReliable = sampleGaps.every(({ gap, expectedLockDelay }) => gap <= reliableGapLimit + expectedLockDelay)
const steadySlopeMbPerHour = durationSeconds >= 30 * 60 && steadyRows.length >= 6
  ? Number((slopePerSecond(steadyRows) * 3600 / 1024).toFixed(2))
  : null

console.log(JSON.stringify({
  input,
  durationMinutes: Number((durationSeconds / 60).toFixed(1)),
  timing: {
    medianSampleGapSeconds,
    maxSampleGapSeconds,
    longestContinuousWindowMinutes: Number((longestContinuousWindowSeconds / 60).toFixed(1)),
    reliable: timingReliable,
  },
  samples: rows.length,
  pssMb: {
    start: Number((rows[0].totalPssKb / 1024).toFixed(1)),
    end: Number((rows.at(-1).totalPssKb / 1024).toFixed(1)),
    min: Number((Math.min(...pssValues) / 1024).toFixed(1)),
    max: Number((Math.max(...pssValues) / 1024).toFixed(1)),
    steadySlopeMbPerHour,
  },
  swapMb: {
    start: Number((rows[0].swapPssKb / 1024).toFixed(1)),
    end: Number((rows.at(-1).swapPssKb / 1024).toFixed(1)),
    min: Number((Math.min(...swapValues) / 1024).toFixed(1)),
    max: Number((Math.max(...swapValues) / 1024).toFixed(1)),
  },
  mediaSessionRate: Number((mediaSamples / rows.length * 100).toFixed(1)),
  playingRate: Number((playingSamples / rows.length * 100).toFixed(1)),
  steadyPlayingRate: steadyPlaybackRows.length ? Number((steadyPlayingSamples / steadyPlaybackRows.length * 100).toFixed(1)) : null,
  nextTrackRecoveryRate: nextTrackRecoveries.length ? Number((nextTrackRecoveries.filter((sample) => sample.recovered).length / nextTrackRecoveries.length * 100).toFixed(1)) : null,
  nextTrackRecoveries,
  position: {
    available: positionIndex >= 0,
    advanceRate: positionProgress.length
      ? Number((positionProgress.filter((sample) => sample.advanced).length / positionProgress.length * 100).toFixed(1))
      : null,
    startSeconds: positionIndex >= 0 ? Number((rows[0].positionMs / 1000).toFixed(1)) : null,
    endSeconds: positionIndex >= 0 ? Number((rows.at(-1).positionMs / 1000).toFixed(1)) : null,
    longestStallMinutes: positionProgress.length ? Number((longestPositionStallSeconds / 60).toFixed(1)) : null,
  },
  lockCycleSamples: lockSamples.map((row) => ({ elapsedSeconds: row.elapsedSeconds, playing: Boolean(row.playing), pssMb: Number((row.totalPssKb / 1024).toFixed(1)) })),
}, null, 2))
