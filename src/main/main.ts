import { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs'
import { spawn, ChildProcess } from 'child_process'
import { parseTheme, buildTheme } from '../shared/theme-io'
import type { ThemeFile } from '../shared/types'
import { SK18Serial, findSK18Port } from './serial'

const isDev = process.env.NODE_ENV === 'development'

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'SK18 Theme Editor',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
    // F12 opens DevTools detached so it doesn't shrink the app window
    globalShortcut.register('F12', () => {
      win.webContents.openDevTools({ mode: 'detach' })
    })
  } else {
    win.loadFile(join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// IPC: open .Theme file
ipcMain.handle('theme:open', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open SK18 Theme',
    filters: [{ name: 'SK18 Theme', extensions: ['Theme'] }],
    properties: ['openFile']
  })
  if (result.canceled || !result.filePaths[0]) return null

  const filePath = result.filePaths[0]
  const buf = readFileSync(filePath)
  const { theme, imageBlob } = parseTheme(buf)
  return {
    filePath,
    theme,
    imageBlobB64: imageBlob.length > 0 ? imageBlob.toString('base64') : ''
  }
})

// IPC: save .Theme file
ipcMain.handle('theme:save', async (_event, filePath: string, theme: ThemeFile, imageBlobB64: string) => {
  const imageBlob = imageBlobB64 ? Buffer.from(imageBlobB64, 'base64') : Buffer.alloc(0)
  const buf = buildTheme(theme, imageBlob)
  writeFileSync(filePath, buf)
  return { ok: true }
})

// IPC: save .Theme file as (pick path)
ipcMain.handle('theme:saveAs', async (_event, theme: ThemeFile, imageBlobB64: string) => {
  const result = await dialog.showSaveDialog({
    title: 'Save SK18 Theme',
    filters: [{ name: 'SK18 Theme', extensions: ['Theme'] }],
    defaultPath: 'My Theme.Theme'
  })
  if (result.canceled || !result.filePath) return null

  const imageBlob = imageBlobB64 ? Buffer.from(imageBlobB64, 'base64') : Buffer.alloc(0)
  const buf = buildTheme(theme, imageBlob)
  writeFileSync(result.filePath, buf)
  return { filePath: result.filePath }
})

// IPC: pick image/video file for a widget
ipcMain.handle('file:pickMedia', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select Image or Video',
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
      { name: 'Video', extensions: ['mp4', 'webm'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
})

// IPC: pick directory for frame animation
ipcMain.handle('file:pickDirectory', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select Frame Directory',
    properties: ['openDirectory']
  })
  if (result.canceled || !result.filePaths[0]) return null
  const dir = result.filePaths[0]
  // Count frames
  const frames = readdirSync(dir)
    .filter(f => /^frame_\d+\.(png|jpg)$/i.test(f))
    .sort()
  return { dir, frameCount: frames.length }
})

// IPC: read file as data URL for preview
ipcMain.handle('file:readDataUrl', async (_event, filePath: string) => {
  if (!filePath || !existsSync(filePath)) return null
  const buf = readFileSync(filePath)
  const ext = filePath.split('.').pop()?.toLowerCase() || 'png'
  const mime = ext === 'gif' ? 'image/gif'
    : ext === 'mp4' ? 'video/mp4'
    : ext === 'webm' ? 'video/webm'
    : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : 'image/png'
  return `data:${mime};base64,${buf.toString('base64')}`
})

// IPC: list files in directory
ipcMain.handle('file:listDir', async (_event, dirPath: string) => {
  if (!dirPath || !existsSync(dirPath)) return []
  return readdirSync(dirPath).map(name => ({
    name,
    isDir: statSync(join(dirPath, name)).isDirectory()
  }))
})

// IPC: open file in system file manager
ipcMain.handle('file:showInFolder', async (_event, filePath: string) => {
  shell.showItemInFolder(filePath)
})

// --- Device serial IPC ---
const device = new SK18Serial()

// USB hotplug: watch udev for tty add events, connect immediately when SK18 appears.
// Timing is critical — device serial listener only opens briefly after boot.
// udev gives near-instant notification vs polling which adds up to 500ms delay.
let udevProc: ChildProcess | null = null
let hotplugConnecting = false

async function triggerConnect(portPath: string) {
  if (hotplugConnecting || device.isConnected()) return
  hotplugConnecting = true
  const win = BrowserWindow.getAllWindows()[0]
  win?.webContents.send('device:hotplug', { portPath, status: 'connecting' })
  try {
    const info = await device.connect(portPath)
    win?.webContents.send('device:hotplug', { portPath, status: 'connected', info })
  } catch (err: any) {
    win?.webContents.send('device:hotplug', { portPath, status: 'error', error: err.message })
  } finally {
    hotplugConnecting = false
  }
}

function startHotplug() {
  udevProc = spawn('udevadm', ['monitor', '--udev', '--subsystem-match=tty'])
  let udevBuf = ''
  udevProc.stdout?.on('data', async (data: Buffer) => {
    udevBuf += data.toString()
    const lines = udevBuf.split('\n')
    udevBuf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.includes(' add ')) continue
      // A tty device appeared — check if it's our SK18
      const portPath = await findSK18Port()
      if (portPath) triggerConnect(portPath)
    }
  })
  udevProc.on('error', () => {
    // udevadm unavailable — fall back to 500ms polling
    const timer = setInterval(async () => {
      if (hotplugConnecting || device.isConnected()) return
      const portPath = await findSK18Port()
      if (portPath) triggerConnect(portPath)
    }, 500)
    app.on('will-quit', () => clearInterval(timer))
  })
}

app.whenReady().then(startHotplug)
app.on('will-quit', () => udevProc?.kill())

ipcMain.handle('device:findPort', async () => {
  return findSK18Port()
})

ipcMain.handle('device:connect', async (_event, portPath: string) => {
  try {
    const info = await device.connect(portPath)
    return { ok: true, info }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('device:disconnect', () => {
  device.disconnect()
  return { ok: true }
})

ipcMain.handle('device:isConnected', () => device.isConnected())

ipcMain.handle('device:listThemes', async () => {
  try {
    const themes = await device.listThemes()
    return { ok: true, themes }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('device:pushTheme', async (event, theme: ThemeFile, imageBlobB64: string, devicePath: string) => {
  try {
    const imageBlob = imageBlobB64 ? Buffer.from(imageBlobB64, 'base64') : Buffer.alloc(0)
    const buf = buildTheme(theme, imageBlob)

    await device.pushTheme(buf, devicePath, (pct, msg) => {
      event.sender.send('device:progress', { pct, msg })
    })
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
})
