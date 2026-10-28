// Shared pieces of the backfill and daily update: polite EDGAR access, a pool
// of extraction processes, and reading/writing the dataset in data/.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { companyPath, EXTRACTOR_VERSION, type CompanyRecord, type IndexRow } from '../../src/lib/dataset.ts'
import { createEdgar } from '../../src/lib/edgar.ts'
import type { Section } from '../../src/lib/extract.ts'

export const DATA_DIR = process.env.DATA_DIR ?? 'data'
const TMP_DIR = join(DATA_DIR, '.tmp')

// ---- EDGAR, at most REQUESTS_PER_SECOND (SEC allows 10) ----

const REQUESTS_PER_SECOND = Number(process.env.SEC_RPS ?? 5)
let nextSlot = 0

async function politeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const now = Date.now()
    const wait = Math.max(0, nextSlot - now)
    nextSlot = Math.max(now, nextSlot) + 1000 / REQUESTS_PER_SECOND
    if (wait) await new Promise((r) => setTimeout(r, wait))
    const res = await fetch(input, init)
    // 429/403 from EDGAR mean "slow down"; back off and retry a few times.
    if ((res.status === 429 || res.status === 403 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 15_000 * (attempt + 1)))
      continue
    }
    return res
  }
}

const userAgent = process.env.SEC_USER_AGENT
if (!userAgent || !/@/.test(userAgent)) {
  throw new Error('Set SEC_USER_AGENT to "Your Name you@example.com" (EDGAR requires an email).')
}

export const edgar = createEdgar({
  www: 'https://www.sec.gov',
  data: 'https://data.sec.gov',
  efts: 'https://efts.sec.gov',
  init: { headers: { 'User-Agent': userAgent, 'Accept-Encoding': 'gzip, deflate' } },
  fetch: politeFetch,
})

/** 10-K filers listed in an EDGAR form index (quarterly full-index or daily-index). */
export async function tenKFilersInIndex(url: string): Promise<Map<number, string>> {
  const res = await politeFetch(url, { headers: { 'User-Agent': userAgent! } })
  if (res.status === 404) return new Map()
  if (!res.ok) throw new Error(`EDGAR returned ${res.status} for ${url}`)
  const filers = new Map<number, string>() // cik -> accession
  for (const line of (await res.text()).split('\n')) {
    const m = /^(?:10-K|10-KT|10-K405)\s+.+?\s+(\d+)\s+[\d-]{8,10}\s+edgar\/data\/\d+\/([\d-]+)\.txt/.exec(line)
    if (m) filers.set(Number(m[1]), m[2])
  }
  return filers
}

// ---- extraction process pool ----

type Job = { id: number; path: string; resolve: (s: Section | null) => void; reject: (e: Error) => void }
const DOCS_PER_PROCESS = 20
const DOC_TIMEOUT_MS = 5 * 60_000

class Worker {
  private proc!: ChildProcess
  private done = 0
  job: Job | null = null
  private timer: NodeJS.Timeout | undefined

  constructor() {
    this.start()
  }

  private start() {
    this.proc = spawn(process.execPath, ['--import', 'tsx', 'scripts/lib/extract-worker.ts'], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' },
    })
    this.done = 0
    createInterface({ input: this.proc.stdout! }).on('line', (line) => {
      const reply = JSON.parse(line) as { id: number; section?: Section | null; error?: string }
      const job = this.job
      if (!job || job.id !== reply.id) return
      this.finish()
      if (reply.error) job.reject(new Error(reply.error))
      else job.resolve(reply.section ?? null)
    })
    this.proc.on('exit', () => {
      // Crashed or killed by the timeout: start a fresh process either way.
      clearTimeout(this.timer)
      const job = this.job
      this.job = null
      this.start()
      job?.reject(new Error('extraction process died (out of memory or timeout)'))
    })
  }

  private finish() {
    clearTimeout(this.timer)
    this.job = null
    if (++this.done >= DOCS_PER_PROCESS) this.restart()
  }

  private restart() {
    this.proc.removeAllListeners('exit')
    this.proc.kill()
    this.start()
  }

  run(job: Job) {
    this.job = job
    this.timer = setTimeout(() => this.proc.kill(), DOC_TIMEOUT_MS)
    this.proc.stdin!.write(JSON.stringify({ id: job.id, path: job.path }) + '\n')
  }

  close() {
    this.proc.removeAllListeners('exit')
    this.proc.kill()
  }
}

export class ExtractorPool {
  private workers: Worker[]
  private queue: Job[] = []
  private nextId = 0

  constructor(size: number) {
    this.workers = Array.from({ length: size }, () => new Worker())
  }

  extract(path: string): Promise<Section | null> {
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, path, resolve, reject })
      this.pump()
    })
  }

  private pump() {
    for (const w of this.workers) {
      if (w.job || !this.queue.length) continue
      const job = this.queue.shift()!
      const wrap = (fn: () => void) => () => {
        fn()
        setImmediate(() => this.pump())
      }
      w.run({
        ...job,
        resolve: (s) => wrap(() => job.resolve(s))(),
        reject: (e) => wrap(() => job.reject(e))(),
      })
    }
  }

  close() {
    for (const w of this.workers) w.close()
  }
}

