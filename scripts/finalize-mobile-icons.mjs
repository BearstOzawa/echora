import sharp from 'sharp'
import { readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const markSvg = await readFile('public/echora-mark-v2.svg', 'utf8')
const backgroundSvg = Buffer.from(`
  <svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#20232c"/><stop offset="1" stop-color="#111319"/></linearGradient></defs>
    <rect width="1024" height="1024" fill="url(#bg)"/>
  </svg>
`)
// Keep the brand mark on the same 1024px optical grid as the desktop/Web icon.
// iOS still needs a full-bleed background because the system applies its own mask.
const markSize = 720
const markOffset = (1024 - markSize) / 2
const mark = await sharp(Buffer.from(markSvg)).resize(markSize, markSize).png().toBuffer()
const iosSource = await sharp(backgroundSvg)
  .composite([{ input: mark, left: markOffset, top: markOffset }])
  .png()
  .toBuffer()

const iosDirectory = 'src-tauri/icons/ios'
for (const file of await readdir(iosDirectory)) {
  if (!file.endsWith('.png')) continue
  const path = join(iosDirectory, file)
  const metadata = await sharp(path).metadata()
  if (!metadata.width || !metadata.height) continue
  const nextPath = `${path}.next`
  await sharp(iosSource)
    .resize(metadata.width, metadata.height)
    .flatten({ background: '#111319' })
    .removeAlpha()
    .png()
    .toFile(nextPath)
  await rename(nextPath, path)
}

const androidDirectory = 'src-tauri/icons/android'
await writeFile(join(androidDirectory, 'values', 'ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">#111319</color>
</resources>\n`)
for (const entry of await readdir(androidDirectory, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith('mipmap-')) continue
  const path = join(androidDirectory, entry.name, 'ic_launcher_foreground.png')
  try {
    const metadata = await sharp(path).metadata()
    if (!metadata.width || !metadata.height) continue
    const markSize = Math.round(Math.min(metadata.width, metadata.height) * .68)
    const foreground = await sharp(Buffer.from(markSvg)).resize(markSize, markSize).png().toBuffer()
    const left = Math.round((metadata.width - markSize) / 2)
    const top = Math.round((metadata.height - markSize) / 2)
    const nextPath = `${path}.next`
    await sharp({ create: { width: metadata.width, height: metadata.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: foreground, left, top }])
      .png()
      .toFile(nextPath)
    await rename(nextPath, path)
  } catch {
    // Some legacy density folders do not contain an adaptive foreground.
  }
}
