import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import sharp from 'sharp'

const sourcePlistPath = 'src-tauri/Info.ios.plist'
const generatedPlistPath = 'src-tauri/gen/apple/echora_iOS/Info.plist'
const generatedProjectDirectory = 'src-tauri/gen/apple'
const generatedProjectSpecPath = `${generatedProjectDirectory}/project.yml`
const staleArchiveAppPath = 'src-tauri/gen/apple/build/echora_iOS.xcarchive/Products/Applications/Echora.app'
const staleSimulatorAppPath = 'src-tauri/gen/apple/build/arm64-sim/Echora.app'
const iosIconSourceDirectory = 'src-tauri/icons/ios'
const generatedIosIconDirectory = 'src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset'
const tauriConfig = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'))
const applicationVersion = tauriConfig.version

if (process.platform !== 'darwin') {
  console.log('iOS project configuration is only available on macOS')
  process.exit(0)
}

try {
  await access(generatedPlistPath)
} catch {
  console.log('iOS project is not initialized; run the iOS init command first')
  process.exit(0)
}

let projectSpec = await readFile(generatedProjectSpecPath, 'utf8')
let projectSpecChanged = false
const versionedProjectSpec = projectSpec
  .replace(/CFBundleShortVersionString: [^\n]+/g, `CFBundleShortVersionString: ${applicationVersion}`)
  .replace(/CFBundleVersion: "[^"]+"/g, `CFBundleVersion: "${applicationVersion}"`)
if (versionedProjectSpec !== projectSpec) {
  projectSpec = versionedProjectSpec
  projectSpecChanged = true
}
const replaceProjectAnchor = (anchor, replacement, message) => {
  if (!projectSpec.includes(anchor)) throw new Error(message)
  projectSpec = projectSpec.replace(anchor, replacement)
  projectSpecChanged = true
}

const applicationSourcesAnchor = '    sources:\n      - path: Sources\n      - path: Assets.xcassets'
if (!projectSpec.includes('../../ios/EchoraLiveActivityBridge.swift')) {
  replaceProjectAnchor(
    applicationSourcesAnchor,
    '    sources:\n      - path: Sources\n      - path: ../../ios/EchoraLiveActivityBridge.swift\n      - path: ../../ios/EchoraLiveActivityIntents.swift\n      - path: ../../ios/EchoraNowPlayingAttributes.swift\n      - path: Assets.xcassets',
    'Unable to locate iOS application sources',
  )
}

if (!projectSpec.includes('      - path: ../../ios/EchoraLiveActivityIntents.swift')) {
  replaceProjectAnchor(
    '      - path: ../../ios/EchoraLiveActivityBridge.swift\n',
    '      - path: ../../ios/EchoraLiveActivityBridge.swift\n      - path: ../../ios/EchoraLiveActivityIntents.swift\n',
    'Unable to locate iOS live-activity sources',
  )
}

if (!projectSpec.includes('../../ios/EchoraQuickActionBridge.swift')) {
  replaceProjectAnchor(
    '      - path: ../../ios/EchoraLiveActivityBridge.swift\n',
    '      - path: ../../ios/EchoraLiveActivityBridge.swift\n      - path: ../../ios/EchoraQuickActionBridge.swift\n',
    'Unable to locate iOS native bridge sources',
  )
}

if (!projectSpec.includes('../../ios/EchoraMediaSessionBridge.swift')) {
  replaceProjectAnchor(
    '      - path: ../../ios/EchoraLiveActivityBridge.swift\n',
    '      - path: ../../ios/EchoraLiveActivityBridge.swift\n      - path: ../../ios/EchoraMediaSessionBridge.swift\n',
    'Unable to locate iOS media-session bridge sources',
  )
}

if (!projectSpec.includes('../../ios/EchoraSpeechRecognitionBridge.swift')) {
  replaceProjectAnchor(
    '      - path: ../../ios/EchoraLiveActivityBridge.swift\n',
    '      - path: ../../ios/EchoraLiveActivityBridge.swift\n      - path: ../../ios/EchoraSpeechRecognitionBridge.swift\n',
    'Unable to locate iOS speech-recognition bridge sources',
  )
}

if (!projectSpec.includes('        NSSupportsLiveActivities: true')) {
  replaceProjectAnchor(
    `        CFBundleVersion: "${applicationVersion}"\n    entitlements:`,
    `        CFBundleVersion: "${applicationVersion}"\n        NSSupportsLiveActivities: true\n    entitlements:`,
    'Unable to locate iOS application metadata',
  )
}

