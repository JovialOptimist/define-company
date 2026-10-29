import { useEffect, useState } from 'react'
import './App.css'
import { CompanySearch } from './components/CompanySearch'
import { Masthead } from './components/Masthead'
import { SectionView } from './components/SectionView'
import { datasetSize, latestFilings, loadCompany } from './lib/data'
import { toFiling, type CompanyRecord } from './lib/dataset'
import type { Company, Filing } from './lib/edgar'
import { findItem1, type Section } from './lib/extract'
import { displayName, formatDate, headlineName, pullQuote, readMinutes, standfirst } from './lib/presentation'
import { edgar } from './lib/sec'

type Load<T> =
  | { state: 'idle' }
  | { state: 'loading'; message: string }
  | { state: 'error'; message: string }
  | { state: 'done'; value: T }

type FilingList = {
  name: string
  tickers: string[]
  industry?: string
  filings: Filing[]
  hasOlder: boolean
  /** False while only the dataset's latest 10-K is listed (EDGAR not asked yet). */
  live: boolean
}

function readCikFromUrl(): number | null {
  const cik = Number(new URLSearchParams(location.search).get('cik'))
  return Number.isInteger(cik) && cik > 0 ? cik : null
}

export default function App() {
  const [cik, setCik] = useState<number | null>(readCikFromUrl)
  const [list, setList] = useState<Load<FilingList>>({ state: 'idle' })
  const [filing, setFiling] = useState<Filing | null>(null)
  const [record, setRecord] = useState<CompanyRecord | null>(null)
  const [section, setSection] = useState<Load<Section | null>>({ state: 'idle' })

  useEffect(() => {
    const onPop = () => setCik(readCikFromUrl())
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])

  // Company -> its 10-K filings: the dataset's latest one if it has the
  // company, otherwise the full list from EDGAR.
  useEffect(() => {
    if (cik === null) {
      setList({ state: 'idle' })
      setFiling(null)
      setRecord(null)
      return
    }
    let cancelled = false
    setList({ state: 'loading', message: 'Finding 10-K filings…' })
    setFiling(null)
    loadCompany(cik)
      .then(async (rec): Promise<[FilingList, CompanyRecord | null]> => {
        if (rec) {
          const filings = [toFiling(rec.filing, '/sec-www')]
          const value = { name: rec.name, tickers: rec.tickers, industry: rec.industry, filings, hasOlder: true, live: false }
          return [value, rec]
        }
        return [{ ...(await edgar.listTenKs(cik)), live: true }, null]
      })
      .then(
        ([value, rec]) => {
          if (cancelled) return
          setRecord(rec)
          setList({ state: 'done', value })
          setFiling(value.filings[0])
        },
        (e: Error) => !cancelled && setList({ state: 'error', message: e.message }),
      )
    return () => {
      cancelled = true
    }
  }, [cik])

  // Filing -> its Item 1 section.
  useEffect(() => {
    if (!filing) {
      setSection({ state: 'idle' })
      return
    }
    if (record?.filing.accession === filing.accession) {
      setSection({ state: 'done', value: record.section })
      return
    }
    let cancelled = false
    setSection({ state: 'loading', message: `Downloading ${filing.primaryDocument}…` })
    edgar
      .fetchDocument(filing)
      .then(async (html) => {
        if (cancelled) return
        setSection({ state: 'loading', message: 'Looking for Item 1…' })
        await new Promise((r) => setTimeout(r)) // let the message paint before parsing
        const doc = new DOMParser().parseFromString(html, 'text/html')
        if (!cancelled) setSection({ state: 'done', value: findItem1(doc) })
      })
      .catch((e: Error) => !cancelled && setSection({ state: 'error', message: e.message }))
    return () => {
      cancelled = true
    }
  }, [filing, record])

  const shown = section.state === 'done' ? section.value : null
  const headline = list.state === 'done' ? headlineName(list.value.name, shown) : null

  useEffect(() => {
    document.title = headline ? `${headline} · Define Company` : 'Define Company'
  }, [headline])

  function goTo(next: number | null) {
    history.pushState(null, '', next === null ? './' : `?cik=${next}`)
    setCik(next)
    scrollTo(0, 0)
  }

  async function loadOlder() {
    if (list.state !== 'done' || cik === null) return
    const current = list.value
    setList({ state: 'loading', message: 'Reading filing history from EDGAR…' })
    try {
      // First click lists recent years; after that, the full history.
      const value = { ...(await edgar.listTenKs(cik, { all: current.live })), live: true }
      setList({ state: 'done', value })
    } catch (e) {
      setList({ state: 'done', value: current })
      alert((e as Error).message)
    }
  }

  return (
    <div className="app">
      <Masthead onHome={() => goTo(null)} onSelect={(c) => goTo(c.cik)} />

      <main>
        {cik === null && <FrontPage onSelect={(c) => goTo(c.cik)} />}

        {list.state === 'loading' && <Status>{list.message}</Status>}
        {list.state === 'error' && <ErrorBox>{list.message}</ErrorBox>}

        {list.state === 'done' && filing && (
          <article className="story">
            <header className="story-head">
              <Kicker list={list.value} />
              <h2 className="headline">{headline}</h2>
              {shown && <Standfirst section={shown} name={list.value.name} />}
              <FilingMeta
                list={list.value}
                filing={filing}
                section={shown}
                onChange={setFiling}
                onLoadOlder={loadOlder}
              />
            </header>

            {section.state === 'loading' && <Status>{section.message}</Status>}
            {section.state === 'error' && <ErrorBox>{section.message}</ErrorBox>}
            {section.state === 'done' &&
              (shown ? (
                <SectionView key={filing.accession} section={shown} quote={pullQuote(shown)} />
              ) : (
                <ErrorBox>
                  Couldn't find the Item 1 (Business) section in this filing. Some 10-Ks use a
                  magazine-style layout or put Item 1 in a separate exhibit.{' '}
                  <a href={filing.publicUrl} target="_blank" rel="noreferrer">Open the 10-K on sec.gov</a>.
                </ErrorBox>
              ))}
          </article>
        )}
      </main>

      <footer className="footer">
        <p>
          Data from <a href="https://www.sec.gov/edgar/search/">SEC EDGAR</a>. Text is extracted automatically and may
          miss or include extra material; check the original filing for anything that matters. Headlines, summaries
          and pull quotes are picked from the filing's own words by a program, not an editor.
        </p>
      </footer>
    </div>
  )
}

