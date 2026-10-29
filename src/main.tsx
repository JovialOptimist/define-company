import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/libre-franklin'
import '@fontsource-variable/newsreader'
import '@fontsource-variable/newsreader/wght-italic.css'
import '@fontsource-variable/playfair-display'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
