import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist'
import { TextLayer } from 'pdfjs-dist'
import { pdfjs } from '../utils/pdfSetup'
import { ZoteroClient } from '../api/zotero'
import type { ZoteroAnnotation } from '../api/zotero'
import { X, FileText } from 'lucide-react'

const SCALE = 1.5
const COLORS = ['#ffd400', '#5fb236', '#2ea8e5', '#e56060']
const DRAG_THRESHOLD = 4

// Text layer is visual only — pointer-events handled by page container
const TEXT_LAYER_CSS = `
  .pdf-text-layer { position: absolute; top: 0; left: 0; overflow: hidden; line-height: 1;
                    pointer-events: none; user-select: none; }
  .pdf-text-layer span, .pdf-text-layer br { color: transparent; white-space: pre; }
  .pdf-text-layer .endOfContent { display: none; }
`

interface Annotation {
  key: string; version: number; pageIndex: number;
  rects: number[][]; text: string; comment: string; color: string; pageLabel: string;
}

interface PopoverState {
  type: 'create' | 'edit'; x: number; y: number;
  pageIndex: number; rects: number[][]; text: string; comment: string; color: string;
  annotationKey?: string; annotationVersion?: number; pageLabel: string;
}

interface DragState { startX: number; startY: number; endX: number; endY: number }

function parsePosition(raw: string | { pageIndex: number; rects: number[][] }) {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return { pageIndex: 0, rects: [] } }
  }
  return raw
}

function toAnnotation(z: ZoteroAnnotation): Annotation {
  const pos = parsePosition(z.data.annotationPosition)
  return {
    key: z.key, version: z.version,
    pageIndex: pos.pageIndex ?? 0, rects: pos.rects ?? [],
    text: z.data.annotationText ?? '', comment: z.data.annotationComment ?? '',
    color: z.data.annotationColor || '#ffd400', pageLabel: z.data.annotationPageLabel ?? '',
  }
}

// ─── PdfViewer ────────────────────────────────────────────────────────────────

interface PdfViewerProps {
  itemKey: string; pdfKey: string; title: string;
  userId: string; apiKey: string; onClose: () => void;
}

