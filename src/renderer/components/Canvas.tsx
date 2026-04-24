import React, { useCallback, useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { Page, Item } from '../../shared/types'
import { CANVAS_W, CANVAS_H, GRID_COLS, GRID_ROWS } from '../../shared/types'
import './Canvas.css'

// The 6x3 button grid as rendered on the 1280x720 canvas
// Buttons are 160x160 with some padding, grid starts at ~120x60
// Based on the SK18 default theme layout
const KEY_W = 160
const KEY_H = 160
const GRID_X = 120
const GRID_Y = 60
const KEY_GAP_X = (CANVAS_W - GRID_X * 2 - KEY_W * GRID_COLS) / (GRID_COLS - 1)
const KEY_GAP_Y = (CANVAS_H - GRID_Y * 2 - KEY_H * GRID_ROWS) / (GRID_ROWS - 1)

function keyPos(col: number, row: number) {
  return {
    x: GRID_X + col * (KEY_W + KEY_GAP_X),
    y: GRID_Y + row * (KEY_H + KEY_GAP_Y)
  }
}

interface Props {
  page: Page
  selectedItemId: string | null
  onSelectItem: (id: string | null) => void
  onAddItem: (item: Item) => void
  onUpdateItem: (item: Item) => void
}

export default function Canvas({ page, selectedItemId, onSelectItem, onAddItem, onUpdateItem }: Props) {
  const [bgDataUrl, setBgDataUrl] = useState<string | null>(null)
  const [scale, setScale] = useState(0.7)

  // Load background image
  const bgItem = page.items.find(i => i.type === 100 && i.path)
  useEffect(() => {
    setBgDataUrl(null)
    if (!bgItem?.path) return
    ;(window as any).sk18.readDataUrl(bgItem.path).then((url: string | null) => {
      setBgDataUrl(url)
    })
  }, [bgItem?.path])

  // Find button items by col/row
  const buttonItems: Record<string, Item> = {}
  for (const item of page.items) {
    if (item.type === 115 && item.col != null && item.row != null) {
      buttonItems[`${item.col},${item.row}`] = item
    }
  }

  // Image overlays per button col/row
  const overlayItems: Record<string, Item[]> = {}
  for (const item of page.items) {
    if (item.type === 102 || item.type === 109) {
      const key = `overlay_${item.id}`
      overlayItems[key] = overlayItems[key] || []
    }
  }

  function handleKeyClick(col: number, row: number, e: React.MouseEvent) {
    e.stopPropagation()
    const existing = buttonItems[`${col},${row}`]
    if (existing) {
      onSelectItem(existing.id || null)
    } else {
      // Create new button item at this grid position
      const pos = keyPos(col, row)
      const item: Item = {
        id: uuidv4(),
        type: 115,
        x: pos.x,
        y: pos.y,
        w: KEY_W,
        h: KEY_H,
        z: 10,
        col,
        row,
        controlData: ''
      }
      onAddItem(item)
    }
  }

  async function handleSetBackground() {
    const path = await (window as any).sk18.pickMedia()
    if (!path) return
    const bgItem = page.items.find(i => i.type === 100)
    if (bgItem) {
      onUpdateItem({ ...bgItem, path })
    } else {
      onAddItem({
        id: uuidv4(),
        type: 100,
        x: 0, y: 0,
        w: CANVAS_W, h: CANVAS_H,
        z: 0,
        path
      })
    }
  }

  return (
    <div className="canvas-wrapper">
      <div className="canvas-controls row">
        <span className="canvas-label">{page.pageName}</span>
        <span className="canvas-dim">{CANVAS_W}x{CANVAS_H}</span>
        <div className="spacer" />
        <button className="small" onClick={handleSetBackground}>Set Background</button>
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
            {bgDataUrl ? (
              <img src={bgDataUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
            ) : (
              <div className="canvas-bg-placeholder">
                <span>No background — click "Set Background"</span>
              </div>
            )}
          </div>

          {/* Key grid overlay */}
          {Array.from({ length: GRID_ROWS }, (_, row) =>
            Array.from({ length: GRID_COLS }, (_, col) => {
              const pos = keyPos(col, row)
              const key = `${col},${row}`
              const btnItem = buttonItems[key]
              const isSelected = btnItem && btnItem.id === selectedItemId
              return (
                <div
                  key={key}
                  className={`key-cell ${btnItem ? 'has-action' : ''} ${isSelected ? 'selected' : ''}`}
                  style={{ left: pos.x, top: pos.y, width: KEY_W, height: KEY_H }}
                  onClick={e => handleKeyClick(col, row, e)}
                  title={btnItem ? `Key (${col},${row}) - click to edit` : `Key (${col},${row}) - click to add action`}
                >
                  <span className="key-label">
                    {btnItem ? getActionLabel(btnItem) : `${col+1},${row+1}`}
                  </span>
                  <span className="key-pos">{col},{row}</span>
                </div>
              )
            })
          )}

          {/* Non-button items: overlays, text, etc */}
          {page.items
            .filter(i => i.type !== 100 && i.type !== 115)
            .map(item => {
              const isSelected = item.id === selectedItemId
              return (
                <div
                  key={item.id}
                  className={`overlay-item ${isSelected ? 'selected' : ''}`}
                  style={{ left: item.x, top: item.y, width: item.w, height: item.h, zIndex: item.z + 1 }}
                  onClick={e => { e.stopPropagation(); onSelectItem(item.id || null) }}
                  title={`${ITEM_TYPE_NAMES[item.type] || 'Item'} at (${item.x},${item.y})`}
                >
                  <span className="overlay-label">{ITEM_TYPE_NAMES[item.type] || `type ${item.type}`}</span>
                </div>
              )
            })
          }
        </div>
      </div>
    </div>
  )
}

function getActionLabel(item: Item): string {
  if (!item.controlData) return '(no action)'
  // Just show that an action is configured; full decode is in ItemPanel
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