// ---- the dataset ----

export function readRecord(cik: number): CompanyRecord | null {
  const path = join(DATA_DIR, companyPath(cik))
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as CompanyRecord) : null
}

export type Outcome = 'skipped' | 'ok' | 'no-section' | 'not-a-business' | 'no-10k' | 'error'

/**
 * SIC 6189, "Asset-Backed Securities": mortgage and auto-loan trusts and
 * other financing vehicles. Their 10-Ks omit Item 1 (there's no business to
 * describe), so they're left out of the dataset and search.
 */
const ASSET_BACKED_SIC = '6189'

/**
 * Brings one company's record up to date with its latest 10-K. `accession`
 * (from an index file) lets an unchanged company be skipped without asking
 * EDGAR anything.
 */
export async function updateCompany(
  cik: number,
  pool: ExtractorPool,
  accession?: string,
): Promise<{ outcome: Outcome; detail?: string }> {
  const existing = readRecord(cik)
  const current = (r: CompanyRecord | null, acc?: string) =>
    !!r && r.extractorVersion === EXTRACTOR_VERSION && r.filing.accession === acc
  // Records from before `industry` existed are re-checked once (one EDGAR request).
  if (current(existing, accession) && existing!.industry !== undefined) return { outcome: 'skipped' }
  let list
  try {
    list = await edgar.listTenKs(cik)
  } catch (e) {
    return { outcome: 'no-10k', detail: (e as Error).message }
  }
  if (list.sic === ASSET_BACKED_SIC) {
    rmSync(join(DATA_DIR, companyPath(cik)), { force: true })
    return { outcome: 'not-a-business' }
  }
  const latest = list.filings[0]
  if (current(existing, latest.accession)) {
    if (existing!.industry === undefined) {
      writeFileSync(join(DATA_DIR, companyPath(cik)), JSON.stringify({ ...existing, industry: list.industry }))
    }
    return { outcome: 'skipped' }
  }
  mkdirSync(TMP_DIR, { recursive: true })
  const tmp = join(TMP_DIR, `${cik}.htm`)
  try {
    writeFileSync(tmp, await edgar.fetchDocument(latest))
    const section = await pool.extract(tmp)
    const { url: _url, ...filing } = latest
    const record: CompanyRecord = {
      cik,
      name: list.name,
      tickers: list.tickers,
      industry: list.industry,
      filing,
      section,
      extractorVersion: EXTRACTOR_VERSION,
      extractedAt: new Date().toISOString(),
    }
    mkdirSync(join(DATA_DIR, 'companies'), { recursive: true })
    writeFileSync(join(DATA_DIR, companyPath(cik)), JSON.stringify(record))
    return section && section.length >= 1500
      ? { outcome: 'ok' }
      : { outcome: 'no-section', detail: section ? `only ${section.length} chars` : 'Item 1 not found' }
  } catch (e) {
    return { outcome: 'error', detail: (e as Error).message }
  } finally {
    rmSync(tmp, { force: true })
  }
}

/** Rebuilds data/index.json, the search index the site loads. */
export function writeIndex(): number {
  const dir = join(DATA_DIR, 'companies')
  const rows: IndexRow[] = []
  for (const f of readdirSync(dir)) {
    const r = JSON.parse(readFileSync(join(dir, f), 'utf8')) as CompanyRecord
    rows.push([r.cik, r.name, r.tickers.join(','), r.filing.filingDate])
  }
  rows.sort((a, b) => a[1].localeCompare(b[1]))
  writeFileSync(join(DATA_DIR, 'index.json'), JSON.stringify(rows))
  return rows.length
}

/** Runs `fn` over `items` with at most `limit` in flight, logging progress. */
export async function runAll<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<{ outcome: Outcome; detail?: string }>,
  label: (item: T) => string,
): Promise<Record<Outcome, number>> {
  const counts: Record<Outcome, number> = {
    skipped: 0,
    ok: 0,
    'no-section': 0,
    'not-a-business': 0,
    'no-10k': 0,
    error: 0,
  }
  const problems: string[] = []
  let next = 0
  let finished = 0
  const started = Date.now()
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const item = items[next++]
        const { outcome, detail } = await fn(item)
        counts[outcome]++
        finished++
        if (outcome === 'no-section' || outcome === 'no-10k' || outcome === 'error') problems.push(`${outcome}\t${label(item)}\t${detail ?? ''}`)
        if (finished % 25 === 0 || finished === items.length) {
          const rate = finished / ((Date.now() - started) / 60_000)
          const left = Math.round((items.length - finished) / rate)
          console.log(`${finished}/${items.length}  ${JSON.stringify(counts)}  ~${left} min left`)
        }
      }
    }),
  )
  writeFileSync(join(DATA_DIR, 'problems.tsv'), problems.join('\n') + '\n')
  return counts
}
