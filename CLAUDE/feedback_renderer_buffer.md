---
name: Renderer process has no Buffer global
description: Node.js Buffer is not available in Electron renderer; qdatastream.ts must use browser-native APIs
type: feedback
originSessionId: 746c3b59-9942-431e-af68-63c240d61db0
---
`Buffer` is not defined in the Electron renderer process even with `vite-plugin-electron-renderer`. Any shared module that uses `Buffer` will fail silently in the renderer.

**Why:** Attempted to add `import { Buffer } from 'buffer'` which caused a blank white screen because vite-plugin-electron-renderer resolves `buffer` via Node.js conditions, not the npm browser polyfill.

**How to apply:** `src/shared/qdatastream.ts` was rewritten to use only browser-native APIs: `DataView` for binary reads/writes, `btoa`/`atob` for base64, manual UTF-16BE loops for string encoding. Never import or use `Buffer` in any renderer-side or shared module. Keep `Buffer` only in `src/main/` (Node.js process).
