# SK18 Theme Editor — Claude Context

This repo is an Electron + React + TypeScript theme editor for the Waveshare SK18 Stream Deck clone.
The project memory lives in `CLAUDE/`. Read those files at the start of every session.

## Quick orientation

- `src/main/` — Electron main process (Node.js): serial comms, file I/O, IPC handlers
- `src/renderer/` — React UI: canvas, button editor, device panel
- `src/shared/` — shared types and QDataStream codec (renderer-safe, no Buffer/Node APIs)
- `src/main/serial.ts` — SK18 USB serial driver (1MB init, DTR cycle, framing)

## Running in dev

```
npm install
npm run electron:dev
```

F12 opens DevTools detached.

## Key constraints

- `src/shared/qdatastream.ts` must never use Node.js `Buffer` — it runs in the renderer.
  Uses DataView / btoa / atob instead. See `CLAUDE/feedback_renderer_buffer.md`.
- Serial port is `/dev/ttyACM0`, VID=1d6b PID=0104.
- Device requires ~1MB of 0x30 bytes sent before it will respond to JSON frames.

## Memory index

See `CLAUDE/MEMORY.md` for the full index of project knowledge.
