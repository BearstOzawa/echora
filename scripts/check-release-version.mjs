import { readFile } from 'node:fs/promises'

const tag = (process.argv[2] || process.env.GITHUB_REF_NAME || '').trim()
const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag)

if (!match) {
  console.error(`Release tag must use v<semver>; received ${tag || '(empty)'}.`)
  process.exit(1)
}

const expected = match[1]
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const tauriConfig = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
const cargoToml = await readFile(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8')
const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargoToml)?.[1]
const iosAppPlist = await readFile(new URL('../src-tauri/gen/apple/echora_iOS/Info.plist', import.meta.url), 'utf8')
const iosExtensionPlist = await readFile(new URL('../src-tauri/gen/apple/EchoraNowPlayingExtension/Info.plist', import.meta.url), 'utf8')
const plistVersion = (contents) => /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(contents)?.[1]

const versions = {
  'package.json': packageJson.version,
  'src-tauri/tauri.conf.json': tauriConfig.version,
  'src-tauri/Cargo.toml': cargoVersion,
  'src-tauri/gen/apple/echora_iOS/Info.plist': plistVersion(iosAppPlist),
  'src-tauri/gen/apple/EchoraNowPlayingExtension/Info.plist': plistVersion(iosExtensionPlist),
}

const mismatches = Object.entries(versions).filter(([, version]) => version !== expected)
if (mismatches.length) {
  for (const [file, version] of mismatches) {
    console.error(`${file} has version ${version || '(missing)'}, expected ${expected}.`)
  }
  process.exit(1)
}

console.log(`Release version ${expected} is consistent across application manifests.`)
