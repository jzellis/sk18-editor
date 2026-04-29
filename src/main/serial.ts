import { SerialPort } from 'serialport'
import { appendFileSync } from 'fs'

const LOG_FILE = '/tmp/sk18_serial.log'
function log(msg: string) {
  const line = `${new Date().toISOString()} ${msg}\n`
  process.stderr.write(line)
  try { appendFileSync(LOG_FILE, line) } catch {}
}

// CRC32 using Node.js built-in (same table as CRC32.cpp - standard IEEE polynomial)
function crc32(buf: Buffer): number {
  // Node v25+ has zlib.crc32
  const z = (require('zlib') as any)
  if (z.crc32) return z.crc32(buf) >>> 0
  // Fallback: manual table
  return crc32Manual(buf)
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[i] = c
  }
  return t
})()

function crc32Manual(buf: Buffer): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF]! ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

const FRAME_MAGIC = Buffer.from([0xA1, 0xA5, 0x5A, 0x5E])
const CMD_JSON = 101
const CMD_SEND_SYSTEM_DATA = 85
const CHUNK_SIZE = 64 * 1024

// Protocol B (FIXEDCMDHEAD) — used by the full ScreenKey app for theme switching
const FIXEDCMD_PREFIX = Buffer.from('AA551234 FIXEDCMDHEAD ')

function buildFixedCmd(cmd: number, msgType: number, payload: Buffer): Buffer {
  const size = Buffer.alloc(4); size.writeUInt32LE(payload.length, 0)
  const crc  = Buffer.alloc(4); crc.writeUInt32LE(crc32(payload), 0)
  const cmdBuf  = Buffer.alloc(4); cmdBuf.writeUInt32LE(cmd, 0)
  const typeBuf = Buffer.alloc(4); typeBuf.writeUInt32LE(msgType, 0)
  return Buffer.concat([FIXEDCMD_PREFIX, cmdBuf, typeBuf, size, crc, payload])
}

// QMap<QString,QString>: uint32BE count + alternating key/value QStrings
function qmapStrings(map: Record<string, string>): Buffer {
  const entries = Object.entries(map)
  const parts: Buffer[] = []
  const count = Buffer.alloc(4); count.writeUInt32BE(entries.length, 0)
  parts.push(count)
  for (const [k, v] of entries) {
    parts.push(qstringPayload(k))
    parts.push(qstringPayload(v))
  }
  return Buffer.concat(parts)
}

// QDataStream big-endian QString encoding: uint32BE byte-count + UTF-16BE chars
function qstringPayload(s: string): Buffer {
  const be = Buffer.alloc(s.length * 2)
  for (let i = 0; i < s.length; i++) be.writeUInt16BE(s.charCodeAt(i), i * 2)
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(be.length, 0)
  return Buffer.concat([lenBuf, be])
}

let frameId = 0

function buildFrame(cmd: number, payload: Buffer): Buffer {
  const id = ++frameId
  const size = payload.length

  const idBuf = Buffer.alloc(4); idBuf.writeUInt32LE(id, 0)
  const cmdBuf = Buffer.alloc(4); cmdBuf.writeUInt32LE(cmd, 0)
  const sizeBuf = Buffer.alloc(4); sizeBuf.writeUInt32LE(size, 0)
  const sizeCrcBuf = Buffer.alloc(4); sizeCrcBuf.writeUInt32LE(crc32(sizeBuf), 0)
  const dataCrcBuf = Buffer.alloc(4); dataCrcBuf.writeUInt32LE(crc32(payload), 0)

  return Buffer.concat([FRAME_MAGIC, idBuf, cmdBuf, sizeBuf, sizeCrcBuf, payload, dataCrcBuf])
}

function buildJsonFrame(obj: object): Buffer {
  return buildFrame(CMD_JSON, Buffer.from(JSON.stringify(obj), 'utf8'))
}

export interface DeviceInfo {
  deviceModel?: string
  deviceWidth?: number
  deviceHeight?: number
  [key: string]: unknown
}