export function PdfViewer({ itemKey, pdfKey: initialPdfKey, title, userId, apiKey, onClose }: PdfViewerProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const resolvedPdfKey = useRef(initialPdfKey)
  const zotero = useMemo(() => new ZoteroClient(userId, apiKey), [userId, apiKey])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError('')
      try {
        let key = initialPdfKey
        if (!key) {
          key = await zotero.getPdfAttachmentKey(itemKey)
          if (!key) { setError('No PDF attachment found for this paper.'); setLoading(false); return }
          resolvedPdfKey.current = key
        }
        const [pdfData, rawAnnotations] = await Promise.all([
          window.ipcRenderer.invoke('read-zotero-pdf', key) as Promise<Uint8Array | null>,
          zotero.getAnnotations(key).catch(() => [] as ZoteroAnnotation[]),
        ])
        if (cancelled) return
        if (!pdfData) { setError('PDF file not found in local Zotero storage.'); setLoading(false); return }
        const doc = await pdfjs.getDocument({ data: pdfData }).promise
        if (!cancelled) { setPdf(doc); setAnnotations(rawAnnotations.filter(Boolean).map(toAnnotation)) }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load PDF.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [itemKey, initialPdfKey, zotero])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      // Prevent the native Electron find bar — it renders inside the window frame
      // and shifts the fixed-position PDF viewer layout.
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') e.preventDefault()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const handleHighlight = useCallback((
    pageIndex: number, pdfRects: number[][], text: string,
    clientX: number, clientY: number, pageLabel: string,
  ) => {
    setPopover({ type: 'create', x: clientX, y: clientY + 12, pageIndex, rects: pdfRects, text, comment: '', color: COLORS[0], pageLabel })
  }, [])

  const handleAnnotationClick = useCallback((ann: Annotation, clientX: number, clientY: number) => {
    setPopover({ type: 'edit', x: clientX, y: clientY + 12, pageIndex: ann.pageIndex, rects: ann.rects, text: ann.text, comment: ann.comment, color: ann.color, annotationKey: ann.key, annotationVersion: ann.version, pageLabel: ann.pageLabel })
  }, [])

  const handleCreate = useCallback(async (color: string, comment: string) => {
    if (!popover) return
    try {
      const created = await zotero.createAnnotation(resolvedPdfKey.current, { ...popover, color, comment })
      setAnnotations(prev => [...prev, toAnnotation(created)])
    } catch (e) { console.error('[PdfViewer] create failed:', e) }
    setPopover(null)
  }, [popover, zotero])

  const handleUpdate = useCallback(async (comment: string) => {
    if (!popover?.annotationKey) return
    try {
      await zotero.updateAnnotationComment(popover.annotationKey, comment, popover.annotationVersion!)
      setAnnotations(prev => prev.map(a => a.key === popover.annotationKey ? { ...a, comment } : a))
    } catch (e) { console.error('[PdfViewer] update failed:', e) }
    setPopover(null)
  }, [popover, zotero])

  const handleDelete = useCallback(async () => {
    if (!popover?.annotationKey) return
    try {
      await zotero.deleteAnnotation(popover.annotationKey, popover.annotationVersion!)
      setAnnotations(prev => prev.filter(a => a.key !== popover.annotationKey))
    } catch (e) { console.error('[PdfViewer] delete failed:', e) }
    setPopover(null)
  }, [popover, zotero])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 999, display: 'flex', flexDirection: 'column', backgroundColor: '#18181b', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <style>{TEXT_LAYER_CSS}</style>

      <div style={{ height: 48, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px 0 80px', backgroundColor: '#1c1c1f', borderBottom: '1px solid #2e2e33' }}>
        <FileText size={16} color="#6366f1" />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#f4f4f5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        {pdf && <span style={{ fontSize: 11, color: '#71717a', flexShrink: 0 }}>{pdf.numPages} {pdf.numPages === 1 ? 'page' : 'pages'}</span>}
        <button onClick={onClose} title="Close (Esc)" style={{ flexShrink: 0, border: 'none', background: 'none', cursor: 'pointer', color: '#71717a', padding: '6px 8px', display: 'flex', alignItems: 'center', borderRadius: 6, minWidth: 32, justifyContent: 'center' }}
          onMouseEnter={e => { e.currentTarget.style.color = '#f4f4f5'; e.currentTarget.style.backgroundColor = '#27272a' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#71717a'; e.currentTarget.style.backgroundColor = 'transparent' }}>
          <X size={18} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        {loading && <div style={{ color: '#71717a', fontSize: 13, marginTop: 60 }}>Loading PDF…</div>}
        {!loading && error && <div style={{ color: '#f87171', fontSize: 13, marginTop: 60, textAlign: 'center', padding: '0 32px' }}>{error}</div>}
        {!loading && pdf && Array.from({ length: pdf.numPages }, (_, i) => (
          <PdfPage key={i} pdf={pdf} pageIndex={i}
            annotations={annotations.filter(a => a.pageIndex === i)}
            onHighlight={handleHighlight} onAnnotationClick={handleAnnotationClick} />
        ))}
      </div>

      {popover && (
        <AnnotationPopover popover={popover}
          onCreate={handleCreate} onUpdate={handleUpdate} onDelete={handleDelete}
          onClose={() => setPopover(null)}
          onColorChange={color => setPopover(p => p ? { ...p, color } : p)}
          onCommentChange={comment => setPopover(p => p ? { ...p, comment } : p)} />
      )}
    </div>
  )
}

// ─── PdfPage ──────────────────────────────────────────────────────────────────

interface PdfPageProps {
  pdf: PDFDocumentProxy; pageIndex: number; annotations: Annotation[];
  onHighlight: (pageIndex: number, pdfRects: number[][], text: string, clientX: number, clientY: number, pageLabel: string) => void;
  onAnnotationClick: (ann: Annotation, clientX: number, clientY: number) => void;
}

function PdfPage({ pdf, pageIndex, annotations, onHighlight, onAnnotationClick }: PdfPageProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState<PageViewport | null>(null)
  // Text items in PDF user-space — the source of truth for selection
  const textItemsRef = useRef<any[]>([])
  const textLayerInstance = useRef<InstanceType<typeof TextLayer> | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragging = useRef(false)

  useEffect(() => {
    let cancelled = false
    async function render() {
      const page = await pdf.getPage(pageIndex + 1)
      if (cancelled) return
      const dpr = window.devicePixelRatio || 1
      const vp = page.getViewport({ scale: SCALE })

      // Canvas render + text content fetch in parallel
      const [, content] = await Promise.all([
        (async () => {
          const canvas = canvasRef.current
          if (!canvas || cancelled) return
          canvas.width = Math.round(vp.width * dpr)
          canvas.height = Math.round(vp.height * dpr)
          canvas.style.width = vp.width + 'px'
          canvas.style.height = vp.height + 'px'
          const ctx = canvas.getContext('2d')!
          ctx.scale(dpr, dpr)
          await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise
        })(),
        page.getTextContent(),
      ])
      if (cancelled) return

      // Keep only real text items (skip TextMarkedContent group items)
      textItemsRef.current = (content as any).items.filter(
        (item: any) => 'str' in item && item.str.trim().length > 0
      )

      const textDiv = textLayerRef.current
      if (textDiv && !cancelled) {
        textDiv.style.width = vp.width + 'px'
        textDiv.style.height = vp.height + 'px'
        textLayerInstance.current?.cancel()
        textDiv.innerHTML = ''
        const tl = new TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport: vp })
        textLayerInstance.current = tl
        await tl.render()
      }
      if (!cancelled) setViewport(vp)
    }
    render().catch(e => console.warn(`[PdfPage ${pageIndex + 1}]`, e))
    return () => { cancelled = true; textLayerInstance.current?.cancel() }
  }, [pdf, pageIndex])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const rect = containerRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left, y = e.clientY - rect.top
    dragging.current = true
    setDrag({ startX: x, startY: y, endX: x, endY: y })
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return
    const rect = containerRef.current!.getBoundingClientRect()
    setDrag(prev => prev ? { ...prev, endX: e.clientX - rect.left, endY: e.clientY - rect.top } : prev)
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging.current || !drag || !viewport || !containerRef.current) return
    dragging.current = false
    const dragW = Math.abs(drag.endX - drag.startX), dragH = Math.abs(drag.endY - drag.startY)
    setDrag(null)

    if (dragW < DRAG_THRESHOLD && dragH < DRAG_THRESHOLD) {
      // Click: check if it hits an existing annotation
      const cr = containerRef.current.getBoundingClientRect()
      const [px, py] = viewport.convertToPdfPoint(e.clientX - cr.left, e.clientY - cr.top)
      const hit = annotations.find(a => a.rects.some(([x1, y1, x2, y2]) => px >= x1 && px <= x2 && py >= y1 && py <= y2))
      if (hit) onAnnotationClick(hit, e.clientX, e.clientY)
      return
    }

    // Convert the drag rectangle from container-space to PDF user-space.
    // convertToPdfPoint handles the Y-axis flip (PDF Y increases upward).
    const [p1x, p1y] = viewport.convertToPdfPoint(Math.min(drag.startX, drag.endX), Math.min(drag.startY, drag.endY))
    const [p2x, p2y] = viewport.convertToPdfPoint(Math.max(drag.startX, drag.endX), Math.max(drag.startY, drag.endY))
    const selMinX = Math.min(p1x, p2x), selMaxX = Math.max(p1x, p2x)
    const selMinY = Math.min(p1y, p2y), selMaxY = Math.max(p1y, p2y)

    // Hit-test each text item's PDF-space bounding box against the selection.
    // item.transform = [a, b, c, d, x, y] — x,y are the baseline origin in PDF user-space.
    // item.width is the run width in the same units.
    // Height falls back to the font scale |a| when item.height is zero.
    const hitItems = textItemsRef.current.filter((item: any) => {
      const [a, , , , x, y] = item.transform
      const w = item.width
      const h = item.height > 0 ? item.height : Math.abs(a) || 10
      return (x + w) > selMinX && x < selMaxX && (y + h) > selMinY && y < selMaxY
    })

    if (hitItems.length === 0) return

    // Sort into reading order: top of page first (higher PDF Y), then left to right
    hitItems.sort((a: any, b: any) => {
      const ay = a.transform[5], by = b.transform[5]
      const lineH = (Math.abs(a.transform[0]) || 10) * 0.5
      if (Math.abs(ay - by) > lineH) return by - ay   // different lines
      return a.transform[4] - b.transform[4]            // same line, left to right
    })

    const text = hitItems.map((item: any) => item.str).join(' ').replace(/\s+/g, ' ').trim()

    const pdfRects = hitItems.map((item: any) => {
      const [a, , , , x, y] = item.transform
      const h = item.height > 0 ? item.height : Math.abs(a) || 10
      return [x, y, x + item.width, y + h]
    })

    onHighlight(pageIndex, pdfRects, text, e.clientX, e.clientY, String(pageIndex + 1))
  }

  const showDragRect = drag &&
    (Math.abs(drag.endX - drag.startX) >= DRAG_THRESHOLD || Math.abs(drag.endY - drag.startY) >= DRAG_THRESHOLD)
  const dragVisual = showDragRect ? {
    left: Math.min(drag!.startX, drag!.endX), top: Math.min(drag!.startY, drag!.endY),
    width: Math.abs(drag!.endX - drag!.startX), height: Math.abs(drag!.endY - drag!.startY),
  } : null

  return (
    <div ref={containerRef}
      style={{ position: 'relative', width: viewport ? viewport.width : 'auto', boxShadow: '0 4px 24px rgba(0,0,0,0.5)', borderRadius: 2, overflow: 'hidden', cursor: 'crosshair', flexShrink: 0, touchAction: 'none' }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>

      <canvas ref={canvasRef} style={{ display: 'block' }} />

      {/* Highlight layer */}
      {viewport && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: viewport.width, height: viewport.height, pointerEvents: 'none', zIndex: 1 }}>
          {annotations.map(ann => ann.rects.map((rect, ri) => {
            const vr = viewport.convertToViewportRectangle(rect)
            return (
              <div key={`${ann.key}-${ri}`} style={{
                position: 'absolute',
                left: Math.min(vr[0], vr[2]), top: Math.min(vr[1], vr[3]),
                width: Math.abs(vr[2] - vr[0]), height: Math.abs(vr[3] - vr[1]),
                backgroundColor: ann.color, opacity: 0.4, mixBlendMode: 'multiply',
              }} />
            )
          }))}
        </div>
      )}

      {/* Drag selection rectangle */}
      {dragVisual && (
        <div style={{ position: 'absolute', pointerEvents: 'none', zIndex: 3, border: '1px solid rgba(99,102,241,0.7)', backgroundColor: 'rgba(99,102,241,0.1)', ...dragVisual }} />
      )}

      {/* Text layer — visual only, no pointer events */}
      <div ref={textLayerRef} className="pdf-text-layer" style={{ zIndex: 2 }} />
    </div>
  )
}

