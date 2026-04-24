import React from 'react'
import type { Item } from '../../shared/types'

interface Props {
  item: Item
  onUpdate: (item: Item) => void
}

export default function OverlayEditor({ item, onUpdate }: Props) {
  function f(key: string, value: unknown) {
    onUpdate({ ...item, [key]: value })
  }

  async function pickMedia() {
    const p = await (window as any).sk18.pickMedia()
    if (p) f('path', p)
  }

  async function pickDir() {
    const result = await (window as any).sk18.pickDirectory()
    if (result?.dir) {
      f('paths', result.dir)
      if (result.frameCount > 0 && !item.frameDelays) {
        const delays = Array(result.frameCount).fill(100).join(',')
        onUpdate({ ...item, paths: result.dir, frameDelays: delays })
      }
    }
  }

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="field-group">
        <label>Position X</label>
        <input type="number" value={item.x} onChange={e => f('x', Number(e.target.value))} />
      </div>
      <div className="field-group">
        <label>Position Y</label>
        <input type="number" value={item.y} onChange={e => f('y', Number(e.target.value))} />
      </div>
      <div className="row">
        <div className="field-group" style={{ flex: 1 }}>
          <label>Width</label>
          <input type="number" value={item.w} onChange={e => f('w', Number(e.target.value))} />
        </div>
        <div className="field-group" style={{ flex: 1 }}>
          <label>Height</label>
          <input type="number" value={item.h} onChange={e => f('h', Number(e.target.value))} />
        </div>
      </div>
      <div className="field-group">
        <label>Z-order</label>
        <input type="number" value={item.z} onChange={e => f('z', Number(e.target.value))} />
      </div>

      {(item.type === 102 || item.type === 100 || item.type === 113) && (
        <div className="field-group">
          <label>File path</label>
          <div className="row">
            <input value={(item.path as string) || ''} onChange={e => f('path', e.target.value)} placeholder="path/to/image.png" style={{ flex: 1 }} />
            <button className="small" onClick={pickMedia}>Browse</button>
          </div>
        </div>
      )}

      {item.type === 109 && (
        <>
          <div className="field-group">
            <label>Frame directory (contains frame_0.png, frame_1.png...)</label>
            <div className="row">
              <input value={(item.paths as string) || ''} onChange={e => f('paths', e.target.value)} style={{ flex: 1 }} />
              <button className="small" onClick={pickDir}>Browse Dir</button>
            </div>
          </div>
          <div className="field-group">
            <label>Frame delays (ms, comma-separated)</label>
            <input
              value={(item.frameDelays as string) || ''}
              onChange={e => f('frameDelays', e.target.value)}
              placeholder="100,100,100"
            />
          </div>
        </>
      )}

      {item.type === 114 && (
        <>
          <div className="field-group">
            <label>System data name</label>
            <select
              value={(item.system_data_name as string) || ''}
              onChange={e => f('system_data_name', e.target.value)}
            >
              <option value="">-- none --</option>
              <option value="CPU Temperature">CPU Temperature</option>
              <option value="GPU Temperature">GPU Temperature</option>
              <option value="GPU Usage">GPU Usage (%)</option>
              <option value="RAM Usage">RAM Usage (%)</option>
              <option value="Upload Speed">Upload Speed</option>
              <option value="Download Speed">Download Speed</option>
              <option value="Disk Temperature0">Disk Temperature</option>
              <option value="avg_dB">Audio Level (avg_dB)</option>
            </select>
          </div>
          <div className="field-group">
            <label>Data flag (1=from host serial, 0=device local)</label>
            <select
              value={String(item.system_data_flag ?? '1')}
              onChange={e => f('system_data_flag', e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="1">1 - from host (Linux daemon)</option>
              <option value="0">0 - device local (time, weather)</option>
              <option value="">Audio level</option>
            </select>
          </div>
          <div className="row">
            <div className="field-group" style={{ flex: 1 }}>
              <label>Min value</label>
              <input type="number" value={(item.system_data_min_value as number) ?? 0} onChange={e => f('system_data_min_value', Number(e.target.value))} />
            </div>
            <div className="field-group" style={{ flex: 1 }}>
              <label>Max value</label>
              <input type="number" value={(item.system_data_max_value as number) ?? 100} onChange={e => f('system_data_max_value', Number(e.target.value))} />
            </div>
          </div>
          <div className="field-group">
            <label>Show unit</label>
            <input type="checkbox" checked={!!item.showUnit} onChange={e => f('showUnit', e.target.checked)} />
          </div>
        </>
      )}

      {item.type === 111 && (
        <>
          <div className="field-group">
            <label>Digit image directory (0.png - 9.png)</label>
            <div className="row">
              <input value={(item.paths as string) || ''} onChange={e => f('paths', e.target.value)} style={{ flex: 1 }} />
              <button className="small" onClick={pickDir}>Browse Dir</button>
            </div>
          </div>
          <div className="field-group">
            <label>System data name (value to display)</label>
            <select
              value={(item.system_data_name as string) || ''}
              onChange={e => f('system_data_name', e.target.value)}
            >
              <option value="">-- none --</option>
              <option value="CPU Temperature">CPU Temperature</option>
              <option value="GPU Temperature">GPU Temperature</option>
              <option value="GPU Usage">GPU Usage (%)</option>
              <option value="RAM Usage">RAM Usage (%)</option>
            </select>
          </div>
        </>
      )}
    </div>
  )
}
