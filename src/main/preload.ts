import { contextBridge, ipcRenderer } from 'electron'
import type { ThemeFile } from '../shared/types'

contextBridge.exposeInMainWorld('sk18', {
  openTheme: () => ipcRenderer.invoke('theme:open'),
  saveTheme: (filePath: string, theme: ThemeFile, blobB64: string) =>
    ipcRenderer.invoke('theme:save', filePath, theme, blobB64),
  saveThemeAs: (theme: ThemeFile, blobB64: string) =>
    ipcRenderer.invoke('theme:saveAs', theme, blobB64),
  pickMedia: () => ipcRenderer.invoke('file:pickMedia'),
  pickDirectory: () => ipcRenderer.invoke('file:pickDirectory'),
  readDataUrl: (filePath: string) => ipcRenderer.invoke('file:readDataUrl', filePath),
  listDir: (dirPath: string) => ipcRenderer.invoke('file:listDir', dirPath),
  showInFolder: (filePath: string) => ipcRenderer.invoke('file:showInFolder', filePath),

  // Device serial
  deviceFindPort: () => ipcRenderer.invoke('device:findPort'),
  deviceConnect: (portPath: string) => ipcRenderer.invoke('device:connect', portPath),
  deviceDisconnect: () => ipcRenderer.invoke('device:disconnect'),
  deviceIsConnected: () => ipcRenderer.invoke('device:isConnected'),
  deviceListThemes: () => ipcRenderer.invoke('device:listThemes'),
  devicePushTheme: (theme: ThemeFile, blobB64: string, devicePath: string) =>
    ipcRenderer.invoke('device:pushTheme', theme, blobB64, devicePath),
  onDeviceProgress: (cb: (data: { pct: number; msg: string }) => void) => {
    ipcRenderer.on('device:progress', (_e, data) => cb(data))
    return () => ipcRenderer.removeAllListeners('device:progress')
  },
  onDeviceHotplug: (cb: (data: { portPath: string; status: string; info?: unknown; error?: string }) => void) => {
    ipcRenderer.on('device:hotplug', (_e, data) => cb(data))
    return () => ipcRenderer.removeAllListeners('device:hotplug')
  }
})
