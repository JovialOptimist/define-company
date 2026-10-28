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

Browsers can't set User-Agent, and `www.sec.gov/Archives` sends no CORS headers, so EDGAR calls go
through a proxy at `/sec-www`, `/sec-data` and `/sec-efts`: the Vite dev server's in development
(`vite.config.ts`), and a Cloudflare Worker in production (`worker/index.ts`).

## Architecture

- **Dataset** (`data/`, on the `data` branch): the latest 10-K's Item 1 for every company that filed
  one in the last year (~6,600), one JSON file per company, plus `index.json` for search. The site
  reads these first, so most visits never touch EDGAR.
- **Live fallback**: companies not in the dataset, and older years ("Other years"), are fetched
  from EDGAR through the proxy and extracted in the browser, as before.
- **Hosting**: one Cloudflare Worker (`wrangler.jsonc`) serves the build and dataset as static
  assets (free and unlimited) and runs only for the proxy paths.
- **Daily updates**: `.github/workflows/deploy.yml` reads EDGAR's daily index, refreshes companies
  that filed a new 10-K, commits the `data` branch, and redeploys. Pushes to `main` redeploy too.

### Building the dataset

```
npm run backfill   # from scratch; ~1-2 hours, resumable
npm run update     # since the last run, from EDGAR's daily index
```

Both read `SEC_USER_AGENT` from `.env.local` and stay under 5 EDGAR requests a second
(`SEC_RPS`). Companies whose Item 1 couldn't be found are listed in `data/problems.tsv`.

### Deploying

One-time setup:

1. Create a Cloudflare account, then `npx wrangler login`.
2. `npx wrangler secret put SEC_USER_AGENT` (your name and email, as in `.env.local`).
3. `npm run build && npx wrangler deploy`. The site is at `https://define-company.<you>.workers.dev`.
4. For the daily workflow, add repository secrets `SEC_USER_AGENT`, `CLOUDFLARE_API_TOKEN`
   (a token with the "Edit Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID`.

To try the production setup locally: put `SEC_USER_AGENT=...` in `.dev.vars`, run
`npm run build`, then `npx wrangler dev`.

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
