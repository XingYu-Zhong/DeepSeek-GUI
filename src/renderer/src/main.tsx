import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import './styles/base-shell.css'
import './styles/surfaces-write.css'
import './styles/markdown-code.css'
import './styles/write-editor.css'
import App from './App'
import './i18n'

document.documentElement.dataset.platform = window.dsGui?.platform ?? 'unknown'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
