const { ipcRenderer, contextBridge } = require('electron')

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
