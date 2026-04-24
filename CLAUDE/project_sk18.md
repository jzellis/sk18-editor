---
name: Waveshare SK18 reverse engineering project
description: Reverse engineering .Theme file format, serial protocol, and system data for the Waveshare SK18 Stream Deck clone
type: project
originSessionId: 746c3b59-9942-431e-af68-63c240d61db0
---
Goal: build themes by hand and replace Windows-only AIDA64/ScreenKey system stats with a local Linux Node.js daemon over USB serial.

**Why:** Device uses Windows-only software; user wants to drive it from Linux with local system stats.

**How to apply:** When writing .Theme files or the Node.js serial daemon, use the exact formats documented here.

## Hardware

- T113-S3 (dual-core ARM A7) Linux main controller
- GD32 co-controller (QMK firmware)
- Main app: `/data/KeyboardDevice` (ARM ELF, 2.2MB, Qt5, stripped)
- Launch: `/data/appLunch.sh` → `/data/KeyboardDevice`

## SD Card Partitions (dumped to /home/jzellis/Projects/sk18/)

- `Volumn/` - FAT user partition: config.json, theme .bin files (raw image data), magic.bin (512 bytes of UUID-like strings)
- `03259a09-.../` - OverlayFS upper (writable). Theme files live here.
- `57f8f4bc-.../` - ARM Linux root filesystem
- `MK Series Upper Computer Open Source_V1.0/` - source code (serial demo only)

Theme files: `03259a09-.../upper/data/theme/SK18/*.Theme`
Currently loaded: `My Theme.Theme` (set in `Volumn/config.json`)

## .Theme File Format

```
Offset 0-192 (193 bytes): Qt QDataStream big-endian header
  4 bytes: uint32 entry count = 3
  Entry 1: "keyMacro"      = null QByteArray   (fixed magic)
  Entry 2: "keyMacroValue" = 92 bytes           (fixed magic, same in ALL themes)
  Entry 3: "language"      = Int 0              (0=English)

Offset 193-200 (8 bytes): JSON body length as uint64 big-endian

Offset 201+: UTF-8 JSON body (length as above)

Offset 201+json_len+: Binary image blob (concatenated images embedded by ScreenKey)
```

Qt QDataStream QVariant format (per-entry after key):
- 4 bytes: value type (10=QString, 12=QByteArray, 2=Int)
- 1 byte: isNull flag (0=value follows, 1=null, no data)
- [type data]: Int=4 bytes, QString=4-byte-len+UTF16BE, QByteArray=4-byte-len+data
  - null QByteArray: len=0xFFFFFFFF (no data following)

FIXED 201-byte header (base64, copy this verbatim for new themes):
```
AAAAAwAAABAAawBlAHkATQBhAGMAcgBvAAAADAD/////AAAAGgBrAGUAeQBNAGEAYwByAG8AVgBhAGwAdQBlAAAADAAAAABcQUFBQUVBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQT0AAAAQAGwAYQBuAGcAdQBhAGcAZQAAAAIAAAAAAAAAAAAAAiel
```

## JSON Structure

Root: `{ "main": { "currentPage": "<UUID>", "version": "V3.0" }, "pages": [...] }`

Each page: `{ "id": "<UUID>", "pageName": "...", "canvas": { "canvas_w": 1280, "canvas_h": 720, "canvas_flip": true, "canvas_rotate": false }, "items": [...] }`

Item widget types: 102, 109, 111, 113, 114
Item fields include: type, x, y, w, h, z, system_data_name, system_data_flag, system_data_min_value, system_data_max_value, displayType, showUnit, path, paths, controlData (base64 QDataStream), soundFile, etc.

controlData is also base64-encoded Qt QDataStream (same format as header, no length prefix).

## System Data Architecture

`system_data_flag`:
- `1` = data PUSHED from host PC over USB serial (AIDA64/LibreHardwareMonitor on Windows)
- `0` = data pulled by device itself (local time, weather, random numbers)
- `""` (empty) = local audio level (`avg_dB`)

Data keys expected from host (system_data_flag=1):
- "CPU Temperature" (°C string)
- "GPU Temperature" (°C string)
- "GPU Usage" (% string, 0-100)
- "RAM Usage" (% string, 0-100)
- "Upload Speed" (string)
- "Download Speed" (string)
- "Disk Temperature0" (°C string)

Weather/clock/random handled internally by device (system_data_flag=0).

## USB Serial Protocol

Frame format (little-endian integers):
```
[A1][A5][5A][5E]  - 4-byte magic header
[id: 4 bytes LE uint32]        - auto-incrementing
[cmd: 4 bytes LE uint32]       - CMD_VALUE enum
[size: 4 bytes LE uint32]      - payload size
[size_crc: 4 bytes LE CRC32]   - CRC32 of the size field bytes
[data: size bytes]             - payload
[data_crc: 4 bytes LE CRC32]   - CRC32 of payload
```

CRC32 function: uses Start_CheckCRC/Calculate_CRC/CheckCRC_Result (custom CRC32)

Known CMD_VALUE integers (from demo source mainwindow.h):
- CMD_VALUE_SHOW_JPG = 100  (host sends JPEG screen captures)
- CMD_VALUE_JSON = 101       (bidirectional JSON command/response)
- CMD_VALUE_END = 102

Estimated CMD values (if sequential from 84):
- CMD_VALUE_FIND_DEVICE = 84
- CMD_VALUE_SEND_SYSTEM_DATA_TO_DEVICE = 85  (needs verification)
- CMD_VALUE_SET_DEVICE_RELOAD = 86
- CMD_VALUE_GET_DEVICE_THEME = 87
- CMD_VALUE_SET_DEVICE_BL = 88
- CMD_VALUE_SET_DEVICE_SCAN_STATE = 89
- CMD_VALUE_FILE_START = 90
- CMD_VALUE_FILE_END = 91
- CMD_VALUE_GET_DEVICE_VERSION = 92
- CMD_VALUE_SET_DEVICE_CANVASFLIP = 93
- CMD_VALUE_GET_DEVICE_SCREENMESSAGE = 94
- CMD_VALUE_SET_DEVICE_DELETE_THEME = 95
- CMD_VALUE_SEND_PIXMAP = 96
- CMD_VALUE_DEVICE_ProactiveEscalationCMD = 97
- CMD_VALUE_REQUEST_UPLOAD_KEY = 98
- CMD_VALUE_SEND_JSON = 99

## JSON Protocol Methods (CMD_VALUE_JSON payloads)

PC→Device request format: `{"method": "...", "parameters": {...}}`
Device→PC ack format: `{"ack_method": "...", "success": true/false, "result": {...}, "errorString": "..."}`

Known methods:
- `getInfo` → result: {deviceModel, deviceWidth, deviceHeight, ...}
- `keyStateChanged` (device→host): {col, row, pressed}
- `keyboardInput` (host→device): {inputString}
- `saveToFile`: {filePath, seek, data(base64)} - chunked file upload, 64KB per chunk
- `setFileCRC`: {filePath, crc}
- `getFilesBySuffix`: {suffixs:[...]} → {filePaths:[{filePath, crc}]}
- `deleteFiles`: {filePaths:[...]}
- `playAudio`: {filePath}
- `stopAudio`
- `setVolume`: {level}
- `setBacklight`: {level}
- `deviceRequestSystemData` (device→host): triggers system data response
- `deviceRequestSystemDataShowUnit` (device→host): asks for units

Connection init: host sends 1MB of '0' bytes, then sends getInfo JSON request.
Device USB IDs: VID=0x1d6b PID=0x0104 OR VID=0x1234 PID=0x5678
