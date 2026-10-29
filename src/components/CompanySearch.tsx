import { useEffect, useId, useRef, useState } from 'react'
import { searchDataset } from '../lib/data'
import type { Company } from '../lib/edgar'
import { edgar } from '../lib/sec'

const LIMIT = 8

/**
 * The dataset first (no EDGAR traffic); live EDGAR search only fills in when
 * it has few matches, e.g. companies that haven't filed a 10-K this year.
 */
async function search(query: string): Promise<Company[]> {
  const local = await searchDataset(query, LIMIT)
  if (local.length >= 3) return local
  const live = await edgar.searchCompanies(query, LIMIT).catch(() => [])
  const seen = new Set(local.map((c) => c.cik))
  return [...local, ...live.filter((c) => !seen.has(c.cik))].slice(0, LIMIT)
}

/** Ticker / name / CIK search box with a keyboard-navigable suggestion list. */
export function CompanySearch(props: {
  onSelect: (c: Company) => void
  /**
   * Inside the search dialog: opens focused and lists results in place,
   * always visible, instead of in a drop-down. The dialog handles Escape.
   */
  inDialog?: boolean
}) {
  const { onSelect, inDialog } = props
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Company[]>([])
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const listId = useId()
  const latest = useRef(0)

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      setPending(false)
      return
    }
    const id = ++latest.current
    setPending(true)
    const timer = setTimeout(() => {
      search(q).then(
        (r) => {
          if (id !== latest.current) return
          setResults(r)
          setActive(0)
          setError(null)
          setPending(false)
        },
        (e: Error) => {
          if (id !== latest.current) return
          setError(e.message)
          setPending(false)
        },
      )
    }, 150)
    return () => clearTimeout(timer)
  }, [query])

  function choose(c: Company | undefined) {
    if (!c) return
    setOpen(false)
    setQuery(c.ticker || c.name)
    onSelect(c)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Escape' && !inDialog) {
      setOpen(false)
    }
  }

  const showList = (inDialog || open) && results.length > 0
  const q = query.trim()

  return (
    <form
      className={inDialog ? 'search search-in-dialog' : 'search'}
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        choose(results[active])
      }}
    >
      <label htmlFor={`${listId}-input`} className="visually-hidden">
        Company ticker, name or CIK
      </label>
      <input
        id={`${listId}-input`}
        type="search"
        placeholder="Ticker, company name or CIK, e.g. AAPL"
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList ? `${listId}-${active}` : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        autoFocus={inDialog}
        enterKeyHint="search"
      />
      {!inDialog && (
        <button type="submit" disabled={!results.length}>
          Look up
        </button>
      )}
      {showList && (
        <ul className="suggestions" id={listId} role="listbox">
          {results.map((c, i) => (
            <li
              key={c.cik}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(c)
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="ticker">{c.ticker || 'no ticker'}</span>
              <span className="name">{c.name}</span>
              <span className="cik">CIK {c.cik}</span>
            </li>
          ))}
        </ul>
      )}
      {inDialog && !showList && !error && (
        <p className="search-status" role="status">
          {!q ? 'Type a ticker, company name or CIK.' : pending ? 'Searching…' : `No companies with a 10-K match “${q}”.`}
        </p>
      )}
      {error && (
        <p className="search-error" role="alert">
          <span aria-hidden="true">✕ </span>Search failed: {error}
        </p>
      )}
    </form>
  )
}
