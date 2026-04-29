import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
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

app.whenReady().then(() => {
  createWindow()
  if (app.isPackaged) {
    autoUpdater.on('update-downloaded', () => {
      win?.webContents.send('update-downloaded')
    })
    autoUpdater.checkForUpdatesAndNotify()
  }
})
