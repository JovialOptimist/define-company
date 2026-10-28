// Finds "Item 1. Business" in a 10-K's HTML and turns it into plain,
// renderable blocks. Works on any DOM Document (browser DOMParser or jsdom).
//
// How it works:
// 1. Flatten the document into leaf "blocks" (paragraphs, divs without block
//    children, whole tables). Hidden inline-XBRL headers are skipped.
// 2. Every short block that starts with "Item 1" (not 1A/1B/10...) and says
//    "Business" (itself or in the next block) is a candidate start.
// 3. Each candidate runs until the next "Item 1A/1B/1C/2/3" or "Part II"
//    heading. The table of contents also matches, but its "section" is a few
//    lines long, so the longest candidate wins.

export type Run = { text: string; bold?: boolean; italic?: boolean }

export type SectionBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'bullet'; runs: Run[] }
  | { type: 'table'; rows: string[][] }

export type Section = {
  heading: string
  /** Set when the section wasn't found the usual way, e.g. no "Item 1" heading. */
  note?: string
  blocks: SectionBlock[]
  /** Plain text length of the section, used to judge whether it's real content. */
  length: number
}

export type RawBlock = { node: Element | Text; text: string; isTable: boolean }

const BLOCK_TAGS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'table',
  'center', 'blockquote', 'section', 'article', 'pre', 'dl', 'dt', 'dd', 'body',
  'tr', 'td', 'th', 'tbody', 'thead', 'hr', 'br',
])
const BLOCK_SELECTOR = [...BLOCK_TAGS].filter((t) => t !== 'body').join(',')
const SKIP_TAGS = new Set(['script', 'style', 'head', 'title', 'ix:header', 'noscript'])

const ITEM_PREFIX = String.raw`^(?:part\s*i[\s.,:\-–—]*)?items?\s*`
const START_RE = new RegExp(ITEM_PREFIX + String.raw`1(?![0-9a-z])`, 'i')
const END_RE = new RegExp(ITEM_PREFIX + String.raw`(?:1\s*a|1\s*b|1\s*c|2|3)(?![0-9a-z])`, 'i')
const PART_II_RE = /^part\s*ii(?![i])\b/i
const ANY_ITEM_RE = new RegExp(ITEM_PREFIX + String.raw`\d`, 'i')
const BUSINESS_RE = /business/i
const BULLET_RE = /^[•●○◦▪■□·\-–—*]$/

export function normalize(s: string): string {
  return s.replace(/[\s ​]+/g, ' ').trim()
}

function tagOf(node: Node): string {
  return node.nodeType === 1 ? (node as Element).tagName.toLowerCase() : ''
}

function isHidden(el: Element): boolean {
  const style = el.getAttribute('style') ?? ''
  return /display\s*:\s*none/i.test(style)
}

export function collectBlocks(root: Element, out: RawBlock[]): void {
  const tag = tagOf(root)
  if (SKIP_TAGS.has(tag) || isHidden(root)) return

  if (tag === 'table') {
    const rows = [...root.querySelectorAll('tr')].map((tr) => normalize(tr.textContent ?? ''))
    out.push({ node: root, text: rows.filter(Boolean).join('\n'), isTable: true })
    return
  }

  if (!root.querySelector(BLOCK_SELECTOR)) {
    const text = normalize(root.textContent ?? '')
    if (text) out.push({ node: root, text, isTable: false })
    return
  }

  // Mixed content: recurse into block children, and gather runs of inline
  // siblings (text, <span>, <b>...) into their own pseudo-blocks.
  let inline: Node[] = []
  const flush = () => {
    const text = normalize(inline.map((n) => n.textContent ?? '').join(''))
    if (text) {
      const wrapper = root.ownerDocument.createElement('span')
      for (const n of inline) wrapper.appendChild(n.cloneNode(true))
      out.push({ node: wrapper, text, isTable: false })
    }
    inline = []
  }
  for (const child of [...root.childNodes]) {
    const isBlockish =
      child.nodeType === 1 &&
      (BLOCK_TAGS.has(tagOf(child)) || !!(child as Element).querySelector(BLOCK_SELECTOR))
    if (isBlockish) {
      flush()
      collectBlocks(child as Element, out)
    } else if (child.nodeType === 1 || child.nodeType === 3) {
      if (child.nodeType === 1 && (SKIP_TAGS.has(tagOf(child)) || isHidden(child as Element))) continue
      inline.push(child)
    }
  }
  flush()
}

