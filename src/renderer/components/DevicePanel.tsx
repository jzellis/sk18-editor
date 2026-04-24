import React, { useState, useEffect, useCallback } from 'react'
import type { ThemeFile } from '../../shared/types'
import './DevicePanel.css'

interface ThemeEntry {
  filePath: string
  crc: string
}

interface Props {
  theme: ThemeFile | null
  imageBlobB64: string
  currentFilePath: string | null
}

type ConnectState = 'disconnected' | 'connecting' | 'connected' | 'error'

export default function DevicePanel({ theme, imageBlobB64, currentFilePath }: Props) {
  const [connectState, setConnectState] = useState<ConnectState>('disconnected')
  const [detectedPort, setDetectedPort] = useState<string | null>(null)
  const [deviceInfo, setDeviceInfo] = useState<Record<string, unknown> | null>(null)
  const [deviceThemes, setDeviceThemes] = useState<ThemeEntry[]>([])
  const [pushPath, setPushPath] = useState('/data/theme/SK18/My Theme.Theme')
  const [progress, setProgress] = useState<{ pct: number; msg: string } | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  // Auto-detect port on mount and when expanded
  useEffect(() => {
    if (!expanded) return
    ;(window as any).sk18.deviceFindPort().then((port: string | null) => {
      setDetectedPort(port)
    })
  }, [expanded])

  // Listen for push progress
  useEffect(() => {
    const off = (window as any).sk18.onDeviceProgress((data: { pct: number; msg: string }) => {
      setProgress(data)
    })
    return off
  }, [])

  // Listen for USB hotplug auto-connect events from main process
  useEffect(() => {
    const off = (window as any).sk18.onDeviceHotplug((data: { portPath: string; status: string; info?: unknown; error?: string }) => {
      setDetectedPort(data.portPath)
      if (data.status === 'connecting') {
        setConnectState('connecting')
        setLastError(null)
        setExpanded(true)
      } else if (data.status === 'connected') {
        setConnectState('connected')
        setDeviceInfo(data.info as Record<string, unknown>)
        setDeviceThemes([])
      } else if (data.status === 'error') {
        setConnectState('error')
        setLastError(data.error || 'Connection failed')
      }
    })
    return off
  }, [])

  // Check connection state on mount
  useEffect(() => {
    ;(window as any).sk18.deviceIsConnected().then((connected: boolean) => {
      if (connected) setConnectState('connected')
    })
  }, [])

  const connect = useCallback(async () => {
    const port = detectedPort
    if (!port) { setLastError('No SK18 device found. Is it plugged in?'); return }
    setConnectState('connecting')
    setLastError(null)
    const result = await (window as any).sk18.deviceConnect(port)
    if (result.ok) {
      setConnectState('connected')
      setDeviceInfo(result.info)
    } else {
      setConnectState('error')
      setLastError(result.error)
    }
  }, [detectedPort])

  const disconnect = useCallback(async () => {
    await (window as any).sk18.deviceDisconnect()
    setConnectState('disconnected')
    setDeviceInfo(null)
    setDeviceThemes([])
  }, [])

  const listThemes = useCallback(async () => {
    const result = await (window as any).sk18.deviceListThemes()
    if (result.ok) setDeviceThemes(result.themes)
    else setLastError(result.error)
  }, [])

  const pushTheme = useCallback(async () => {
    if (!theme) return
    setProgress({ pct: 0, msg: 'Starting...' })
    setLastError(null)
    const result = await (window as any).sk18.devicePushTheme(theme, imageBlobB64, pushPath)
    if (!result.ok) {
      setLastError(result.error)
      setProgress(null)
    }
  }, [theme, imageBlobB64, pushPath])

  const isConnected = connectState === 'connected'

  return (
    <div className={`device-panel ${expanded ? 'expanded' : ''}`}>
      <div className="device-panel-header" onClick={() => setExpanded(e => !e)}>
        <div className={`device-dot ${connectState}`} />
        <span className="device-title">Device</span>
        {isConnected && deviceInfo && (
          <span className="device-model">{String(deviceInfo.deviceModel || 'SK18')}</span>
        )}
        {detectedPort && !isConnected && (
          <span className="device-port">{detectedPort}</span>
        )}
        <span className="device-chevron">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className="device-panel-body">
          {!isConnected ? (
            <div className="col" style={{ gap: 8 }}>
              {connectState === 'connecting' ? (
                <span className="device-found">Connecting to {detectedPort}... (sending init, takes ~10s)</span>
              ) : detectedPort ? (
                <span className="device-found">SK18 found on {detectedPort}</span>
              ) : (
                <span className="device-notfound">No SK18 detected. Plug in via USB.</span>
              )}
              <span style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.5 }}>
                Auto-connect triggers on USB plug-in. Unplug and replug to connect.
                Screen will go blank while connected (normal).
              </span>
              <button
                className="primary"
                onClick={connect}
                disabled={connectState === 'connecting' || !detectedPort}
              >
                {connectState === 'connecting' ? 'Connecting...' : 'Connect'}
              </button>
              {lastError && <span className="device-error">{lastError}</span>}
            </div>
          ) : (
            <div className="col" style={{ gap: 10 }}>
              <div className="row">
                <span className="device-found">
                  Connected &mdash; {String(deviceInfo?.deviceModel || 'SK18')}&nbsp;
                  {deviceInfo?.deviceWidth ? `${deviceInfo.deviceWidth}x${deviceInfo.deviceHeight}` : ''}
                </span>
                <div className="spacer" />
                <button className="small" onClick={disconnect}>Disconnect</button>
              </div>

              <div className="device-section">
                <span className="section-title">Push Theme to Device</span>
                <label style={{ marginTop: 6 }}>Destination path on device</label>
                <input
                  value={pushPath}
                  onChange={e => setPushPath(e.target.value)}
                  placeholder="/data/theme/SK18/My Theme.Theme"
                />
                <div className="row" style={{ marginTop: 6 }}>
                  <button
                    className="primary"
                    disabled={!theme || !!progress}
                    onClick={pushTheme}
                    style={{ flex: 1 }}
                  >
                    {progress ? `Pushing... ${progress.pct}%` : 'Push Theme'}
                  </button>
                </div>
                {progress && (
                  <div className="push-progress">
                    <div className="push-bar" style={{ width: `${progress.pct}%` }} />
                    <span>{progress.msg}</span>
                  </div>
                )}
                {lastError && <span className="device-error">{lastError}</span>}
              </div>

              <div className="device-section">
                <div className="row">
                  <span className="section-title">Themes on Device</span>
                  <div className="spacer" />
                  <button className="small" onClick={listThemes}>Refresh</button>
                </div>
                {deviceThemes.length === 0 ? (
                  <span style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
                    Click Refresh to list themes on device.
                  </span>
                ) : (
                  <div className="theme-list">
                    {deviceThemes.map(t => (
                      <div key={t.filePath} className="theme-entry" onClick={() => setPushPath(t.filePath)}>
                        <span className="theme-entry-path">{t.filePath.split('/').pop()}</span>
                        <span className="theme-entry-full">{t.filePath}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
