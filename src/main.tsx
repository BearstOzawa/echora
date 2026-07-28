import React from 'react'
import ReactDOM from 'react-dom/client'
import { resolveUiPlatform } from './platforms/uiPlatform'

document.addEventListener('contextmenu', (event) => event.preventDefault())

const platform = resolveUiPlatform()
document.documentElement.dataset.uiPlatform = platform

const renderApplication = ({ default: Application }: { default: React.ComponentType }) => {
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Application /></React.StrictMode>)
}

if (platform === 'mobile') void import('./platforms/mobile/MobileApplication').then(renderApplication)
else void import('./platforms/desktop/DesktopApplication').then(renderApplication)
