import React, { useState, useRef } from 'react'
import type { Item, Page } from '../../shared/types'
import { HID_KEYCODES, MODIFIER_BITS } from '../../shared/types'
import { actionToControlData, actionsToControlDataList, controlDataToAction, controlDataListToActions } from '../../shared/qdatastream'
import './ButtonEditor.css'

interface Props {
  item: Item
  allPages: Page[]
  assets: Record<string, string>
  onUpdate: (item: Item) => void
  onAddAsset: (devicePath: string, dataB64: string) => void
}

type ActionMap = Record<string, unknown>

const ACTION_TYPES = [
  { value: 'keyboard', label: 'Keyboard Shortcut' },
  { value: 'text', label: 'Type Text' },
  { value: 'qmk_string', label: 'QMK Type String' },
  { value: 'openWeb', label: 'Open URL' },
  { value: 'openPage', label: 'Open Page (folder)' },
  { value: 'pageSwitch', label: 'Switch to Page' },
  { value: 'oneLevelUp', label: 'Go Back (one level up)' },
  { value: 'playAudio', label: 'Play Audio' },
  { value: 'stopAudio', label: 'Stop Audio' },
  { value: 'deviceVolume', label: 'Set Volume' },
  { value: 'controlMouse', label: 'Mouse Action' },
  { value: 'systemCmd', label: 'Shell Command' },
  { value: 'homeAssistantControl', label: 'Home Assistant' },
  { value: 'obsControl', label: 'OBS Control' },
  { value: 'ControlFlow', label: 'Macro (ControlFlow)' },
  { value: 'delay', label: 'Delay' },
]

