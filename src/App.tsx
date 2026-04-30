import { useState, useEffect, useRef, useCallback } from 'react'
import { Sidebar } from './components/Sidebar'
import { Canvas } from './components/Canvas'
import { Settings } from './components/Settings'
import { Settings as SettingsIcon, Layers, Plus, X, Download, ArrowDownCircle, CheckCircle2 } from 'lucide-react'

interface Workspace {
  id: string;
  name: string;
}

function App() {
  const [showSettings, setShowSettings] = useState(false)
  const [userId, setUserId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [placedItemKeys, setPlacedItemKeys] = useState<Set<string>>(new Set())
  const [crossPageItems, setCrossPageItems] = useState<Map<string, string[]>>(new Map())
  const handlePlacedKeysChange = useCallback((keys: Set<string>, cross: Map<string, string[]>) => {
    setPlacedItemKeys(keys)
    setCrossPageItems(cross)
  }, [])
  const [currentVersion, setCurrentVersion] = useState('')
  const [updateState, setUpdateState] = useState<{
    phase: 'idle' | 'available' | 'downloading' | 'ready';
    version: string; releaseNotes: string; percent: number; dismissed: boolean;
  }>({ phase: 'idle', version: '', releaseNotes: '', percent: 0, dismissed: false })

  const loadSettings = async () => {
    const id = await window.ipcRenderer.invoke('get-store-value', 'zotero-user-id')
    const key = await window.ipcRenderer.invoke('get-store-value', 'zotero-api-key')
    setUserId(id || '')
    setApiKey(key || '')
    if (!id || !key) setShowSettings(true)
  }

  const loadWorkspaces = async () => {
    const ws = await window.ipcRenderer.invoke('get-workspaces')
    setWorkspaces(ws)
    if (ws.length > 0) {
      setActiveWorkspaceId(ws[0].id)
    } else {
      createWorkspace('My Research')
    }
  }

  const createWorkspace = async (name: string) => {
    const newWs = await window.ipcRenderer.invoke('create-workspace', name)
    setWorkspaces(prev => [...prev, newWs])
    setActiveWorkspaceId(newWs.id)
    return newWs
  }

  const deleteWorkspace = async (id: string) => {
    if (workspaces.length <= 1) return
    await window.ipcRenderer.invoke('delete-workspace', id)
    const updated = workspaces.filter(w => w.id !== id)
    setWorkspaces(updated)
    if (activeWorkspaceId === id) setActiveWorkspaceId(updated[0].id)
  }

  const renameWorkspace = async (id: string, name: string) => {
    await window.ipcRenderer.invoke('rename-workspace', id, name)
    setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, name } : w))
  }

  useEffect(() => {
    loadSettings()
    loadWorkspaces()
    window.ipcRenderer.invoke('get-app-version').then((v: string) => setCurrentVersion(v || ''))
    window.ipcRenderer.on('update-available', (_e: any, info: { version: string; releaseNotes: string }) => {
      setUpdateState(s => ({ ...s, phase: 'available', version: info.version, releaseNotes: info.releaseNotes, dismissed: false }))
    })
    window.ipcRenderer.on('update-download-progress', (_e: any, { percent }: { percent: number }) => {
      setUpdateState(s => ({ ...s, phase: 'downloading', percent }))
    })
    window.ipcRenderer.on('update-downloaded', (_e: any, info: { version: string }) => {
      setUpdateState(s => ({ ...s, phase: 'ready', version: info?.version || s.version, percent: 100, dismissed: false }))
    })
  }, [])

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <Sidebar userId={userId} apiKey={apiKey} workspaceId={activeWorkspaceId} placedItemKeys={placedItemKeys} crossPageItems={crossPageItems} />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {!updateState.dismissed && updateState.phase !== 'idle' && (
          <UpdateModal
            phase={updateState.phase}
            version={updateState.version}
            currentVersion={currentVersion}
            releaseNotes={updateState.releaseNotes}
            percent={updateState.percent}
            onUpdate={() => {
              setUpdateState(s => ({ ...s, phase: 'downloading', percent: 0 }))
              window.ipcRenderer.invoke('start-update-download')
            }}
            onRestart={() => window.ipcRenderer.invoke('restart-and-update')}
            onDismiss={() => setUpdateState(s => ({ ...s, dismissed: true }))}
          />
        )}
        <header style={{
          height: '48px',
          borderBottom: '1px solid #eee',
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px 0 16px',
          backgroundColor: '#fff',
          zIndex: 50,
          flexShrink: 0,
          WebkitAppRegion: 'drag',
        } as any}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginRight: '16px', WebkitAppRegion: 'no-drag', flexShrink: 0 } as any}>
            <Layers size={18} color="#333" />
            <span style={{ fontSize: '14px', fontWeight: '700', color: '#111' }}>Momo</span>
          </div>

          {/* Workspace tabs */}
          <WorkspaceTabs
            workspaces={workspaces}
            activeId={activeWorkspaceId}
            onSelect={setActiveWorkspaceId}
            onCreate={createWorkspace}
            onDelete={deleteWorkspace}
            onRename={renameWorkspace}
          />

          {/* Settings */}
          <button
            onClick={() => setShowSettings(true)}
            style={{
              WebkitAppRegion: 'no-drag',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 10px',
              borderRadius: '6px',
              border: '1px solid #e5e7eb',
              background: '#fff',
              cursor: 'pointer',
              fontSize: '12px',
              color: '#6b7280',
              marginLeft: '8px',
            } as any}
          >
            <SettingsIcon size={13} />
            Settings
          </button>
        </header>

        <Canvas workspaceId={activeWorkspaceId} userId={userId} apiKey={apiKey} onPlacedKeysChange={handlePlacedKeysChange} />
      </main>

      {showSettings && (
        <Settings onClose={() => { setShowSettings(false); loadSettings() }} />
      )}
    </div>
  )
}

