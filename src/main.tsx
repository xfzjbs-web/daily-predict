import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from './registerServiceWorker.ts'

const root = createRoot(document.getElementById('root')!)

root.render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registerServiceWorker((newVersion) => {
  // Dispatch a custom event so App can show the update banner
  window.dispatchEvent(new CustomEvent('app-updated', { detail: { version: newVersion } }))
})
