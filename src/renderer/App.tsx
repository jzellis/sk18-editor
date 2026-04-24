import React, { useState, useCallback } from 'react'
import { useTheme } from './hooks/useTheme'
import Toolbar from './components/Toolbar'
import PageList from './components/PageList'
import Canvas from './components/Canvas'
import ItemPanel from './components/ItemPanel'
import DevicePanel from './components/DevicePanel'
import type { Item } from '../shared/types'
import './App.css'

export default function App() {
  const {
    state, newTheme, loadTheme, saveTheme, saveThemeAs,
    addPage, deletePage, renamePage, setCurrentPage,
    updatePage, upsertItem, deleteItem
  } = useTheme()

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)

  const currentPage = state.theme?.pages.find(p => p.id === state.currentPageId) || null
  const selectedItem = currentPage?.items.find(i => i.id === selectedItemId) || null

  const handleSelectPage = useCallback((id: string) => {
    setSelectedItemId(null)
    setCurrentPage(id)
  }, [setCurrentPage])

  const handleSelectItem = useCallback((id: string | null) => {
    setSelectedItemId(id)
  }, [])

  const handleUpdateItem = useCallback((item: Item) => {
    if (!state.currentPageId) return
    upsertItem(state.currentPageId, item)
  }, [state.currentPageId, upsertItem])

  const handleDeleteItem = useCallback((itemId: string) => {
    if (!state.currentPageId) return
    deleteItem(state.currentPageId, itemId)
    setSelectedItemId(null)
  }, [state.currentPageId, deleteItem])

  const handleAddItem = useCallback((item: Item) => {
    if (!state.currentPageId) return
    upsertItem(state.currentPageId, item)
    setSelectedItemId(item.id || null)
  }, [state.currentPageId, upsertItem])

  if (!state.theme) {
    return (
      <div className="welcome">
        <div className="welcome-box">
          <h1>SK18 Theme Editor</h1>
          <p>Create or open an SK18 .Theme file</p>
          <div className="row" style={{ justifyContent: 'center', gap: 12 }}>
            <button className="primary" onClick={newTheme}>New Theme</button>
            <button onClick={loadTheme}>Open .Theme File</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-layout">
      <Toolbar
        filePath={state.filePath}
        dirty={state.dirty}
        onNew={newTheme}
        onOpen={loadTheme}
        onSave={saveTheme}
        onSaveAs={saveThemeAs}
      />
      <div className="app-body">
        <PageList
          pages={state.theme.pages}
          currentPageId={state.currentPageId}
          onSelect={handleSelectPage}
          onAdd={addPage}
          onDelete={deletePage}
          onRename={renamePage}
        />
        <div className="canvas-area">
          {currentPage && (
            <Canvas
              page={currentPage}
              selectedItemId={selectedItemId}
              onSelectItem={handleSelectItem}
              onAddItem={handleAddItem}
              onUpdateItem={handleUpdateItem}
            />
          )}
        </div>
        <div className="right-col">
          <ItemPanel
            item={selectedItem}
            page={currentPage}
            allPages={state.theme.pages}
            onUpdate={handleUpdateItem}
            onDelete={handleDeleteItem}
          />
          <DevicePanel
            theme={state.theme}
            imageBlobB64={state.imageBlobB64}
            currentFilePath={state.filePath}
          />
        </div>
      </div>
    </div>
  )
}