// ─── Workspace tab bar ────────────────────────────────────────────────────────

interface WorkspaceTabsProps {
  workspaces: Workspace[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

function WorkspaceTabs({ workspaces, activeId, onSelect, onCreate, onDelete, onRename }: WorkspaceTabsProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [createValue, setCreateValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const createInputRef = useRef<HTMLInputElement>(null)

  const commitCreate = () => {
    if (createValue.trim()) onCreate(createValue.trim())
    setIsCreating(false)
    setCreateValue('')
  }

  const startRename = (w: Workspace) => {
    setRenamingId(w.id)
    setRenameValue(w.name)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const commitRename = () => {
    if (renamingId && renameValue.trim()) onRename(renamingId, renameValue.trim())
    setRenamingId(null)
  }

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      gap: '2px',
      overflowX: 'auto',
      scrollbarWidth: 'none',
      WebkitAppRegion: 'no-drag',
      minWidth: 0,
    } as any}>
      {workspaces.map(w => {
        const isActive = w.id === activeId
        const isHovered = w.id === hoveredId
        const isRenaming = w.id === renamingId

        return (
          <div
            key={w.id}
            onMouseEnter={() => setHoveredId(w.id)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={() => !isRenaming && onSelect(w.id)}
            onDoubleClick={() => startRename(w)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '0 10px',
              height: '30px',
              borderRadius: '6px',
              cursor: 'pointer',
              flexShrink: 0,
              backgroundColor: isActive ? '#f3f4f6' : isHovered ? '#f9fafb' : 'transparent',
              borderBottom: isActive ? '2px solid #6366f1' : '2px solid transparent',
              transition: 'background-color 0.1s',
            }}
          >
            {isRenaming ? (
              <input
                ref={inputRef}
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') setRenamingId(null)
                  e.stopPropagation()
                }}
                onClick={e => e.stopPropagation()}
                style={{
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  fontSize: '12px',
                  fontWeight: isActive ? '600' : '400',
                  color: '#111',
                  width: Math.max(60, renameValue.length * 8),
                  fontFamily: 'inherit',
                }}
                autoFocus
              />
            ) : (
              <span style={{
                fontSize: '12px',
                fontWeight: isActive ? '600' : '400',
                color: isActive ? '#111' : '#6b7280',
                maxWidth: '140px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {w.name}
              </span>
            )}

            {(isHovered || isActive) && workspaces.length > 1 && !isRenaming && (
              <button
                onClick={e => { e.stopPropagation(); onDelete(w.id) }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  padding: '1px',
                  color: '#9ca3af',
                  borderRadius: '3px',
                  lineHeight: 0,
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}
              >
                <X size={11} />
              </button>
            )}
          </div>
        )
      })}

      {isCreating ? (
        <input
          ref={createInputRef}
          value={createValue}
          onChange={e => setCreateValue(e.target.value)}
          onBlur={commitCreate}
          onKeyDown={e => {
            if (e.key === 'Enter') commitCreate()
            if (e.key === 'Escape') { setIsCreating(false); setCreateValue('') }
            e.stopPropagation()
          }}
          placeholder="Workspace name"
          style={{
            border: '1px solid #6366f1',
            outline: 'none',
            borderRadius: '6px',
            padding: '2px 8px',
            fontSize: '12px',
            color: '#111',
            width: '130px',
            height: '26px',
            fontFamily: 'inherit',
            flexShrink: 0,
            marginLeft: '2px',
          }}
          autoFocus
        />
      ) : (
        <button
          onClick={() => { setCreateValue(''); setIsCreating(true); setTimeout(() => createInputRef.current?.focus(), 0) }}
          title="New workspace"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '26px',
            height: '26px',
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            color: '#9ca3af',
            borderRadius: '5px',
            flexShrink: 0,
            marginLeft: '2px',
          }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f3f4f6')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <Plus size={14} />
        </button>
      )}
    </div>
  )
}

