// .Theme file reader and writer
// Format: 193-byte fixed Qt header + 8-byte uint64 JSON length + UTF-8 JSON + image blob

import type { ThemeFile } from './types'

// Fixed 193-byte header, identical across all SK18 themes (base64)
const FIXED_HEADER_B64 =
  'AAAAAwAAABAAawBlAHkATQBhAGMAcgBvAAAADAD/////AAAAGgBrAGUAeQBNAGEAYwByAG8A' +
  'VgBhAGwAdQBlAAAADAAAAABcQUFBQUVBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFB' +
  'QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQT0A' +
  'AAAQAGwAYQBuAGcAdQBhAGcAZQAAAAIAAAAAAAAAAAAAAA=='

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

export function buildTheme(theme: ThemeFile, imageBlob?: Buffer): Buffer {
  const header = Buffer.from(FIXED_HEADER_B64, 'base64')
  if (header.length !== 193) {
    throw new Error(`Header decode error: expected 193 bytes, got ${header.length}`)
  }

  const jsonStr = JSON.stringify(theme)
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
