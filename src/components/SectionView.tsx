import type { Run, Section } from '../lib/extract'

function Runs({ runs }: { runs: Run[] }) {
  return runs.map((r, i) => {
    let node: React.ReactNode = r.text
    if (r.italic) node = <em>{node}</em>
    if (r.bold) node = <strong>{node}</strong>
    return <span key={i}>{node}</span>
  })
}

const slug = (i: number) => `part-${i}`

export function SectionView({ section }: { section: Section }) {
  const headings = section.blocks
    .map((b, i) => (b.type === 'heading' ? { text: b.text, id: slug(i) } : null))
    .filter((h): h is { text: string; id: string } => !!h)
  const words = Math.round(section.length / 6)

  // Consecutive bullets render as one list.
  const rendered: React.ReactNode[] = []
  let bullets: React.ReactNode[] = []
  const flush = (key: number) => {
    if (bullets.length) rendered.push(<ul key={`ul-${key}`}>{bullets}</ul>)
    bullets = []
  }
  section.blocks.forEach((b, i) => {
    if (b.type === 'bullet') {
      bullets.push(<li key={i}><Runs runs={b.runs} /></li>)
      return
    }
    flush(i)
    if (b.type === 'heading') rendered.push(<h3 key={i} id={slug(i)}>{b.text}</h3>)
    else if (b.type === 'paragraph') rendered.push(<p key={i}><Runs runs={b.runs} /></p>)
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
  flush(section.blocks.length)

  return (
    <article className="section">
      <header className="section-head">
        <h2>{section.heading}</h2>
        <p className="section-size">About {words.toLocaleString()} words · {Math.max(1, Math.round(words / 230))} min read</p>
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
    </article>
  )
}
