import sharp from 'sharp'
import { readFile } from 'node:fs/promises'

const brandMarkSvg = await readFile('public/echora-mark-v2.svg', 'utf8')
const brandMark = await sharp(Buffer.from(brandMarkSvg))
  .resize(720, 720)
  .png()
  .toBuffer()

const iconSource = await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
}).composite([
  {
    input: Buffer.from('<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#20232c"/><stop offset="1" stop-color="#111319"/></linearGradient></defs><rect x="64" y="64" width="896" height="896" rx="224" fill="url(#bg)"/><rect x="65" y="65" width="894" height="894" rx="223" fill="none" stroke="#ffffff" stroke-opacity=".1" stroke-width="2"/></svg>'),
  },
  { input: brandMark, left: 152, top: 148 },
]).png().toBuffer()

const source = sharp(iconSource)

const outputs = [
  ['src-tauri/icons/icon-source.png', 1024],
  ['public/brand-icon.png', 512],
  ['public/brand-icon-v2.png', 512],
  ['public/icon-512.png', 512],
  ['public/icon-512-v2.png', 512],
  ['public/icon-192.png', 192],
  ['public/icon-192-v2.png', 192],
  ['public/apple-touch-icon.png', 180],
  ['public/apple-touch-icon-v2.png', 180],
  ['public/favicon.png', 64],
  ['public/favicon-v2.png', 64],
]

await Promise.all(outputs.map(([path, size]) => source.clone().resize(size, size).png().toFile(path)))
