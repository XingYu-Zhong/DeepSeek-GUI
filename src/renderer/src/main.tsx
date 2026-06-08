import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import './styles/base-shell.css'
import './styles/surfaces-write.css'
import './styles/markdown-code.css'
import './styles/write-editor.css'
import App from './App'
import { initBackgroundImage } from './components/BackgroundLayer'
import './i18n'

document.documentElement.dataset.platform = window.dsGui?.platform ?? 'unknown'

// Initialize background before React mounts — stays alive across all route changes
try { initBackgroundImage() } catch (_) {}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
