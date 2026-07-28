import { appendFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const adb = process.env.ADB ?? `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`
const packageName = 'studio.echora.client'
const durationMinutes = Math.max(5, Number(process.argv[2] ?? 120))
const sampleSeconds = Math.max(30, Number(process.argv[3] ?? 300))
const output = process.argv[4] ?? `/tmp/echora-android-soak-${Date.now()}.csv`

const run = (...args) => spawnSync(adb, args, { encoding: 'utf8' }).stdout.trim()
const shell = (...args) => run('shell', ...args)
const dispatchMediaCommand = (command) => spawnSync(
  adb,
  ['shell', 'cmd', 'media_session', 'monitor', 'EchoraPlayback'],
  { encoding: 'utf8', input: `${command}\nq\n` },
).stdout.includes(`V2Monitoring session EchoraPlayback`)
const numberFrom = (value, pattern) => Number(value.match(pattern)?.[1] ?? 0)
const echoraMediaSession = (value) => value.match(/EchoraPlayback studio\.echora\.client[\s\S]*?(?=\n\S|$)/)?.[0] ?? ''
const waitFor = async (predicate, timeoutMs, intervalMs = 500) => {
  const startedAt = performance.now()
  while (performance.now() - startedAt < timeoutMs) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return false
}
const sample = (elapsedSeconds, action = '') => {
  const memory = shell('dumpsys', 'meminfo', packageName)
  const media = shell('dumpsys', 'media_session')
  const session = echoraMediaSession(media)
  const row = [
    new Date().toISOString(), elapsedSeconds, action,
    numberFrom(memory, /TOTAL PSS:\s+(\d+)/),
    numberFrom(memory, /TOTAL RSS:\s+(\d+)/),
    numberFrom(memory, /TOTAL SWAP PSS:\s+(\d+)/),
    session ? 1 : 0,
    /state=PlaybackState \{state=(?:PLAYING\(3\)|3)/.test(session) ? 1 : 0,
    numberFrom(session, /position=(\d+)/),
  ]
  appendFileSync(output, `${row.join(',')}\n`)
  console.log(row.join(','))
}

writeFileSync(output, 'timestamp,elapsed_seconds,action,total_pss_kb,total_rss_kb,swap_pss_kb,media_session,playing,position_ms\n')
shell('am', 'start', '-n', `${packageName}/.MainActivity`)
const sessionReady = await waitFor(() => Boolean(echoraMediaSession(shell('dumpsys', 'media_session'))), 15_000)
if (!sessionReady) throw new Error('Echora MediaSession did not become available within 15 seconds')
if (!dispatchMediaCommand('play')) throw new Error('Unable to dispatch play to Echora MediaSession')
const playbackReady = await waitFor(() => /state=PlaybackState \{state=(?:PLAYING\(3\)|3)/.test(echoraMediaSession(shell('dumpsys', 'media_session'))), 15_000)
if (!playbackReady) throw new Error('Echora did not enter the playing state within 15 seconds')

const startedAt = performance.now()
const durationMs = durationMinutes * 60_000
let nextTrackAt = 10 * 60_000
let lockCycleDone = false
sample(0, 'start')

while (performance.now() - startedAt < durationMs) {
  await new Promise((resolve) => setTimeout(resolve, sampleSeconds * 1000))
  const elapsed = performance.now() - startedAt
  let action = ''
  if (elapsed >= nextTrackAt) {
    dispatchMediaCommand('next')
    nextTrackAt += 10 * 60_000
    action = 'next'
  }
  if (!lockCycleDone && elapsed >= durationMs / 2) {
    shell('input', 'keyevent', '26')
    await new Promise((resolve) => setTimeout(resolve, 60_000))
    shell('input', 'keyevent', '26')
    shell('input', 'keyevent', '82')
    lockCycleDone = true
    action = action ? `${action}+lock-cycle` : 'lock-cycle'
  }
  sample(Math.round((performance.now() - startedAt) / 1000), action)
}

sample(Math.round((performance.now() - startedAt) / 1000), 'complete')
console.log(`SOAK_RESULT=${output}`)
