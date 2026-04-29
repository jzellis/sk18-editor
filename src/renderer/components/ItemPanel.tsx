import React from 'react'
import type { Item, Page } from '../../shared/types'
import ButtonEditor from './ButtonEditor'
import OverlayEditor from './OverlayEditor'
import './ItemPanel.css'

interface Props {
  item: Item | null
  page: Page | null
  allPages: Page[]
  assets: Record<string, string>
  onUpdate: (item: Item) => void
  onDelete: (id: string) => void
  onAddAsset: (devicePath: string, dataB64: string) => void
}

export default function ItemPanel({ item, page, allPages, assets, onUpdate, onDelete, onAddAsset }: Props) {
  if (!item) {
    return (
      <div className="item-panel empty">
        <div className="item-panel-hint">
          <p>Click a key to add or edit an action.</p>
          <p>Click an overlay widget to edit it.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="item-panel">
      <div className="item-panel-header">
        <span>{ITEM_TYPE_NAMES[item.type] || `Type ${item.type}`}</span>
        {item.type === 115 && item.col != null && (
          <span className="item-panel-pos">col {item.col}, row {item.row}</span>
        )}
<div className="spacer" />
        <button className="small danger" onClick={() => onDelete(item.id!)}>Remove</button>
      </div>
      <div className="item-panel-body">
        {item.type === 115 ? (
          <ButtonEditor key={item.id} item={item} allPages={allPages} assets={assets} onUpdate={onUpdate} onAddAsset={onAddAsset} />
        ) : (
          <OverlayEditor key={item.id} item={item} onUpdate={onUpdate} />
        )}
      </div>
    </div>
  )
}

const ITEM_TYPE_NAMES: Record<number, string> = {
  100: 'Background',
  102: 'Image Overlay',
  109: 'Animation',
  111: 'Picture Font',
  113: 'Video',
  114: 'Text / System Data',
  115: 'Key Button'
}