export default function ButtonEditor({ item, allPages, assets, onUpdate, onAddAsset }: Props) {
  // Derive action directly from item props — no local state, always in sync
  const action: ActionMap = (item.controlData ? controlDataToAction(item.controlData) : null) || { actionType: 'keyboard' }
  const steps: ActionMap[] = item.controlDataList ? controlDataListToActions(item.controlDataList) : []

  const actionType = (action.actionType as string) || 'keyboard'

  function save(newAction: ActionMap, newSteps: ActionMap[]) {
    const isControlFlow = newAction.actionType === 'ControlFlow'
    onUpdate({
      ...item,
      controlData: actionToControlData(newAction),
      controlDataList: isControlFlow ? actionsToControlDataList(newSteps) : item.controlDataList
    })
  }

  function setField(key: string, value: unknown) {
    save({ ...action, [key]: value }, steps)
  }

  function setActionType(type: string) {
    save({ actionType: type }, steps)
  }

  function addStep() {
    save(action, [...steps, { actionType: 'keyboard' }])
  }

  function updateStep(idx: number, step: ActionMap) {
    save(action, steps.map((s, i) => i === idx ? step : s))
  }

  function deleteStep(idx: number) {
    save(action, steps.filter((_, i) => i !== idx))
  }

  function moveStep(idx: number, dir: -1 | 1) {
    const newSteps = [...steps]
    const target = idx + dir
    if (target < 0 || target >= newSteps.length) return
    ;[newSteps[idx], newSteps[target]] = [newSteps[target], newSteps[idx]]
    save(action, newSteps)
  }

  // Parse key combo string like "Ctrl+Shift+C" -> keyCode integer
  function parseKeyCombo(combo: string): number {
    const parts = combo.split('+').map(s => s.trim())
    let mod = 0
    let keyCode = 0
    for (const p of parts) {
      if (MODIFIER_BITS[p] != null) {
        mod |= MODIFIER_BITS[p]
      } else {
        keyCode = HID_KEYCODES[p.toUpperCase()] || parseInt(p, 16) || 0
      }
    }
    return (mod << 8) | keyCode
  }

  function formatKeyCode(code: number): string {
    const mod = (code >> 8) & 0xFF
    const key = code & 0xFF
    const parts: string[] = []
    for (const [name, bit] of Object.entries(MODIFIER_BITS)) {
      if (mod & bit) parts.push(name)
    }
    const keyName = Object.entries(HID_KEYCODES).find(([, v]) => v === key)?.[0] || `0x${key.toString(16)}`
    parts.push(keyName)
    return parts.join('+')
  }

  const DEFAULT_TITLE_PARAM = {
    FontFamily: 'Microsoft YaHei', FontSize: 24, FontStyle: '',
    FontUnderline: false, ShowImage: true, ShowTitle: true,
    TitleAlignment: 'bottom', TitleColor: '#ffffff'
  }

  function updateTitle(title: string) {
    const hasIcon = !!((item.path as string) || '')
    const param = { ...DEFAULT_TITLE_PARAM, ShowImage: hasIcon, ShowTitle: title.length > 0 }
    onUpdate({ ...item, title, titleParam: JSON.stringify(param) })
  }

  // Icon preview
  const iconPath = (item.path as string) || ''
  const iconB64 = iconPath ? assets[iconPath] : null
  const iconMime = iconPath.endsWith('.gif') ? 'image/gif' : iconPath.endsWith('.jpg') || iconPath.endsWith('.jpeg') ? 'image/jpeg' : 'image/png'
  const iconPreviewUrl = iconB64 ? `data:${iconMime};base64,${iconB64}` : null

  async function pickIcon() {
    const result = await (window as any).sk18.pickIcon()
    if (!result) return
    onAddAsset(result.devicePath, result.dataB64)
    const hasTitle = ((item.title as string) || '').length > 0
    const param = { ...DEFAULT_TITLE_PARAM, ShowImage: true, ShowTitle: hasTitle }
    onUpdate({ ...item, path: result.devicePath, titleParam: JSON.stringify(param) })
  }

  function clearIcon() {
    const hasTitle = ((item.title as string) || '').length > 0
    const param = { ...DEFAULT_TITLE_PARAM, ShowImage: false, ShowTitle: hasTitle }
    onUpdate({ ...item, path: '', titleParam: JSON.stringify(param) })
  }

  return (
    <div className="button-editor">
      <div className="field-group">
        <label>Label</label>
        <input
          value={(item.title as string) || ''}
          onChange={e => updateTitle(e.target.value)}
          placeholder="Optional label shown on button..."
        />
      </div>

      <div className="field-group">
        <label>Icon</label>
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 6, overflow: 'hidden',
            background: '#1a1a2e', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0
          }}>
            {iconPreviewUrl
              ? <img src={iconPreviewUrl} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="" />
              : <span style={{ fontSize: 9, color: 'var(--text2)', textAlign: 'center' }}>
                  {iconPath ? 'device\nicon' : 'none'}
                </span>
            }
          </div>
          <div className="col" style={{ gap: 4, flex: 1 }}>
            <button className="small primary" onClick={pickIcon}>Pick Image...</button>
            {iconPath && (
              <button className="small" onClick={clearIcon}>Clear</button>
            )}
            {iconPath && (
              <span style={{ fontSize: 9, color: 'var(--text2)', wordBreak: 'break-all' }}>
                {iconPath.split('/').pop()}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="field-group">
        <label>Action Type</label>
        <select value={actionType} onChange={e => setActionType(e.target.value)}>
          {ACTION_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {actionType === 'keyboard' && (
        <KeyboardFields
          keyCode={action.keyCode as number}
          onKeyCode={v => setField('keyCode', v)}
          parseKeyCombo={parseKeyCombo}
          formatKeyCode={formatKeyCode}
        />
      )}

      {(actionType === 'text' || actionType === 'qmk_string') && (
        <div className="field-group">
          <label>Text to type</label>
          <textarea
            value={(action.inputText as string) || ''}
            onChange={e => setField('inputText', e.target.value)}
            placeholder="Hello, World!"
          />
        </div>
      )}

      {actionType === 'openWeb' && (
        <div className="field-group">
          <label>URL</label>
          <input
            type="text"
            value={(action.url as string) || ''}
            onChange={e => setField('url', e.target.value)}
            placeholder="https://..."
          />
        </div>
      )}

      {(actionType === 'openPage' || actionType === 'pageSwitch') && (
        <div className="field-group">
          <label>Target Page</label>
          <select
            value={(action.pageId as string) || (allPages[(action.jumpToPage as number) ?? -1]?.id ?? '')}
            onChange={e => {
              const idx = allPages.findIndex(p => p.id === e.target.value)
              const pg = allPages[idx]
              save({ ...action, pageId: e.target.value, pageName: pg?.pageName || '', jumpToPage: idx }, steps)
            }}
          >
            <option value="">-- select page --</option>
            {allPages.map(p => (
              <option key={p.id} value={p.id}>{p.pageName}</option>
            ))}
          </select>
        </div>
      )}

      {actionType === 'playAudio' && (
        <AudioFields
          path={(action.audioPath as string) || ''}
          onChange={v => setField('audioPath', v)}
        />
      )}

      {actionType === 'deviceVolume' && (
        <div className="field-group">
          <label>Volume (0-100)</label>
          <input
            type="number" min={0} max={100}
            value={(action.volumeLevel as number) ?? 50}
            onChange={e => setField('volumeLevel', Number(e.target.value))}
          />
        </div>
      )}

      {actionType === 'controlMouse' && (
        <MouseFields
          action={action}
          onChange={(k, v) => setField(k, v)}
        />
      )}

      {actionType === 'systemCmd' && (
        <div className="field-group">
          <label>Shell Command (one arg per line)</label>
          <textarea
            value={((action.cmdArray as string[]) || []).join('\n')}
            onChange={e => setField('cmdArray', e.target.value.split('\n').filter(Boolean))}
            placeholder={'/bin/sh\n-c\necho hello > /tmp/test'}
            rows={4}
          />
          <span style={{ fontSize: 10, color: 'var(--text2)' }}>
            First line = binary, remaining = args. Runs on the SK18 Linux side.
          </span>
        </div>
      )}

      {actionType === 'homeAssistantControl' && (
        <HAFields action={action} onChange={(k, v) => setField(k, v)} />
      )}

      {actionType === 'obsControl' && (
        <OBSFields action={action} onChange={(k, v) => setField(k, v)} />
      )}

      {actionType === 'delay' && (
        <div className="field-group">
          <label>Delay (ms)</label>
          <input
            type="number" min={1} max={60000}
            value={(action.delayMs as number) || 100}
            onChange={e => setField('delayMs', Number(e.target.value))}
          />
        </div>
      )}

      {actionType === 'ControlFlow' && (
        <ControlFlowEditor
          steps={steps}
          allPages={allPages}
          onAdd={addStep}
          onUpdate={updateStep}
          onDelete={deleteStep}
          onMove={moveStep}
        />
      )}

      <div className="field-group">
        <label>Sound on press (optional)</label>
        <PathField
          value={(item.soundFile as string) || ''}
          placeholder="path/to/sound.mp3"
          onChange={v => onUpdate({ ...item, soundFile: v })}
        />
      </div>

      <div className="raw-data">
        <span className="section-title">Raw controlData</span>
        <code>{item.controlData ? item.controlData.slice(0, 60) + '...' : '(empty)'}</code>
      </div>
    </div>
  )
}

// Sub-components

function KeyboardFields({ keyCode, onKeyCode, parseKeyCombo, formatKeyCode }: {
  keyCode: number
  onKeyCode: (v: number) => void
  parseKeyCombo: (s: string) => number
  formatKeyCode: (n: number) => string
}) {
  const [raw, setRaw] = useState(keyCode ? formatKeyCode(keyCode) : '')
  const rawRef = useRef(raw)

  return (
    <div className="field-group">
      <label>Key combo (e.g. LCtrl+C, LShift+F5, F1)</label>
      <input
        value={raw}
        onChange={e => {
          rawRef.current = e.target.value
          setRaw(e.target.value)
          const kc = parseKeyCombo(e.target.value)
          if (kc > 0) onKeyCode(kc)
        }}
        onBlur={() => onKeyCode(parseKeyCombo(rawRef.current))}
        placeholder="LCtrl+C"
      />
      <span style={{ fontSize: 10, color: 'var(--text2)' }}>
        Modifiers: LCtrl, LShift, LAlt, LWin, RCtrl, RShift, RAlt, RWin
      </span>
      {keyCode > 0 && (
        <span style={{ fontSize: 10, color: 'var(--accent2)' }}>
          Raw: 0x{keyCode.toString(16).padStart(4, '0')} ({keyCode})
        </span>
      )}
    </div>
  )
}

function AudioFields({ path, onChange }: { path: string; onChange: (v: string) => void }) {
  async function pick() {
    const p = await (window as any).sk18.pickMedia()
    if (p) onChange(p)
  }
  return (
    <div className="field-group">
      <label>Audio file path (on device)</label>
      <div className="row">
        <input value={path} onChange={e => onChange(e.target.value)} placeholder="/data/sounds/..." style={{ flex: 1 }} />
        <button className="small" onClick={pick}>Browse</button>
      </div>
    </div>
  )
}

function PathField({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (v: string) => void }) {
  async function pick() {
    const p = await (window as any).sk18.pickMedia()
    if (p) onChange(p)
  }
  return (
    <div className="row">
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{ flex: 1 }} />
      <button className="small" onClick={pick}>Browse</button>
    </div>
  )
}

