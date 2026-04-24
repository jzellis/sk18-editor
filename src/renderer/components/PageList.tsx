import React, { useState } from 'react'
import type { Page } from '../../shared/types'
import './PageList.css'

interface Props {
  pages: Page[]
  currentPageId: string | null
  onSelect: (id: string) => void
  onAdd: () => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
}

export default function PageList({ pages, currentPageId, onSelect, onAdd, onDelete, onRename }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  function startRename(page: Page) {
    setEditingId(page.id)
    setEditName(page.pageName)
  }

  function commitRename(id: string) {
    if (editName.trim()) onRename(id, editName.trim())
    setEditingId(null)
  }

  return (
    <div className="page-list">
      <div className="page-list-header">
        <span>Pages</span>
        <button className="small primary" onClick={onAdd} title="Add page">+</button>
      </div>
      <div className="page-list-items">
        {pages.map((page, idx) => (
          <div
            key={page.id}
            className={`page-item ${page.id === currentPageId ? 'active' : ''}`}
            onClick={() => onSelect(page.id)}
          >
            <span className="page-num">{idx + 1}</span>
            {editingId === page.id ? (
              <input
                autoFocus
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onBlur={() => commitRename(page.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitRename(page.id)
                  if (e.key === 'Escape') setEditingId(null)
                }}
                onClick={e => e.stopPropagation()}
                style={{ flex: 1, minWidth: 0 }}
              />
            ) : (
              <span className="page-name" onDoubleClick={e => { e.stopPropagation(); startRename(page) }}>
                {page.pageName}
              </span>
            )}
            <div className="page-actions" onClick={e => e.stopPropagation()}>
              <button className="small" title="Rename" onClick={() => startRename(page)}>
                ✎
              </button>
              <button
                className="small danger"
                title="Delete page"
                disabled={pages.length <= 1}
                onClick={() => onDelete(page.id)}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
