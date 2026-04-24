import React from 'react'
import './Toolbar.css'

interface Props {
  filePath: string | null
  dirty: boolean
  onNew: () => void
  onOpen: () => void
  onSave: () => void
  onSaveAs: () => void
}

export default function Toolbar({ filePath, dirty, onNew, onOpen, onSave, onSaveAs }: Props) {
  const fileName = filePath ? filePath.split('/').pop() : 'Untitled'

  return (
    <div className="toolbar">
      <span className="toolbar-brand">SK18</span>
      <div className="toolbar-sep" />
      <button onClick={onNew}>New</button>
      <button onClick={onOpen}>Open</button>
      <button className="primary" onClick={onSave} disabled={!dirty && !!filePath}>
        {filePath ? 'Save' : 'Save As'}
      </button>
      <button onClick={onSaveAs}>Save As</button>
      <div className="spacer" />
      <span className="toolbar-filename">
        {fileName}{dirty ? ' *' : ''}
      </span>
      {filePath && (
        <span className="toolbar-path" title={filePath}>{filePath}</span>
      )}
    </div>
  )
}
