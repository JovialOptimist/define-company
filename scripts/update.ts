// Daily update: reads EDGAR's daily form index for each day since the last
// run and refreshes every company that filed a 10-K. Run by
// .github/workflows/deploy.yml; also fine to run by hand.
//
// Usage: SEC_USER_AGENT="Name you@example.com" npm run update
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR, ExtractorPool, runAll, tenKFilersInIndex, updateCompany, writeIndex } from './lib/pipeline.ts'

type State = { lastDailyIndex: string }
const statePath = join(DATA_DIR, 'state.json')
const state = JSON.parse(readFileSync(statePath, 'utf8')) as State

const day = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (s: string, n: number) => day(new Date(Date.parse(s) + n * 86400_000))
const yesterday = addDays(day(new Date()), -1)

// Gather filers day by day. Weekends and holidays have no index (404). If
// yesterday's isn't published yet, stop there and pick it up next run.
const filers = new Map<number, string>()
let last = state.lastDailyIndex
for (let d = addDays(last, 1); d <= yesterday; d = addDays(d, 1)) {
  const [y, m, dd] = d.split('-')
  const quarter = Math.floor((Number(m) - 1) / 3) + 1
  const url = `https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${quarter}/form.${y}${m}${dd}.idx`
  const found = await tenKFilersInIndex(url)
  if (!found.size && d === yesterday) break
  for (const [cik, accession] of found) filers.set(cik, accession)
  console.log(`${d}: ${found.size} 10-K filers`)
  last = d
}

const ciks = [...filers.keys()]
if (ciks.length) {
  const pool = new ExtractorPool(4)
  const counts = await runAll(ciks, 8, (cik) => updateCompany(cik, pool, filers.get(cik)), String)
  pool.close()
  console.log(JSON.stringify(counts))
}
const total = writeIndex()
writeFileSync(statePath, JSON.stringify({ ...state, lastDailyIndex: last }, null, 2))
console.log(`Up to date through ${last}. ${ciks.length} companies checked; index has ${total}.`)
