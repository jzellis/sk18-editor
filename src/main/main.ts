import { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut, nativeImage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs'
import { spawn, ChildProcess } from 'child_process'
import { parseTheme, buildTheme, parseBlob, buildBlob } from '../shared/theme-io'
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
    win.loadURL('http://localhost:5200')
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
  // Parse blob into assets map: devicePath → base64 data
  const blobAssets = imageBlob.length > 0 ? parseBlob(imageBlob) : {}
  const assets: Record<string, string> = {}
  for (const [path, data] of Object.entries(blobAssets)) {
    assets[path] = data.toString('base64')
  }
  return { filePath, theme, assets }
})

// 2x2 opaque black PNG used to explicitly clear button positions on push.
// Device skips items with path:"" but WILL composite an actual image, clearing old icons.
const BLANK_ICON_PATH = '/image/SK18/cache/_blank.png'
const BLANK_ICON_B64: string = (() => {
  const pixels = Buffer.alloc(2 * 2 * 4, 0)
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255  // alpha=255, opaque black
  return nativeImage.createFromBitmap(pixels, { width: 2, height: 2 }).toPNG().toString('base64')
})()

function assetsToBlob(assets: Record<string, string>): Buffer {
  if (Object.keys(assets).length === 0) return Buffer.alloc(0)
  const bufAssets: Record<string, Buffer> = {}
  for (const [path, b64] of Object.entries(assets)) {
    bufAssets[path] = Buffer.from(b64, 'base64')
  }
  return buildBlob(bufAssets)
}

// Filter assets to only paths referenced by items in the theme (drop orphaned images).
function referencedAssets(theme: ThemeFile, assets: Record<string, string>): Record<string, string> {
  const paths = new Set<string>()
  for (const page of theme.pages) {
    for (const item of page.items) {
      if (item.path && typeof item.path === 'string') paths.add(item.path as string)
      if (item.paths && typeof item.paths === 'string') {
        for (const p of (item.paths as string).split(';')) { if (p) paths.add(p) }
      }
    }
  }
  const out: Record<string, string> = {}
  for (const [p, d] of Object.entries(assets)) { if (paths.has(p)) out[p] = d }
  return out
}

// Pad every page with empty stub items for unused grid positions so the device
// explicitly clears old icons at those positions (device doesn't clear on its own).
function fillEmptySlots(theme: ThemeFile): ThemeFile {
  const GRID_COLS = 6, GRID_ROWS = 3
  const X0 = 10, Y0 = 63, STEP = 218, W = 158, H = 158
  const CANVAS_W = 1280, CANVAS_H = 720
  const titleParam = JSON.stringify({
    FontFamily: 'Microsoft YaHei', FontSize: 24, FontStyle: '',
    FontUnderline: false, ShowImage: true, ShowTitle: false,
    TitleAlignment: 'bottom', TitleColor: '#ffffff'
  })
  return {
    ...theme,
    pages: theme.pages.map(page => {
      const occupied = new Set<string>()
      for (const item of page.items) {
        if (item.type === 115 && item.col != null && item.row != null)
          occupied.add(`${item.col},${item.row}`)
      }
      const stubs: any[] = []
      for (let pr = 0; pr < GRID_ROWS; pr++) {
        for (let pc = 0; pc < GRID_COLS; pc++) {
          const col = GRID_ROWS - 1 - pr, row = pc
          if (occupied.has(`${col},${row}`)) continue
          stubs.push({
            id: `stub-${pr}-${pc}`, type: 115,
            x: X0 + pc * STEP, y: Y0 + pr * STEP, w: W, h: H, z: 15,
            col, row, itemName: `control${pr * GRID_COLS + pc + 1}`,
            lock: '1', path: BLANK_ICON_PATH, paths: '', controlData: '', titleParam,
            maxWidth: CANVAS_W, maxHeight: CANVAS_H,
            scaledWidthTo: W, scaledHeightTo: H,
            opacity: 100, rotate: 0, scale: 1, soundFile: '', title: '',
          })
        }
      }
      return { ...page, items: [...page.items, ...stubs] }
    })
  }
}

// IPC: save .Theme file
ipcMain.handle('theme:save', async (_event, filePath: string, theme: ThemeFile, assets: Record<string, string>) => {
  const imageBlob = assetsToBlob(assets)
  const buf = buildTheme(theme, imageBlob.length > 0 ? imageBlob : undefined)
  writeFileSync(filePath, buf)
  return { ok: true }
})