function MouseFields({ action, onChange }: { action: ActionMap; onChange: (k: string, v: unknown) => void }) {
  return (
    <div className="col">
      <div className="field-group">
        <label>Mouse Action</label>
        <select
          value={(action.mouseAction as string) || 'click'}
          onChange={e => onChange('mouseAction', e.target.value)}
        >
          <option value="click">Click</option>
          <option value="rightClick">Right Click</option>
          <option value="doubleClick">Double Click</option>
          <option value="moveRelative">Move Relative</option>
          <option value="scroll">Scroll</option>
        </select>
      </div>
      {(action.mouseAction === 'moveRelative' || action.mouseAction === 'scroll') && (
        <div className="row">
          <div className="field-group" style={{ flex: 1 }}>
            <label>X</label>
            <input type="number" value={(action.mouseX as number) || 0} onChange={e => onChange('mouseX', Number(e.target.value))} />
          </div>
          <div className="field-group" style={{ flex: 1 }}>
            <label>Y</label>
            <input type="number" value={(action.mouseY as number) || 0} onChange={e => onChange('mouseY', Number(e.target.value))} />
          </div>
        </div>
      )}
    </div>
  )
}

function HAFields({ action, onChange }: { action: ActionMap; onChange: (k: string, v: unknown) => void }) {
  return (
    <div className="col">
      <div className="field-group">
        <label>Entity ID</label>
        <input
          value={(action.entity_id as string) || ''}
          onChange={e => onChange('entity_id', e.target.value)}
          placeholder="light.living_room"
        />
      </div>
      <div className="field-group">
        <label>Service</label>
        <input
          value={(action.haService as string) || ''}
          onChange={e => onChange('haService', e.target.value)}
          placeholder="homeassistant.toggle"
        />
      </div>
    </div>
  )
}

