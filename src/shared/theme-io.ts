// .Theme file reader and writer
// Format: 193-byte fixed Qt header + 8-byte uint64 JSON length + UTF-8 JSON + image blob

import type { ThemeFile } from './types'

// Fixed 193-byte header, identical across all SK18 themes (base64)
const FIXED_HEADER_B64 = 'AAAAAwAAABAAawBlAHkATQBhAGMAcgBvAAAADAD/////AAAAGgBrAGUAeQBNAGEAYwByAG8AVgBhAGwAdQBlAAAADAAAAABcQUFBQUVBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQT0AAAAQAGwAYQBuAGcAdQBhAGcAZQAAAAIAAAAAAA=='

export function parseTheme(buf: Buffer): { theme: ThemeFile; imageBlob: Buffer } {
  const HEADER_LEN = 193

  // Read 8-byte big-endian uint64 JSON length at offset 193
  const jsonLenHi = buf.readUInt32BE(HEADER_LEN)
  const jsonLenLo = buf.readUInt32BE(HEADER_LEN + 4)
  const jsonLen = jsonLenHi * 0x100000000 + jsonLenLo

  const jsonStart = HEADER_LEN + 8
  const jsonBuf = buf.slice(jsonStart, jsonStart + jsonLen)
  const theme: ThemeFile = JSON.parse(jsonBuf.toString('utf8'))

  const blobStart = jsonStart + jsonLen
  const imageBlob = buf.slice(blobStart)

  return { theme, imageBlob }
}

// Parse asset blob → map of devicePath → raw data
export function parseBlob(blob: Buffer): Record<string, Buffer> {
  const assets: Record<string, Buffer> = {}
  if (blob.length < 4) return assets
  let off = 0
  const count = blob.readUInt32BE(off); off += 4
  for (let i = 0; i < count; i++) {
    if (off + 4 > blob.length) break
    const plen = blob.readUInt32BE(off); off += 4
    if (off + plen > blob.length) break
    const pathBuf = blob.slice(off, off + plen); off += plen
    // Decode UTF-16-BE path
    let path = ''
    for (let j = 0; j + 1 < pathBuf.length; j += 2) {
      path += String.fromCharCode(pathBuf.readUInt16BE(j))
    }
    if (off + 4 > blob.length) break
    const dlen = blob.readUInt32BE(off); off += 4
    if (off + dlen > blob.length) break
    assets[path] = Buffer.from(blob.slice(off, off + dlen)); off += dlen
  }
  return assets
}

// Build asset blob from map of devicePath → raw data
export function buildBlob(assets: Record<string, Buffer>): Buffer {
  const entries = Object.entries(assets)
  const parts: Buffer[] = []
  const countBuf = Buffer.alloc(4); countBuf.writeUInt32BE(entries.length, 0)
  parts.push(countBuf)
  for (const [path, data] of entries) {
    // Encode path as UTF-16-BE
    const pathBuf = Buffer.alloc(path.length * 2)
    for (let i = 0; i < path.length; i++) pathBuf.writeUInt16BE(path.charCodeAt(i), i * 2)
    const plen = Buffer.alloc(4); plen.writeUInt32BE(pathBuf.length, 0)
    parts.push(plen, pathBuf)
    const dlen = Buffer.alloc(4); dlen.writeUInt32BE(data.length, 0)
    parts.push(dlen, data)
  }
  parts.push(Buffer.alloc(4)) // zero terminator
  return Buffer.concat(parts)
}

// Fields the device expects as strings, not numbers
const ITEM_STRING_FIELDS = new Set([
  'type','x','y','w','h','z','col','row',
  'maxWidth','maxHeight','scaledWidthTo','scaledHeightTo',
  'opacity','rotate','scale'
])

function normalizeItem(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(item)) {
    out[k] = (ITEM_STRING_FIELDS.has(k) && v !== undefined && v !== null) ? String(v) : v
  }
  return out
}

export function buildTheme(theme: ThemeFile, imageBlob?: Buffer): Buffer {
  const header = Buffer.from(FIXED_HEADER_B64, 'base64')
  if (header.length !== 193) {
    throw new Error(`Header decode error: expected 193 bytes, got ${header.length}`)
  }

  const normalized = {
    ...theme,
    pages: theme.pages.map(p => ({
      ...p,
      items: p.items.map(normalizeItem)
    }))
  }
  const jsonStr = JSON.stringify(normalized)
  const jsonBuf = Buffer.from(jsonStr, 'utf8')
  const jsonLen = jsonBuf.length

  // Write 8-byte big-endian uint64 length
  const lenBuf = Buffer.alloc(8)
  lenBuf.writeUInt32BE(Math.floor(jsonLen / 0x100000000), 0)
  lenBuf.writeUInt32BE(jsonLen >>> 0, 4)

  const parts: Buffer[] = [header, lenBuf, jsonBuf]
  if (imageBlob && imageBlob.length > 0) {
    parts.push(imageBlob)
  }

  return Buffer.concat(parts)
}
