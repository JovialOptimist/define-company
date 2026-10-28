// The precomputed dataset: one record per company that filed a 10-K, built by
// scripts/backfill.ts and kept current by scripts/update.ts. The site loads
// these first and only goes to EDGAR live when a company isn't here.

import type { Filing } from './edgar'
import type { Section } from './extract'

/** Bump when extraction changes, so the next run redoes every record. */
export const EXTRACTOR_VERSION = 1

export type StoredFiling = Omit<Filing, 'url'>

export type CompanyRecord = {
  cik: number
  name: string
  tickers: string[]
  /** EDGAR's industry (SIC) description, e.g. "Electronic Computers". */
  industry?: string
  filing: StoredFiling
  /** null when Item 1 couldn't be found in the filing. */
  section: Section | null
  extractorVersion: number
  extractedAt: string
}

/** One search-index row: [cik, name, tickers joined by ",", latest 10-K filing date]. */
export type IndexRow = [number, string, string, string]

export const companyPath = (cik: number) => `companies/${cik}.json`

/** Turns a stored filing back into one the live code can fetch through `www`. */
export function toFiling(f: StoredFiling, www: string): Filing {
  return { ...f, url: f.publicUrl.replace('https://www.sec.gov', www) }
}
