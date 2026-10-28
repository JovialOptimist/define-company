import { useCallback, useId, useMemo, useState } from 'react'
import type { Run, Section, SectionBlock } from '../lib/extract'
import { findTerms, type GlossaryEntry } from '../lib/glossary'
import { Term, TermPopover, type OpenTerm } from './Glossary'

/** A run split further into plain text and glossary terms. */
type Piece = Run & { entry?: GlossaryEntry; termId?: string }
type ShownBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; pieces: Piece[] }
  | { type: 'bullet'; pieces: Piece[] }
  | Extract<SectionBlock, { type: 'table' }>

/**
 * Marks the first use of each glossary term in every subsection (the
 * stretch between two headings), so common terms aren't underlined on
 * every line.
 */
function withTerms(blocks: SectionBlock[]): ShownBlock[] {
  let seen = new Set<GlossaryEntry>()
  let n = 0
  return blocks.map((b) => {
    if (b.type === 'heading') {
      seen = new Set()
      return b
    }
    if (b.type === 'table') return b
    const pieces = b.runs.flatMap((run) =>
      findTerms(run.text, seen).map((part): Piece =>
        typeof part === 'string'
          ? { ...run, text: part }
          : { ...run, text: part.text, entry: part.entry, termId: `term-${n++}` },
      ),
    )
    return b.type === 'bullet' ? { type: 'bullet', pieces } : { type: 'paragraph', pieces }
  })
}

const slug = (i: number) => `part-${i}`

export function SectionView({ section }: { section: Section }) {
  const blocks = useMemo(() => withTerms(section.blocks), [section])
  const [open, setOpen] = useState<OpenTerm | null>(null)
  const close = useCallback(() => setOpen(null), [])
  const popoverId = useId()

  const headings = blocks
    .map((b, i) => (b.type === 'heading' ? { text: b.text, id: slug(i) } : null))
    .filter((h): h is { text: string; id: string } => !!h)
  const words = Math.round(section.length / 6)

  const renderPieces = (pieces: Piece[]) =>
    pieces.map((p, i) => {
      let node: React.ReactNode = p.entry ? (
        <Term
          termId={p.termId!}
          text={p.text}
          entry={p.entry}
          open={open}
          onToggle={setOpen}
          popoverId={popoverId}
        />
      ) : (
        p.text
      )
      if (p.italic) node = <em>{node}</em>
      if (p.bold) node = <strong>{node}</strong>
      return <span key={i}>{node}</span>
    })

  // Consecutive bullets render as one list.
  const rendered: React.ReactNode[] = []
  let bullets: React.ReactNode[] = []
  const flush = (key: number) => {
    if (bullets.length) rendered.push(<ul key={`ul-${key}`}>{bullets}</ul>)
    bullets = []
  }
  blocks.forEach((b, i) => {
    if (b.type === 'bullet') {
      bullets.push(<li key={i}>{renderPieces(b.pieces)}</li>)
      return
    }
    flush(i)
    if (b.type === 'heading') rendered.push(<h3 key={i} id={slug(i)}>{b.text}</h3>)
    else if (b.type === 'paragraph') rendered.push(<p key={i}>{renderPieces(b.pieces)}</p>)
    else
      rendered.push(
        <div key={i} className="table-wrap">
          <table>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
  })
  flush(blocks.length)

  return (
    <article className="section">
      <header className="section-head">
        <h2>{section.heading}</h2>
        <p className="section-size">About {words.toLocaleString()} words · {Math.max(1, Math.round(words / 230))} min read</p>
        <p className="term-hint">
          <span className="term-sample">Dashed underlines</span> mark business jargon. Click one for a plain-English definition.
        </p>
      </header>

      {section.note && (
        <div className="callout callout-note" role="note">
          <strong>
            <span aria-hidden="true">ⓘ </span>Note:
          </strong>{' '}
          {section.note}
        </div>
      )}

      {headings.length >= 4 && (
        <details className="contents">
          <summary>Contents ({headings.length} topics)</summary>
          <ol>
            {headings.map((h) => (
              <li key={h.id}>
                <a href={`#${h.id}`}>{h.text}</a>
              </li>
            ))}
          </ol>
        </details>
      )}

      <div className="section-body">{rendered}</div>
      {open && <TermPopover key={open.termId} open={open} onClose={close} id={popoverId} />}
    </article>
  )
}
