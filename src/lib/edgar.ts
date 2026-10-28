// SEC EDGAR lookups: company search, latest 10-K, and the 10-K document itself.
// Endpoints: https://www.sec.gov/search-filings/edgar-application-programming-interfaces

export type Company = { cik: number; ticker: string; name: string }

export type Filing = {
  cik: number
  form: string
  accession: string
  filingDate: string
  reportDate: string
  primaryDocument: string
  url: string
  /** The filing on sec.gov, for people to open. */
  publicUrl: string
}

export type EdgarConfig = {
  /** Base for https://www.sec.gov (a proxy path in the browser). */
  www: string
  /** Base for https://data.sec.gov. */
  data: string
  /** Base for https://efts.sec.gov (EDGAR's own company-name autocomplete). */
  efts: string
  init?: RequestInit
  /** Replaces the global fetch, e.g. to rate-limit a batch job. */
  fetch?: typeof fetch
}

type FilingColumns = {
  accessionNumber: string[]
  filingDate: string[]
  reportDate: string[]
  form: string[]
  primaryDocument: string[]
}

type Submissions = {
  name: string
  tickers: string[]
  sic: string
  sicDescription: string
  filings: { recent: FilingColumns; files: { name: string }[] }
}

const TEN_K_FORMS = new Set(['10-K', '10-KT', '10-K405'])
const FOREIGN_FORMS = new Set(['20-F', '40-F'])

export function createEdgar(config: EdgarConfig) {
  async function get(url: string): Promise<Response> {
    const res = await (config.fetch ?? fetch)(url, config.init)
    if (!res.ok) throw new Error(`EDGAR returned ${res.status} for ${url}`)
    return res
  }

  let companies: Promise<Company[]> | null = null

  function loadCompanies(): Promise<Company[]> {
    companies ??= get(`${config.www}/files/company_tickers.json`)
      .then((r) => r.json())
      .then((json: Record<string, { cik_str: number; ticker: string; title: string }>) =>
        Object.values(json).map((c) => ({ cik: c.cik_str, ticker: c.ticker, name: c.title })),
      )
      .catch((e) => {
        companies = null
        throw e
      })
    return companies
  }

  /**
   * Companies by name from the autocomplete behind EDGAR's company search.
   * It also knows filers without a current ticker, such as a predecessor
   * company after a reorganization. It isn't a documented API, so failures
   * are ignored.
   */
  async function searchEntities(query: string): Promise<Company[]> {
    try {
      const res = await get(`${config.efts}/LATEST/search-index?keysTyped=${encodeURIComponent(query)}`)
      const json: { hits: { hits: { _id: string; _source: { entity: string; tickers?: string } }[] } } = await res.json()
      return json.hits.hits.map((h) => ({
        cik: Number(h._id),
        ticker: h._source.tickers?.split(',')[0]?.trim() ?? '',
        name: h._source.entity,
      }))
    } catch {
      return []
    }
  }

  /** Best matches for a ticker, CIK or (part of a) company name. */
  async function searchCompanies(query: string, limit = 8): Promise<Company[]> {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const all = await loadCompanies()
    if (/^\d+$/.test(q)) {
      const cik = Number(q)
      return [all.find((c) => c.cik === cik) ?? { cik, ticker: '', name: `CIK ${cik}` }]
    }
    const tickerQ = q.replace(/[.\s/]/g, '-')
    const wordRe = new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
    const scored: { c: Company; score: number }[] = []
    for (const c of all) {
      const ticker = c.ticker.toLowerCase()
      const name = c.name.toLowerCase()
      let score = 0
      if (ticker === tickerQ) score = 100
      else if (name === q) score = 90
      else if (name.startsWith(q)) score = 60
      else if (wordRe.test(name)) score = 40
      else if (ticker.startsWith(tickerQ)) score = 30
      if (score) scored.push({ c, score })
    }
    // company_tickers.json is ordered by market cap, so stable sort keeps big names first.
    scored.sort((a, b) => b.score - a.score)
    const matches = scored.map((s) => s.c)
    if (q.length >= 3) matches.push(...(await searchEntities(q)))
    const seen = new Set<number>()
    return matches.filter((c) => !seen.has(c.cik) && seen.add(c.cik)).slice(0, limit)
  }

  function toFilings(cik: number, cols: FilingColumns, forms: Set<string>): Filing[] {
    const out: Filing[] = []
    cols.form.forEach((form, i) => {
      if (!forms.has(form)) return
      const accession = cols.accessionNumber[i]
      const folder = `Archives/edgar/data/${cik}/${accession.replace(/-/g, '')}`
      out.push({
        cik,
        form,
        accession,
        filingDate: cols.filingDate[i],
        reportDate: cols.reportDate[i],
        primaryDocument: cols.primaryDocument[i],
        url: `${config.www}/${folder}/${cols.primaryDocument[i]}`,
        publicUrl: `https://www.sec.gov/${folder}/${cols.primaryDocument[i]}`,
      })
    })
    return out
  }

  /**
   * 10-K filings, newest first. The submissions file only holds the most
   * recent ~1000 filings; busy filers (banks issuing notes) can push every
   * 10-K out of it. Older pages are read until one turns up, or all of them
   * with `all`.
   */
  async function listTenKs(
    cik: number,
    { all = false } = {},
  ): Promise<{ name: string; tickers: string[]; sic: string; industry: string; filings: Filing[]; hasOlder: boolean }> {
    const cik10 = String(cik).padStart(10, '0')
    const subs: Submissions = await (await get(`${config.data}/submissions/CIK${cik10}.json`)).json()
    const filings = toFilings(cik, subs.filings.recent, TEN_K_FORMS)
    let pagesRead = 0
    for (const file of subs.filings.files) {
      if (filings.length && !all) break
      const cols: FilingColumns = await (await get(`${config.data}/submissions/${file.name}`)).json()
      filings.push(...toFilings(cik, cols, TEN_K_FORMS))
      pagesRead++
    }
    if (!filings.length) {
      const foreign = subs.filings.recent.form.find((f) => FOREIGN_FORMS.has(f))
      throw new Error(
        foreign
          ? `${subs.name} files a ${foreign} (foreign private issuer) instead of a 10-K.`
          : `No 10-K filings found for ${subs.name}. If it recently reorganized under a new holding company, search for the earlier company by name.`,
      )
    }
    return {
      name: subs.name,
      tickers: subs.tickers,
      sic: subs.sic,
      industry: subs.sicDescription,
      filings,
      hasOlder: pagesRead < subs.filings.files.length,
    }
  }

  async function fetchDocument(filing: Filing): Promise<string> {
    return (await get(filing.url)).text()
  }

  return { searchCompanies, listTenKs, fetchDocument }
}