/**
 * The block's text when read as a heading: a one-row table is joined up
 * (| Item 1. | Business |), and a long paragraph that opens with a bold
 * run-in title ("ABOUT GE AEROSPACE. General Electric...") yields that title.
 */
function headingText(b: RawBlock): string {
  if (b.isTable) return b.text.replace(/\n/g, ' ')
  return b.text.length > 120 ? (runInTitle(b) ?? b.text) : b.text
}

function runInTitle(b: RawBlock): string | null {
  if (b.isTable || b.node.nodeType !== 1) return null
  const first = [...b.node.childNodes].find((n) => normalize(n.textContent ?? ''))
  if (!first || first.nodeType !== 1 || !isBoldEl(first as Element)) return null
  const title = normalize(first.textContent ?? '')
  return title.length <= 120 && b.text.startsWith(title) ? title : null
}

function isStartCandidate(blocks: RawBlock[], i: number): boolean {
  const b = blocks[i]
  if (b.isTable && b.text.includes('\n')) return false // multi-row table, e.g. the TOC
  const text = headingText(b)
  if (text.length > 120 || !START_RE.test(text)) return false
  if (BUSINESS_RE.test(text)) return true
  // A bare "ITEM 1." with no title at all (Exelon).
  if (/^(?:part\s*i[\s.,:\-–—]*)?items?\s*1\s*[.:]?$/i.test(text)) return true
  // "Item 1." alone, with "Business" as the next block.
  const next = blocks[i + 1]
  return !!next && next.text.length < 80 && /^business/i.test(next.text)
}

function isEnd(b: RawBlock, re: RegExp): boolean {
  if (b.isTable && b.text.includes('\n')) return false
  const text = headingText(b)
  return text.length <= 200 && (re.test(text) || PART_II_RE.test(text))
}

function findEnd(blocks: RawBlock[], start: number): number {
  for (const re of [END_RE, ANY_ITEM_RE]) {
    for (let j = start + 1; j < blocks.length; j++) {
      if (isEnd(blocks[j], re) && !(re === ANY_ITEM_RE && START_RE.test(headingText(blocks[j])))) return j
    }
  }
  return blocks.length
}

// Some filers (GE, for one) replace Item headings with a "Form 10-K Cross
// Reference Index" that points to page numbers. Their business overview
// still has a heading of its own, such as "About GE Aerospace".
const FALLBACK_START_RE =
  /^(?:about\b|business overview|overview of (?:our|the) business|our business\b|company overview|business\.?$)/i
