import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const option = (name, fallback = '') => {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] || fallback : fallback
}

const tag = option('tag', process.env.RELEASE_TAG || '')
const output = resolve(option('output', 'release-notes.md'))
const artifactDirectory = resolve(option('artifacts', 'release-artifacts'))
const assetNames = option('asset-names')
const repository = option('repository', process.env.GITHUB_REPOSITORY || 'BearstOzawa/echora')

if (!/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tag)) throw new Error('A semantic --tag is required')
if (!assetNames && !existsSync(artifactDirectory)) throw new Error(`Artifact directory does not exist: ${artifactDirectory}`)

const version = tag.slice(1)
const assets = (assetNames ? assetNames.split(',') : readdirSync(artifactDirectory)).map((name) => name.trim()).filter(Boolean).sort()
const releaseAssetUrl = (name) => `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(name)}`
const assetMatching = (pattern) => assets.find((name) => pattern.test(name))

const downloadDefinitions = [
  { pattern: /macOS-arm64\.dmg$/i, platform: 'macOS', architecture: 'Apple Silicon', format: 'DMG' },
  { pattern: /macOS-x86_64\.dmg$/i, platform: 'macOS', architecture: 'Intel', format: 'DMG' },
  { pattern: /Windows-x64-Setup\.exe$/i, platform: 'Windows', architecture: 'x64', format: 'EXE（推荐）' },
  { pattern: /Windows-x64\.msi$/i, platform: 'Windows', architecture: 'x64', format: 'MSI' },
  { pattern: /Android-universal\.apk$/i, platform: 'Android', architecture: '通用', format: '签名 APK' },
]

const downloadRows = downloadDefinitions.flatMap((definition) => {
  const name = assetMatching(definition.pattern)
  return name ? [`| ${definition.platform} | ${definition.architecture} | [${definition.format}](${releaseAssetUrl(name)}) |`] : []
})

const developmentDefinitions = [
  { pattern: /iOS-unsigned\.ipa$/i, label: 'iOS 未签名 IPA', detail: '需要个人签名后安装' },
  { pattern: /iOS-Simulator\.zip$/i, label: 'iOS 模拟器', detail: '仅用于开发与界面验证' },
]

const developmentRows = developmentDefinitions.flatMap((definition) => {
  const name = assetMatching(definition.pattern)
  return name ? [`- [${definition.label}](${releaseAssetUrl(name)})：${definition.detail}。`] : []
})

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
let previousTag = ''
try { previousTag = git('describe', '--tags', '--abbrev=0', `${tag}^`) } catch { /* First tagged release. */ }

const categoryOrder = ['feat', 'fix', 'perf', 'build', 'docs', 'other']
const categoryLabels = {
  feat: '新增',
  fix: '修复',
  perf: '性能',
  build: '工程与发布',
  docs: '文档',
  other: '其他变更',
}
const categoryFor = (type) => {
  if (['feat'].includes(type)) return 'feat'
  if (['fix'].includes(type)) return 'fix'
  if (['perf'].includes(type)) return 'perf'
  if (['ci', 'build', 'chore', 'refactor', 'test'].includes(type)) return 'build'
  if (type === 'docs') return 'docs'
  return 'other'
}

const range = previousTag ? `${previousTag}..${tag}` : tag
const commits = git('log', '--format=%H%x09%s', range).split('\n').filter(Boolean).map((line) => {
  const [hash, ...subjectParts] = line.split('\t')
  const subject = subjectParts.join('\t')
  const conventional = subject.match(/^([a-z]+)(?:\([^)]*\))?!?:\s*(.+)$/i)
  const type = conventional?.[1]?.toLocaleLowerCase() || 'other'
  return { hash, subject: conventional?.[2] || subject, category: categoryFor(type) }
})

const changelog = categoryOrder.flatMap((category) => {
  const entries = commits.filter((commit) => commit.category === category)
  if (!entries.length) return []
  return [
    `### ${categoryLabels[category]}`,
    '',
    ...entries.map((commit) => `- ${commit.subject} ([\`${commit.hash.slice(0, 7)}\`](https://github.com/${repository}/commit/${commit.hash}))`),
    '',
  ]
})

const curatedPath = resolve('docs', 'releases', `${tag}.md`)
const curated = existsSync(curatedPath)
  ? readFileSync(curatedPath, 'utf8').trim()
  : `Echora ${version} 提供播放、发现与音乐编排体验的阶段性更新。`

const checksum = assetMatching(/^SHA256SUMS\.txt$/i)
const hasMacBuild = assets.some((name) => /macOS-(?:arm64|x86_64)\.dmg$/i.test(name))
const hasWindowsBuild = assets.some((name) => /Windows-x64(?:-Setup\.exe|\.msi)$/i.test(name))
const installationNotes = [
  ...(hasMacBuild ? [
    '### macOS',
    '',
    '打开 DMG，将 Echora 拖入“应用程序”。当前 macOS 包为未签名测试构建；若系统拦截首次打开，请确认文件来自本 Release 后执行：',
    '',
    '```bash',
    'xattr -rd com.apple.quarantine /Applications/Echora.app',
    '```',
    '',
  ] : []),
  ...(hasWindowsBuild ? [
    '### Windows',
    '',
    '优先使用 EXE 安装包；当前测试构建未完成代码签名，系统可能显示信誉提示。',
    '',
  ] : []),
]
const lines = [
  curated,
  '',
  '<p align="center">',
  '  <img src="https://echora-cloud.lili.uno/media/echora-ai-light.png" width="960" alt="Echora 音乐场" />',
  '</p>',
  '',
  '## 下载',
  '',
  '| 平台 | 架构 | 安装包 |',
  '| --- | --- | --- |',
  ...downloadRows,
  '',
  ...(developmentRows.length ? ['### 开发构建', '', ...developmentRows, ''] : []),
  ...(installationNotes.length ? [
    '## 安装',
    '',
    ...installationNotes,
    '[查看完整安装说明](https://echora-cloud.lili.uno/download)',
    '',
  ] : []),
  '## 完整性校验',
  '',
  checksum
    ? `下载 [SHA256SUMS.txt](${releaseAssetUrl(checksum)}) 校验安装包。`
    : '本版本未附带校验清单。',
  '',
  '## Changelog',
  '',
  ...changelog,
  ...(previousTag ? [`[\u67e5\u770b ${previousTag}...${tag} 的完整变更](https://github.com/${repository}/compare/${previousTag}...${tag})`] : []),
  '',
]

writeFileSync(output, `${lines.join('\n')}\n`)
console.log(`Release notes written to ${output}`)
