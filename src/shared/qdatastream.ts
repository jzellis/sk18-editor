// Qt QDataStream encoder/decoder for controlData QVariantMap
// Format: big-endian, Qt>=4.2, with isNull bytes
// Uses only browser-native APIs (DataView, atob/btoa, TextEncoder)

const TYPE_INT = 2
const TYPE_STRING = 10
const TYPE_BYTEARRAY = 12
const TYPE_VARIANTMAP = 8
const TYPE_VARIANTLIST = 9
const TYPE_BOOL = 1
const TYPE_DOUBLE = 6

// --- Low-level byte writer ---

class Writer {
  private chunks: Uint8Array[] = []
  private _len = 0

  u32(v: number) {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setUint32(0, v >>> 0, false)
    this.push(b)
  }
  i32(v: number) {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setInt32(0, v, false)
    this.push(b)
  }
  f64(v: number) {
    const b = new Uint8Array(8)
    new DataView(b.buffer).setFloat64(0, v, false)
    this.push(b)
  }
  byte(v: number) {
    this.push(new Uint8Array([v & 0xFF]))
  }
  push(b: Uint8Array) {
    this.chunks.push(b)
    this._len += b.length
  }
  toBytes(): Uint8Array {
    const out = new Uint8Array(this._len)
    let off = 0
    for (const c of this.chunks) { out.set(c, off); off += c.length }
    return out
  }
}

// --- Low-level byte reader ---

class Reader {
  private view: DataView
  constructor(readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  }
  u32(off: number) { return this.view.getUint32(off, false) }
  i32(off: number) { return this.view.getInt32(off, false) }
  f64(off: number) { return this.view.getFloat64(off, false) }
  byte(off: number) { return this.data[off] }
  slice(start: number, end: number) { return this.data.slice(start, end) }
  get length() { return this.data.length }
}

// --- Base64 ---

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

// --- UTF-16BE string encoding (Qt QDataStream QString format) ---

function encodeQString(w: Writer, s: string | null | undefined) {
  if (s == null) { w.u32(0xFFFFFFFF); return }
  // Encode as UTF-16BE (2 bytes per BMP char)
  const be = new Uint8Array(s.length * 2)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    be[i * 2]     = (c >> 8) & 0xFF
    be[i * 2 + 1] = c & 0xFF
  }
  w.u32(be.length)
  w.push(be)
}

function decodeQString(r: Reader, off: number): { str: string; end: number } {
  const len = r.u32(off); off += 4
  if (len === 0xFFFFFFFF) return { str: '', end: off }
  const bytes = r.slice(off, off + len)
  let str = ''
  for (let i = 0; i < bytes.length; i += 2) {
    str += String.fromCharCode((bytes[i] << 8) | bytes[i + 1])
  }
  return { str, end: off + len }
}

// --- QVariant encode/decode ---

function encodeQVariant(w: Writer, value: unknown) {
  if (typeof value === 'string') {
    w.u32(TYPE_STRING); w.byte(0); encodeQString(w, value)
  } else if (typeof value === 'number' && Number.isInteger(value)) {
    w.u32(TYPE_INT); w.byte(0); w.i32(value)
  } else if (typeof value === 'number') {
    w.u32(TYPE_DOUBLE); w.byte(0); w.f64(value)
  } else if (typeof value === 'boolean') {
    w.u32(TYPE_BOOL); w.byte(0); w.byte(value ? 1 : 0)
  } else if (Array.isArray(value)) {
    w.u32(TYPE_VARIANTLIST); w.byte(0); w.u32(value.length)
    for (const v of value) encodeQVariant(w, v)
  } else if (value !== null && typeof value === 'object') {
    w.u32(TYPE_VARIANTMAP); w.byte(0); encodeQVariantMap(w, value as Record<string, unknown>)
  } else {
    w.u32(TYPE_BYTEARRAY); w.byte(1) // null QByteArray
  }
}

function decodeQVariant(r: Reader, off: number): { value: unknown; end: number } {
  const type = r.u32(off); off += 4
  const isNull = r.byte(off); off += 1
  if (isNull) return { value: null, end: off }
  switch (type) {
    case TYPE_INT: return { value: r.i32(off), end: off + 4 }
    case TYPE_DOUBLE: return { value: r.f64(off), end: off + 8 }
    case TYPE_BOOL: return { value: r.byte(off) !== 0, end: off + 1 }
    case TYPE_STRING: { const { str, end } = decodeQString(r, off); return { value: str, end } }
    case TYPE_BYTEARRAY: {
      const len = r.i32(off); off += 4
      if (len < 0) return { value: null, end: off }
      return { value: toBase64(r.slice(off, off + len)), end: off + len }
    }
    case TYPE_VARIANTMAP: { const { map, end } = decodeQVariantMap(r, off); return { value: map, end } }
    case TYPE_VARIANTLIST: {
      const count = r.u32(off); off += 4
      const list: unknown[] = []
      for (let i = 0; i < count; i++) {
        const { value, end } = decodeQVariant(r, off); list.push(value); off = end
      }
      return { value: list, end: off }
    }
    default: return { value: null, end: off }
  }
}

// --- QVariantMap encode/decode ---

function encodeQVariantMap(w: Writer, map: Record<string, unknown>) {
  const keys = Object.keys(map)
  w.u32(keys.length)
  for (const key of keys) {
    encodeQString(w, key)
    encodeQVariant(w, map[key])
  }
}

function decodeQVariantMap(r: Reader, off: number): { map: Record<string, unknown>; end: number } {
  const count = r.u32(off); off += 4
  const map: Record<string, unknown> = {}
  for (let i = 0; i < count; i++) {
    const { str: key, end: k2 } = decodeQString(r, off); off = k2
    const { value, end: v2 } = decodeQVariant(r, off); off = v2
    map[key] = value
  }
  return { map, end: off }
}

// --- QList<QVariantMap> encode/decode ---

function encodeQVariantMapList(w: Writer, list: Record<string, unknown>[]) {
  w.u32(list.length)
  for (const map of list) encodeQVariantMap(w, map)
}

function decodeQVariantMapList(r: Reader, off: number): { list: Record<string, unknown>[]; end: number } {
  const count = r.u32(off); off += 4
  const list: Record<string, unknown>[] = []
  for (let i = 0; i < count; i++) {
    const { map, end } = decodeQVariantMap(r, off); list.push(map); off = end
  }
  return { list, end: off }
}

// --- Public API ---

export function actionToControlData(action: Record<string, unknown>): string {
  try {
    const w = new Writer()
    encodeQVariantMap(w, action)
    return toBase64(w.toBytes())
  } catch (e) {
    console.error('actionToControlData failed:', e)
    return ''
  }
}

export function controlDataToAction(b64: string): Record<string, unknown> | null {
  if (!b64) return null
  try {
    const r = new Reader(fromBase64(b64))
    return decodeQVariantMap(r, 0).map
  } catch {
    return null
  }
}

export function actionsToControlDataList(actions: Record<string, unknown>[]): string {
  try {
    const w = new Writer()
    encodeQVariantMapList(w, actions)
    return toBase64(w.toBytes())
  } catch (e) {
    console.error('actionsToControlDataList failed:', e)
    return ''
  }
}

export function controlDataListToActions(b64: string): Record<string, unknown>[] {
  if (!b64) return []
  try {
    const r = new Reader(fromBase64(b64))
    return decodeQVariantMapList(r, 0).list
  } catch {
    return []
  }
}
