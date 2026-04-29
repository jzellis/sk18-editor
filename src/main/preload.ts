import { contextBridge, ipcRenderer } from 'electron'
import type { ThemeFile } from '../shared/types'

contextBridge.exposeInMainWorld('sk18', {
  openTheme: () => ipcRenderer.invoke('theme:open'),
  saveTheme: (filePath: string, theme: ThemeFile, assets: Record<string, string>) =>
    ipcRenderer.invoke('theme:save', filePath, theme, assets),
  saveThemeAs: (theme: ThemeFile, assets: Record<string, string>) =>
    ipcRenderer.invoke('theme:saveAs', theme, assets),
  pickMedia: () => ipcRenderer.invoke('file:pickMedia'),
  pickIcon: () => ipcRenderer.invoke('file:pickIcon'),
  pickBackground: () => ipcRenderer.invoke('file:pickBackground'),
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
  devicePushTheme: (theme: ThemeFile, assets: Record<string, string>, devicePath: string) =>
    ipcRenderer.invoke('device:pushTheme', theme, assets, devicePath),
  onDeviceProgress: (cb: (data: { pct: number; msg: string }) => void) => {
    ipcRenderer.on('device:progress', (_e, data) => cb(data))
    return () => ipcRenderer.removeAllListeners('device:progress')
  },
  onDeviceHotplug: (cb: (data: { portPath: string; status: string; info?: unknown; error?: string }) => void) => {
    ipcRenderer.on('device:hotplug', (_e, data) => cb(data))
    return () => ipcRenderer.removeAllListeners('device:hotplug')
  },
  onDeviceMessage: (cb: (msg: Record<string, unknown>) => void) => {
    ipcRenderer.on('device:message', (_e, msg) => cb(msg))
    return () => ipcRenderer.removeAllListeners('device:message')
  },
  deviceReloadTheme: (devicePath: string) =>
    ipcRenderer.invoke('device:reloadTheme', devicePath),
  deviceSendSystemData: (data: Record<string, string>) =>
    ipcRenderer.invoke('device:sendSystemData', data),
})
