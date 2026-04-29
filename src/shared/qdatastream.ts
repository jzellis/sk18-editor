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
// Keys must be sorted alphabetically — device parser is order-sensitive.

function encodeQVariantMap(w: Writer, map: Record<string, unknown>) {
  const keys = Object.keys(map).sort()
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

// --- Action <-> device QVariantMap translation ---
// The device parses specific field names (type, keycode, AISoundControlKeyword, etc.)
// which differ from the editor's internal representation (actionType, keyCode, etc.).

const HID_NAMES: Record<number, string> = {
  0x04: 'A', 0x05: 'B', 0x06: 'C', 0x07: 'D', 0x08: 'E', 0x09: 'F',
  0x0A: 'G', 0x0B: 'H', 0x0C: 'I', 0x0D: 'J', 0x0E: 'K', 0x0F: 'L',
  0x10: 'M', 0x11: 'N', 0x12: 'O', 0x13: 'P', 0x14: 'Q', 0x15: 'R',
  0x16: 'S', 0x17: 'T', 0x18: 'U', 0x19: 'V', 0x1A: 'W', 0x1B: 'X',
  0x1C: 'Y', 0x1D: 'Z',
  0x1E: '1', 0x1F: '2', 0x20: '3', 0x21: '4', 0x22: '5',
  0x23: '6', 0x24: '7', 0x25: '8', 0x26: '9', 0x27: '0',
  0x28: 'Enter', 0x29: 'Esc', 0x2A: 'Backspace', 0x2B: 'Tab', 0x2C: 'Space',
  0x3A: 'F1', 0x3B: 'F2', 0x3C: 'F3', 0x3D: 'F4', 0x3E: 'F5', 0x3F: 'F6',
  0x40: 'F7', 0x41: 'F8', 0x42: 'F9', 0x43: 'F10', 0x44: 'F11', 0x45: 'F12',
  0x46: 'PrintScreen', 0x48: 'Pause', 0x49: 'Insert', 0x4A: 'Home',
  0x4B: 'PageUp', 0x4C: 'Delete', 0x4D: 'End', 0x4E: 'PageDown',
  0x4F: 'Right', 0x50: 'Left', 0x51: 'Down', 0x52: 'Up',
  0x7F: 'Mute', 0x80: 'VolumeUp', 0x81: 'VolumeDown',
  0xB5: 'MediaNext', 0xB6: 'MediaPrev', 0xB7: 'MediaStop', 0xB8: 'MediaPlay',
}

const MOD_NAMES: [number, string][] = [
  [0x01, 'LCtrl'], [0x02, 'LShift'], [0x04, 'LAlt'], [0x08, 'LWin'],
  [0x10, 'RCtrl'], [0x20, 'RShift'], [0x40, 'RAlt'], [0x80, 'RWin'],
]

function formatKeyLabel(kc: number): string {
  const mods = (kc >> 8) & 0xFF
  const key = kc & 0xFF
  const parts: string[] = []
  for (const [bit, name] of MOD_NAMES) {
    if (mods & bit) parts.push(name)
  }
  parts.push(HID_NAMES[key] || `0x${key.toString(16)}`)
  return parts.join('+')
}

// Translate editor action → device QVariantMap (field names the device firmware expects)
function actionToDeviceMap(action: Record<string, unknown>): Record<string, unknown> {
  const actionType = (action.actionType as string) || ''

  switch (actionType) {
    case 'keyboard': {
      const kc = (action.keyCode as number) || 0
      return {
        AISoundControlKeyword: '',
        description: 'Keyboard',
        iconPath: '/static/icon/dark/keyboard.png',
        keyString: formatKeyLabel(kc),
        keycode: kc,
        parentDescription: 'System input control',
        type: 'keyboard',
      }
    }
    case 'pageSwitch':
    case 'openPage': {
      return {
        AISoundControlKeyword: '',
        description: 'Page switching',
        iconPath: '/static/icon/dark/PageSwitch.png',
        jumpToPage: (action.jumpToPage as number) ?? 0,
        pageSwitchMode: 0,
        parentDescription: 'Page switching',
        type: 'pageSwitch',
      }
    }
    case 'oneLevelUp': {
      return {
        description: 'Back',
        iconPath: '/static/icon/dark/oneLevelUp.png',
        pageName: 'parentPage',
        parentDescription: 'Page switching',
        type: 'oneLevelUp',
      }
    }
    case 'text':
    case 'qmk_string': {
      return {
        AISoundControlKeyword: '',
        description: 'Text',
        iconPath: '/static/icon/dark/Text.png',
        inputText: (action.inputText as string) || '',
        isCopyPaste: false,
        isInputEnter: false,
        parentDescription: 'System input control',
        type: actionType,
      }
    }
    case 'controlMouse': {
      const mouseAction = (action.mouseAction as string) || 'click'
      const x = (action.mouseX as number) || 0
      const y = (action.mouseY as number) || 0
      let event = 2, btn = 0, mx = 0, my = 0, mh = 0, mv = 0
      if (mouseAction === 'rightClick') { event = 2; btn = 1 }
      else if (mouseAction === 'moveRelative') { event = 0; mx = x; my = y }
      else if (mouseAction === 'scroll') { event = 1; mh = x; mv = y }
      return {
        AISoundControlKeyword: '',
        description: 'Mouse',
        iconPath: '/static/icon/dark/mouse.png',
        mouse_h: mh,
        mouse_v: mv,
        mouse_x: mx,
        mouse_y: my,
        parentDescription: 'System input control',
        qmk_mouse_event: event,
        qmk_mouse_key: btn,
        type: 'qmk_mouse',
      }
    }
    case 'openWeb': {
      return {
        Url: (action.url as string) || '',
        description: 'Open web',
        iconPath: '/static/icon/dark/openWeb.png',
        parentDescription: 'System file control',
        type: 'openWeb',
      }
    }
    case 'playAudio': {
      return {
        AISoundControlKeyword: '',
        description: 'Play audio',
        filePath: (action.audioPath as string) || '',
        iconPath: '/static/icon/dark/audio.png',
        parentDescription: 'System file control',
        type: 'playAudio',
      }
    }
    case 'stopAudio': {
      return {
        AISoundControlKeyword: '',
        description: 'Stop audio',
        iconPath: '/static/icon/dark/audio.png',
        parentDescription: 'System file control',
        type: 'stopAudio',
      }
    }
    case 'deviceVolume': {
      return {
        AISoundControlKeyword: '',
        description: 'Set volume',
        iconPath: '/static/icon/dark/audio.png',
        parentDescription: 'System input control',
        type: 'deviceVolume',
        volumeLevel: (action.volumeLevel as number) ?? 50,
      }
    }
    case 'systemCmd': {
      return {
        AISoundControlKeyword: '',
        cmdArray: (action.cmdArray as string[]) || [],
        description: 'Shell command',
        iconPath: '/static/icon/dark/cmd.png',
        parentDescription: 'System file control',
        type: 'systemCmd',
      }
    }
    case 'delay': {
      return {
        AISoundControlKeyword: '',
        delayMs: (action.delayMs as number) || 100,
        description: 'Delay',
        iconPath: '',
        parentDescription: 'System input control',
        type: 'delay',
      }
    }
    default: {
      // Already in device format (e.g., loaded from an existing .Theme file)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { actionType: _drop, ...rest } = action
      return rest as Record<string, unknown>
    }
  }
}

// Translate device QVariantMap → editor action (internal representation)
function deviceMapToAction(map: Record<string, unknown>): Record<string, unknown> {
  const type = (map.type as string) || ''
  switch (type) {
    case 'keyboard':
      return { actionType: 'keyboard', keyCode: (map.keycode as number) || 0 }
    case 'pageSwitch':
      return { actionType: 'pageSwitch', jumpToPage: (map.jumpToPage as number) ?? 0 }
    case 'oneLevelUp':
      return { actionType: 'oneLevelUp' }
    case 'text':
      return { actionType: 'text', inputText: (map.inputText as string) || '' }
    case 'qmk_string':
      return { actionType: 'qmk_string', inputText: (map.inputText as string) || '' }
    case 'qmk_mouse': {
      const event = map.qmk_mouse_event as number
      const key = map.qmk_mouse_key as number
      let mouseAction = 'click'
      if (event === 2 && key === 1) mouseAction = 'rightClick'
      else if (event === 0) mouseAction = 'moveRelative'
      else if (event === 1) mouseAction = 'scroll'
      return {
        actionType: 'controlMouse', mouseAction,
        mouseX: ((map.mouse_x as number) || (map.mouse_h as number) || 0),
        mouseY: ((map.mouse_y as number) || (map.mouse_v as number) || 0),
      }
    }
    case 'openWeb':
      return { actionType: 'openWeb', url: (map.Url as string) || '' }
    case 'playAudio':
      return { actionType: 'playAudio', audioPath: (map.filePath as string) || '' }
    case 'stopAudio':
      return { actionType: 'stopAudio' }
    case 'deviceVolume':
      return { actionType: 'deviceVolume', volumeLevel: (map.volumeLevel as number) ?? 50 }
    case 'systemCmd':
      return { actionType: 'systemCmd', cmdArray: (map.cmdArray as string[]) || [] }
    case 'delay':
      return { actionType: 'delay', delayMs: (map.delayMs as number) || 100 }
    default:
      return { ...map, actionType: type }
  }
}

// --- Public API ---

export function actionToControlData(action: Record<string, unknown>): string {
  try {
    const w = new Writer()
    encodeQVariantMap(w, actionToDeviceMap(action))
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
    const { map } = decodeQVariantMap(r, 0)
    return deviceMapToAction(map)
  } catch {
    return null
  }
}

export function actionsToControlDataList(actions: Record<string, unknown>[]): string {
  try {
    const w = new Writer()
    encodeQVariantMapList(w, actions.map(actionToDeviceMap))
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
    return decodeQVariantMapList(r, 0).list.map(deviceMapToAction)
  } catch {
    return []
  }
}
