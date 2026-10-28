// Cloudflare Worker: serves the built site and dataset as static assets, and
// proxies live EDGAR requests (companies not in the dataset, older 10-Ks).
// Only the /sec-* paths reach this code; see run_worker_first in wrangler.jsonc.
//
// EDGAR wants a User-Agent naming the operator with a contact email
// (https://www.sec.gov/os/accessing-edgar-data). Set it with:
//   npx wrangler secret put SEC_USER_AGENT

interface Env {
  ASSETS: Fetcher
  SEC_USER_AGENT: string
}

const UPSTREAMS: Record<string, string> = {
  '/sec-www': 'https://www.sec.gov',
  '/sec-data': 'https://data.sec.gov',
  '/sec-efts': 'https://efts.sec.gov',
}

/** How long Cloudflare may cache each kind of EDGAR response, in seconds. */
function cacheTtl(path: string): number {
  if (path.startsWith('/Archives/')) return 30 * 86400 // filed documents never change
  if (path.startsWith('/submissions/')) return 3600 // new filings show up here
  return 86400 // ticker list, name search
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const prefix = Object.keys(UPSTREAMS).find((p) => url.pathname.startsWith(`${p}/`))
    if (!prefix) return env.ASSETS.fetch(request)

    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
    if (!env.SEC_USER_AGENT) return new Response('SEC_USER_AGENT is not configured', { status: 500 })

    const path = url.pathname.slice(prefix.length)
    const upstream = await fetch(`${UPSTREAMS[prefix]}${path}${url.search}`, {
      headers: { 'User-Agent': env.SEC_USER_AGENT, 'Accept-Encoding': 'gzip, deflate' },
      cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': cacheTtl(path), '404': 300, '400-599': 0 } },
    })
    // Pass the body through as a stream; only the headers are rewritten.
    const response = new Response(upstream.body, upstream)
    response.headers.delete('Set-Cookie')
    return response
  },
} satisfies ExportedHandler<Env>
