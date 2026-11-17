import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import pkg from 'electron-updater'
const { autoUpdater } = pkg
import path from 'node:path'
import fs from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import Store from 'electron-store'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const store = new Store()

app.setName('Momo')

// Rolling daily backup of the whole store (workspaces, notes, settings). Keeps 7.
function backupStore() {
  try {
    const src = store.path
    if (!fs.existsSync(src)) return
    const dir = path.join(path.dirname(src), 'backups')
    fs.mkdirSync(dir, { recursive: true })
    const dest = path.join(dir, `config-${new Date().toISOString().slice(0, 10)}.json`)
    if (!fs.existsSync(dest)) fs.copyFileSync(src, dest)
    const old = fs.readdirSync(dir).filter(f => /^config-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -7)
    old.forEach(f => fs.unlinkSync(path.join(dir, f)))
  } catch (e: any) {
    console.error('[backup] failed:', e?.message)
  }
}
backupStore()

ipcMain.handle('open-backups-folder', () => {
  shell.openPath(path.join(path.dirname(store.path), 'backups'))
})

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
  const known: any[] = store.get('workspaces', []) as any[]
  if (!known.some(w => w.id === id)) return false // workspace was deleted; don't re-create its data
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
  try {
    const { protocol } = new URL(url)
    if (!['http:', 'https:', 'mailto:', 'file:'].includes(protocol)) return false
    shell.openExternal(url)
    return true
  } catch {
    return false
  }
})

function zoteroStorageDir(attachmentKey: string) {
  // Zotero stores files in ~/Zotero/storage on both macOS and Windows
  return path.join(os.homedir(), 'Zotero', 'storage', attachmentKey)
}

ipcMain.handle('check-pdf-exists', (_event, attachmentKey: string) => {
  try {
    const dir = zoteroStorageDir(attachmentKey)
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
    const destDir = zoteroStorageDir(attachmentKey)
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
    if (!/\.(png|jpe?g|webp)$/i.test(filePath)) return null
    const buffer = fs.readFileSync(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
    return `data:${mime};base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
})

const FETCH_MAX_BYTES = 2 * 1024 * 1024

ipcMain.handle('fetch-url', async (_event, url: string) => {
  try {
    if (!/^https?:\/\//i.test(url)) return null
    const { default: https } = await import('node:https')
    const { default: http } = await import('node:http')
    const mod: any = url.startsWith('https:') ? https : http
    return await new Promise<{ status: number; body: string } | null>((resolve) => {
      const req = mod.get(url, { headers: { 'User-Agent': 'Momo/1.0' } }, (res: any) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          body += chunk
          if (body.length > FETCH_MAX_BYTES) { req.destroy(); resolve({ status: res.statusCode ?? 200, body: body.slice(0, FETCH_MAX_BYTES) }) }
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 200, body }))
      })
      req.on('error', () => resolve(null))
      req.setTimeout(8000, () => { req.destroy(); resolve(null) })
    })
  } catch {
    return null
  }
})

ipcMain.handle('import-pdf', (_event, { srcPath, fileData, attachmentKey, filename }: { srcPath?: string; fileData?: Uint8Array; attachmentKey: string; filename: string }) => {
  try {
    const destDir = zoteroStorageDir(attachmentKey)
    fs.mkdirSync(destDir, { recursive: true })
    if (fileData) {
      fs.writeFileSync(path.join(destDir, filename), Buffer.from(fileData))
    } else if (srcPath) {
      fs.copyFileSync(srcPath, path.join(destDir, filename))
    }
    return true
  } catch (e: any) {
    console.error('[import-pdf]', e?.message)
    return false
  }
})

ipcMain.handle('download-zotero-pdf', async (_event, { userId, apiKey, attachmentKey }: { userId: string; apiKey: string; attachmentKey: string }) => {
  try {
    const { default: https } = await import('node:https')
    const { default: http } = await import('node:http')

    // Fetch attachment metadata to get the filename
    const metaBody: string = await new Promise((resolve, reject) => {
      const req = https.get(
        `https://api.zotero.org/users/${userId}/items/${attachmentKey}`,
        { headers: { 'Zotero-API-Key': apiKey } },
        (res: any) => {
          let body = ''
          res.setEncoding('utf8')
          res.on('data', (chunk: string) => { body += chunk })
          res.on('end', () => resolve(body))
        }
      )
      req.on('error', reject)
      req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout fetching metadata')) })
    })
    const meta = JSON.parse(metaBody)
    const filename: string = meta?.data?.filename || `${attachmentKey}.pdf`

    // Download the file, following redirects (Zotero redirects to S3/CDN)
    const downloadBinary = (url: string, redirectsLeft = 5): Promise<Buffer> =>
      new Promise((resolve, reject) => {
        const mod: any = url.startsWith('https:') ? https : http
        const headers: Record<string, string> = url.includes('api.zotero.org') ? { 'Zotero-API-Key': apiKey } : {}
        const req = mod.get(url, { headers }, (res: any) => {
          if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
            if (redirectsLeft <= 0) { reject(new Error('Too many redirects')); return }
            downloadBinary(res.headers.location, redirectsLeft - 1).then(resolve, reject)
            return
          }
          if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return }
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
          res.on('end', () => resolve(Buffer.concat(chunks)))
        })
        req.on('error', reject)
        req.setTimeout(60000, () => { req.destroy(); reject(new Error('Download timeout')) })
      })

    const fileData = await downloadBinary(`https://api.zotero.org/users/${userId}/items/${attachmentKey}/file`)
    const destDir = zoteroStorageDir(attachmentKey)
    fs.mkdirSync(destDir, { recursive: true })
    fs.writeFileSync(path.join(destDir, filename), fileData)
    return { success: true, filename }
  } catch (e: any) {
    return { success: false, error: e?.message ?? 'Unknown error' }
  }
})

