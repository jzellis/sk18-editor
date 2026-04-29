import React, { useCallback, useMemo, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { Page, Item } from '../../shared/types'
import { CANVAS_W, CANVAS_H, GRID_COLS, GRID_ROWS } from '../../shared/types'
import './Canvas.css'

// Editor display: buttons fill the full canvas edge-to-edge (matches physical device)
const CELL_W = CANVAS_W / GRID_COLS   // 213.33px
const CELL_H = CANVAS_H / GRID_ROWS   // 240px

// Theme JSON coordinates: confirmed from My Theme.Theme (icon offset within button area)
const THEME_ICON_W = 158
const THEME_ICON_H = 158
const THEME_GRID_X = 10
const THEME_GRID_Y = 63
const THEME_STEP = 218

// Display position (for editor canvas)
// dCol = 0..5 left→right, dRow = 0..2 top→bottom in EDITOR VIEW
// dRow=2 (visual top) = physical top row; dRow=0 (visual bottom) = physical bottom row.
// cellPos flips so dRow=2 renders at y=0 (top) and dRow=0 renders at y=480 (bottom).
function cellPos(dCol: number, dRow: number) {
  return { x: dCol * CELL_W, y: (GRID_ROWS - 1 - dRow) * CELL_H }
}

// Device col/row ↔ display col/row conversion
// From make_theme.py: col = 2 - phys_row, row = phys_col; phys_row=0 is physical TOP.
// dRow=2 (visual top) → phys_row=0 → col=2; dRow=0 (visual bottom) → phys_row=2 → col=0.
// Simplified: col = dRow, row = dCol.
function toDeviceCoords(dCol: number, dRow: number) {
  return { col: dRow, row: dCol }
}
function toDisplayCoords(col: number, row: number) {
  return { dCol: row, dRow: col }
}

// Theme JSON position (written to .Theme file)
// x = 10 + phys_col*218, y = 63 + phys_row*218 (phys_row=0 at top, y=63 at top).
// phys_row = GRID_ROWS-1-dRow (dRow=2→physRow=0→y=63, dRow=0→physRow=2→y=499).
function themePos(dCol: number, dRow: number) {
  const physRow = GRID_ROWS - 1 - dRow
  return {
    x: THEME_GRID_X + dCol * THEME_STEP,
    y: THEME_GRID_Y + physRow * THEME_STEP
  }
}

function mimeFromPath(p: string) {
  const ext = p.split('.').pop()?.toLowerCase() || 'png'
  if (ext === 'mp4' || ext === 'webm') return `video/${ext}`
  if (ext === 'gif') return 'image/gif'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  return 'image/png'
}

function dataUrl(path: string, b64: string) {
  return `data:${mimeFromPath(path)};base64,${b64}`
}

interface Props {
  page: Page
  selectedItemId: string | null
  assets: Record<string, string>
  onSelectItem: (id: string | null) => void
  onAddItem: (item: Item) => void
  onUpdateItem: (item: Item) => void
  onAddAsset: (devicePath: string, dataB64: string) => void
}

export default function Canvas({ page, selectedItemId, assets, onSelectItem, onAddItem, onUpdateItem, onAddAsset }: Props) {
  const [scale, setScale] = useState(0.7)

  const bgItem = page.items.find(i => i.type === 100)
  const bgPath = (bgItem?.path as string) || ''
  const isVideo = bgPath.endsWith('.mp4') || bgPath.endsWith('.webm')

  // Background preview: use embedded asset if available
  const bgUrl = useMemo(() => {
    if (!bgPath) return null
    const b64 = assets[bgPath]
    return b64 ? dataUrl(bgPath, b64) : null
  }, [bgPath, assets])

  // Index buttons by device col,row (as stored in theme JSON)
  const buttonItems = useMemo(() => {
    const map: Record<string, Item> = {}
    for (const item of page.items) {
      if (item.type === 115 && item.col != null && item.row != null) {
        map[`${item.col},${item.row}`] = item
      }
    }
    return map
  }, [page.items])

  const handleKeyClick = useCallback((dCol: number, dRow: number, e: React.MouseEvent) => {
    e.stopPropagation()
    const { col, row } = toDeviceCoords(dCol, dRow)
    const existing = buttonItems[`${col},${row}`]
    if (existing) {
      onSelectItem(existing.id || null)
    } else {
      const pos = themePos(dCol, dRow)
      const physRow = GRID_ROWS - 1 - dRow
      const linearIdx = physRow * GRID_COLS + dCol
      const item: Item = {
        id: uuidv4(),
        type: 115,
        x: pos.x, y: pos.y,
        w: THEME_ICON_W, h: THEME_ICON_H,
        z: 15,
        col, row,
        itemName: `control${linearIdx + 1}`,
        lock: '1',
        path: '',
        paths: '',
        controlData: '',
        titleParam: JSON.stringify({
          FontFamily: 'Microsoft YaHei', FontSize: 24, FontStyle: '',
          FontUnderline: false, ShowImage: true, ShowTitle: false,
          TitleAlignment: 'bottom', TitleColor: '#ffffff'
        }),
        maxWidth: CANVAS_W,
        maxHeight: CANVAS_H,
        scaledWidthTo: 158,
        scaledHeightTo: 158,
        opacity: 100,
        rotate: 0,
        scale: 1,
        soundFile: '',
        title: '',
      }
      onAddItem(item)
      onSelectItem(item.id || null)
    }
  }, [buttonItems, onSelectItem, onAddItem])

  async function handleSetBackground() {
    const result = await (window as any).sk18.pickBackground()
    if (!result) return
    onAddAsset(result.devicePath, result.dataB64)
    if (bgItem) {
      onUpdateItem({ ...bgItem, path: result.devicePath })
    } else {
      onAddItem({
        id: uuidv4(),
        type: 100,
        x: 0, y: 0,
        w: CANVAS_W, h: CANVAS_H,
        z: -2,
        path: result.devicePath,
        backgroundType: 'main',
        maxWidth: CANVAS_W,
        maxHeight: CANVAS_H,
        rotate: 0,
        scale: 1,
      })
    }
  }

  function handleClearBackground() {
    if (!bgItem) return
    onUpdateItem({ ...bgItem, path: '' })
  }

  return (
    <div className="canvas-wrapper">
      <div className="canvas-controls row">
        <span className="canvas-label">{page.pageName}</span>
        <span className="canvas-dim">{CANVAS_W}x{CANVAS_H}</span>
        <div className="spacer" />
        <button className="small" onClick={handleSetBackground}>Set Background</button>
        {bgPath && (
          <button className="small" onClick={handleClearBackground} title="Remove background">Clear BG</button>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text2)', fontSize: 11 }}>
          Zoom
          <input
            type="range" min="30" max="100" value={Math.round(scale * 100)}
            onChange={e => setScale(Number(e.target.value) / 100)}
            style={{ width: 80 }}
          />
          {Math.round(scale * 100)}%
        </label>
      </div>
      <div
        className="canvas-stage"
        style={{ width: CANVAS_W * scale, height: CANVAS_H * scale }}
        onClick={() => onSelectItem(null)}
      >
        <div
          className="canvas-inner"
          style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
        >
          {/* Background */}
          <div className="canvas-bg" style={{ width: CANVAS_W, height: CANVAS_H }}>
            {bgUrl ? (
              isVideo
                ? <video src={bgUrl} autoPlay loop muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <img src={bgUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
            ) : (
              <div className="canvas-bg-placeholder">
                <span>{bgPath ? `[${bgPath.split('/').pop()}]` : 'No background — click "Set Background"'}</span>
              </div>
            )}
          </div>

          {/* Key grid */}
          {Array.from({ length: GRID_ROWS }, (_, dRow) =>
            Array.from({ length: GRID_COLS }, (_, dCol) => {
              const pos = cellPos(dCol, dRow)
              const { col, row } = toDeviceCoords(dCol, dRow)
              const btnItem = buttonItems[`${col},${row}`]
              const isSelected = btnItem && btnItem.id === selectedItemId
              const iconPath = (btnItem?.path as string) || ''
              const iconB64 = iconPath ? assets[iconPath] : null
              const iconUrl = iconB64 ? dataUrl(iconPath, iconB64) : null
              const label = btnItem ? ((btnItem.title as string) || getActionLabel(btnItem)) : null

              return (
                <div
                  key={`${dCol},${dRow}`}
                  className={`key-cell ${btnItem ? 'has-action' : ''} ${isSelected ? 'selected' : ''}`}
                  style={{ left: pos.x, top: pos.y, width: CELL_W, height: CELL_H }}
                  onClick={e => handleKeyClick(dCol, dRow, e)}
                  title={btnItem ? `(${dCol},${dRow}) — click to edit` : `(${dCol},${dRow}) — click to add`}
                >
                  {iconUrl
                    ? <img src={iconUrl} className="key-icon" alt="" />
                    : !btnItem && <span className="key-pos">{dCol},{dRow}</span>
                  }
                  {label && <span className="key-label">{label}</span>}
                </div>
              )
            })
          )}

          {/* Non-button, non-background items */}
          {page.items
            .filter(i => i.type !== 100 && i.type !== 115)
            .map(item => (
              <div
                key={item.id}
                className={`overlay-item ${item.id === selectedItemId ? 'selected' : ''}`}
                style={{ left: item.x, top: item.y, width: item.w, height: item.h, zIndex: (item.z as number) + 1 }}
                onClick={e => { e.stopPropagation(); onSelectItem(item.id || null) }}
                title={`${ITEM_TYPE_NAMES[item.type] || 'Item'} at (${item.x},${item.y})`}
              >
                <span className="overlay-label">{ITEM_TYPE_NAMES[item.type] || `type ${item.type}`}</span>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  )
}

function getActionLabel(item: Item): string {
  if (!item.controlData) return ''
  return 'Action'
}

const ITEM_TYPE_NAMES: Record<number, string> = {
  100: 'Background',
  102: 'Image',
  109: 'Animation',
  111: 'PicFont',
  113: 'Video',
  114: 'Text/Data',
  115: 'Key'
}
