import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'

const androidManifestPath = 'src-tauri/gen/android/app/src/main/AndroidManifest.xml'
const requiredPermissions = [
  'android.permission.RECORD_AUDIO',
  'android.permission.MODIFY_AUDIO_SETTINGS',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
]

try {
  let manifest = await readFile(androidManifestPath, 'utf8')
  const missingPermissions = requiredPermissions.filter((permission) => !manifest.includes(permission))
  if (missingPermissions.length) {
    const declarations = missingPermissions
      .map((permission) => `<uses-permission android:name="${permission}" />`)
      .join('\n    ')
    manifest = manifest.replace(/(<manifest\b[^>]*>)/, `$1\n    ${declarations}`)
    console.log(`Added Android audio permissions: ${missingPermissions.join(', ')}`)
  }
  if (!manifest.includes('android:windowSoftInputMode="adjustResize"')) {
    manifest = manifest.replace('android:exported="true">', 'android:exported="true"\n            android:windowSoftInputMode="adjustResize">')
  }
  if (!manifest.includes('android:roundIcon=')) {
    manifest = manifest.replace('android:icon="@mipmap/ic_launcher"', 'android:icon="@mipmap/ic_launcher"\n        android:roundIcon="@mipmap/ic_launcher_round"')
  }
  if (!manifest.includes('android.app.shortcuts')) {
    manifest = manifest.replace(
      '            </intent-filter>\n        </activity>',
      '            </intent-filter>\n            <meta-data android:name="android.app.shortcuts" android:resource="@xml/shortcuts" />\n        </activity>',
    )
  }
  if (!manifest.includes('android:name=".EchoraMediaService"')) {
    manifest = manifest.replace(
      '        <provider',
      '        <service\n            android:name=".EchoraMediaService"\n            android:exported="false"\n            android:foregroundServiceType="mediaPlayback"\n            android:stopWithTask="false" />\n\n        <provider',
    )
  }
  await writeFile(androidManifestPath, manifest)
  await cp('src-tauri/icons/android', 'src-tauri/gen/android/app/src/main/res', { recursive: true, force: true })
  await mkdir('src-tauri/gen/android/app/src/main/java/studio/echora/client', { recursive: true })
  await cp('src-tauri/android/java', 'src-tauri/gen/android/app/src/main/java/studio/echora/client', { recursive: true, force: true })
  await cp('src-tauri/android/res', 'src-tauri/gen/android/app/src/main/res', { recursive: true, force: true })
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
    console.log('Android project is not initialized; microphone permission will be added after initialization')
  } else {
    throw error
  }
}
