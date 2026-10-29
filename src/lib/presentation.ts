// Turns what EDGAR and the extractor give us into the editorial page's
// pieces: a readable headline name, a one-sentence standfirst and a pull
// quote. All of it is heuristic and quotes the filing verbatim; anything that
// doesn't fit simply isn't shown.

import type { Section, SectionBlock } from './extract'

// ---- names ----

/** Words that stay lowercase inside a name. */
const SMALL = new Set(['of', 'and', 'the', 'for', 'in', 'on', 'at', 'to', 'de', 'a'])
/** Short words that are ordinary words, not acronyms. */
const SHORT_WORDS = new Set(['co', 'inc', 'new', 'one', 'air', 'oil', 'gas', 'car', 'bio', 'sun', 'sea', 'us', 'cos', 'old', 'big', 'red', 'top', 'web', 'pet', 'art', 'all', 'way', 'ag', 'lp',
  'eli', 'ann', 'ted', 'joe', 'sam', 'bob', 'ace', 'ark', 'box', 'key', 'oak', 'gap', 'fox', 'tri', 'max', 'pro', 'ice', 'sky', 'com'])
const SUFFIXES: Record<string, string> = {
  co: 'Co.',
  cos: 'Cos.',
  inc: 'Inc.',
  'inc.': 'Inc.',
  corp: 'Corp.',
  'corp.': 'Corp.',
  ltd: 'Ltd.',
  'ltd.': 'Ltd.',
  llc: 'LLC',
  lp: 'LP',
  'l.p.': 'L.P.',
  plc: 'plc',
  nv: 'N.V.',
  sa: 'S.A.',
}

function titleWord(word: string, first: boolean): string {
  const lower = word.toLowerCase()
  if (!first && SMALL.has(lower)) return lower
  if (SUFFIXES[lower] && !first) return SUFFIXES[lower]
  const letters = lower.replace(/[^a-z]/g, '')
  // AT&T, 3M, IBM, CSX: keep acronyms and anything with digits or "&" as written.
  if (/[&\d]/.test(word) || (letters.length <= 3 && !SHORT_WORDS.has(letters)) || !/[aeiouy]/.test(letters)) return word
  return lower
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('-')
    .replace(/^Mc([a-z])/, (_, c: string) => `Mc${c.toUpperCase()}`)
}

/**
 * EDGAR spells about a third of company names in capitals ("COCA COLA CO",
 * often with a state tag like "/DE/"). Those, and names that are nearly all
 * capitals ("ELI LILLY & Co"), are title-cased for display; names in mixed
 * case are kept as the company wrote them.
 */
export function displayName(name: string): string {
  const clean = name.replace(/\s*\/[A-Z]{2,}\/?\s*$/, '').replace(/,\s*$/, '').trim()
  const letters = clean.replace(/[^A-Za-z]/g, '')
  const lower = clean.replace(/[^a-z]/g, '')
  if (lower.length >= letters.length * 0.2) return clean
  return clean
    .split(/\s+/)
    .map((w, i) => titleWord(w, i === 0))
    .join(' ')
    .replace(/ Com\b/, '.com') // EDGAR drops the dot: "AMAZON COM INC"
}

const LEGAL_SUFFIX = /^(co|cos|inc|corp|corporation|company|ltd|limited|llc|lp|plc|nv|sa|ag)$/
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const isMostlyCapitals = (s: string) => {
  const letters = s.replace(/[^A-Za-z]/g, '').length
  return s.replace(/[^a-z]/g, '').length < letters * 0.2
}

/**
 * The company's name for the headline. When EDGAR has it in capitals, the
 * filing's own spelling is used if Item 1 spells it out ("The Coca-Cola
 * Company", "JPMorgan Chase & Co."); otherwise `displayName`.
 */
export function headlineName(name: string, section: Section | null): string {
  const fallback = displayName(name)
  const clean = name.replace(/\s*\/[A-Z]{2,}\/?\s*$/, '')
  if (!section || !isMostlyCapitals(clean)) return fallback
  const words = clean.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean)
  while (words.length > 1 && LEGAL_SUFFIX.test(words[words.length - 1])) words.pop()
  const core = words.map(escapeRe).join(String.raw`[\s.,&'’-]*`)
  const suffix = String.raw`(?:,?\s+(?:&\s+Co\.|and\s+Company|Inc\.|Incorporated|Corporation|Company|Co\.|Corp\.|Ltd\.|Limited|plc|N\.V\.|S\.A\.|LLC|L\.P\.))?`
  // Not part of a web or email address ("dataio.com", "ir@cedar…").
  const re = new RegExp(String.raw`(?<![\w.@/])(?:The\s+)?${core}\b${suffix}(?!\.?\w)`, 'gi')
  let bare: string | null = null
  for (const b of section.blocks.slice(0, 40)) {
    const text = blockText(b)
    if (isMostlyCapitals(text)) continue
    for (const m of text.matchAll(re)) {
      // "The" only belongs to names like "The Coca-Cola Company".
      const found = /\b(company|corporation)$/i.test(m[0]) ? m[0] : m[0].replace(/^the\s+/i, '')
      // Capitals in ordinary prose are the company's own styling (NVIDIA).
      if (!/^[A-Z0-9]/.test(found) || found.split(/\s+/).length > 8) continue
      // The full legal name ("Twitter, Inc.") beats a passing mention ("Twitter").
      if (m[0].length > m[0].replace(new RegExp(`${suffix}$`, 'i'), '').length) return found
      bare ??= found
    }
  }
  return bare ?? fallback
}

