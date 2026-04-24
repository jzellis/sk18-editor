---
name: SK18 project TODO
description: Remaining tasks for the Waveshare SK18 Linux integration project
type: project
originSessionId: 746c3b59-9942-431e-af68-63c240d61db0
---
1. Write the .Theme file builder (Python or Node.js) — generates a valid .Theme from a JSON description: prepends the fixed 193-byte header, writes the 8-byte JSON length field, appends the JSON body. Optionally embeds images in the trailing blob.

2. Write the Node.js USB serial daemon — connects to the SK18 over USB serial, handles the framing protocol (magic A1A55A5E + id + cmd + size + size_crc + data + data_crc), responds to `getInfo` and `deviceRequestSystemData` with real Linux system stats from /proc/stat, /sys/class/thermal/, /proc/net/dev, etc.

3. Determine the exact integer value of CMD_VALUE_SEND_SYSTEM_DATA_TO_DEVICE — plug the device in, sniff one real exchange, and confirm whether it's 85 (estimated sequential) or something else.
