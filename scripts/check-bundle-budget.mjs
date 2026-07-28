import { readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const budgets = [
  { name: 'desktop CSS', directory: 'dist-desktop/assets', pattern: /DesktopApplication-.*\.css$/, rawKb: 450, gzipKb: 70 },
  { name: 'mobile CSS', directory: 'dist-mobile/assets', pattern: /MobileApplication-.*\.css$/, rawKb: 800, gzipKb: 108 },
]

let failed = false
const results = budgets.map((budget) => {
  const file = readdirSync(budget.directory).find((entry) => budget.pattern.test(entry))
  if (!file) throw new Error(`${budget.name} bundle not found; build both platforms first`)
  const bytes = readFileSync(join(budget.directory, file))
  const rawKb = Number((bytes.length / 1024).toFixed(2))
  const gzipKb = Number((gzipSync(bytes).length / 1024).toFixed(2))
  const withinBudget = rawKb <= budget.rawKb && gzipKb <= budget.gzipKb
  if (!withinBudget) failed = true
  return { name: budget.name, rawKb, rawBudgetKb: budget.rawKb, gzipKb, gzipBudgetKb: budget.gzipKb, withinBudget }
})

console.log(JSON.stringify(results, null, 2))
if (failed) process.exitCode = 1
