import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { GlossaryEntry } from '../lib/glossary'

export type OpenTerm = { entry: GlossaryEntry; anchor: HTMLElement; termId: string; text: string }

/** A glossary term in the text: dashed underline, opens its definition on click. */
export function Term(props: {
  termId: string
  text: string
  entry: GlossaryEntry
  open: OpenTerm | null
  onToggle: (t: OpenTerm | null) => void
  popoverId: string
}) {
  const isOpen = props.open?.termId === props.termId
  const toggle = (anchor: HTMLElement) =>
    props.onToggle(isOpen ? null : { entry: props.entry, anchor, termId: props.termId, text: props.text })
  // A span (not a <button>) so multi-word terms can wrap across lines.
  return (
    <span
      className={isOpen ? 'term term-open' : 'term'}
      role="button"
      tabIndex={0}
      aria-expanded={isOpen}
      aria-controls={isOpen ? props.popoverId : undefined}
      onClick={(e) => toggle(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          toggle(e.currentTarget)
        }
      }}
    >
      {props.text}
    </span>
  )
}

const GAP = 8
const MARGIN = 16

/** The definition card, placed below the term (or above it when there's no room). */
export function TermPopover({ open, onClose, id }: { open: OpenTerm; onClose: () => void; id: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const place = () => {
      const pop = ref.current
      if (!pop) return
      // A term can wrap onto two lines: sit below its last line or above its first.
      const lines = open.anchor.getClientRects()
      const first = lines[0] ?? open.anchor.getBoundingClientRect()
      const last = lines[lines.length - 1] ?? first
      const width = pop.offsetWidth
      const height = pop.offsetHeight
      const below = last.bottom + GAP + height <= innerHeight || first.top - GAP - height < 0
      const line = below ? last : first
      const top = (below ? last.bottom + GAP : first.top - GAP - height) + scrollY
      const maxLeft = document.documentElement.clientWidth - width - MARGIN
      const left = Math.max(MARGIN, Math.min(line.left, maxLeft)) + scrollX
      setPos({ top, left })
    }
    place()
    addEventListener('resize', place)
    return () => removeEventListener('resize', place)
  }, [open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      onClose()
      open.anchor.focus()
    }
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target) || open.anchor.contains(target)) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open, onClose])

  const { entry } = open
  const shown = open.text
  const isAlias = shown.toLowerCase() !== entry.term.toLowerCase() && !shown.toLowerCase().startsWith(entry.term.toLowerCase())

  return (
    <div
      ref={ref}
      id={id}
      className="term-popover"
      role="dialog"
      aria-labelledby={titleId}
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}
    >
      <div className="term-popover-head">
        <h4 id={titleId}>
          {entry.term}
          {isAlias && <span className="term-alias"> ({shown})</span>}
        </h4>
        <button type="button" className="term-close" aria-label="Close definition" onClick={onClose}>
          ×
        </button>
      </div>
      <p>{entry.definition}</p>
      <p className="term-source">Plain-English glossary, not from the filing.</p>
    </div>
  )
}
