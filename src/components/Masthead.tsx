import { useEffect, useRef, useState } from 'react'
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

export function Masthead(props: {
  onHome: () => void
  onSelect: (c: Company) => void
  /** A search field already on the page: the Search button goes to it instead of opening the dialog. */
  pageSearch?: React.RefObject<HTMLInputElement | null>
}) {
  const { onHome, onSelect, pageSearch } = props
  const [searching, setSearching] = useState(false)
  const searchButton = useRef<HTMLButtonElement>(null)

  function search() {
    const field = pageSearch?.current
    if (!field) return setSearching(true)
    // Focus during the click, so phones open the keyboard, then jump the field
    // to mid-screen. No smooth scroll: Chrome drops it when focus moves.
    field.focus({ preventScroll: true })
    field.scrollIntoView({ block: 'center' })
  }
  return (
    <header className="masthead">
      <div className="masthead-bar">
        <span className="masthead-side masthead-tag">Annual reports, explained</span>
        <h1 className="wordmark">
          <a href="./" onClick={(e) => { e.preventDefault(); onHome() }}>
            Define Company
          </a>
        </h1>
        <div className="masthead-actions">
          <button
            ref={searchButton}
            type="button"
            className="masthead-button"
            onClick={search}
            aria-label="Search companies"
            aria-haspopup={pageSearch ? undefined : 'dialog'}
          >
            <SearchIcon />
            <span className="masthead-button-label">Search</span>
          </button>
          <ThemeToggle />
        </div>
      </div>
      <div className="masthead-rule" aria-hidden="true" />
      <SearchDialog
        open={searching}
        onClose={() => {
          setSearching(false)
          searchButton.current?.focus()
        }}
        onSelect={(c) => {
          setSearching(false)
          onSelect(c)
        }}
      />
    </header>
  )
}

/**
 * Company search in a modal <dialog>: a centred panel on wide screens and a
 * full-screen sheet on phones (as DocSearch and Material for MkDocs do). The
 * browser makes the page behind inert and closes it on Escape; clicking the
 * backdrop closes it too.
 */
function SearchDialog(props: { open: boolean; onClose: () => void; onSelect: (c: Company) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const { open, onClose } = props

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      // showModal() focuses the first control (the close button); start in the field.
      dialog.querySelector('input')?.focus()
    } else if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="search-dialog"
      aria-label="Search companies"
      onClose={onClose}
      // A search field spends Escape on clearing itself; close on the first press.
      onKeyDownCapture={(e) => {
        if (e.key !== 'Escape') return
        e.preventDefault()
        onClose()
      }}
      // The dialog itself has no padding, so a click that lands on it (not
      // its contents) is a click on the backdrop.
      onClick={(e) => e.target === ref.current && onClose()}
    >
      {open && (
        <div className="search-dialog-body">
          <div className="search-dialog-head">
            <h2 className="rubric">Look up a company</h2>
            <button type="button" className="masthead-button masthead-close" aria-label="Close search" onClick={onClose}>
              ×
            </button>
          </div>
          <CompanySearch inDialog onSelect={props.onSelect} />
          <p className="search-dialog-keys" aria-hidden="true">
            ↑ ↓ to choose · Enter to open · Esc to close
          </p>
        </div>
      )}
    </dialog>
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
