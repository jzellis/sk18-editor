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
const CHUNK_SIZE = 64 * 1024

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

export class SK18Serial {
  private port: SerialPort | null = null
  private rxBuf = Buffer.alloc(0)
  private pending: Map<string, PendingResolver> = new Map()
  private onProgress: ((pct: number, msg: string) => void) | null = null

  async connect(portPath: string): Promise<DeviceInfo> {
    if (this.port) {
      try { if (this.port.isOpen) this.port.close() } catch {}
      this.port = null
    }
    this.pending.clear()

    this.port = new SerialPort({
      path: portPath,
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      autoOpen: false
    })

    await new Promise<void>((resolve, reject) => {
      this.port!.open(err => err ? reject(err) : resolve())
    })

    // DTR cycle: Linux CDC ACM sets DTR=1 on open. Dropping and raising DTR
    // sends a fresh SET_CONTROL_LINE_STATE edge to the device firmware, which
    // re-triggers its serial listener regardless of how long ago it booted.
    await new Promise<void>(res => this.port!.set({ dtr: false }, () => res()))
    await new Promise<void>(res => setTimeout(res, 150))
    await new Promise<void>(res => this.port!.set({ dtr: true }, () => res()))
    await new Promise<void>(res => setTimeout(res, 50))

    this.rxBuf = Buffer.alloc(0)
    this.port.on('data', (chunk: Buffer) => this.onData(chunk))
    this.port.on('error', (err: Error) => log(`SK18 serial error: ${err.message}`))

    // Device serial loop requires ~1MB of data before it starts processing frames.
    await this.write1MB()

    const getInfoFrame = buildJsonFrame({ method: 'getInfo' })
    log(`SK18 TX getInfo (${getInfoFrame.length} bytes): ${getInfoFrame.toString('hex')}`)
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

      const response = await this.waitFor('saveToFile', 15000)
      if (!response.success) {
        throw new Error(`saveToFile failed at seek ${seek}: ${response.errorString || 'unknown error'}`)
      }

      seek += chunk.length
      const pct = Math.round((seek / totalSize) * 95)
      this.onProgress?.(pct, `Uploading... ${pct}%`)
    }

    // Send CRC
    const fileCrc = crc32(themeData)
    const crcFrame = buildJsonFrame({
      method: 'setFileCRC',
      parameters: {
        filePath: devicePath,
        crc: String(fileCrc)
      }
    })
    this.send(crcFrame)
    await this.waitFor('setFileCRC', 5000)

    this.onProgress?.(100, 'Done')
  }

  private async write1MB(): Promise<void> {
    const chunk = Buffer.alloc(4096, 0x30)
    const TOTAL = 1024 * 1024
    let sent = 0
    while (sent < TOTAL) {
      const ok = this.port!.write(chunk)
      sent += chunk.length
      if (!ok) await new Promise<void>(res => this.port!.once('drain', res))
    }
    await new Promise<void>(res => this.port!.drain(res))
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
      const ackMethod = json.ack_method as string
      log(`SK18 ack_method: ${ackMethod}, pending: [${[...this.pending.keys()].join(',')}]`)
      if (ackMethod) {
        const resolver = this.pending.get(ackMethod)
        if (resolver) {
          this.pending.delete(ackMethod)
          resolver(json)
        } else {
          log(`SK18 no resolver for ${ackMethod}`)
        }
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
