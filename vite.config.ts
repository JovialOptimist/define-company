import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'

// SEC EDGAR asks every client to identify itself with a User-Agent that names
// the app and a contact email (https://www.sec.gov/os/accessing-edgar-data).
// Browsers can't set User-Agent, and www.sec.gov/Archives doesn't send CORS
// headers, so all EDGAR requests go through this proxy.
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
    plugins: [react()],
    server: { proxy },
    preview: { proxy },
  }
})
