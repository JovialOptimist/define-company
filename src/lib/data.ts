// Reads the precomputed dataset the site is deployed with (see dataset.ts).
import type { Company } from './edgar'
import { companyPath, type CompanyRecord, type IndexRow } from './dataset'

const BASE = '/data'

let index: Promise<IndexRow[]> | null = null

function loadIndex(): Promise<IndexRow[]> {
  index ??= fetch(`${BASE}/index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<IndexRow[]>) : []))
    .catch(() => {
      index = null
      return []
    })
  return index
}

/** The company's record, or null if it isn't in the dataset. */
export async function loadCompany(cik: number): Promise<CompanyRecord | null> {
  const res = await fetch(`${BASE}/${companyPath(cik)}`)
  if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null
  return res.json() as Promise<CompanyRecord>
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Best dataset matches for a ticker or (part of a) company name. */
export async function searchDataset(query: string, limit: number): Promise<Company[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const rows = await loadIndex()
  if (/^\d+$/.test(q)) {
    const row = rows.find((r) => r[0] === Number(q))
    return row ? [toCompany(row)] : []
  }
  const tickerQ = q.replace(/[.\s/]/g, '-')
  const wordRe = new RegExp(`\\b${escape(q)}`)
  const scored: { row: IndexRow; score: number }[] = []
  for (const row of rows) {
    const tickers = row[2] ? row[2].toLowerCase().split(',') : []
    const name = row[1].toLowerCase()
    let score = 0
    if (tickers.includes(tickerQ)) score = 100
    else if (name === q) score = 90
    else if (name.startsWith(q)) score = 60
    else if (wordRe.test(name)) score = 40
    else if (tickers.some((t) => t.startsWith(tickerQ))) score = 30
    // Companies with tickers first among equals: they're the ones people look up.
    if (score) scored.push({ row, score: score + (tickers.length ? 1 : 0) })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((s) => toCompany(s.row))
}

function toCompany([cik, name, tickers]: IndexRow): Company {
  return { cik, name, ticker: tickers.split(',')[0] ?? '' }
}

/** How many companies the dataset has (0 when it isn't deployed). */
export async function datasetSize(): Promise<number> {
  return (await loadIndex()).length
}

/** The companies whose latest 10-K was filed most recently. */
export async function latestFilings(limit: number): Promise<{ company: Company; filingDate: string }[]> {
  const rows = [...(await loadIndex())]
  rows.sort((a, b) => b[3].localeCompare(a[3]) || a[1].localeCompare(b[1]))
  return rows.slice(0, limit).map((row) => ({ company: toCompany(row), filingDate: row[3] }))
}