if (!projectSpec.includes('      - target: EchoraNowPlayingExtension')) {
  replaceProjectAnchor(
    '      - framework: libapp.a\n        embed: false',
    '      - framework: libapp.a\n        embed: false\n      - target: EchoraNowPlayingExtension',
    'Unable to locate iOS application dependencies',
  )
}

const frameworkAnchor = '      - sdk: CoreGraphics.framework'
const nativePlaybackFrameworks = '      - sdk: AVFAudio.framework\n      - sdk: CoreGraphics.framework\n      - sdk: MediaPlayer.framework'
if (!projectSpec.includes('      - sdk: MediaPlayer.framework')) {
  replaceProjectAnchor(frameworkAnchor, nativePlaybackFrameworks, 'Unable to locate iOS framework dependencies')
}

if (!projectSpec.includes('      - sdk: Speech.framework')) {
  replaceProjectAnchor(
    '      - sdk: MediaPlayer.framework',
    '      - sdk: MediaPlayer.framework\n      - sdk: Speech.framework',
    'Unable to locate iOS speech framework dependencies',
  )
}

if (!projectSpec.includes('  EchoraNowPlayingExtension:')) {
  projectSpec += `
  EchoraNowPlayingExtension:
    type: app-extension
    platform: iOS
    deploymentTarget: "16.2"
    sources:
      - path: ../../ios/EchoraNowPlayingAttributes.swift
      - path: ../../ios/EchoraLiveActivityIntents.swift
      - path: ../../ios/EchoraNowPlayingLiveActivity.swift
    info:
      path: EchoraNowPlayingExtension/Info.plist
      properties:
        CFBundleDisplayName: Echora
        CFBundleShortVersionString: ${applicationVersion}
        CFBundleVersion: "${applicationVersion}"
        NSExtension:
          NSExtensionPointIdentifier: com.apple.widgetkit-extension
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: studio.echora.client.nowplaying
        SKIP_INSTALL: true
        APPLICATION_EXTENSION_API_ONLY: true
        SWIFT_VERSION: 5.0
`
  projectSpecChanged = true
}

if (!projectSpec.includes('      - path: ../../ios/EchoraLiveActivityIntents.swift\n      - path: ../../ios/EchoraNowPlayingLiveActivity.swift')) {
  replaceProjectAnchor(
    '      - path: ../../ios/EchoraNowPlayingAttributes.swift\n      - path: ../../ios/EchoraNowPlayingLiveActivity.swift',
    '      - path: ../../ios/EchoraNowPlayingAttributes.swift\n      - path: ../../ios/EchoraLiveActivityIntents.swift\n      - path: ../../ios/EchoraNowPlayingLiveActivity.swift',
    'Unable to locate iOS extension sources',
  )
}

if (projectSpecChanged) await writeFile(generatedProjectSpecPath, projectSpec)
await Promise.all([
  mkdir(`${generatedProjectDirectory}/assets`, { recursive: true }),
  mkdir(`${generatedProjectDirectory}/Externals`, { recursive: true }),
])
execFileSync('/usr/bin/env', ['xcodegen', 'generate'], {
  cwd: generatedProjectDirectory,
  stdio: 'inherit',
})

const sourceXml = await readFile(sourcePlistPath, 'utf8')
const source = JSON.parse(
  execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], {
    input: sourceXml,
    encoding: 'utf8',
  }),
)

for (const [key, value] of Object.entries(source)) {
  const args = [key, '-json', JSON.stringify(value), generatedPlistPath]
  try {
    execFileSync('/usr/bin/plutil', ['-replace', ...args], { stdio: 'ignore' })
  } catch {
    execFileSync('/usr/bin/plutil', ['-insert', ...args], { stdio: 'ignore' })
  }
}

await Promise.all((await readdir(iosIconSourceDirectory))
  .filter((file) => file.endsWith('.png'))
  .map(async (file) => {
    const nextPath = `${generatedIosIconDirectory}/${file}.next`
    await sharp(`${iosIconSourceDirectory}/${file}`)
      .flatten({ background: '#111319' })
      .removeAlpha()
      .png()
      .toFile(nextPath)
    await rename(nextPath, `${generatedIosIconDirectory}/${file}`)
  }))

// Tauri cannot replace a non-empty archived app left by an earlier simulator build.
await Promise.all([
  rm(staleArchiveAppPath, { recursive: true, force: true }),
  rm(staleSimulatorAppPath, { recursive: true, force: true }),
])

console.log('Applied iOS privacy and background-audio configuration')
