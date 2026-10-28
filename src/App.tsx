import { useEffect, useState } from 'react'
import './App.css'
import { CompanySearch } from './components/CompanySearch'
import { SectionView } from './components/SectionView'
import { loadCompany } from './lib/data'
import { toFiling, type CompanyRecord } from './lib/dataset'
import type { Company, Filing } from './lib/edgar'
import { findItem1, type Section } from './lib/extract'
import { edgar } from './lib/sec'

type Load<T> =
  | { state: 'idle' }
  | { state: 'loading'; message: string }
  | { state: 'error'; message: string }
  | { state: 'done'; value: T }

type FilingList = {
  name: string
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
          return [{ name: rec.name, filings, hasOlder: true, live: false }, rec]
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

  function chooseCompany(company: Company) {
    history.pushState(null, '', `?cik=${company.cik}`)
    setCik(company.cik)
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
      <header className="masthead">
        <h1>
          <a href="./" onClick={(e) => { e.preventDefault(); history.pushState(null, '', './'); setCik(null) }}>
            Define Company
          </a>
        </h1>
        <p className="tagline">What a public company says it does, from Item 1 of its latest 10-K on SEC EDGAR.</p>
        <CompanySearch onSelect={chooseCompany} />
      </header>

      <main>
        {list.state === 'loading' && <Status>{list.message}</Status>}
        {list.state === 'error' && <ErrorBox>{list.message}</ErrorBox>}

        {list.state === 'done' && filing && (
          <FilingHeader
            list={list.value}
            filing={filing}
            onChange={setFiling}
            onLoadOlder={loadOlder}
          />
        )}

        {section.state === 'loading' && <Status>{section.message}</Status>}
        {section.state === 'error' && <ErrorBox>{section.message}</ErrorBox>}
        {section.state === 'done' && filing &&
          (section.value ? (
            <SectionView key={filing.accession} section={section.value} />
          ) : (
            <ErrorBox>
              Couldn't find the Item 1 (Business) section in this filing. Some 10-Ks use a
              magazine-style layout or put Item 1 in a separate exhibit.{' '}
              <a href={filing.publicUrl} target="_blank" rel="noreferrer">Open the 10-K on sec.gov</a>.
            </ErrorBox>
          ))}

        {cik === null && <Examples onSelect={chooseCompany} />}
      </main>

      <footer className="footer">
        Data from <a href="https://www.sec.gov/edgar/search/">SEC EDGAR</a>. Text is extracted
        automatically and may miss or include extra material; check the original filing for anything that matters.
      </footer>
    </div>
  )
}

function FilingHeader(props: {
  list: FilingList
  filing: Filing
  onChange: (f: Filing) => void
  onLoadOlder: () => void
}) {
  const { list, filing } = props
  return (
    <section className="filing" aria-label="Filing">
      <h2 className="company-name">{list.name}</h2>
      <div className="filing-meta">
        <label>
          <span className="meta-label">Filing</span>
          <select
            value={filing.accession}
            onChange={(e) => props.onChange(list.filings.find((f) => f.accession === e.target.value)!)}
          >
            {list.filings.map((f, i) => (
              <option key={f.accession} value={f.accession}>
                {f.form} for period ending {f.reportDate || '?'} (filed {f.filingDate}){i === 0 ? ' · latest' : ''}
              </option>
            ))}
          </select>
        </label>
        {list.hasOlder && (
          <button type="button" className="link-button" onClick={props.onLoadOlder}>
            {list.live ? 'Find older 10-Ks' : 'Other years'}
          </button>
        )}
        <a href={filing.publicUrl} target="_blank" rel="noreferrer">
          Open on sec.gov ↗
        </a>
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

const EXAMPLES: Company[] = [
  { cik: 320193, ticker: 'AAPL', name: 'Apple Inc.' },
  { cik: 1067983, ticker: 'BRK-B', name: 'Berkshire Hathaway' },
  { cik: 21344, ticker: 'KO', name: 'Coca-Cola' },
  { cik: 40545, ticker: 'GE', name: 'GE Aerospace' },
  { cik: 1318605, ticker: 'TSLA', name: 'Tesla' },
  { cik: 726728, ticker: 'O', name: 'Realty Income' },
]

function Examples({ onSelect }: { onSelect: (c: Company) => void }) {
  return (
    <div className="examples">
      <p>Try one:</p>
      <ul>
        {EXAMPLES.map((c) => (
          <li key={c.cik}>
            <button type="button" onClick={() => onSelect(c)}>
              <span className="ticker">{c.ticker}</span> {c.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