ipcMain.handle('read-zotero-pdf', (_event, attachmentKey: string) => {
  try {
    const dir = zoteroStorageDir(attachmentKey)
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
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
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

// macOS builds are not signed with a Developer ID, so Squirrel.Mac refuses to
// install updates in place. On macOS we download the .dmg ourselves and hand it
// to the user to drag into Applications. Windows uses electron-updater normally.
const MANUAL_UPDATE = process.platform === 'darwin'
const RELEASE_BASE = 'https://github.com/Arduqq/Momo/releases/download'
let latestUpdate: { version: string; fileName: string } | null = null
let downloadedInstaller: string | null = null

function downloadFile(url: string, dest: string, onProgress: (percent: number) => void, redirectsLeft = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Momo-updater' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0) && res.headers.location) {
        res.resume()
        if (redirectsLeft <= 0) { reject(new Error('Too many redirects')); return }
        downloadFile(res.headers.location, dest, onProgress, redirectsLeft - 1).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return }
      const total = parseInt(res.headers['content-length'] ?? '0', 10)
      let received = 0
      const tmp = dest + '.part'
      const out = fs.createWriteStream(tmp)
      res.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (total) onProgress(Math.round((received / total) * 100))
      })
      res.pipe(out)
      out.on('finish', () => { fs.renameSync(tmp, dest); resolve() })
      out.on('error', reject)
      res.on('error', reject)
    }).on('error', reject)
  })
}

ipcMain.handle('restart-and-update', async () => {
  if (MANUAL_UPDATE) {
    if (downloadedInstaller) await shell.openPath(downloadedInstaller)
    app.quit()
    return
  }
  autoUpdater.quitAndInstall()
})

ipcMain.handle('start-update-download', async () => {
  if (!MANUAL_UPDATE) { autoUpdater.downloadUpdate(); return }
  if (!latestUpdate) return
  try {
    const dest = path.join(app.getPath('downloads'), latestUpdate.fileName)
    await downloadFile(
      `${RELEASE_BASE}/v${latestUpdate.version}/${latestUpdate.fileName}`,
      dest,
      (percent) => win?.webContents.send('update-download-progress', { percent }),
    )
    downloadedInstaller = dest
    win?.webContents.send('update-downloaded', { version: latestUpdate.version, manual: true })
  } catch (e: any) {
    console.error('[updater] manual download failed:', e?.message)
    win?.webContents.send('update-error', { message: e?.message ?? 'Download failed' })
  }
})

ipcMain.handle('check-for-updates', () => {
  if (app.isPackaged) autoUpdater.checkForUpdates()
})

ipcMain.handle('get-app-version', () => app.getVersion())

ipcMain.handle('get-update-permission', () => {
  const val = store.get('auto-update-permission', null)
  return val  // null = never asked, true = allowed, false = declined
})

ipcMain.handle('set-update-permission', (_event, allowed: boolean) => {
  store.set('auto-update-permission', allowed)
  if (allowed && app.isPackaged) autoUpdater.checkForUpdates()
})

// Cache update info in case it arrives before the renderer is ready
let pendingUpdateInfo: { version: string; releaseNotes: string } | null = null

function setupAutoUpdater() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = !MANUAL_UPDATE

  autoUpdater.on('update-available', (info) => {
    const dmg = info.files?.find(f => f.url.toLowerCase().endsWith('.dmg'))?.url ?? info.path
    latestUpdate = { version: info.version, fileName: path.basename(dmg ?? `Momo-${info.version}-arm64.dmg`) }
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
    win?.webContents.send('update-error', { message: err?.message ?? 'Update failed' })
  })
}

app.whenReady().then(() => {
  createWindow()

  if (app.isPackaged) {
    setupAutoUpdater()
    win?.webContents.on('did-finish-load', () => {
      if (pendingUpdateInfo) {
        win?.webContents.send('update-available', pendingUpdateInfo)
        pendingUpdateInfo = null
        return
      }
      const permission = store.get('auto-update-permission', null)
      if (permission === null) {
        // First launch — ask the user for permission
        win?.webContents.send('ask-update-permission')
      } else if (permission === true) {
        setTimeout(() => autoUpdater.checkForUpdates(), 2000)
      }
      // false = user declined, do nothing
    })
  }
})