function Kicker({ list }: { list: FilingList }) {
  const parts = [list.industry, list.tickers.join(' · ')].filter(Boolean)
  return parts.length ? <p className="kicker">{parts.join(' · ')}</p> : null
}

function Standfirst({ section, name }: { section: Section; name: string }) {
  const text = standfirst(section, name)
  return text ? <p className="standfirst">{text}</p> : null
}

function FilingMeta(props: {
  list: FilingList
  filing: Filing
  section: Section | null
  onChange: (f: Filing) => void
  onLoadOlder: () => void
}) {
  const { list, filing, section } = props
  return (
    <div className="filing-meta">
      {section && <span>{section.heading}</span>}
      <span>
        From the {filing.form} filed {formatDate(filing.filingDate)}
        {filing.reportDate && <>, for the fiscal year ended {formatDate(filing.reportDate)}</>}
      </span>
      {section && <span>{readMinutes(section)} min read</span>}
      {list.filings.length > 1 && (
        <label>
          <span className="visually-hidden">Filing</span>
          <select
            value={filing.accession}
            onChange={(e) => props.onChange(list.filings.find((f) => f.accession === e.target.value)!)}
          >
            {list.filings.map((f, i) => (
              <option key={f.accession} value={f.accession}>
                {f.form}, year ended {f.reportDate ? formatDate(f.reportDate) : '?'}
                {i === 0 ? ' (latest)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {list.hasOlder && (
        <button type="button" className="link-button" onClick={props.onLoadOlder}>
          {list.live ? 'Find older 10-Ks' : 'Other years'}
        </button>
      )}
      <a href={filing.publicUrl} target="_blank" rel="noreferrer">
        Original on sec.gov ↗
      </a>
    </div>
  )
}

const EXAMPLES: Company[] = [
  { cik: 320193, ticker: 'AAPL', name: 'Apple Inc.' },
  { cik: 1067983, ticker: 'BRK-B', name: 'Berkshire Hathaway' },
  { cik: 21344, ticker: 'KO', name: 'Coca-Cola' },
  { cik: 40545, ticker: 'GE', name: 'GE Aerospace' },
  { cik: 1318605, ticker: 'TSLA', name: 'Tesla' },
  { cik: 726728, ticker: 'O', name: 'Realty Income' },
]

function FrontPage({ onSelect }: { onSelect: (c: Company) => void }) {
  const [count, setCount] = useState(0)
  const [latest, setLatest] = useState<{ company: Company; filingDate: string }[]>([])
  useEffect(() => {
    datasetSize().then(setCount)
    latestFilings(8).then(setLatest)
  }, [])

  return (
    <section className="front" aria-labelledby="front-headline">
      <p className="kicker">{count ? `${count.toLocaleString()} companies · ` : ''}Item 1 of the latest 10-K</p>
      <h2 id="front-headline" className="headline front-headline">What does this company actually do?</h2>
      <p className="standfirst">
        Every U.S. public company describes its business in Item 1 of its annual 10-K. Look one up and read it, with the
        jargon explained.
      </p>
      <CompanySearch onSelect={onSelect} />

      <div className="front-columns">
        <section aria-labelledby="try-one">
          <h3 id="try-one" className="rubric">Try one</h3>
          <ol className="front-list">
            {EXAMPLES.map((c) => (
              <li key={c.cik}>
                <button type="button" onClick={() => onSelect(c)}>
                  <span className="ticker">{c.ticker}</span>
                  <span className="front-name">{c.name}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
        {latest.length > 0 && (
          <section aria-labelledby="just-filed">
            <h3 id="just-filed" className="rubric">Just filed</h3>
            <ol className="front-list">
              {latest.map(({ company, filingDate }) => (
                <li key={company.cik}>
                  <button type="button" onClick={() => onSelect(company)}>
                    <span className="ticker">{company.ticker || '—'}</span>
                    <span className="front-name">{displayName(company.name)}</span>
                    <span className="front-date">{formatDate(filingDate).replace(/, \d{4}$/, '')}</span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </section>
  )
}

function Status({ children }: { children: React.ReactNode }) {
  return (
    <p className="status" role="status">
      <span className="spinner" aria-hidden="true" /> {children}
    </p>
  )
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="callout callout-error" role="alert">
      <strong>
        <span aria-hidden="true">✕ </span>Problem:
      </strong>{' '}
      {children}
    </div>
  )
}
