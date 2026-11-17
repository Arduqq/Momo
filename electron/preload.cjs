const { ipcRenderer, contextBridge, webUtils } = require('electron')

contextBridge.exposeInMainWorld('momoFiles', {
  // File.path was removed in Electron 32+; this is the supported replacement.
  pathFor(file) {
    try { return webUtils.getPathForFile(file) } catch { return '' }
  },
})

contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args) {
    const [channel, ...rest] = args
    return ipcRenderer.off(channel, ...rest)
  },
  send(...args) {
    const [channel, ...rest] = args
    return ipcRenderer.send(channel, ...rest)
  },
  invoke(...args) {
    const [channel, ...rest] = args
    return ipcRenderer.invoke(channel, ...rest)
  },
})