export interface ThemeFileEntry {
  filePath: string
  crc: string
}

type PendingResolver = (data: Record<string, unknown>) => void
type MessageHandler = (msg: Record<string, unknown>) => void

export class SK18Serial {
  private port: SerialPort | null = null
  private rxBuf = Buffer.alloc(0)
  private pending: Map<string, PendingResolver> = new Map()
  private onProgress: ((pct: number, msg: string) => void) | null = null
  private onMessage: MessageHandler | null = null

  setOnMessage(cb: MessageHandler | null) { this.onMessage = cb }

  async connect(portPath: string): Promise<DeviceInfo> {
    if (this.port) {
      try { if (this.port.isOpen) this.port.close() } catch {}
      this.port = null
    }
    this.pending.clear()

    this.port = new SerialPort({
      path: portPath, baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none',
      rtscts: false, autoOpen: false
    })

    await new Promise<void>((resolve, reject) => {
      this.port!.open(err => err ? reject(err) : resolve())
    })

    // Wait 1s for the device serial listener to be fully ready after USB enumeration.
    // Connecting immediately on hotplug can cause writes to block if the firmware
    // hasn't opened its serial endpoint yet.
    await new Promise<void>(res => setTimeout(res, 1000))

    this.rxBuf = Buffer.alloc(0)
    this.port.on('data', (chunk: Buffer) => this.onData(chunk))
    this.port.on('error', (err: Error) => log(`SK18 serial error: ${err.message}`))

    await this.write1MB()
    // Discard any data received during the 1MB phase (device may send proactive
    // FIXEDCMDHEAD messages during init that would corrupt frame parsing).
    this.rxBuf = Buffer.alloc(0)

    const getInfoFrame = buildJsonFrame({ method: 'getInfo' })
    log(`SK18 TX getInfo`)
    await new Promise<void>((resolve, reject) => {
      this.port!.write(getInfoFrame, err => err ? reject(err) : resolve())
    })
    log('SK18 getInfo sent, waiting for response...')

    const response = await this.waitFor('getInfo', 10000)
    return (response.result as DeviceInfo) || {}
  }

  disconnect() {
    if (this.port?.isOpen) this.port.close()
    this.port = null
    this.pending.clear()
  }

  isConnected(): boolean {
    return !!this.port?.isOpen
  }

  async listThemes(): Promise<ThemeFileEntry[]> {
    const frame = buildJsonFrame({
      method: 'getFilesBySuffix',
      parameters: { suffixs: ['Theme'] }
    })
    this.send(frame)
    const response = await this.waitFor('getFilesBySuffix', 5000)
    const result = response.result as { filePaths?: ThemeFileEntry[] }
    return result?.filePaths || []
  }

  async pushTheme(themeData: Buffer, devicePath: string, onProgress?: (pct: number, msg: string) => void): Promise<void> {
    this.onProgress = onProgress || null
    const totalSize = themeData.length
    let seek = 0

    this.onProgress?.(0, `Uploading ${(totalSize / 1024 / 1024).toFixed(1)} MB...`)

    while (seek < totalSize) {
      const chunk = themeData.slice(seek, seek + CHUNK_SIZE)
      const frame = buildJsonFrame({
        method: 'saveToFile',
        parameters: {
          filePath: devicePath,
          seek,
          data: chunk.toString('base64')
        }
      })
      this.send(frame)

      const response = await this.waitFor('saveToFile', 60000)
      if (!response.success) {
        throw new Error(`saveToFile failed at seek ${seek}: ${response.errorString || 'unknown error'}`)
      }

      seek += chunk.length
      const pct = Math.round((seek / totalSize) * 80)
      this.onProgress?.(pct, `Uploading... ${pct}%`)
    }

    // Verify CRC — device updates file_info.json automatically on success
    this.onProgress?.(85, 'Verifying...')
    const fileCrc = crc32(themeData)
    const crcFrame = buildJsonFrame({
      method: 'setFileCRC',
      parameters: { filePath: devicePath, crc: String(fileCrc) }
    })
    this.send(crcFrame)
    const crcResp = await this.waitFor('setFileCRC', 10000)
    if (crcResp.success === false) {
      throw new Error(`setFileCRC failed: ${crcResp.errorString || 'CRC mismatch'}`)
    }

    this.onProgress?.(95, 'Switching theme...')
    await this.switchThemeProtocolB(devicePath)

    this.onProgress?.(100, 'Done')
  }

