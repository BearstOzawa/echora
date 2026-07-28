import { execFileSync } from 'node:child_process'

const appPath = 'src-tauri/gen/apple/build/arm64-sim/Echora.app'
const extensionPath = `${appPath}/PlugIns/EchoraNowPlayingExtension.appex`

if (process.platform !== 'darwin') process.exit(0)

for (const path of [extensionPath, appPath]) {
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', path], { stdio: 'inherit' })
}
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'inherit' })

console.log('Signed iOS simulator app for interactive App Intents')