// ---- sentences ----

const ABBREVIATIONS = new Set([
  'inc', 'corp', 'co', 'cos', 'ltd', 'no', 'nos', 'mr', 'mrs', 'ms', 'dr', 'st', 'vs', 'etc', 'jr', 'sr', 'bros',
  'mfg', 'intl', 'dept', 'approx', 'est', 'fig', 'u.s', 'u.k', 'e.g', 'i.e', 'n.a', 'l.p', 's.a', 'n.v', 'p.m', 'a.m', 'sdn', 'bhd', 'pty', 'pte', 'ag', 'gmbh',
])

/** Splits text into sentences without breaking on "Inc." or "U.S.". */
export function sentences(text: string): string[] {
  const out: string[] = []
  let start = 0
  for (const m of text.matchAll(/[.!?]["”’)]*\s+(?=["“(]?[A-Z0-9])/g)) {
    const end = m.index + m[0].trimEnd().length
    const before = text.slice(start, m.index + 1)
    const word = /([A-Za-z.]+)\.$/.exec(before)?.[1]?.toLowerCase() ?? ''
    if (ABBREVIATIONS.has(word) || /^[a-z]$/.test(word)) continue
    out.push(text.slice(start, end).trim())
    start = m.index + m[0].length
  }
  const rest = text.slice(start).trim()
  if (rest) out.push(rest)
  return out
}

const blockText = (b: SectionBlock) => (b.type === 'paragraph' ? b.runs.map((r) => r.text).join('') : '')

/** Definitions, cross-references and legal set-up, not a description of the business. */
const BOILERPLATE =
  /\bthe terms\b|unless the context|\brefer(s|red)? to\b|as used in|forward-looking|this (annual )?report|form 10-k|incorporated by reference|\bitem \d|collectively|hereinafter|see note|fiscal year|principal executive offices|telephone/i

// ---- standfirst ----

const DESCRIBES =
  /\b(is|are)\s+(a|an|one of)\b|^(today, )?(we|the company|our company)\s+(designs?|develops?|manufactures?|provides?|operates?|offers?|owns?|sells?|makes?|markets?|produces?)\b(?!(\s+and\s+\w+)?\s+(our|its)\b)/i
const OPENS_ASIDE = /^(in (this|connection|addition)|while|however|as a result|additionally|also|although)\b/i

/**
 * The first sentence near the top that says what the company is or does,
 * with the company (or "we") as its subject.
 */
export function standfirst(section: Section, name: string): string | null {
  const firstWord = displayName(name).replace(/^the\s+/i, '').split(/[\s,]/)[0].toLowerCase()
  const aboutCompany = (s: string) =>
    /^(today, )?(we|our company|the company|the trust|the bank|the partnership)\b/i.test(s) ||
    (firstWord.length > 1 && s.slice(0, 60).toLowerCase().includes(firstWord))
  const paragraphs = section.blocks.filter((b) => b.type === 'paragraph').slice(0, 8)
  for (const p of paragraphs) {
    for (const s of sentences(blockText(p)).slice(0, 2)) {
      if (s.length < 50 || s.length > 280 || !/[.!]$/.test(s)) continue
      if (BOILERPLATE.test(s) || OPENS_ASIDE.test(s) || /\bwe believe\b/i.test(s)) continue
      if (DESCRIBES.test(s) && aboutCompany(s)) return s
    }
  }
  return null
}

// ---- pull quote ----

export type PullQuote = { text: string; heading: string; headingIndex: number }

/**
 * A short, plain sentence that opens one of the later subsections, taken
 * from about a third of the way through. Shown next to the text, like a
 * magazine's pull quote, and credited to its subsection.
 */
export function pullQuote(section: Section): PullQuote | null {
  const candidates: (PullQuote & { at: number })[] = []
  let heading: { text: string; index: number } | null = null
  let seenHeadings = 0
  let takenForHeading = -1
  section.blocks.forEach((b, i) => {
    if (b.type === 'heading') {
      // A link or a source note isn't a subsection worth crediting.
      heading = /https?:|www\./i.test(b.text) ? null : { text: b.text, index: i }
      seenHeadings++
      return
    }
    if (!heading || seenHeadings < 2 || takenForHeading === heading.index || b.type !== 'paragraph') return
    takenForHeading = heading.index
    const s = sentences(blockText(b))[0] ?? ''
    if (s.length < 60 || s.length > 150 || /[();:“”"]|\d{3,}/.test(s) || BOILERPLATE.test(s) || !/\.$/.test(s)) return
    candidates.push({ text: s, heading: heading.text, headingIndex: heading.index, at: i / section.blocks.length })
  })
  if (!candidates.length) return null
  // Nearest a third of the way in, preferring the company speaking ("We …")
  // over descriptions of its reporting ("The Company's …").
  const score = (c: { text: string; at: number }) => Math.abs(c.at - 0.3) - (/^(we|our)\b/i.test(c.text) ? 0.2 : 0)
  candidates.sort((a, b) => score(a) - score(b))
  const { at: _at, ...quote } = candidates[0]
  return quote
}

// ---- dates and lengths ----

/** "2026-02-20" -> "Feb 20, 2026". */
export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export const wordCount = (section: Section) => Math.round(section.length / 6)
export const readMinutes = (section: Section) => Math.max(1, Math.round(wordCount(section) / 230))