  // Protocol B handshake: arms page switching, sets active theme, persists across reboot.
  // Must be called after a successful saveToFile + setFileCRC upload.
  async switchThemeProtocolB(devicePath: string): Promise<void> {
    const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms))
    const pathBytes = Buffer.from(devicePath, 'utf8')

    log(`SK18 Protocol B switch: "${devicePath}"`)
    this.send(buildFixedCmd(0, 0, Buffer.alloc(0)))   // type=0: device info request
    await sleep(300)
    this.send(buildFixedCmd(0, 15, Buffer.from(JSON.stringify({ connect: true }), 'utf8')))
    await sleep(500)
    this.send(buildFixedCmd(0, 2, pathBytes))          // type=2: set active theme (updates config.json)
    await sleep(2000)
    this.send(buildFixedCmd(0, 9, qmapStrings({ canvasflip: '1' })))
    await sleep(500)
    log(`SK18 Protocol B switch complete`)
  }

  async reloadTheme(devicePath: string): Promise<void> {
    return this.switchThemeProtocolB(devicePath)
  }

  // Send CMD_VALUE_SEND_SYSTEM_DATA_TO_DEVICE = 85
  // Payload: QDataStream QMap<QString,QString> — uint32BE count, then key/value QString pairs
  async sendSystemData(data: Record<string, string>): Promise<void> {
    const entries = Object.entries(data)
    const parts: Buffer[] = []
    const countBuf = Buffer.alloc(4)
    countBuf.writeUInt32BE(entries.length, 0)
    parts.push(countBuf)
    for (const [k, v] of entries) {
      parts.push(qstringPayload(k))
      parts.push(qstringPayload(v))
    }
    const payload = Buffer.concat(parts)
    const frame = buildFrame(CMD_SEND_SYSTEM_DATA, payload)
    log(`SK18 TX sendSystemData cmd=${CMD_SEND_SYSTEM_DATA} entries=${entries.length}`)
    this.send(frame)
  }

  private async write1MB(): Promise<void> {
    log('SK18 write1MB start')
    // Fire all chunks into the kernel write buffer without awaiting individual
    // callbacks. USB CDC ACM transfers at USB speed (<1s for 1MB), not baud rate.
    // The drain event never fires (no backpressure), so a fixed 2s settle is used.
    const chunk = Buffer.alloc(4096, 0x30)
    for (let i = 0; i < 256; i++) {
      if (!this.port?.isOpen) throw new Error('Port closed during write1MB')
      this.port.write(chunk)
    }
    await new Promise<void>(res => setTimeout(res, 2000))
    log('SK18 write1MB done')
  }

  private send(frame: Buffer) {
    if (!this.port?.isOpen) throw new Error('Not connected')
    this.port.write(frame)
  }

  private onData(chunk: Buffer) {
    log(`SK18 RX ${chunk.length} bytes: ${chunk.slice(0, 64).toString('hex')}`)
    this.rxBuf = Buffer.concat([this.rxBuf, chunk])
    this.parseFrames()
  }

  private skipFixedCmdHead(): boolean {
    // FIXEDCMDHEAD frames: "AA551234 FIXEDCMDHEAD " (22 bytes) + cmd(4) + field2(4) + size(4) + crc(4) + payload(size)
    const prefix = Buffer.from('AA551234 FIXEDCMDHEAD ')
    if (this.rxBuf.length < prefix.length) return false
    if (!this.rxBuf.slice(0, prefix.length).equals(prefix)) return false
    const headerLen = prefix.length + 4 + 4 + 4 + 4 // prefix + cmd + field2 + size + crc
    if (this.rxBuf.length < headerLen) return false // wait for full header
    const payloadSize = this.rxBuf.readUInt32LE(prefix.length + 4 + 4) // size field
    const totalLen = headerLen + payloadSize
    if (this.rxBuf.length < totalLen) return false // wait for full frame
    log(`SK18 skip FIXEDCMDHEAD ${totalLen}b`)
    this.rxBuf = this.rxBuf.slice(totalLen)
    return true
  }

  private parseFrames() {
    while (true) {
      // Skip any FIXEDCMDHEAD unsolicited frames from device
      if (this.skipFixedCmdHead()) continue

      // Find magic header
      const magic = this.findMagic(this.rxBuf)
      if (magic < 0) { this.rxBuf = Buffer.alloc(0); return }
      if (magic > 0) { this.rxBuf = this.rxBuf.slice(magic) }

      // Need at least magic(4) + id(4) + cmd(4) + size(4) + size_crc(4) = 20 bytes
      if (this.rxBuf.length < 20) return

      const size = this.rxBuf.readUInt32LE(12)
      const totalNeeded = 20 + size + 4 // header + payload + data_crc

      if (this.rxBuf.length < totalNeeded) return

      // Verify size_crc
      const sizeBuf = this.rxBuf.slice(12, 16)
      const sizeCrc = this.rxBuf.readUInt32LE(16)
      if (crc32(sizeBuf) !== sizeCrc) {
        // Bad frame, skip one byte and retry
        this.rxBuf = this.rxBuf.slice(1)
        continue
      }

      const payload = this.rxBuf.slice(20, 20 + size)
      const dataCrc = this.rxBuf.readUInt32LE(20 + size)

      if (crc32(payload) !== dataCrc) {
        this.rxBuf = this.rxBuf.slice(1)
        continue
      }

      // Good frame
      this.rxBuf = this.rxBuf.slice(totalNeeded)
      this.handleFrame(payload)
    }
  }

  private findMagic(buf: Buffer): number {
    for (let i = 0; i <= buf.length - 4; i++) {
      if (buf[i] === 0xA1 && buf[i+1] === 0xA5 && buf[i+2] === 0x5A && buf[i+3] === 0x5E) return i
    }
    return buf.length < 4 ? 0 : -1
  }

  private handleFrame(payload: Buffer) {
    try {
      const text = payload.toString('utf8')
      log(`SK18 frame payload (${payload.length}b): ${text.slice(0, 200)}`)
      const json = JSON.parse(text)

      const ackMethod = json.ack_method as string | undefined
      const method = json.method as string | undefined

      if (ackMethod) {
        log(`SK18 ack_method: ${ackMethod}, pending: [${[...this.pending.keys()].join(',')}]`)
        const resolver = this.pending.get(ackMethod)
        if (resolver) {
          this.pending.delete(ackMethod)
          resolver(json)
        } else {
          log(`SK18 no resolver for ${ackMethod}`)
        }
      } else if (method) {
        log(`SK18 device method: ${method}`)
        this.onMessage?.(json)
      } else {
        log(`SK18 unrouted frame: ${text.slice(0, 100)}`)
      }
    } catch (e: any) {
      log(`SK18 frame parse error: ${e.message}`)
    }
  }

  private waitFor(method: string, timeoutMs: number): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(method)
        reject(new Error(`Timeout waiting for ${method}`))
      }, timeoutMs)

      this.pending.set(method, (data) => {
        clearTimeout(timer)
        resolve(data)
      })
    })
  }
}

// Auto-detect SK18 serial port
export async function findSK18Port(): Promise<string | null> {
  const ports = await SerialPort.list()
  for (const p of ports) {
    const vid = p.vendorId?.toLowerCase()
    const pid = p.productId?.toLowerCase()
    if ((vid === '1d6b' && pid === '0104') || (vid === '1234' && pid === '5678')) {
      return p.path
    }
  }
  return null
}
