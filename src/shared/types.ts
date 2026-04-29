// SK18 .Theme format types

export interface ThemeFile {
  main: { currentPage: string; version: string }
  pages: Page[]
}

export interface Page {
  id: string
  pageName: string
  canvas: Canvas
  items: Item[]
}

export interface Canvas {
  canvas_w: number
  canvas_h: number
  canvas_flip: boolean
  canvas_rotate: boolean
}

// Item widget types:
// 100 = background image/video
// 102 = static image overlay
// 109 = animated frames (paths + frameDelays)
// 111 = picture font (digit directory)
// 113 = video
// 114 = text/system data label
// 115 = pressable button key
export type ItemType = 100 | 102 | 109 | 111 | 113 | 114 | 115

export interface Item {
  id?: string
  type: ItemType
  x: number
  y: number
  w: number
  h: number
  z: number

  // Images / animation
  path?: string
  paths?: string       // directory path for frame animation or multi-path
  frameDelays?: string // comma-separated ms per frame e.g. "100,100,100"

  // System data (type 114 / 111)
  system_data_name?: string
  system_data_flag?: number | string
  system_data_min_value?: number
  system_data_max_value?: number
  displayType?: number
  showUnit?: boolean

  // Text label
  text?: string
  fontSize?: number
  fontColor?: string

  // Button key (type 115)
  col?: number
  row?: number
  itemName?: string       // e.g. "control0" — required for device to register button
  lock?: string           // must be '1' for device to handle button presses
  title?: string
  titleParam?: string     // JSON string with font/display settings
  controlData?: string    // base64 QDataStream QVariantMap
  controlDataList?: string // base64 QList<QVariantMap> for ControlFlow

  soundFile?: string
  [key: string]: unknown
}

// Action types for button controlData

export type ActionType =
  | 'keyboard'
  | 'openWeb'
  | 'openPage'
  | 'pageSwitch'
  | 'oneLevelUp'
  | 'ControlFlow'
  | 'text'
  | 'qmk_string'
  | 'deviceVolume'
  | 'playAudio'
  | 'stopAudio'
  | 'controlMouse'
  | 'qmk_mouse_key'
  | 'qmk_mouse_event'
  | 'systemCmd'
  | 'delay'
  | 'homeAssistantControl'
  | 'obsControl'

export interface KeyAction {
  actionType: ActionType
  // keyboard
  keyCode?: number        // (modifier << 8) | HID_keycode
  // openWeb
  url?: string
  // openPage / pageSwitch
  pageId?: string
  pageName?: string
  // text / qmk_string
  inputText?: string
  // deviceVolume
  volumeLevel?: number
  // playAudio
  audioPath?: string
  // controlMouse
  mouseAction?: string
  mouseX?: number
  mouseY?: number
  // delay
  delayMs?: number
  // systemCmd
  cmdArray?: string[]
  // homeAssistantControl
  entity_id?: string
  haService?: string
  // obsControl
  obsAction?: string
  obsScene?: string
  // ControlFlow steps (nested)
  steps?: KeyAction[]
  [key: string]: unknown
}

// HID key codes (subset)
export const HID_KEYCODES: Record<string, number> = {
  'A': 0x04, 'B': 0x05, 'C': 0x06, 'D': 0x07, 'E': 0x08, 'F': 0x09,
  'G': 0x0A, 'H': 0x0B, 'I': 0x0C, 'J': 0x0D, 'K': 0x0E, 'L': 0x0F,
  'M': 0x10, 'N': 0x11, 'O': 0x12, 'P': 0x13, 'Q': 0x14, 'R': 0x15,
  'S': 0x16, 'T': 0x17, 'U': 0x18, 'V': 0x19, 'W': 0x1A, 'X': 0x1B,
  'Y': 0x1C, 'Z': 0x1D,
  '1': 0x1E, '2': 0x1F, '3': 0x20, '4': 0x21, '5': 0x22,
  '6': 0x23, '7': 0x24, '8': 0x25, '9': 0x26, '0': 0x27,
  'Enter': 0x28, 'Escape': 0x29, 'Backspace': 0x2A, 'Tab': 0x2B,
  'Space': 0x2C, 'F1': 0x3A, 'F2': 0x3B, 'F3': 0x3C, 'F4': 0x3D,
  'F5': 0x3E, 'F6': 0x3F, 'F7': 0x40, 'F8': 0x41, 'F9': 0x42,
  'F10': 0x43, 'F11': 0x44, 'F12': 0x45,
  'PrintScreen': 0x46, 'Pause': 0x48, 'Insert': 0x49,
  'Home': 0x4A, 'PageUp': 0x4B, 'Delete': 0x4C, 'End': 0x4D,
  'PageDown': 0x4E, 'Right': 0x4F, 'Left': 0x50, 'Down': 0x51, 'Up': 0x52,
  'Mute': 0x7F, 'VolumeUp': 0x80, 'VolumeDown': 0x81,
  'MediaNext': 0xB5, 'MediaPrev': 0xB6, 'MediaStop': 0xB7, 'MediaPlay': 0xB8
}

export const MODIFIER_BITS: Record<string, number> = {
  LCtrl: 0x01, LShift: 0x02, LAlt: 0x04, LWin: 0x08,
  RCtrl: 0x10, RShift: 0x20, RAlt: 0x40, RWin: 0x80
}

// Grid layout constants
export const GRID_COLS = 6
export const GRID_ROWS = 3
export const CANVAS_W = 1280
export const CANVAS_H = 720
