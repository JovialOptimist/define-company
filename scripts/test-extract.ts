// Runs the 10-K lookup and Item 1 extraction against real EDGAR filings.
// Usage: npx tsx scripts/test-extract.ts [TICKER[@N] ...]   (@N = Nth most recent 10-K)
// Downloads are cached in .cache/ so reruns don't hit EDGAR again.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { createEdgar } from '../src/lib/edgar.ts'
import { findItem1 } from '../src/lib/extract.ts'

const DEFAULT_TICKERS = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'BRK-B', 'JPM', 'XOM', 'GE', 'KO',
  'WMT', 'TSLA', 'JNJ', 'O', 'DUK', 'BAC', 'MET', 'F', 'PG', 'CAT', 'PFE',
  'NFLX', 'T', 'COST', 'HD', 'SMCI', 'PLUG', 'GS', 'CVX', 'UNH',
]
const userAgent = process.env.SEC_USER_AGENT || 'define-company admin@example.com'
const edgar = createEdgar({
  www: 'https://www.sec.gov',
  data: 'https://data.sec.gov',
  efts: 'https://efts.sec.gov',
  init: { headers: { 'User-Agent': userAgent } },
})

mkdirSync('.cache', { recursive: true })
const tickers = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_TICKERS
const verbose = process.argv.length > 2
let failures = 0

for (const arg of tickers) {
  const [ticker, nth = '0'] = arg.split('@')
  try {
    const [company] = await edgar.searchCompanies(ticker)
    if (!company) throw new Error('no company found')
    const { filings } = await edgar.listTenKs(company.cik, { all: nth !== '0' })
    const filing = filings[Number(nth)]
    if (!filing) throw new Error(`only ${filings.length} 10-Ks found`)
    const cachePath = `.cache/${filing.accession}.htm`
    let html: string
    if (existsSync(cachePath)) html = readFileSync(cachePath, 'utf8')
    else {
      html = await edgar.fetchDocument(filing)
      writeFileSync(cachePath, html)
    }
    const section = findItem1(new JSDOM(html).window.document)
    if (!section || section.length < 2000) failures++
    const text = section?.blocks.map((b) =>
      b.type === 'table' ? '[table]' : b.type === 'heading' ? `## ${b.text}` : b.runs.map((r) => r.text).join(''),
    ) ?? []
    const flat = text.join(' | ')
    console.log(
      `${section && section.length >= 2000 ? 'OK  ' : 'FAIL'} ${ticker.padEnd(6)} ${filing.form} ${filing.filingDate} ` +
        `${filing.primaryDocument} -> ${section ? `"${section.heading}" ${section.length} chars, ${section.blocks.length} blocks` : 'NOT FOUND'}`,
    )
    if (section?.note) console.log(`       note:   ${section.note}`)
    if (section) console.log(`       starts: ${flat.slice(0, 160)}\n       ends:   ${flat.slice(-160)}`)
    if (verbose) console.log(text.join('\n'))
  } catch (e) {
    failures++
    console.log(`ERR  ${ticker.padEnd(6)} ${(e as Error).message}`)
  }
}
console.log(`\n${tickers.length - failures}/${tickers.length} OK`)
process.exitCode = failures ? 1 : 0
