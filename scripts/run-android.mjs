import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const action = process.argv[2]
const forwardedArgs = process.argv.slice(3)
const supportedActions = new Set(['init', 'dev', 'build'])

if (!supportedActions.has(action)) {
  console.error('Usage: node scripts/run-android.mjs <init|dev|build> [...args]')
  process.exit(1)
}

const firstExistingDirectory = (candidates) =>
  candidates.find((candidate) => candidate && existsSync(candidate))

const androidHome = firstExistingDirectory([
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  join(homedir(), 'Library', 'Android', 'sdk'),
  join(homedir(), 'Android', 'Sdk'),
])

if (!androidHome) {
  console.error('Android SDK not found. Install it or set ANDROID_HOME.')
  process.exit(1)
}

const javaCandidates = [
  process.env.JAVA_HOME,
  '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
  '/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
]

const javaHome = javaCandidates.find((candidate) => {
  if (!candidate || !existsSync(join(candidate, 'bin', 'java'))) return false
  try {
    const release = readFileSync(join(candidate, 'release'), 'utf8')
    return /JAVA_VERSION="17(?:\.|\")/.test(release)
  } catch {
    return false
  }
})

if (!javaHome) {
  console.error('JDK 17 not found. Install openjdk@17 or set JAVA_HOME to a JDK 17 installation.')
  process.exit(1)
}

const ndkRoot = join(androidHome, 'ndk')
const installedNdks = existsSync(ndkRoot)
  ? readdirSync(ndkRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
  : []
const ndkHome = firstExistingDirectory([
  process.env.NDK_HOME,
  join(ndkRoot, '27.2.12479018'),
  installedNdks[0] ? join(ndkRoot, installedNdks[0]) : undefined,
])

if (!ndkHome) {
  console.error('Android NDK not found. Install NDK 27.2.12479018 with sdkmanager.')
  process.exit(1)
}

const executableDirectories = [
  join(androidHome, 'cmdline-tools', 'latest', 'bin'),
  join(androidHome, 'platform-tools'),
  join(androidHome, 'emulator'),
  join(javaHome, 'bin'),
]

const env = {
  ...process.env,
  ANDROID_HOME: androidHome,
  ANDROID_SDK_ROOT: androidHome,
  JAVA_HOME: javaHome,
  NDK_HOME: ndkHome,
  PATH: [...executableDirectories, process.env.PATH].filter(Boolean).join(delimiter),
}

const run = (command, args) => {
  const result = spawnSync(command, args, { env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (action !== 'init') run(process.execPath, ['scripts/configure-mobile-permissions.mjs'])

run('npx', [
  '--no-install',
  'tauri',
  'android',
  action,
  '--config',
  'src-tauri/tauri.mobile.conf.json',
  ...forwardedArgs,
])

if (action === 'init') run(process.execPath, ['scripts/configure-mobile-permissions.mjs'])
