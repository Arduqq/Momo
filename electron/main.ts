import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import pkg from 'electron-updater'
const { autoUpdater } = pkg
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import Store from 'electron-store'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const store = new Store()

app.setName('Momo')

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ └── main.js
// │

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public')


let win: BrowserWindow | null

// 🛰️ IPC Handlers for Persistence & Settings
ipcMain.handle('get-store-value', (_event, key) => {
  return store.get(key)
})

ipcMain.handle('set-store-value', (_event, key, value) => {
  store.set(key, value)
})

ipcMain.handle('get-workspaces', () => {
  return store.get('workspaces', [])
})

ipcMain.handle('save-workspace', (_event, id, data) => {
  store.set(`workspace-data-${id}`, data)
  // Update last modified in list
  const workspaces: any[] = store.get('workspaces', []) as any[]
  const updated = workspaces.map(w => w.id === id ? { ...w, lastModified: Date.now() } : w)
  store.set('workspaces', updated)
  return true
})

ipcMain.handle('create-workspace', (_event, name) => {
  const workspaces: any[] = store.get('workspaces', []) as any[]
  const newWs = { id: Date.now().toString(), name, lastModified: Date.now() }
  store.set('workspaces', [...workspaces, newWs])
  return newWs
})

ipcMain.handle('delete-workspace', (_event, id) => {
  const workspaces: any[] = store.get('workspaces', []) as any[]
  store.set('workspaces', workspaces.filter(w => w.id !== id))
  store.delete(`workspace-data-${id}`)
  store.delete(`hidden-items-${id}`)
  return true
})

ipcMain.handle('get-hidden-items', (_event, workspaceId: string) => {
  return store.get(`hidden-items-${workspaceId}`, [])
})

ipcMain.handle('add-hidden-item', (_event, workspaceId: string, item: any) => {
  const hidden: any[] = store.get(`hidden-items-${workspaceId}`, []) as any[]
  if (!hidden.find((h: any) => h.key === item.key)) {
    store.set(`hidden-items-${workspaceId}`, [...hidden, item])
  }
  return true
})

ipcMain.handle('remove-hidden-item', (_event, workspaceId: string, key: string) => {
  const hidden: any[] = store.get(`hidden-items-${workspaceId}`, []) as any[]
  store.set(`hidden-items-${workspaceId}`, hidden.filter((h: any) => h.key !== key))
  return true
})

ipcMain.handle('rename-workspace', (_event, id: string, name: string) => {
  const workspaces: any[] = store.get('workspaces', []) as any[]
  store.set('workspaces', workspaces.map(w => w.id === id ? { ...w, name } : w))
  return true
})

ipcMain.handle('load-workspace', (_event, id) => {
  return store.get(`workspace-data-${id}`)
})

ipcMain.handle('save-bib-file', async (_event, content: string, defaultName: string) => {
  const result = await dialog.showSaveDialog({
    title: 'Export BibTeX',
    defaultPath: defaultName,
    filters: [{ name: 'BibTeX', extensions: ['bib'] }],
  })
  if (result.canceled || !result.filePath) return false
  fs.writeFileSync(result.filePath, content, 'utf-8')
  return true
})

ipcMain.handle('open-external', (_event, url: string) => {
  shell.openExternal(url)
})

ipcMain.handle('check-pdf-exists', (_event, attachmentKey: string) => {
  try {
    const dir = path.join(os.homedir(), 'Zotero', 'storage', attachmentKey)
    if (!fs.existsSync(dir)) return { exists: false }
    const pdf = fs.readdirSync(dir).find(f => f.toLowerCase().endsWith('.pdf'))
    return { exists: !!pdf }
  } catch {
    return { exists: false }
  }
})

ipcMain.handle('locate-pdf', async (_event, attachmentKey: string) => {
  const result = await dialog.showOpenDialog({
    title: 'Select PDF file',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: ['openFile'],
  })
  if (result.canceled || result.filePaths.length === 0) return false
  try {
    const src = result.filePaths[0]
    const destDir = path.join(os.homedir(), 'Zotero', 'storage', attachmentKey)
    fs.mkdirSync(destDir, { recursive: true })
    fs.copyFileSync(src, path.join(destDir, path.basename(src)))
    return true
  } catch {
    return false
  }
})

ipcMain.handle('get-workspace-background', (_event, workspaceId: string) => {
  return store.get(`background-${workspaceId}`, null)
})

ipcMain.handle('set-workspace-background', (_event, workspaceId: string, bg: any) => {
  store.set(`background-${workspaceId}`, bg)
  return true
})

ipcMain.handle('pick-background-image', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select Background Image',
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    properties: ['openFile'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('read-image-file', (_event, filePath: string) => {
  try {
    const buffer = fs.readFileSync(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
    return `data:${mime};base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
})

ipcMain.handle('read-zotero-pdf', (_event, attachmentKey: string) => {
  try {
    const dir = path.join(os.homedir(), 'Zotero', 'storage', attachmentKey)
    const files = fs.readdirSync(dir)
    const pdf = files.find(f => f.toLowerCase().endsWith('.pdf'))
    if (!pdf) return null
    return fs.readFileSync(path.join(dir, pdf))
  } catch {
    return null
  }
})

function createWindow() {
  const iconPath = path.join(__dirname, '../icon.png')
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(iconPath)
  win = new BrowserWindow({
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    width: 1200,
    height: 800,
    titleBarStyle: 'hiddenInset', // Better for macOS
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(process.env.DIST as string, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

ipcMain.handle('restart-and-update', () => {
  autoUpdater.quitAndInstall()
})

ipcMain.handle('start-update-download', () => {
  autoUpdater.downloadUpdate()
})

ipcMain.handle('check-for-updates', () => {
  if (app.isPackaged) autoUpdater.checkForUpdates()
})

ipcMain.handle('get-app-version', () => app.getVersion())

// Cache update info in case it arrives before the renderer is ready
let pendingUpdateInfo: { version: string; releaseNotes: string } | null = null

function setupAutoUpdater() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    const payload = {
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
    }
    if (win?.webContents && !win.webContents.isLoading()) {
      win.webContents.send('update-available', payload)
    } else {
      pendingUpdateInfo = payload
    }
  })

  autoUpdater.on('download-progress', (progress) => {
    win?.webContents.send('update-download-progress', { percent: Math.round(progress.percent) })
  })

  autoUpdater.on('update-downloaded', (info) => {
    win?.webContents.send('update-downloaded', { version: info.version })
  })

  autoUpdater.on('error', (err) => {
    console.error('[auto-updater] error:', err?.message)
  })
}

app.whenReady().then(() => {
  createWindow()

  if (app.isPackaged) {
    setupAutoUpdater()
    // Wait for renderer to finish loading before checking, so the
    // update-available payload is never lost to a race condition.
    win?.webContents.on('did-finish-load', () => {
      if (pendingUpdateInfo) {
        win?.webContents.send('update-available', pendingUpdateInfo)
        pendingUpdateInfo = null
      } else {
        setTimeout(() => autoUpdater.checkForUpdates(), 2000)
      }
    })
  }
})