function OBSFields({ action, onChange }: { action: ActionMap; onChange: (k: string, v: unknown) => void }) {
  return (
    <div className="col">
      <div className="field-group">
        <label>OBS Action</label>
        <select
          value={(action.obsAction as string) || 'ToggleRecord'}
          onChange={e => onChange('obsAction', e.target.value)}
        >
          <option value="ToggleRecord">Toggle Recording</option>
          <option value="GetRecordStatus">Get Record Status</option>
          <option value="GetSceneItemEnabled">Get Scene Item Enabled</option>
          <option value="SetSceneItemEnabled">Set Scene Item Enabled</option>
        </select>
      </div>
      {(action.obsAction as string)?.includes('Scene') && (
        <div className="field-group">
          <label>Scene Name</label>
          <input
            value={(action.obsScene as string) || ''}
            onChange={e => onChange('obsScene', e.target.value)}
            placeholder="Scene 1"
          />
        </div>
      )}
    </div>
  )
}

function ControlFlowEditor({ steps, allPages, onAdd, onUpdate, onDelete, onMove }: {
  steps: ActionMap[]
  allPages: Page[]
  onAdd: () => void
  onUpdate: (idx: number, step: ActionMap) => void
  onDelete: (idx: number) => void
  onMove: (idx: number, dir: -1 | 1) => void
}) {
  return (
    <div className="cf-editor">
      <div className="row">
        <span className="section-title" style={{ flex: 1 }}>Macro Steps</span>
        <button className="small primary" onClick={onAdd}>+ Add Step</button>
      </div>
      {steps.length === 0 && (
        <p style={{ color: 'var(--text2)', fontSize: 11 }}>No steps yet. Add a step to build a macro.</p>
      )}
      {steps.map((step, idx) => (
        <div key={idx} className="cf-step">
          <div className="cf-step-header">
            <span className="cf-step-num">{idx + 1}</span>
            <select
              value={(step.actionType as string) || 'keyboard'}
              onChange={e => onUpdate(idx, { ...step, actionType: e.target.value })}
              style={{ flex: 1 }}
            >
              {ACTION_TYPES.filter(t => t.value !== 'ControlFlow').map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <div className="row" style={{ gap: 2 }}>
              <button className="small" onClick={() => onMove(idx, -1)} disabled={idx === 0} title="Move up">^</button>
              <button className="small" onClick={() => onMove(idx, 1)} disabled={idx === steps.length - 1} title="Move down">v</button>
              <button className="small danger" onClick={() => onDelete(idx)} title="Remove step">✕</button>
            </div>
          </div>
          <div className="cf-step-body">
            <StepFields step={step} allPages={allPages} onUpdate={s => onUpdate(idx, s)} />
          </div>
        </div>
      ))}
    </div>
  )
}

function StepFields({ step, allPages, onUpdate }: { step: ActionMap; allPages: Page[]; onUpdate: (s: ActionMap) => void }) {
  const type = (step.actionType as string) || 'keyboard'
  function f(k: string, v: unknown) { onUpdate({ ...step, [k]: v }) }

  if (type === 'keyboard') {
    return (
      <div className="field-group">
        <label>Key combo</label>
        <input
          value={(step.keyComboRaw as string) || ''}
          onChange={e => {
            const parts = e.target.value.split('+').map(s => s.trim())
            let mod = 0, code = 0
            for (const p of parts) {
              if (MODIFIER_BITS[p] != null) mod |= MODIFIER_BITS[p]
              else code = HID_KEYCODES[p.toUpperCase()] || parseInt(p, 16) || 0
            }
            f('keyCode', (mod << 8) | code)
            f('keyComboRaw', e.target.value)
          }}
          placeholder="LCtrl+C"
        />
      </div>
    )
  }
  if (type === 'text' || type === 'qmk_string') {
    return (
      <div className="field-group">
        <label>Text</label>
        <input value={(step.inputText as string) || ''} onChange={e => f('inputText', e.target.value)} />
      </div>
    )
  }
  if (type === 'delay') {
    return (
      <div className="field-group">
        <label>Delay (ms)</label>
        <input type="number" value={(step.delayMs as number) || 100} onChange={e => f('delayMs', Number(e.target.value))} />
      </div>
    )
  }
  if (type === 'openWeb') {
    return (
      <div className="field-group">
        <label>URL</label>
        <input value={(step.url as string) || ''} onChange={e => f('url', e.target.value)} placeholder="https://..." />
      </div>
    )
  }
  if (type === 'pageSwitch' || type === 'openPage') {
    return (
      <div className="field-group">
        <label>Target Page</label>
        <select value={(step.pageId as string) || (allPages[(step.jumpToPage as number) ?? -1]?.id ?? '')} onChange={e => {
          const idx = allPages.findIndex(p => p.id === e.target.value)
          const pg = allPages[idx]
          onUpdate({ ...step, pageId: e.target.value, pageName: pg?.pageName || '', jumpToPage: idx })
        }}>
          <option value="">-- select --</option>
          {allPages.map(p => <option key={p.id} value={p.id}>{p.pageName}</option>)}
        </select>
      </div>
    )
  }
  if (type === 'systemCmd') {
    return (
      <div className="field-group">
        <label>Shell command (one arg per line)</label>
        <textarea
          value={((step.cmdArray as string[]) || []).join('\n')}
          onChange={e => f('cmdArray', e.target.value.split('\n').filter(Boolean))}
          rows={3}
        />
      </div>
    )
  }
  return null
}
