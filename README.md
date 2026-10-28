# Define Company

A React + TypeScript (Vite) site that finds a company's latest 10-K on SEC EDGAR and shows its
overview section, normally **Item 1. Business**.

## Run it

SEC EDGAR asks every client to send a User-Agent naming the app and a contact email
([fair access rules](https://www.sec.gov/os/accessing-edgar-data)). Copy the template and put
yours in it:

```
cp .env.example .env.local
```

Then:

```
npm install
npm run dev
```

Browsers can't set User-Agent, and `www.sec.gov/Archives` sends no CORS headers, so the Vite
dev/preview server proxies all EDGAR calls (`/sec-www`, `/sec-data`, `/sec-efts` in
`vite.config.ts`). A static deployment needs an equivalent proxy.

## How it works

- **Company search** (`src/lib/edgar.ts`): ticker, name or CIK, from `company_tickers.json`, plus
  EDGAR's company-name autocomplete (`efts.sec.gov`, undocumented) for filers with no current ticker.
- **10-K lookup**: `data.sec.gov/submissions/CIK##########.json`, reading older history pages when
  the recent window has no 10-K (busy bank filers), or when you click "Find older 10-Ks".
- **Item 1 extraction** (`src/lib/extract.ts`): flattens the HTML into blocks, finds every
  "Item 1 … Business" heading, runs each to the next Item 1A/1B/1C/2/3 or Part II heading, and keeps
  the longest (the table of contents matches too, but its "section" is tiny). Filings with a
  cross-reference index instead of Item headings (GE, Honeywell, Intel) fall back to the first
  "About …" / "Our Business" / "Business overview" section, and the page says so.

## Glossary

`src/data/glossary.json` holds 200 business terms with plain-English definitions. In the
displayed section, the first use of each term per subsection gets a dashed underline; clicking it
(or Enter/Space) opens the definition. The terms were chosen by counting how many of ~60 real 10-K
Item 1 sections use each candidate term, after dropping everyday words too vague to define well
("platform", "property"). The definitions were written for this project, not copied from a source.

## Testing the extractor

```
npm run test:extract                # 30 large and small companies, latest 10-K
npm run test:extract -- IBM KO@10   # chosen tickers; @N = Nth most recent 10-K
```

Downloads are cached in `.cache/`.
