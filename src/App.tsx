import { useState, useEffect, useRef } from 'react'
import { Sidebar } from './components/Sidebar'
import { Canvas } from './components/Canvas'
import { Settings } from './components/Settings'
import { Settings as SettingsIcon, Layers, Plus, X } from 'lucide-react'

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
  }, [])

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <Sidebar userId={userId} apiKey={apiKey} workspaceId={activeWorkspaceId} placedItemKeys={placedItemKeys} />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
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

        <Canvas workspaceId={activeWorkspaceId} userId={userId} apiKey={apiKey} onPlacedKeysChange={setPlacedItemKeys} />
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

export default App
