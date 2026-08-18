import { readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const budgets = [
  {
    name: 'desktop CSS',
    directory: 'dist-desktop/assets',
    initial: { rawKb: 450, gzipKb: 70 },
    total: { rawKb: 470, gzipKb: 72 },
  },
  {
    name: 'mobile CSS',
    directory: 'dist-mobile/assets',
    initial: { rawKb: 800, gzipKb: 108 },
    total: { rawKb: 900, gzipKb: 118 },
  },
]

const deferredCssChunk = /^(?:AccountSpace|AgentSessionSpace|AudioEffectsPanel|NowPlayingSpace|SettingsPanel|SourceStatusPanel)-/
const measure = (directory, files) => {
  const contents = files.map((file) => readFileSync(join(directory, file)))
  return {
    rawKb: Number((contents.reduce((sum, bytes) => sum + bytes.length, 0) / 1024).toFixed(2)),
    gzipKb: Number((contents.reduce((sum, bytes) => sum + gzipSync(bytes).length, 0) / 1024).toFixed(2)),
  }
}

let failed = false
const results = budgets.map((budget) => {
  const files = readdirSync(budget.directory).filter((entry) => entry.endsWith('.css'))
  if (!files.length) throw new Error(`${budget.name} bundle not found; build both platforms first`)
  const initialFiles = files.filter((file) => !deferredCssChunk.test(file))
  if (!initialFiles.length) throw new Error(`${budget.name} initial bundle not found`)
  const deferredFiles = files.filter((file) => deferredCssChunk.test(file))
  const initial = measure(budget.directory, initialFiles)
  const total = measure(budget.directory, files)
  const initialWithinBudget = initial.rawKb <= budget.initial.rawKb && initial.gzipKb <= budget.initial.gzipKb
  const totalWithinBudget = total.rawKb <= budget.total.rawKb && total.gzipKb <= budget.total.gzipKb
  const withinBudget = initialWithinBudget && totalWithinBudget
  if (!withinBudget) failed = true
  return {
    name: budget.name,
    initial: {
      files: initialFiles,
      ...initial,
      rawBudgetKb: budget.initial.rawKb,
      gzipBudgetKb: budget.initial.gzipKb,
      withinBudget: initialWithinBudget,
    },
    deferredFiles,
    total: {
      ...total,
      rawBudgetKb: budget.total.rawKb,
      gzipBudgetKb: budget.total.gzipKb,
      withinBudget: totalWithinBudget,
    },
    withinBudget,
  }
})

console.log(JSON.stringify(results, null, 2))
if (failed) process.exitCode = 1
