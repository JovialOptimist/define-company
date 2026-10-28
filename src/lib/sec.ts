import { createEdgar } from './edgar'

// Browser requests go through the Vite proxy (see vite.config.ts), which adds
// the User-Agent EDGAR requires and gets around missing CORS headers.
export const edgar = createEdgar({ www: '/sec-www', data: '/sec-data', efts: '/sec-efts' })
