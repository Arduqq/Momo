import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Force tldraw to use English before it reads its user preferences from localStorage.
// tldraw validates the stored object and requires an `id` field — without it the
// validator rejects the payload and falls back to navigator.language (German here).
try {
  const KEY = 'TLDRAW_USER_DATA_v3'
  const prefs = JSON.parse(localStorage.getItem(KEY) || '{}')
  localStorage.setItem(KEY, JSON.stringify({
    id: prefs.id ?? 'user:momo',  // required by tldraw's validator
    ...prefs,
    locale: 'en',
  }))
} catch { /* localStorage not available */ }

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Use contextBridge
window.ipcRenderer.on('main-process-message', (_event, message) => {
  console.log(message)
})