const FALLBACK_END_RE = /^(?:risk factors|management['’]s discussion|legal proceedings|properties\b)/i

type Span = { start: number; end: number; length: number }

/** The longest span, or with `firstOver`, the first one at least that long. */
function pickSpan(
  blocks: RawBlock[],
  isStart: (i: number) => boolean,
  endOf: (i: number) => number,
  firstOver?: number,
): Span | null {
  let best: Span | null = null
  for (let i = 0; i < blocks.length; i++) {
    if (!isStart(i)) continue
    const end = endOf(i)
    let length = 0
    for (let j = i + 1; j < end; j++) length += blocks[j].text.length
    if (firstOver !== undefined && length >= firstOver) return { start: i, end, length }
    if (!best || length >= best.length) best = { start: i, end, length }
  }
  return best
}

/** Font size of a heading-like block's bold title, e.g. "11pt", or null. */
function titleSize(b: RawBlock): string | null {
  if (b.isTable || b.node.nodeType !== 1) return null
  const title = headingText(b)
  if (title.length > 120) return null
  const root = b.node as Element
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (!isBoldEl(el) || !normalize(el.textContent ?? '').startsWith(title.slice(0, 20))) continue
    for (let e: Element | null = el; e && e !== root.parentElement; e = e.parentElement) {
      const size = /font-size\s*:\s*([\d.]+\s*(?:pt|px|em|rem|%))/.exec(styleOf(e))?.[1]
      if (size) return size.replace(/\s/g, '')
    }
    return null
  }
  return null
}

/**
 * The fallback section ends at Risk Factors / MD&A / an Item heading, or at
 * the next title in the same font size as its own (the next top-level topic).
 */
function fallbackEnd(blocks: RawBlock[], start: number): number {
  const size = titleSize(blocks[start])
  for (let j = start + 1; j < blocks.length; j++) {
    const b = blocks[j]
    if (b.isTable && b.text.includes('\n')) continue
    const text = headingText(b)
    if (text.length > 120) continue
    if (FALLBACK_END_RE.test(text) || isEnd(b, ANY_ITEM_RE)) return j
    if (size && titleSize(b) === size) return j
  }
  return blocks.length
}

export function findItem1(doc: Document): Section | null {
  const blocks: RawBlock[] = []
  collectBlocks(doc.body ?? doc.documentElement, blocks)

  const item1 = pickSpan(blocks, (i) => isStartCandidate(blocks, i), (i) => findEnd(blocks, i))
  if (item1 && item1.length >= 1500) return toSection(blocks, item1)

  // The business overview comes early, so take the first heading that has
  // real content under it rather than the longest one.
  const fallback = pickSpan(
    blocks,
    (i) => {
      const b = blocks[i]
      return !(b.isTable && b.text.includes('\n')) && headingText(b).length <= 80 && FALLBACK_START_RE.test(headingText(b))
    },
    (i) => fallbackEnd(blocks, i),
    1500,
  )
  if (fallback && fallback.length > (item1?.length ?? 0) && fallback.length >= 1500) {
    const section = toSection(blocks, fallback)
    section.note = item1
      ? `"${headingText(blocks[item1.start])}" only points elsewhere in the filing, so this shows the "${section.heading}" section instead.`
      : `This 10-K has no "Item 1. Business" heading (it probably uses a cross-reference index), so this shows the "${section.heading}" section instead.`
    return section
  }
  if (!item1) return null
  const section = toSection(blocks, item1)
  if (/incorporated|exhibit 13|annual report to (?:share|stock)holders/i.test(blocks.slice(item1.start, item1.end).map((b) => b.text).join(' ')))
    section.note = 'Item 1 in this 10-K is incorporated by reference from another document (often the annual report, Exhibit 13), so only a short pointer is shown.'
  return section
}

function toSection(blocks: RawBlock[], span: Span): Section {
  const noise = repeatedNoise(blocks)
  const first = blocks[span.start]
  let heading = headingText(first).replace(/\.$/, '')
  let from = span.start + 1
  const out: SectionBlock[] = []
  if (headingText(first) !== first.text && !first.isTable) {
    // Run-in title: keep the paragraph text that follows it.
    const runs = runsOf(first.node)
    runs[0].text = runs[0].text.slice(headingText(first).length).trimStart()
    if (!runs[0].text) runs.shift()
    if (runs.length) {
      runs[0].text = runs[0].text.trimStart()
      out.push({ type: 'paragraph', runs })
    }
  }
  // Fold a separate "Business" title block into the heading.
  if (START_RE.test(heading) && !BUSINESS_RE.test(heading) && from < span.end && /^business/i.test(blocks[from].text)) {
    heading = `${heading} ${blocks[from].text}`
    from++
  }

  for (let j = from; j < span.end; j++) {
    const b = blocks[j]
    if (noise.has(b.text) || isPageNoise(b.text)) continue
    out.push(...toSectionBlocks(b))
  }
  return { heading, blocks: out, length: span.length }
}

// ---- noise: page numbers, running footers, "Table of Contents" links ----

function isPageNoise(text: string): boolean {
  return (
    /^(?:page\s*)?[\divxlc]{1,6}$/i.test(text) ||
    /^table of contents$/i.test(text) ||
    /^-\s*\d+\s*-$/.test(text) ||
    /^back to contents$/i.test(text) ||
    /^part\s*[iv]+\.?$/i.test(text)
  )
}

/** Short blocks with a page number in them that repeat on many pages. */
function repeatedNoise(blocks: RawBlock[]): Set<string> {
  const counts = new Map<string, number>()
  for (const b of blocks) {
    if (b.text.includes('\n') || b.text.length > 120 || !/\d/.test(b.text)) continue
    const key = b.text.replace(/\d+/g, '#')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const noise = new Set<string>()
  for (const b of blocks) {
    if (b.text.includes('\n') || b.text.length > 120 || !/\d/.test(b.text)) continue
    if ((counts.get(b.text.replace(/\d+/g, '#')) ?? 0) >= 5) noise.add(b.text)
  }
  return noise
}

// ---- turning raw blocks into renderable ones ----

function styleOf(el: Element): string {
  return (el.getAttribute('style') ?? '').toLowerCase()
}

function isBoldEl(el: Element): boolean {
  const tag = tagOf(el)
  return tag === 'b' || tag === 'strong' || /^h[1-6]$/.test(tag) ||
    /font-weight\s*:\s*(bold|bolder|[6-9]00)/.test(styleOf(el))
}

function isItalicEl(el: Element): boolean {
  const tag = tagOf(el)
  return tag === 'i' || tag === 'em' || /font-style\s*:\s*italic/.test(styleOf(el))
}

function collectRuns(node: Node, bold: boolean, italic: boolean, out: Run[]): void {
  if (node.nodeType === 3) {
    const text = (node.textContent ?? '').replace(/[\s ​]+/g, ' ')
    if (!text) return
    const last = out[out.length - 1]
    if (last && !!last.bold === bold && !!last.italic === italic) last.text += text
    else out.push({ text, ...(bold && { bold }), ...(italic && { italic }) })
    return
  }
  if (node.nodeType !== 1) return
  const el = node as Element
  if (SKIP_TAGS.has(tagOf(el)) || isHidden(el)) return
  const b = bold || isBoldEl(el)
  const i = italic || isItalicEl(el)
  if (tagOf(el) === 'br') {
    collectRuns(el.ownerDocument.createTextNode(' '), b, i, out)
    return
  }
  for (const child of el.childNodes) collectRuns(child, b, i, out)
}

function runsOf(node: Node): Run[] {
  const runs: Run[] = []
  collectRuns(node, node.nodeType === 1 && isBoldEl(node as Element), node.nodeType === 1 && isItalicEl(node as Element), runs)
  if (runs.length) {
    runs[0].text = runs[0].text.trimStart()
    runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd()
  }
  return runs.filter((r) => r.text)
}

function paragraphOrHeading(runs: Run[], text: string): SectionBlock {
  const allBold = runs.every((r) => r.bold || !r.text.trim())
  const allItalic = runs.every((r) => r.italic || !r.text.trim())
  const looksLikeTitle = text.length <= 100 && !/[.:;,]$/.test(text) || text.length <= 60
  if ((allBold || allItalic) && looksLikeTitle) return { type: 'heading', text }
  if (/^[•●○◦▪■·]\s*/.test(text)) {
    runs[0].text = runs[0].text.replace(/^[•●○◦▪■·]\s*/, '')
    return { type: 'bullet', runs }
  }
  return { type: 'paragraph', runs }
}

function cellTexts(tr: Element): { cells: string[]; nodes: Element[] } {
  const cells: string[] = []
  const nodes: Element[] = []
  for (const td of tr.querySelectorAll(':scope > td, :scope > th')) {
    const text = normalize(td.textContent ?? '')
    if (!text) continue
    const last = cells.length - 1
    // Join "$" | "1,234" and "12" | "%" / ")" fragments that SEC tables split.
    if (last >= 0 && /^[$€£¥]$/.test(cells[last])) cells[last] += text
    else if (last >= 0 && /^[%)]+$|^\)%$/.test(text)) cells[last] += text
    else {
      cells.push(text)
      nodes.push(td)
    }
  }
  return { cells, nodes }
}

function toSectionBlocks(b: RawBlock): SectionBlock[] {
  if (!b.isTable) return [paragraphOrHeading(runsOf(b.node), b.text)]

  const table = b.node as Element
  const rows = [...table.querySelectorAll('tr')]
    .filter((tr) => tr.closest('table') === table)
    .map(cellTexts)
    .filter((r) => r.cells.length)

  // Layout tables: bullets (| • | text |) and single-cell boxes.
  if (rows.every((r) => r.cells.length === 1 || (r.cells.length === 2 && BULLET_RE.test(r.cells[0])))) {
    return rows.map((r) =>
      r.cells.length === 2
        ? { type: 'bullet', runs: runsOf(r.nodes[1]) }
        : paragraphOrHeading(runsOf(r.nodes[0]), r.cells[0]),
    )
  }
  return [{ type: 'table', rows: rows.map((r) => r.cells) }]
}
