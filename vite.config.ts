import react from '@vitejs/plugin-react'
import { cpSync, existsSync, readFileSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite'

const DATA_DIR = process.env.DATA_DIR ?? 'data'

/**
 * The precomputed dataset (data/, built by scripts/backfill.ts) is served at
 * /data in dev and copied into dist/data on build. It's kept out of public/
 * because it lives on its own git branch.
 */
function dataset(): Plugin {
  return {
    name: 'dataset',
    configureServer(server) {
      server.middlewares.use('/data', (req, res) => {
        const path = join(DATA_DIR, normalize(decodeURIComponent(req.url ?? '/').split('?')[0]))
        if (!path.startsWith(normalize(DATA_DIR)) || !existsSync(path) || !statSync(path).isFile()) {
          res.statusCode = 404
          return res.end()
        }
        res.setHeader('Content-Type', 'application/json')
        res.end(readFileSync(path))
      })
    },
    closeBundle() {
      if (!existsSync(DATA_DIR)) return
      cpSync(DATA_DIR, 'dist/data', {
        recursive: true,
        // data/ is a checkout of the data branch: skip git internals and scratch files.
        filter: (src) => !/[\\/](\.git|\.tmp)([\\/]|$)|[\\/]\.gitignore$|problems\.tsv$/.test(src),
      })
    },
  }
}

// SEC EDGAR asks every client to identify itself with a User-Agent that names
// the app and a contact email (https://www.sec.gov/os/accessing-edgar-data).
// Browsers can't set User-Agent, and www.sec.gov/Archives doesn't send CORS
// headers, so all EDGAR requests go through a proxy: this one in dev, and the
// Cloudflare Worker (worker/index.ts) in production.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const userAgent = env.SEC_USER_AGENT || 'define-company admin@example.com'

  const sec = (target: string, prefix: string): ProxyOptions => ({
    target,
    changeOrigin: true,
    headers: { 'User-Agent': userAgent },
    rewrite: (path) => path.slice(prefix.length),
  })

  const proxy = {
    '/sec-www': sec('https://www.sec.gov', '/sec-www'),
    '/sec-data': sec('https://data.sec.gov', '/sec-data'),
    '/sec-efts': sec('https://efts.sec.gov', '/sec-efts'),
  }

  return {
    plugins: [react(), dataset()],
    server: { proxy },
    preview: { proxy },
  }
})