// ─── AnnotationPopover ────────────────────────────────────────────────────────

interface AnnotationPopoverProps {
  popover: PopoverState;
  onCreate: (color: string, comment: string) => void;
  onUpdate: (comment: string) => void;
  onDelete: () => void;
  onClose: () => void;
  onColorChange: (color: string) => void;
  onCommentChange: (comment: string) => void;
}

function AnnotationPopover({ popover, onCreate, onUpdate, onDelete, onClose, onColorChange, onCommentChange }: AnnotationPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    setTimeout(() => document.addEventListener('mousedown', h), 0)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  const [pos, setPos] = useState({ x: popover.x, y: popover.y })
  useEffect(() => {
    if (!ref.current) return
    const { width, height } = ref.current.getBoundingClientRect()
    setPos({
      x: Math.min(popover.x, window.innerWidth - width - 8),
      y: popover.y + height > window.innerHeight ? popover.y - height - 24 : popover.y,
    })
  }, [popover.x, popover.y])

  const isCreate = popover.type === 'create'

  return (
    <div ref={ref} onMouseDown={e => e.stopPropagation()} style={{
      position: 'fixed', left: pos.x, top: pos.y, zIndex: 1100,
      backgroundColor: '#1c1c1f', border: '1px solid #3f3f46', borderRadius: 10,
      padding: '12px 14px', width: 260, boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {popover.text && (
        <div style={{ fontSize: 11.5, color: '#a1a1aa', borderLeft: `3px solid ${popover.color}`, paddingLeft: 8, lineHeight: 1.5, maxHeight: 60, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' } as React.CSSProperties}>
          {popover.text}
        </div>
      )}
      {isCreate && (
        <div style={{ display: 'flex', gap: 7 }}>
          {COLORS.map(c => (
            <button key={c} onClick={() => onColorChange(c)} style={{ width: 20, height: 20, borderRadius: 4, backgroundColor: c, border: 'none', cursor: 'pointer', outline: popover.color === c ? '2px solid #fff' : 'none', outlineOffset: 1 }} />
          ))}
        </div>
      )}
      <textarea value={popover.comment} onChange={e => onCommentChange(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) isCreate ? onCreate(popover.color, popover.comment) : onUpdate(popover.comment)
          if (e.key === 'Escape') onClose()
        }}
        placeholder="Add a note… (⌘↵ to save)" rows={3}
        style={{ resize: 'none', width: '100%', boxSizing: 'border-box', backgroundColor: '#27272a', border: '1px solid #3f3f46', borderRadius: 6, padding: '7px 9px', fontSize: 12.5, color: '#e4e4e7', lineHeight: 1.5, outline: 'none', fontFamily: 'inherit' }}
        onFocus={e => (e.target.style.borderColor = '#6366f1')}
        onBlur={e => (e.target.style.borderColor = '#3f3f46')}
        autoFocus />
      <div style={{ display: 'flex', gap: 7, justifyContent: 'flex-end' }}>
        {!isCreate && <button onClick={onDelete} style={btn('#ef444420', '#ef4444')}>Delete</button>}
        <button onClick={onClose} style={btn('transparent', '#71717a')}>Cancel</button>
        <button onClick={() => isCreate ? onCreate(popover.color, popover.comment) : onUpdate(popover.comment)} style={btn('#6366f1', '#fff', true)}>
          {isCreate ? 'Highlight' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function btn(bg: string, color: string, solid = false): React.CSSProperties {
  return { fontSize: 12, fontWeight: solid ? 600 : 400, padding: '4px 11px', borderRadius: 6, border: 'none', backgroundColor: bg, color, cursor: 'pointer', fontFamily: 'inherit' }
}
