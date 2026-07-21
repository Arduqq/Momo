import { Tldraw, createShapeId, Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import { PaperCardShapeUtil } from './PaperCard'
import { LinkCardShapeUtil, LINK_W, LINK_H } from './LinkCard'
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { generateThumbnail } from '../utils/pdfThumbnail'
import { generateBibEntry, makeCiteKey, assembleBibFile } from '../utils/bibtex'
import { ZoteroClient } from '../api/zotero'
import type { ZoteroAnnotation } from '../api/zotero'
import {
  extractDoiFromPdf, fetchCrossrefMetadata,
  parseArxivXml, detectAcademicUrl, metadataToPaperProps,
} from '../utils/metadata'
import { CiteWebModal } from './CiteWebModal'
import type { WebCiteData } from './CiteWebModal'
import TextareaAutosize from 'react-textarea-autosize'
import { X, FileText, Download, Check, Loader2, RefreshCw, Palette, Image as ImageIcon, Copy, ClipboardCheck, Link, SlidersHorizontal } from 'lucide-react'
import { PdfViewer } from './PdfViewer'

const customShapeUtils = [PaperCardShapeUtil, LinkCardShapeUtil]

interface BackgroundConfig {
  type: 'color' | 'image' | 'gradient';
  color: string;
  gradient: string;
  imageDataUrl: string;
  imageMode: 'fill' | 'tile';
}

const DEFAULT_BG: BackgroundConfig = { type: 'color', color: '#1a1a2e', gradient: '', imageDataUrl: '', imageMode: 'fill' }

const BG_PRESETS = ['#1a1a2e', '#0f172a', '#111827', '#1e1b4b', '#f8f9fa', '#ffffff']

const FONTS = [
  { label: 'Inter',             value: 'Inter' },
  { label: 'DM Sans',           value: 'DM Sans' },
  { label: 'Work Sans',         value: 'Work Sans' },
  { label: 'Lora',              value: 'Lora' },
  { label: 'Merriweather',      value: 'Merriweather' },
  { label: 'Playfair Display',  value: 'Playfair Display' },
  { label: 'Crimson Text',      value: 'Crimson Text' },
  { label: 'JetBrains Mono',    value: 'JetBrains Mono' },
] as const

export const GRADIENT_PRESETS = [
  { label: 'Space',  value: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)' },
  { label: 'Dusk',   value: 'linear-gradient(135deg, #2c3e50 0%, #4a1942 100%)' },
  { label: 'Forest', value: 'linear-gradient(135deg, #134e5e 0%, #71b280 100%)' },
  { label: 'Ember',  value: 'linear-gradient(135deg, #1a0000 0%, #3d1c00 100%)' },
  { label: 'Ocean',  value: 'linear-gradient(135deg, #000428 0%, #004e92 100%)' },
  { label: 'Slate',  value: 'linear-gradient(135deg, #1e2433 0%, #2d3748 100%)' },
] as const

export const THEMES = [
  { label: 'Dark',  bg: { type: 'color' as const,    color: '#1a1a2e', gradient: '' }, dark: true  },
  { label: 'Slate', bg: { type: 'gradient' as const, color: '',        gradient: 'linear-gradient(135deg, #1e2433 0%, #2d3748 100%)' }, dark: true },
  { label: 'Paper', bg: { type: 'color' as const,    color: '#faf6f0', gradient: '' }, dark: false },
] as const

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
  const [copyState, setCopyState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [citeWebModal, setCiteWebModal] = useState<string | null>(null) // url or '' for blank
  const citeWebDropPos = useRef<{ x: number; y: number } | null>(null)
  const [background, setBackground] = useState<BackgroundConfig>(DEFAULT_BG)
  const [showCustomizePanel, setShowCustomizePanel] = useState(false)
  const [font, setFont] = useState('Inter')
  const [isDarkMode, setIsDarkMode] = useState(true)
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
      setBackground({ type: stored.type ?? 'color', color: stored.color ?? DEFAULT_BG.color, gradient: stored.gradient ?? '', imageDataUrl, imageMode: stored.imageMode ?? 'fill' })
    })
  }, [workspaceId])

  const saveBackground = useCallback(async (bg: BackgroundConfig) => {
    setBackground(bg)
    if (!workspaceId) return
    await window.ipcRenderer.invoke('set-workspace-background', workspaceId, {
      type: bg.type, color: bg.color, gradient: bg.gradient,
      imagePath: bgPathRef.current, imageMode: bg.imageMode,
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

  useEffect(() => {
    window.ipcRenderer.invoke('get-store-value', 'global-font').then((stored: string | null) => {
      const f = stored ?? 'Inter'
      setFont(f)
      document.documentElement.style.setProperty('--momo-font', f)
    })
  }, [])

  useEffect(() => {
    window.ipcRenderer.invoke('get-store-value', 'global-dark-mode').then((v: boolean | null) => {
      setIsDarkMode(v ?? true)
    })
  }, [])

  useEffect(() => {
    if (!editor) return
    editor.user.updateUserPreferences({ colorScheme: isDarkMode ? 'dark' : 'light' })
  }, [editor, isDarkMode])

  const saveFont = useCallback(async (fontName: string) => {
    setFont(fontName)
    document.documentElement.style.setProperty('--momo-font', fontName)
    await window.ipcRenderer.invoke('set-store-value', 'global-font', fontName)
  }, [])

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
          if (card) setPinnedCard({ id: card.id, props: card.props })
          else setPinnedCard(null)
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

    const dropPdf = async (file: File, clientX: number, clientY: number) => {
      // Placeholder card — created immediately, before any async work
      const { x, y } = editor.screenToPage({ x: clientX, y: clientY })
      const shapeId = createShapeId()
      editor.createShapes([{
        id: shapeId, type: 'paper-card', x, y,
        props: { title: 'Importing…', authors: '', year: '', venue: '', contribution: '',
          relationship: '', abstract: '', read: false, thumbnail: '', pdfKey: '', itemKey: '', citeKey: '' },
      } as any])

      try {
        const buf = await file.arrayBuffer()
        // PDF.js transfers (detaches) the typed array's buffer — pass a copy so buf stays valid for the IPC upload
        const doi = await extractDoiFromPdf(new Uint8Array(buf.slice(0)))
        const meta = doi ? await fetchCrossrefMetadata(doi) : null

        let itemKey = ''
        let attachmentKey = ''

        if (userId && apiKey) {
          try {
            const zotero = new ZoteroClient(userId, apiKey)
            const itemData: Record<string, any> = meta
              ? {
                  itemType: meta.itemType,
                  title: meta.title,
                  creators: meta.creators,
                  date: meta.date,
                  abstractNote: meta.abstractNote,
                  ...(meta.DOI ? { DOI: meta.DOI } : {}),
                  ...(meta.publicationTitle ? { publicationTitle: meta.publicationTitle } : {}),
                  ...(meta.proceedingsTitle ? { proceedingsTitle: meta.proceedingsTitle } : {}),
                }
              : { itemType: 'document', title: file.name.replace(/\.pdf$/i, ''), creators: [] }
            itemKey = await zotero.createItem(itemData)
            attachmentKey = await zotero.createAttachment(itemKey, file.name)
            // Send file data via IPC (file.path unavailable in sandboxed renderers)
            await window.ipcRenderer.invoke('import-pdf', { fileData: new Uint8Array(buf), attachmentKey, filename: file.name })
          } catch (err) {
            console.warn('[PDF import] Zotero API error:', err)
          }
        }

        const baseProps = meta
          ? metadataToPaperProps(meta, itemKey)
          : { title: file.name.replace(/\.pdf$/i, ''), authors: '', year: '', venue: '',
              abstract: '', contribution: '', relationship: '', read: false,
              thumbnail: '', pdfKey: '', citeKey: '', itemKey }

        editor.updateShape({ id: shapeId, type: 'paper-card', props: { ...baseProps, pdfKey: attachmentKey } } as any)

        // Thumbnail in background
        if (attachmentKey) {
          generateThumbnail(userId, apiKey, itemKey, attachmentKey)
            .then(({ thumbnail }) => {
              if (thumbnail) editor.updateShape({ id: shapeId, type: 'paper-card', props: { thumbnail } } as any)
            }).catch(() => {})
        }
      } catch (err) {
        console.error('[PDF import] failed:', err)
        editor.updateShape({ id: shapeId, type: 'paper-card',
          props: { title: file.name.replace(/\.pdf$/i, '') } } as any)
      }
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
          if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
            dropPdf(file, e.clientX + i * 20, e.clientY + i * 20)
          } else {
            const filePath = (file as any).path as string | undefined
            const url = filePath
              ? (filePath.startsWith('file://') ? filePath : `file://${filePath}`)
              : `file://${file.name}`
            dropLinkCard(url, file.name, 'file', e.clientX + i * (LINK_W + 10), e.clientY)
          }
        })
        return
      }

      // 3. URL dragged from browser (text/uri-list)
      const uriList = e.dataTransfer?.getData('text/uri-list')
      if (uriList) {
        const urls = uriList.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
        if (!urls.length) return

        // For academic URLs, auto-fetch metadata; for others, open citation modal
        const firstUrl = urls[0]
        const detected = detectAcademicUrl(firstUrl)

        if (detected.type) {
          // Academic URL — resolve metadata and create PaperCard
          const { x, y } = editor.screenToPage({ x: e.clientX, y: e.clientY })
          const shapeId = createShapeId()
          editor.createShapes([{
            id: shapeId, type: 'paper-card', x, y,
            props: { title: 'Fetching…', authors: '', year: '', venue: '', contribution: '',
              relationship: '', abstract: '', read: false, thumbnail: '', pdfKey: '', itemKey: '', citeKey: '' },
          } as any])

          ;(async () => {
            try {
              let meta = null
              if (detected.type === 'doi') {
                meta = await fetchCrossrefMetadata(detected.id)
              } else {
                const result: any = await window.ipcRenderer.invoke(
                  'fetch-url',
                  `https://export.arxiv.org/api/query?id_list=${detected.id}`,
                )
                if (result?.body) meta = parseArxivXml(result.body, detected.id)
              }

              let itemKey = ''
              if (meta && userId && apiKey) {
                try {
                  const zotero = new ZoteroClient(userId, apiKey)
                  itemKey = await zotero.createItem({
                    itemType: meta.itemType,
                    title: meta.title,
                    creators: meta.creators,
                    date: meta.date,
                    abstractNote: meta.abstractNote,
                    ...(meta.DOI ? { DOI: meta.DOI } : {}),
                    ...(meta.publicationTitle ? { publicationTitle: meta.publicationTitle } : {}),
                    ...(meta.proceedingsTitle ? { proceedingsTitle: meta.proceedingsTitle } : {}),
                    ...(meta.url ? { url: meta.url } : {}),
                  })
                } catch { /* Zotero optional */ }
              }

              if (meta) {
                editor.updateShape({ id: shapeId, type: 'paper-card',
                  props: metadataToPaperProps(meta, itemKey) } as any)
              } else {
                // Couldn't resolve — fall back to label from hostname
                editor.deleteShapes([shapeId])
                try {
                  const label = new URL(firstUrl).hostname.replace(/^www\./, '')
                  dropLinkCard(firstUrl, label, 'web', e.clientX, e.clientY)
                } catch { /* ignore */ }
              }
            } catch (err) {
              console.error('[URL import] failed:', err)
              editor.deleteShapes([shapeId])
            }
          })()
        } else {
          // General URL — plain link-card (not an article)
          urls.forEach((url, i) => {
            try {
              const label = new URL(url).hostname.replace(/^www\./, '')
              dropLinkCard(url, label, 'web', e.clientX + i * (LINK_W + 10), e.clientY)
            } catch { /* malformed URL */ }
          })
        }
      }
    }

    container.addEventListener('dragover', onDragOver, { capture: true })
    container.addEventListener('drop', onDrop, { capture: true })
    return () => {
      container.removeEventListener('dragover', onDragOver, { capture: true })
      container.removeEventListener('drop', onDrop, { capture: true })
    }
  }, [editor, userId, apiKey])

  const buildBibContent = useCallback(async (): Promise<string | null> => {
    if (!editor) return null
    const cards: any[] = []
    for (const id of editor.getCurrentPageShapeIds()) {
      const s = editor.getShape(id) as any
      if (s?.type === 'paper-card') cards.push(s)
    }
    if (cards.length === 0) return null

    const zotero = new ZoteroClient(userId, apiKey)
    const itemKeys = cards.map((c: any) => c.props.itemKey).filter(Boolean)
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

      let key = shapeCiteKey?.trim()
      if (!key) {
        key = item ? makeCiteKey(item, usedKeys) : makeCiteKey(
          { data: { creators: authors ? [{ lastName: authors.split(',')[0].trim() }] : [], date: year } },
          usedKeys,
        )
      } else {
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

    const name = workspaceId ?? 'workspace'
    return assembleBibFile(entries, name)
  }, [editor, userId, apiKey, workspaceId])

  const exportBib = useCallback(async () => {
    if (!editor || exportState === 'busy') return
    setExportState('busy')
    try {
      const content = await buildBibContent()
      if (!content) { setExportState('idle'); return }
      const filename = `${workspaceId ?? 'workspace'}.bib`
      await window.ipcRenderer.invoke('save-bib-file', content, filename)
      setExportState('done')
      setTimeout(() => setExportState('idle'), 2000)
    } catch (e) {
      console.error('[export-bib]', e)
      setExportState('idle')
    }
  }, [editor, exportState, buildBibContent, workspaceId])

  const copyBib = useCallback(async () => {
    if (!editor || copyState === 'busy') return
    setCopyState('busy')
    try {
      const content = await buildBibContent()
      if (!content) { setCopyState('idle'); return }
      await navigator.clipboard.writeText(content)
      setCopyState('done')
      setTimeout(() => setCopyState('idle'), 2000)
    } catch (e) {
      console.error('[copy-bib]', e)
      setCopyState('idle')
    }
  }, [editor, copyState, buildBibContent])

  const updateCard = useCallback((id: string, props: Partial<SelectedCard['props']>) => {
    if (!editor) return
    editor.updateShape({ id, type: 'paper-card', props } as any)
    setPinnedCard(prev => prev && prev.id === id ? { ...prev, props: { ...prev.props, ...props } } : prev)
  }, [editor])

  const handleCiteWebSubmit = useCallback((data: WebCiteData) => {
    if (!editor) return
    const screenPos = citeWebDropPos.current
    let x: number, y: number
    if (screenPos) {
      const p = editor.screenToPage(screenPos)
      x = p.x; y = p.y
    } else {
      const vp = editor.getViewportPageBounds()
      x = vp.x + vp.w / 2 - 95
      y = vp.y + vp.h / 2 - 115
    }
    citeWebDropPos.current = null
    editor.createShapes([{
      id: createShapeId(), type: 'paper-card', x, y,
      props: {
        title: data.title || data.url,
        authors: data.authors.trim(),
        year: data.year,
        venue: data.venue,
        abstract: '',
        contribution: '',
        relationship: '',
        read: false,
        thumbnail: '',
        pdfKey: '',
        citeKey: '',
        itemKey: '',
      },
    } as any])
    setCiteWebModal(null)
  }, [editor])

  return (
    <div ref={containerRef} style={{ flex: 1, position: 'relative', display: 'flex', overflow: 'hidden' }}>
      <style>{`
        .tlui-layout__top__right {
          position: absolute !important;
          top: auto !important;
          bottom: 68px !important;
          left: 50% !important;
          right: auto !important;
          transform: translateX(-50%) !important;
          pointer-events: none;
        }
        .tlui-layout__top__right > * {
          pointer-events: all;
        }
      `}</style>
      {/* Canvas background */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 0,
        ...(background.type === 'color'
          ? { backgroundColor: background.color }
          : background.type === 'gradient'
          ? { backgroundImage: background.gradient, backgroundSize: 'cover' }
          : {
              backgroundImage: `url(${background.imageDataUrl})`,
              backgroundSize: background.imageMode === 'fill' ? 'cover' : 'auto',
              backgroundRepeat: background.imageMode === 'tile' ? 'repeat' : 'no-repeat',
              backgroundPosition: 'center',
            }),
      }} />
      <Tldraw onMount={onMount} shapeUtils={customShapeUtils} components={{ Background: () => null }} />

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

      {/* Customize panel (font + background) */}
      {showCustomizePanel && (
        <CustomizePanel
          font={font}
          onFontChange={saveFont}
          background={background}
          onColorChange={color => saveBackground({ ...background, type: 'color', color })}
          onPickImage={pickBgImage}
          onModeChange={mode => saveBackground({ ...background, imageMode: mode })}
          onSwitchToColor={() => saveBackground({ ...background, type: 'color' })}
          onClose={() => setShowCustomizePanel(false)}
        />
      )}
      <button
        onClick={() => { citeWebDropPos.current = null; setCiteWebModal('') }}
        title="Add a web article citation"
        style={{
          position: 'absolute', bottom: 104, right: 16, zIndex: 201,
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 13px', borderRadius: 20,
          border: 'none', cursor: 'pointer',
          backgroundColor: 'rgba(30,30,40,0.75)',
          backdropFilter: 'blur(6px)',
          color: '#fff', fontSize: 12, fontWeight: 600,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
          transition: 'background-color 0.15s, transform 0.1s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.04)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
      >
        <Link size={13} /> Cite article
      </button>
      <button
        onClick={() => setShowCustomizePanel(p => !p)}
        title="Customize workspace"
        style={{
          position: 'absolute', bottom: 60, right: 16, zIndex: 201,
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 13px', borderRadius: 20,
          border: 'none', cursor: 'pointer',
          backgroundColor: showCustomizePanel ? '#374151' : 'rgba(30,30,40,0.75)',
          backdropFilter: 'blur(6px)',
          color: '#fff', fontSize: 12, fontWeight: 600,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
          transition: 'background-color 0.15s, transform 0.1s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.04)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
      >
        <SlidersHorizontal size={13} /> Customize
      </button>

      {/* BibTeX buttons */}
      <div style={{
        position: 'absolute', bottom: 16, right: 16, zIndex: 201,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <button
          onClick={copyBib}
          disabled={copyState === 'busy'}
          title="Copy citations to clipboard"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 13px', borderRadius: 20,
            border: 'none', cursor: copyState === 'busy' ? 'default' : 'pointer',
            backgroundColor: copyState === 'done' ? '#16a34a' : 'rgba(30,30,40,0.75)',
            backdropFilter: 'blur(6px)',
            color: '#fff', fontSize: 12, fontWeight: 600,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
            transition: 'background-color 0.2s, transform 0.1s',
            opacity: copyState === 'busy' ? 0.7 : 1,
          }}
          onMouseEnter={e => { if (copyState === 'idle') (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.04)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
        >
          {copyState === 'busy'
            ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Copying…</>
            : copyState === 'done'
            ? <><ClipboardCheck size={13} /> Copied!</>
            : <><Copy size={13} /> Copy .bib</>}
        </button>
        <button
          onClick={exportBib}
          disabled={exportState === 'busy'}
          title="Export citations as .bib file"
          style={{
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

      {citeWebModal !== null && (
        <CiteWebModal
          initialUrl={citeWebModal}
          onSubmit={handleCiteWebSubmit}
          onCancel={() => setCiteWebModal(null)}
        />
      )}
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

// ─── CustomizePanel ───────────────────────────────────────────────────────────

function CustomizePanel({ font, onFontChange, background, onColorChange, onPickImage, onModeChange, onSwitchToColor, onClose }: {
  font: string;
  onFontChange: (f: string) => void;
  background: BackgroundConfig;
  onColorChange: (color: string) => void;
  onPickImage: () => void;
  onModeChange: (mode: 'fill' | 'tile') => void;
  onSwitchToColor: () => void;
  onClose: () => void;
}) {
  const uiFont = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, zIndex: 210 }} onClick={onClose} />
      <div style={{
        position: 'absolute', bottom: 104, right: 16, zIndex: 211,
        width: 240, backgroundColor: '#fff', borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)', border: '1px solid #e5e7eb',
        fontFamily: uiFont, overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: '#111' }}>Customize</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9ca3af', padding: 2, display: 'flex' }}>
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* ── Font ── */}
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Font</div>
            <select
              value={font}
              onChange={e => onFontChange(e.target.value)}
              style={{
                width: '100%', padding: '6px 10px', borderRadius: 7,
                border: '1.5px solid #e5e7eb', backgroundColor: '#fff',
                color: '#374151', fontSize: 13, cursor: 'pointer', outline: 'none',
                fontFamily: `'${font}', ${uiFont}`,
              }}
            >
              {FONTS.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>

          <div style={{ borderTop: '1px solid #f3f4f6', margin: '0 -14px' }} />

          {/* ── Background ── */}
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Background</div>

            {/* Type toggle */}
            <div style={{ display: 'flex', backgroundColor: '#f3f4f6', borderRadius: 7, padding: 2, gap: 2, marginBottom: 12 }}>
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
                {background.imageDataUrl && (
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Scale</div>
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
      </div>
    </>
  )
}