// IPC: save .Theme file as (pick path)
ipcMain.handle('theme:saveAs', async (_event, theme: ThemeFile, assets: Record<string, string>) => {
  const result = await dialog.showSaveDialog({
    title: 'Save SK18 Theme',
    filters: [{ name: 'SK18 Theme', extensions: ['Theme'] }],
    defaultPath: 'My Theme.Theme'
  })
  if (result.canceled || !result.filePath) return null

  const imageBlob = assetsToBlob(assets)
  const buf = buildTheme(theme, imageBlob.length > 0 ? imageBlob : undefined)
  writeFileSync(result.filePath, buf)
  return { filePath: result.filePath }
})

function safeName(localPath: string, forceExt?: string): string {
  const basename = localPath.split('/').pop() || 'file'
  const noExt = basename.replace(/\.[^.]+$/, '')
  const ext = forceExt || basename.split('.').pop()?.toLowerCase() || 'png'
  return noExt.replace(/[^a-zA-Z0-9_\-]/g, '_') + '.' + ext
}

// IPC: pick image for a button icon — resize to 158x158, remove white bg, return PNG
ipcMain.handle('file:pickIcon', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select Button Icon',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    properties: ['openFile']
  })
  if (result.canceled || !result.filePaths[0]) return null
  const localPath = result.filePaths[0]

  const ni = nativeImage.createFromPath(localPath)
  if (ni.isEmpty()) return null

  // Resize to 158x158 (device renders button icons at native size)
  const resized = ni.resize({ width: 158, height: 158 })
  let bitmap = resized.toBitmap()  // raw BGRA, 158*158*4 bytes

  // If fully opaque (no alpha), remove near-white background
  let allOpaque = true
  for (let i = 3; i < bitmap.length; i += 4) {
    if (bitmap[i] < 255) { allOpaque = false; break }
  }
  if (allOpaque) {
    const buf = Buffer.from(bitmap)
    for (let i = 0; i < buf.length; i += 4) {
      if (buf[i+2] > 220 && buf[i+1] > 220 && buf[i] > 220) buf[i+3] = 0  // BGRA
    }
    bitmap = buf
  }

  const processed = nativeImage.createFromBitmap(Buffer.from(bitmap), { width: 158, height: 158 })
  const pngData = processed.toPNG()
  const devicePath = `/image/SK18/cache/${safeName(localPath, 'png')}`
  const dataB64 = pngData.toString('base64')
  return { devicePath, dataB64, previewUrl: `data:image/png;base64,${dataB64}` }
})

// IPC: pick background image or video for a page
ipcMain.handle('file:pickBackground', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select Background Image or Video',
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
      { name: 'Video (pre-transcoded 1280x720 H.264)', extensions: ['mp4', 'webm'] },
    ],
    properties: ['openFile']
  })
  if (result.canceled || !result.filePaths[0]) return null
  const localPath = result.filePaths[0]
  const ext = localPath.split('.').pop()?.toLowerCase() || 'png'
  const isVideo = ext === 'mp4' || ext === 'webm'
  const data = readFileSync(localPath)
  const dataB64 = data.toString('base64')
  const devicePath = isVideo
    ? `/image/1280x720/cache/${safeName(localPath)}`
    : `/image/SK18/cache/${safeName(localPath)}`
  const mime = isVideo ? `video/${ext}` : ext === 'gif' ? 'image/gif' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
  return { devicePath, dataB64, isVideo, mimeType: mime, previewUrl: `data:${mime};base64,${dataB64}` }
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

device.setOnMessage(msg => {
  const win = BrowserWindow.getAllWindows()[0]
  win?.webContents.send('device:message', msg)
})

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

ipcMain.handle('device:reloadTheme', async (_event, devicePath: string) => {
  try {
    await device.reloadTheme(devicePath)
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('device:sendSystemData', async (_event, data: Record<string, string>) => {
  try {
    await device.sendSystemData(data)
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('device:pushTheme', async (event, theme: ThemeFile, assets: Record<string, string>, devicePath: string) => {
  try {
    const pushTheme = fillEmptySlots(theme)
    const allAssets = { [BLANK_ICON_PATH]: BLANK_ICON_B64, ...assets }
    const imageBlob = assetsToBlob(referencedAssets(pushTheme, allAssets))
    const buf = buildTheme(pushTheme, imageBlob.length > 0 ? imageBlob : undefined)

    await device.pushTheme(buf, devicePath, (pct, msg) => {
      event.sender.send('device:progress', { pct, msg })
    })
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
})
