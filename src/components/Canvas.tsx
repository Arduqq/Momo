import { Tldraw, createShapeId, Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import { PaperCardShapeUtil } from './PaperCard'
import { LinkCardShapeUtil, LINK_W, LINK_H } from './LinkCard'
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { generateThumbnail } from '../utils/pdfThumbnail'
import { generateBibEntry, makeCiteKey, assembleBibFile } from '../utils/bibtex'
import { ZoteroClient } from '../api/zotero'
import type { ZoteroAnnotation } from '../api/zotero'
import TextareaAutosize from 'react-textarea-autosize'
import { X, FileText, Download, Check, Loader2, RefreshCw, Palette, Image as ImageIcon } from 'lucide-react'
import { PdfViewer } from './PdfViewer'

const customShapeUtils = [PaperCardShapeUtil, LinkCardShapeUtil]

interface BackgroundConfig {
  type: 'color' | 'image';
  color: string;
  imageDataUrl: string;
  imageMode: 'fill' | 'tile';
}

const DEFAULT_BG: BackgroundConfig = { type: 'color', color: '#1a1a2e', imageDataUrl: '', imageMode: 'fill' }

const BG_PRESETS = ['#1a1a2e', '#0f172a', '#111827', '#1e1b4b', '#f8f9fa', '#ffffff']

interface SelectedCard {
  id: string;
  props: {
    title: string;
    authors: string;
    year: string;
    venue: string;
    contribution: string;
    relationship: string;
    abstract: string;
    read: boolean;
    pdfKey: string;
    itemKey: string;
    citeKey: string;
  };
}

interface CanvasProps {
  workspaceId: string | null;
  userId: string;
  apiKey: string;
  onPlacedKeysChange: (keys: Set<string>, crossPageItems: Map<string, string[]>) => void;
}

export const Canvas = ({ workspaceId, userId, apiKey, onPlacedKeysChange }: CanvasProps) => {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [pinnedCard, setPinnedCard] = useState<SelectedCard | null>(null)
  const [pdfOpen, setPdfOpen] = useState<{ itemKey: string; pdfKey: string; title: string } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const lastPlacedKeysRef = useRef<Set<string>>(new Set())
  const lastSelectedIdRef = useRef<string | null>(null)
  const lastPageIdRef = useRef<string>('')
  const [exportState, setExportState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [background, setBackground] = useState<BackgroundConfig>(DEFAULT_BG)
  const [showBgPanel, setShowBgPanel] = useState(false)
  const bgPathRef = useRef<string>('')

  const onMount = useCallback((ed: Editor) => {
    setEditor(ed)
    ed.user.updateUserPreferences({ locale: 'en' })
  }, [])

  // Load background per workspace
  useEffect(() => {
    if (!workspaceId) return
    window.ipcRenderer.invoke('get-workspace-background', workspaceId).then(async (stored: any) => {
      if (!stored) { setBackground(DEFAULT_BG); bgPathRef.current = ''; return }
      bgPathRef.current = stored.imagePath || ''
      let imageDataUrl = ''
      if (stored.type === 'image' && stored.imagePath) {
        imageDataUrl = (await window.ipcRenderer.invoke('read-image-file', stored.imagePath)) ?? ''
      }
      setBackground({ type: stored.type ?? 'color', color: stored.color ?? DEFAULT_BG.color, imageDataUrl, imageMode: stored.imageMode ?? 'fill' })
    })
  }, [workspaceId])

  const saveBackground = useCallback(async (bg: BackgroundConfig) => {
    setBackground(bg)
    if (!workspaceId) return
    await window.ipcRenderer.invoke('set-workspace-background', workspaceId, {
      type: bg.type, color: bg.color, imagePath: bgPathRef.current, imageMode: bg.imageMode,
    })
  }, [workspaceId])

  const pickBgImage = useCallback(async () => {
    const filePath = await window.ipcRenderer.invoke('pick-background-image')
    if (!filePath) return
    const dataUrl = await window.ipcRenderer.invoke('read-image-file', filePath)
    if (!dataUrl) return
    bgPathRef.current = filePath
    saveBackground({ ...background, type: 'image', imageDataUrl: dataUrl })
  }, [background, saveBackground])

  // Track selected paper-card + placed keys
  useEffect(() => {
    if (!editor) return
    return editor.store.listen(({ changes }) => {
      const addedIds = Object.keys(changes.added)
      const removedIds = Object.keys(changes.removed)
      const updatedIds = Object.keys(changes.updated)

      // ── Selection ────────────────────────────────────────────────────────────
      // instance_page_state holds selectedShapeIds. Camera lives in camera: records,
      // so this does NOT fire during panning — only on real selection changes.
      if (updatedIds.some(id => id.startsWith('instance_page_state:'))) {
        const shapes = editor.getSelectedShapes()
        const card = shapes.find((s: any) => s.type === 'paper-card') as any
        const newId = card?.id ?? null
        if (newId !== lastSelectedIdRef.current) {
          lastSelectedIdRef.current = newId
          // Only update the pinned panel when a card is actively selected —
          // deselecting leaves the panel showing the last paper.
          if (card) setPinnedCard({ id: card.id, props: card.props })
        }
      }

      // When the selected card's own props change (user editing text in the panel),
      // update both selectedCard and pinnedCard.
      if (lastSelectedIdRef.current && updatedIds.includes(lastSelectedIdRef.current)) {
        const entry = (changes.updated as any)[lastSelectedIdRef.current]
        if (entry) {
          const [oldShape, newShape] = entry
          if (oldShape.props !== newShape.props) {
            setPinnedCard({ id: newShape.id, props: newShape.props })
          }
        }
      }

      // ── Placed keys / cross-page map ─────────────────────────────────────────
      // Detect page switch via ref — avoids treating instance: updates (tool state,
      // drag start, etc.) as triggers, which was the source of pan/drag start lag.
      const currentPageId = editor.getCurrentPageId()
      const pageChanged = currentPageId !== lastPageIdRef.current
      if (pageChanged) lastPageIdRef.current = currentPageId

      // Only rescan when shapes are added/removed, pages change, or user switched page.
      // shape:updated during drag is position-only → skip entirely.
      const needsRescan =
        [...addedIds, ...removedIds].some(id => id.startsWith('shape:')) ||
        [...addedIds, ...removedIds, ...updatedIds].some(id => id.startsWith('page:')) ||
        pageChanged

      if (!needsRescan) return

      const newKeys = new Set<string>()
      for (const id of editor.getCurrentPageShapeIds()) {
        const s = editor.getShape(id) as any
        if (s?.type === 'paper-card') {
          const k = s.props.itemKey || s.props.pdfKey
          if (k) newKeys.add(k)
        }
      }

      const crossPageMap = new Map<string, string[]>()
      for (const page of editor.getPages()) {
        if (page.id === currentPageId) continue
        for (const id of (editor as any).getPageShapeIds(page.id)) {
          const s = editor.getShape(id) as any
          if (s?.type === 'paper-card') {
            const k = s.props.itemKey || s.props.pdfKey
            if (k) {
              const names = crossPageMap.get(k) ?? []
              if (!names.includes(page.name)) crossPageMap.set(k, [...names, page.name])
            }
          }
        }
      }

      lastPlacedKeysRef.current = newKeys
      onPlacedKeysChange(newKeys, crossPageMap)
    })
  }, [editor, onPlacedKeysChange])

  // Load workspace
  useEffect(() => {
    if (!editor || !workspaceId) return
    window.ipcRenderer.invoke('load-workspace', workspaceId).then((data: any) => {
      if (data) {
        editor.loadSnapshot(data)
      } else {
        const shapeIds = editor.getCurrentPageShapeIds()
        if (shapeIds.size > 0) editor.deleteShapes(Array.from(shapeIds))
      }
    })
  }, [editor, workspaceId])

  // Listen for double-click open-PDF events from card shapes
  useEffect(() => {
    const handler = (e: Event) => {
      const { itemKey, pdfKey, title } = (e as CustomEvent).detail
      setPdfOpen({ itemKey, pdfKey, title })
    }
    document.addEventListener('momo:open-pdf', handler)
    return () => document.removeEventListener('momo:open-pdf', handler)
  }, [])

  // Listen for double-click open-link events from link cards
  useEffect(() => {
    const handler = (e: Event) => {
      const { url } = (e as CustomEvent).detail
      if (url) window.ipcRenderer.invoke('open-external', url)
    }
    document.addEventListener('momo:open-link', handler)
    return () => document.removeEventListener('momo:open-link', handler)
  }, [])

  // Auto-save
  useEffect(() => {
    if (!editor || !workspaceId) return
    const saveNow = () => {
      window.ipcRenderer.invoke('save-workspace', workspaceId, editor.getSnapshot())
    }
    const t = setInterval(saveNow, 5000)
    return () => { clearInterval(t); saveNow() }
  }, [editor, workspaceId])

  // Capture-phase drop handler (bypasses tldraw's internal drag handling)
  useEffect(() => {
    const container = containerRef.current
    if (!container || !editor) return

    const onDragOver = (e: DragEvent) => {
      const types = e.dataTransfer?.types ?? []
      if (types.includes('application/momo-paper') || types.includes('text/uri-list') || types.includes('Files')) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    const dropLinkCard = (url: string, label: string, kind: 'web' | 'file', clientX: number, clientY: number) => {
      const { x, y } = editor.screenToPage({ x: clientX, y: clientY })
      editor.createShapes([{
        id: createShapeId(), type: 'link-card',
        x: x - LINK_W / 2, y: y - LINK_H / 2,
        props: { url, label, kind },
      } as any])
    }

    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      // 1. Momo paper card (from sidebar)
      const paperData = e.dataTransfer?.getData('application/momo-paper')
      if (paperData) {
        try {
          const data = JSON.parse(paperData)
          const { x, y } = editor.screenToPage({ x: e.clientX, y: e.clientY })
          const shapeId = createShapeId()
          editor.createShapes([{ id: shapeId, type: 'paper-card', x, y, props: data.props } as any])
          if (userId && apiKey && (data.props.itemKey || data.props.pdfKey)) {
            generateThumbnail(userId, apiKey, data.props.itemKey, data.props.pdfKey)
              .then(({ thumbnail, pdfKey }) => {
                if (thumbnail || pdfKey)
                  editor.updateShape({ id: shapeId, type: 'paper-card', props: { thumbnail, pdfKey } } as any)
              }).catch(() => {})
          }
        } catch (err) { console.error('Paper drop failed:', err) }
        return
      }

      // 2. Files dragged from Finder
      const files = e.dataTransfer?.files
      if (files && files.length > 0) {
        Array.from(files).forEach((file, i) => {
          const filePath = (file as any).path as string
          if (!filePath) return
          const url = filePath.startsWith('file://') ? filePath : `file://${filePath}`
          dropLinkCard(url, file.name, 'file', e.clientX + i * (LINK_W + 10), e.clientY)
        })
        return
      }

      // 3. URL dragged from browser (text/uri-list)
      const uriList = e.dataTransfer?.getData('text/uri-list')
      if (uriList) {
        const urls = uriList.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
        urls.forEach((url, i) => {
          try {
            const label = new URL(url).hostname.replace(/^www\./, '')
            dropLinkCard(url, label, 'web', e.clientX + i * (LINK_W + 10), e.clientY)
          } catch { /* malformed URL */ }
        })
      }
    }

    container.addEventListener('dragover', onDragOver, { capture: true })
    container.addEventListener('drop', onDrop, { capture: true })
    return () => {
      container.removeEventListener('dragover', onDragOver, { capture: true })
      container.removeEventListener('drop', onDrop, { capture: true })
    }
  }, [editor, userId, apiKey])

  const exportBib = useCallback(async () => {
    if (!editor || exportState === 'busy') return
    setExportState('busy')
    try {
      // Collect all paper-card shapes on the current page
      const cards: any[] = []
      for (const id of editor.getCurrentPageShapeIds()) {
        const s = editor.getShape(id) as any
        if (s?.type === 'paper-card') cards.push(s)
      }
      if (cards.length === 0) { setExportState('idle'); return }

      // Batch-fetch full item data from Zotero for cards that have an itemKey
      const zotero = new ZoteroClient(userId, apiKey)
      const itemKeys = cards.map(c => c.props.itemKey).filter(Boolean)
      const fetched: Record<string, any> = {}
      if (itemKeys.length) {
        const items = await zotero.fetchItemsByKeys(itemKeys)
        items.forEach((item: any) => { fetched[item.key] = item })
      }

      const usedKeys = new Set<string>()
      const entries: string[] = []

      for (const card of cards) {
        const { itemKey, citeKey: shapeCiteKey, title, authors, year, venue, abstract } = card.props
        const item = fetched[itemKey]

        // Use the citeKey from shape props if Better BibTeX set one; otherwise derive it
        let key = shapeCiteKey?.trim()
        if (!key) {
          key = item ? makeCiteKey(item, usedKeys) : makeCiteKey(
            { data: { creators: authors ? [{ lastName: authors.split(',')[0].trim() }] : [], date: year } },
            usedKeys,
          )
        } else {
          // Ensure uniqueness even for BBT keys
          if (usedKeys.has(key)) {
            for (let i = 97; i <= 122; i++) {
              const k = key + String.fromCharCode(i)
              if (!usedKeys.has(k)) { key = k; break }
            }
          }
          usedKeys.add(key)
        }

        if (item) {
          entries.push(generateBibEntry(item, key))
        } else {
          // Fallback: synthesise a minimal entry from shape props alone
          const fallback = {
            data: {
              itemType: venue ? 'journalArticle' : 'misc',
              title, date: year,
              creators: authors
                ? authors.split(',').map((n: string) => ({ lastName: n.trim(), creatorType: 'author' }))
                : [],
              publicationTitle: venue,
              abstractNote: abstract,
            }
          }
          entries.push(generateBibEntry(fallback, key))
        }
      }

      const filename = `${workspaceId ?? 'workspace'}.bib`
      const content = assembleBibFile(entries, filename.replace('.bib', ''))
      await window.ipcRenderer.invoke('save-bib-file', content, filename)

      setExportState('done')
      setTimeout(() => setExportState('idle'), 2000)
    } catch (e) {
      console.error('[export-bib]', e)
      setExportState('idle')
    }
  }, [editor, exportState, userId, apiKey, workspaceId])

  const updateCard = useCallback((id: string, props: Partial<SelectedCard['props']>) => {
    if (!editor) return
    editor.updateShape({ id, type: 'paper-card', props } as any)
    setPinnedCard(prev => prev && prev.id === id ? { ...prev, props: { ...prev.props, ...props } } : prev)
  }, [editor])

  return (
    <div ref={containerRef} style={{ flex: 1, position: 'relative', display: 'flex', overflow: 'hidden' }}>
      {/* Canvas background */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 0,
        ...(background.type === 'color'
          ? { backgroundColor: background.color }
          : {
              backgroundImage: `url(${background.imageDataUrl})`,
              backgroundSize: background.imageMode === 'fill' ? 'cover' : 'auto',
              backgroundRepeat: background.imageMode === 'tile' ? 'repeat' : 'no-repeat',
              backgroundPosition: 'center',
            }),
      }} />
      <Tldraw onMount={onMount} shapeUtils={customShapeUtils} inferDarkMode components={{ StylePanel: null, Background: () => null }} />

      {pdfOpen && (
        <PdfViewer
          itemKey={pdfOpen.itemKey}
          pdfKey={pdfOpen.pdfKey}
          title={pdfOpen.title}
          userId={userId}
          apiKey={apiKey}
          onClose={() => setPdfOpen(null)}
        />
      )}

      {/* Detail panel — slides in from right when a card is selected */}
      <div style={{
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: 0,
        width: 320,
        backgroundColor: '#fff',
        borderLeft: '1px solid #e5e7eb',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.1)',
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        transform: pinnedCard ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.22s cubic-bezier(0.4,0,0.2,1)',
        pointerEvents: pinnedCard ? 'all' : 'none',
      }}>
        {pinnedCard && (
          <DetailPanel
            card={pinnedCard}
            onUpdate={(props) => updateCard(pinnedCard.id, props)}
            onClose={() => { editor?.selectNone(); setPinnedCard(null) }}
            onOpenPdf={() => setPdfOpen({
              itemKey: pinnedCard.props.itemKey,
              pdfKey: pinnedCard.props.pdfKey,
              title: pinnedCard.props.title,
            })}
            userId={userId}
            apiKey={apiKey}
          />
        )}
      </div>

      {/* Background settings */}
      {showBgPanel && (
        <BackgroundSettings
          background={background}
          onColorChange={color => saveBackground({ ...background, type: 'color', color })}
          onPickImage={pickBgImage}
          onModeChange={mode => saveBackground({ ...background, imageMode: mode })}
          onSwitchToColor={() => saveBackground({ ...background, type: 'color' })}
          onClose={() => setShowBgPanel(false)}
        />
      )}
      <button
        onClick={() => setShowBgPanel(p => !p)}
        title="Canvas background"
        style={{
          position: 'absolute', bottom: 60, right: 16, zIndex: 201,
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 13px', borderRadius: 20,
          border: 'none', cursor: 'pointer',
          backgroundColor: showBgPanel ? '#374151' : 'rgba(30,30,40,0.75)',
          backdropFilter: 'blur(6px)',
          color: '#fff', fontSize: 12, fontWeight: 600,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
          transition: 'background-color 0.15s, transform 0.1s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.04)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
      >
        <Palette size={13} /> Background
      </button>

      {/* BibTeX export button */}
      <button
        onClick={exportBib}
        disabled={exportState === 'busy'}
        title="Export citations as .bib"
        style={{
          position: 'absolute', bottom: 16, right: 16, zIndex: 201,
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 13px', borderRadius: 20,
          border: 'none', cursor: exportState === 'busy' ? 'default' : 'pointer',
          backgroundColor: exportState === 'done' ? '#16a34a' : '#6366f1',
          color: '#fff', fontSize: 12, fontWeight: 600,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          boxShadow: '0 2px 12px rgba(99,102,241,0.35)',
          transition: 'background-color 0.2s, transform 0.1s',
          opacity: exportState === 'busy' ? 0.7 : 1,
        }}
        onMouseEnter={e => { if (exportState === 'idle') (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.04)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
      >
        {exportState === 'busy'
          ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Exporting…</>
          : exportState === 'done'
          ? <><Check size={13} /> Exported!</>
          : <><Download size={13} /> Export .bib</>}
      </button>
    </div>
  )
}

function DetailPanel({ card, onUpdate, onClose, onOpenPdf, userId, apiKey }: {
  card: SelectedCard;
  onUpdate: (props: Partial<SelectedCard['props']>) => void;
  onClose: () => void;
  onOpenPdf: () => void;
  userId: string;
  apiKey: string;
}) {
  const { title, authors, year, venue, contribution, relationship, abstract, read, citeKey } = card.props;
  const [annotations, setAnnotations] = useState<ZoteroAnnotation[]>([]);
  const [annotationsLoading, setAnnotationsLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const client = useMemo(() => new ZoteroClient(userId, apiKey), [userId, apiKey]);

  useEffect(() => {
    if (!userId || !apiKey) return;
    let cancelled = false;
    setAnnotations([]);
    setAnnotationsLoading(true);
    (async () => {
      try {
        let pdfKey = card.props.pdfKey;
        if (!pdfKey && card.props.itemKey) {
          pdfKey = await client.getPdfAttachmentKey(card.props.itemKey);
        }
        if (!pdfKey || cancelled) { setAnnotationsLoading(false); return; }
        const annots = await client.getAnnotations(pdfKey);
        if (!cancelled) {
          setAnnotations(annots.filter(a => a.data.annotationText?.trim()));
          setAnnotationsLoading(false);
        }
      } catch {
        if (!cancelled) setAnnotationsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [card.id, card.props.pdfKey, card.props.itemKey, userId, apiKey, client, refreshTick]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 18px 12px',
        borderBottom: '1px solid #f3f4f6',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '10px',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: '700', fontSize: '14px', color: '#111827', lineHeight: '1.4' }}>
            {title}
          </div>
          <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>
            {[authors, year && `(${year})`, venue].filter(Boolean).join(' · ')}
          </div>
          {citeKey && (
            <div style={{ fontSize: '10px', color: '#c4c9d4', marginTop: '3px', fontFamily: 'monospace' }}>
              @{citeKey}
            </div>
          )}
        </div>
        <button
          onClick={onOpenPdf}
          title="Open PDF"
          style={{
            flexShrink: 0, border: '1px solid #e5e7eb', background: '#fff',
            cursor: 'pointer', color: '#6366f1', padding: '3px 8px',
            display: 'flex', alignItems: 'center', gap: 4,
            borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
          }}
        >
          <FileText size={12} />
          PDF
        </button>
        <button
          onClick={onClose}
          style={{
            flexShrink: 0,
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            color: '#9ca3af',
            padding: '2px',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Fields */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: '18px',
      }}>
        {/* Read checkbox */}
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: '9px',
          cursor: 'pointer',
          userSelect: 'none',
        }}>
          <div
            onClick={() => onUpdate({ read: !read })}
            style={{
              width: '18px',
              height: '18px',
              borderRadius: '4px',
              backgroundColor: read ? '#6366f1' : '#fff',
              border: read ? '1.5px solid #6366f1' : '1.5px solid #d1d5db',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              cursor: 'pointer',
            }}
          >
            {read && (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="2,6 5,9 10,3" />
              </svg>
            )}
          </div>
          <span
            onClick={() => onUpdate({ read: !read })}
            style={{ fontSize: '13px', color: read ? '#6366f1' : '#374151', fontWeight: read ? '600' : '400' }}
          >
            Read
          </span>
        </label>

        {abstract && (
          <div>
            <div style={{
              fontSize: '10.5px',
              fontWeight: '600',
              color: '#6366f1',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: '7px',
            }}>
              Abstract
            </div>
            <div style={{
              fontSize: '12.5px',
              lineHeight: '1.65',
              color: '#4b5563',
              backgroundColor: '#fafafa',
              border: '1px solid #e5e7eb',
              borderRadius: '7px',
              padding: '9px 11px',
            }}>
              {abstract}
            </div>
          </div>
        )}

        <PanelField
          label="What is their contribution?"
          placeholder="Summarize the core finding or method..."
          value={contribution}
          onChange={v => onUpdate({ contribution: v })}
        />
        <PanelField
          label="How is it relevant for this paper?"
          placeholder="Connect it to your research question..."
          value={relationship}
          onChange={v => onUpdate({ relationship: v })}
        />

        {/* Highlights */}
        <div>
          <div style={{
            fontSize: '10.5px',
            fontWeight: '600',
            color: '#6366f1',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: '7px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            Highlights
            {annotationsLoading
              ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
              : <button
                  onClick={() => setRefreshTick(t => t + 1)}
                  title="Refresh highlights"
                  style={{
                    border: 'none', background: 'none', cursor: 'pointer',
                    color: '#9ca3af', padding: '1px', display: 'flex', alignItems: 'center',
                    borderRadius: 4,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#6366f1')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}
                >
                  <RefreshCw size={11} />
                </button>
            }
            {!annotationsLoading && annotations.length > 0 && (
              <span style={{
                backgroundColor: '#eef2ff', color: '#6366f1',
                borderRadius: 8, fontSize: 10, fontWeight: 700, padding: '1px 6px',
              }}>
                {annotations.length}
              </span>
            )}
          </div>
          {!annotationsLoading && annotations.length === 0 && (
            <div style={{ fontSize: '12px', color: '#9ca3af', fontStyle: 'italic' }}>
              No highlights found.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {annotations.map(a => (
              <div key={a.key} style={{
                borderLeft: `3px solid ${a.data.annotationColor || '#ffd400'}`,
                paddingLeft: '10px',
                paddingTop: '5px',
                paddingBottom: '5px',
                backgroundColor: '#fafafa',
                borderRadius: '0 6px 6px 0',
                border: '1px solid #f0f0f0',
                borderLeftWidth: '3px',
                borderLeftColor: a.data.annotationColor || '#ffd400',
              }}>
                <div style={{ fontSize: '12.5px', color: '#374151', lineHeight: '1.55', fontStyle: 'italic' }}>
                  "{a.data.annotationText}"
                </div>
                {a.data.annotationPageLabel && (
                  <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '3px' }}>
                    p. {a.data.annotationPageLabel}
                  </div>
                )}
                {a.data.annotationComment && (
                  <div style={{
                    fontSize: '11.5px', color: '#4b5563', marginTop: '5px',
                    padding: '4px 7px', backgroundColor: '#f3f4f6', borderRadius: '4px',
                  }}>
                    {a.data.annotationComment}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function PanelField({ label, placeholder, value, onChange }: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div style={{
        fontSize: '10.5px',
        fontWeight: '600',
        color: '#6366f1',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: '7px',
      }}>
        {label}
      </div>
      <TextareaAutosize
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
        placeholder={placeholder}
        minRows={3}
        style={{
          width: '100%',
          border: '1px solid #e5e7eb',
          borderRadius: '7px',
          padding: '9px 11px',
          fontSize: '13px',
          lineHeight: '1.6',
          resize: 'none',
          outline: 'none',
          backgroundColor: '#fafafa',
          boxSizing: 'border-box',
          fontFamily: 'inherit',
          color: '#374151',
          transition: 'border-color 0.15s',
        }}
        onFocus={e => (e.target.style.borderColor = '#6366f1')}
        onBlur={e => (e.target.style.borderColor = '#e5e7eb')}
      />
    </div>
  )
}

// ─── BackgroundSettings ───────────────────────────────────────────────────────

function BackgroundSettings({ background, onColorChange, onPickImage, onModeChange, onSwitchToColor, onClose }: {
  background: BackgroundConfig;
  onColorChange: (color: string) => void;
  onPickImage: () => void;
  onModeChange: (mode: 'fill' | 'tile') => void;
  onSwitchToColor: () => void;
  onClose: () => void;
}) {
  const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  return (
    <>
      {/* Backdrop to close on outside click */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 210 }} onClick={onClose} />
      <div style={{
        position: 'absolute', bottom: 104, right: 16, zIndex: 211,
        width: 240, backgroundColor: '#fff', borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)', border: '1px solid #e5e7eb',
        fontFamily: font, overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: '#111' }}>Background</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9ca3af', padding: 2, display: 'flex' }}>
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Type toggle */}
          <div style={{ display: 'flex', backgroundColor: '#f3f4f6', borderRadius: 7, padding: 2, gap: 2 }}>
            {(['color', 'image'] as const).map(t => (
              <button key={t} onClick={() => t === 'color' ? onSwitchToColor() : onPickImage()} style={{
                flex: 1, border: 'none', cursor: 'pointer', borderRadius: 5, padding: '5px 0',
                fontSize: 11.5, fontWeight: background.type === t ? 600 : 400,
                backgroundColor: background.type === t ? '#fff' : 'transparent',
                color: background.type === t ? '#111' : '#6b7280',
                boxShadow: background.type === t ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                fontFamily: 'inherit', transition: 'all 0.15s',
              }}>
                {t === 'color' ? <><Palette size={11} /> Color</> : <><ImageIcon size={11} /> Image</>}
              </button>
            ))}
          </div>

          {background.type === 'color' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Preset swatches */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {BG_PRESETS.map(c => (
                  <button key={c} onClick={() => onColorChange(c)} style={{
                    width: 26, height: 26, borderRadius: 6, border: background.color === c ? '2px solid #6366f1' : '1.5px solid #e5e7eb',
                    backgroundColor: c, cursor: 'pointer', padding: 0,
                    boxShadow: background.color === c ? '0 0 0 2px #c7d2fe' : 'none',
                    transition: 'box-shadow 0.15s',
                  }} />
                ))}
              </div>
              {/* Custom color picker */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <div style={{
                  width: 26, height: 26, borderRadius: 6, border: '1.5px solid #e5e7eb',
                  backgroundColor: background.color, flexShrink: 0,
                  backgroundImage: 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
                  backgroundSize: '6px 6px', backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0px',
                  overflow: 'hidden',
                }}>
                  <input type="color" value={background.color} onChange={e => onColorChange(e.target.value)}
                    style={{ opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 'none', padding: 0 }} />
                </div>
                <span style={{ fontSize: 12, color: '#374151', fontFamily: 'monospace' }}>{background.color}</span>
              </label>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Image preview */}
              <div style={{
                height: 90, borderRadius: 8, border: '1.5px dashed #e5e7eb',
                backgroundColor: '#f9fafb', overflow: 'hidden', display: 'flex',
                alignItems: 'center', justifyContent: 'center', position: 'relative',
              }}>
                {background.imageDataUrl
                  ? <img src={background.imageDataUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: '#9ca3af' }}>
                      <ImageIcon size={22} />
                      <span style={{ fontSize: 11 }}>No image selected</span>
                    </div>
                }
              </div>
              <button onClick={onPickImage} style={{
                border: '1px solid #e5e7eb', backgroundColor: '#fff', borderRadius: 7,
                padding: '6px 0', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                color: '#374151', fontFamily: 'inherit', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: 6,
              }}>
                <ImageIcon size={12} /> Choose Image…
              </button>

              {/* Fill / Tile */}
              {background.imageDataUrl && (
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                    Scale
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['fill', 'tile'] as const).map(mode => (
                      <button key={mode} onClick={() => onModeChange(mode)} style={{
                        flex: 1, border: background.imageMode === mode ? '1.5px solid #6366f1' : '1.5px solid #e5e7eb',
                        backgroundColor: background.imageMode === mode ? '#eef2ff' : '#fff',
                        color: background.imageMode === mode ? '#4f46e5' : '#6b7280',
                        borderRadius: 6, padding: '5px 0', fontSize: 11.5,
                        fontWeight: background.imageMode === mode ? 600 : 400,
                        cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize',
                      }}>
                        {mode === 'fill' ? 'Fill' : 'Tile'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
