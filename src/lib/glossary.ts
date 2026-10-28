// Finds glossary terms (src/data/glossary.json) in running text.
//
// The 200 terms were picked by counting how many of ~60 real 10-K Item 1
// sections use each candidate term, dropping everyday words that are too
// vague to define well (e.g. "platform", "property").

import entries from '../data/glossary.json'

export type GlossaryEntry = { term: string; aliases: string[]; definition: string }

export const glossary: GlossaryEntry[] = entries

export type TextPart = string | { text: string; entry: GlossaryEntry }

/** Acronyms like SEC or AI only match in capitals, so "sec" in a URL doesn't. */
function isAcronym(phrase: string): boolean {
  return phrase.length <= 6 && phrase === phrase.toUpperCase() && /[A-Z]/.test(phrase)
}

/** Lowercase, straight apostrophes, single spaces for space/hyphen runs. */
function key(s: string): string {
  return s.toLowerCase().replace(/’/g, "'").replace(/[\s-]+/g, ' ')
}

function phrasePattern(phrase: string): string {
  const escaped = phrase
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/'/g, "['’]")
    .replace(/[\s-]+/g, '[\\s-]+')
  if (isAcronym(phrase)) return `${escaped}s?`
  // subsidiary -> subsidiaries, royalty -> royalties
  if (/[^aeiou]y$/i.test(phrase)) return `${escaped.slice(0, -1)}(?:y|ies)`
  return `${escaped}(?:s|es)?`
}

const byKey = new Map<string, { entry: GlossaryEntry; phrase: string }>()
const phrases: string[] = []
for (const entry of glossary) {
  for (const phrase of [entry.term, ...entry.aliases]) {
    byKey.set(key(phrase), { entry, phrase })
    phrases.push(phrase)
  }
}
// Longest first, so "bank holding company" wins over "holding company".
phrases.sort((a, b) => b.length - a.length)
const termRe = new RegExp(`(?<![\\w-])(?:${phrases.map(phrasePattern).join('|')})(?![\\w-])`, 'gi')

function lookup(match: string): GlossaryEntry | undefined {
  const k = key(match)
  for (const singular of [k, k.replace(/ies$/, 'y'), k.replace(/es$/, ''), k.replace(/s$/, '')]) {
    const hit = byKey.get(singular)
    if (!hit) continue
    // The regex ignores case; acronyms must still match in capitals.
    if (isAcronym(hit.phrase) && match.replace(/s$/, '') !== hit.phrase) return undefined
    return hit.entry
  }
  return undefined
}

/**
 * Splits text into plain strings and glossary matches. Terms already in
 * `seen` are left plain, and new matches are added to it, so a caller can
 * mark only the first use of each term per paragraph.
 */
export function findTerms(text: string, seen: Set<GlossaryEntry> = new Set()): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const m of text.matchAll(termRe)) {
    const entry = lookup(m[0])
    if (!entry || seen.has(entry)) continue
    seen.add(entry)
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push({ text: m[0], entry })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}
