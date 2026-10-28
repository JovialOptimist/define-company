// Builds the dataset from scratch: every company that filed a 10-K in the
// last four quarters (EDGAR full-index), with its latest 10-K's Item 1.
// Safe to stop and rerun; companies already up to date are skipped.
//
// Usage: SEC_USER_AGENT="Name you@example.com" npm run backfill -- [--limit N] [--workers N]
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR, ExtractorPool, runAll, tenKFilersInIndex, updateCompany, writeIndex } from './lib/pipeline.ts'

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? Number(process.argv[i + 1]) : fallback
}
const limit = arg('limit', Infinity)
const workers = arg('workers', 12)

function lastQuarters(n: number): string[] {
  const now = new Date()
  let year = now.getUTCFullYear()
  let q = Math.floor(now.getUTCMonth() / 3) + 1
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    out.push(`${year}/QTR${q}`)
    if (--q === 0) {
      q = 4
      year--
    }
  }
  return out
}

// Current quarter (partial) plus the four before it covers a full year.
const filers = new Map<number, string>()
for (const quarter of lastQuarters(5).reverse()) {
  const found = await tenKFilersInIndex(`https://www.sec.gov/Archives/edgar/full-index/${quarter}/form.idx`)
  for (const [cik, accession] of found) filers.set(cik, accession) // later quarters win
  console.log(`${quarter}: ${found.size} 10-K filers`)
}

const ciks = [...filers.keys()].slice(0, limit)
console.log(`${ciks.length} companies to check`)

const pool = new ExtractorPool(workers)
// More downloads in flight than workers, so the pool never waits on EDGAR.
const counts = await runAll(ciks, workers * 2, (cik) => updateCompany(cik, pool, filers.get(cik)), String)
pool.close()

const total = writeIndex()
writeFileSync(
  join(DATA_DIR, 'state.json'),
  // Two days back, so the first daily update overlaps the full index; companies
  // already current are skipped without fetching anything.
  JSON.stringify(
    { lastDailyIndex: new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10), backfilledAt: new Date().toISOString() },
    null,
    2,
  ),
)
console.log(`\nDone. ${JSON.stringify(counts)}. Index has ${total} companies. Problems: ${DATA_DIR}/problems.tsv`)