// ─── UpdateModal ──────────────────────────────────────────────────────────────

function formatReleaseNotes(notes: string): React.ReactNode {
  if (!notes.trim()) return <p style={{ color: '#9ca3af', fontStyle: 'italic', margin: 0, fontSize: 12 }}>No release notes available.</p>
  return notes.split('\n').map((line, i) => {
    if (!line.trim()) return <div key={i} style={{ height: 5 }} />
    if (/^#{1,3}\s/.test(line)) return (
      <div key={i} style={{ fontWeight: 700, fontSize: 11.5, color: '#111', marginTop: 8, marginBottom: 2 }}>
        {line.replace(/^#+\s/, '')}
      </div>
    )
    if (/^[-*]\s/.test(line)) return (
      <div key={i} style={{ display: 'flex', gap: 6, fontSize: 12, color: '#374151', lineHeight: '1.5' }}>
        <span style={{ color: '#6366f1', flexShrink: 0 }}>•</span>
        <span>{line.replace(/^[-*]\s/, '')}</span>
      </div>
    )
    return <div key={i} style={{ fontSize: 12, color: '#4b5563', lineHeight: '1.5' }}>{line}</div>
  })
}

function UpdateModal({ phase, version, currentVersion, releaseNotes, percent, onUpdate, onRestart, onDismiss }: {
  phase: 'available' | 'downloading' | 'ready';
  version: string; currentVersion: string; releaseNotes: string; percent: number;
  onUpdate: () => void; onRestart: () => void; onDismiss: () => void;
}) {
  const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  const isDownloading = phase === 'downloading'
  const isReady = phase === 'ready'

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      backgroundColor: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: font,
    }}>
      <div style={{
        backgroundColor: '#fff', borderRadius: 14,
        boxShadow: '0 24px 64px rgba(0,0,0,0.22)',
        width: 440, maxWidth: 'calc(100vw - 40px)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '22px 24px 16px',
          borderBottom: '1px solid #f3f4f6',
          display: 'flex', alignItems: 'flex-start', gap: 14,
        }}>
          <div style={{ flexShrink: 0, marginTop: 2 }}>
            {isReady
              ? <CheckCircle2 size={28} color="#16a34a" />
              : <ArrowDownCircle size={28} color="#6366f1" />}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#111' }}>
              {isReady ? 'Ready to Install' : isDownloading ? `Downloading Momo ${version}…` : `Momo ${version} Available`}
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>
              {isReady
                ? `Momo ${version} has been downloaded and is ready to install.`
                : isDownloading
                ? 'The update is downloading in the background.'
                : currentVersion ? `You're on v${currentVersion}` : 'A new version is ready to download.'}
            </div>
          </div>
          {!isDownloading && (
            <button onClick={onDismiss} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9ca3af', padding: 2, flexShrink: 0, display: 'flex' }}>
              <X size={16} />
            </button>
          )}
        </div>

        {/* Release notes */}
        {!isDownloading && releaseNotes && (
          <div style={{ padding: '14px 24px', borderBottom: '1px solid #f3f4f6' }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
              What's new
            </div>
            <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
              {formatReleaseNotes(releaseNotes)}
            </div>
          </div>
        )}

        {/* Progress bar */}
        {isDownloading && (
          <div style={{ padding: '18px 24px', borderBottom: '1px solid #f3f4f6' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: '#6b7280', marginBottom: 8 }}>
              <span>Downloading…</span>
              <span>{percent}%</span>
            </div>
            <div style={{ height: 6, backgroundColor: '#f3f4f6', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 99,
                backgroundColor: '#6366f1',
                width: `${percent}%`,
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '14px 24px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {!isDownloading && (
            <button onClick={onDismiss} style={{
              border: '1px solid #e5e7eb', backgroundColor: '#fff', color: '#374151',
              borderRadius: 7, padding: '7px 16px', fontSize: 13, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
              Later
            </button>
          )}
          <button
            onClick={isReady ? onRestart : isDownloading ? undefined : onUpdate}
            disabled={isDownloading}
            style={{
              border: 'none',
              backgroundColor: isReady ? '#16a34a' : isDownloading ? '#a5b4fc' : '#6366f1',
              color: '#fff', borderRadius: 7, padding: '7px 16px', fontSize: 13, fontWeight: 600,
              cursor: isDownloading ? 'default' : 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 6,
              opacity: isDownloading ? 0.7 : 1,
            }}
          >
            {isReady
              ? <><CheckCircle2 size={13} /> Restart &amp; Install</>
              : isDownloading
              ? <><Download size={13} /> Downloading…</>
              : <><Download size={13} /> Update Now</>}
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
