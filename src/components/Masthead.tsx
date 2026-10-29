import { useState } from 'react'
import type { Company } from '../lib/edgar'
import { CompanySearch } from './CompanySearch'

type Theme = 'light' | 'dark'

function currentTheme(): Theme {
  const set = document.documentElement.dataset.theme
  if (set === 'light' || set === 'dark') return set
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Switches light and dark. The choice is remembered; until then the system's is used. */
function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme)
  const next: Theme = theme === 'dark' ? 'light' : 'dark'
  function toggle() {
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem('theme', next)
    } catch {
      // Private windows can refuse storage; the switch still works for this visit.
    }
    setTheme(next)
  }
  return (
    <button type="button" className="masthead-button" onClick={toggle} aria-label={`Switch to ${next} mode`}>
      {next === 'dark' ? <MoonIcon /> : <SunIcon />}
      <span className="masthead-button-label">{next === 'dark' ? 'Dark' : 'Light'}</span>
    </button>
  )
}

export function Masthead({ onHome, onSelect }: { onHome: () => void; onSelect: (c: Company) => void }) {
  const [searching, setSearching] = useState(false)
  return (
    <header className={searching ? 'masthead masthead-searching' : 'masthead'}>
      <div className="masthead-bar">
        <span className="masthead-side masthead-tag">Annual reports, explained</span>
        <h1 className="wordmark">
          <a href="./" onClick={(e) => { e.preventDefault(); onHome() }}>
            Define Company
          </a>
        </h1>
        <div className="masthead-actions">
          {searching ? (
            <div className="masthead-search">
              <CompanySearch
                compact
                onSelect={(c) => {
                  setSearching(false)
                  onSelect(c)
                }}
                onCancel={() => setSearching(false)}
              />
              <button
                type="button"
                className="masthead-button masthead-close"
                aria-label="Close search"
                onClick={() => setSearching(false)}
              >
                ×
              </button>
            </div>
          ) : (
            <button type="button" className="masthead-button" onClick={() => setSearching(true)} aria-label="Search companies">
              <SearchIcon />
              <span className="masthead-button-label">Search</span>
            </button>
          )}
          <ThemeToggle />
        </div>
      </div>
      <div className="masthead-rule" aria-hidden="true" />
    </header>
  )
}

const iconProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  'aria-hidden': true,
}

function SearchIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg {...iconProps}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}
