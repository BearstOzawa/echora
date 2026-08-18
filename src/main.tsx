import React from 'react'
import ReactDOM from 'react-dom/client'
import { resolveUiPlatform } from './platforms/uiPlatform'
import Application from './platforms/Application'

declare global {
  interface Window {
    __ECHORA_BOOT__?: {
      ready: () => void
      fail: () => void
    }
  }
}

document.addEventListener('contextmenu', (event) => event.preventDefault())

const platform = resolveUiPlatform()
document.documentElement.dataset.uiPlatform = platform

function ReadyApplication() {
  React.useEffect(() => window.__ECHORA_BOOT__?.ready(), [])
  return <Application />
}

const renderApplication = () => {
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><React.Suspense fallback={null}><ReadyApplication /></React.Suspense></React.StrictMode>)
}

try {
  renderApplication()
} catch (error: unknown) {
  console.error('Echora application resources failed to load', error)
  window.__ECHORA_BOOT__?.fail()
}
