import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist'
import { TextLayer } from 'pdfjs-dist'
import { pdfjs } from '../utils/pdfSetup'
import { ZoteroClient } from '../api/zotero'
import type { ZoteroAnnotation } from '../api/zotero'
import { X, FileText, Download, FolderOpen, Loader2 } from 'lucide-react'

const SCALE = 1.5
const COLORS = ['#ffd400', '#5fb236', '#2ea8e5', '#e56060']

// pdfjs v5 positions spans with left/top as percentages of the container and drives
// font-size + transforms through CSS custom properties. We must supply the rules that
// pdfjs's own pdf_viewer.css normally provides, adapted to our .pdf-text-layer class.
const TEXT_LAYER_CSS = `
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  .pdf-text-layer {
    position: absolute; top: 0; left: 0; overflow: hidden; line-height: 1;
    pointer-events: auto; user-select: text;
    --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
    --min-font-size-inv: calc(1 / var(--min-font-size));
  }
  .pdf-text-layer span, .pdf-text-layer br {
    color: transparent; white-space: pre; cursor: text;
    position: absolute; transform-origin: 0% 0%;
  }
  .pdf-text-layer > :not(.markedContent),
  .pdf-text-layer .markedContent span:not(.markedContent) {
    --font-height: 0;
    font-size: calc(var(--text-scale-factor) * var(--font-height));
    --scale-x: 1; --rotate: 0deg;
    transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
  }
  .pdf-text-layer .markedContent { display: contents; position: static; }
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

// ─── Highlight utilities ──────────────────────────────────────────────────

function mergeLineRects(rects: number[][]): number[][] {
  if (rects.length === 0) return []
  const sorted = [...rects].sort((a, b) => b[1] - a[1])
  const merged: number[][] = []
  let cur = [...sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i]
    const lineH = cur[3] - cur[1]
    const threshold = Math.max(lineH * 0.5, 2)
    if (Math.abs(r[1] - cur[1]) < threshold) {
      cur[0] = Math.min(cur[0], r[0])
      cur[2] = Math.max(cur[2], r[2])
      cur[1] = Math.min(cur[1], r[1])
      cur[3] = Math.max(cur[3], r[3])
    } else {
      merged.push(cur)
      cur = [...r]
    }
  }
  merged.push(cur)
  return merged
}

function selectionToPdfRects(
  selection: Selection,
  container: HTMLElement,
  viewport: PageViewport,
): number[][] {
  const range = selection.getRangeAt(0)
  const containerRect = container.getBoundingClientRect()
  const raw = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0)
  const pdfRects = raw.map(r => {
    const [x1, y1] = viewport.convertToPdfPoint(
      r.left   - containerRect.left,
      r.top    - containerRect.top,
    )
    const [x2, y2] = viewport.convertToPdfPoint(
      r.right  - containerRect.left,
      r.bottom - containerRect.top,
    )
    return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]
  })
  return mergeLineRects(pdfRects)
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
  const [downloading, setDownloading] = useState(false)
  const [reloadCount, setReloadCount] = useState(0)
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const resolvedPdfKey = useRef(initialPdfKey)
  const pdfRef = useRef<PDFDocumentProxy | null>(null)
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
        if (!pdfData) { setError('not-found'); setLoading(false); return }
        const doc = await pdfjs.getDocument({ data: pdfData }).promise
        if (!cancelled) {
          pdfRef.current = doc
          setPdf(doc)
          setAnnotations(rawAnnotations.filter(Boolean).map(toAnnotation))
        } else {
          doc.destroy()
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load PDF.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
      // Destroy the PDF document to release PDF.js worker memory and GPU resources.
      // Without this, canvas memory accumulates across open/close cycles.
      pdfRef.current?.destroy()
      pdfRef.current = null
    }
  }, [itemKey, initialPdfKey, zotero, reloadCount])

  const handleDownloadFromZotero = useCallback(async () => {
    const key = resolvedPdfKey.current
    if (!key) return
    setDownloading(true)
    try {
      const result: any = await window.ipcRenderer.invoke('download-zotero-pdf', { userId, apiKey, attachmentKey: key })
      if (result?.success) {
        setReloadCount(c => c + 1)
      } else {
        setError(result?.error || 'Download failed — the PDF may not be in Zotero file storage.')
      }
    } finally {
      setDownloading(false)
    }
  }, [userId, apiKey])

  const handleLocatePdf = useCallback(async () => {
    const key = resolvedPdfKey.current
    if (!key) return
    const ok: boolean = await window.ipcRenderer.invoke('locate-pdf', key)
    if (ok) setReloadCount(c => c + 1)
  }, [])

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
        {(loading || downloading) && (
          <div style={{ color: '#71717a', fontSize: 13, marginTop: 60, display: 'flex', alignItems: 'center', gap: 8 }}>
            {downloading && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
            {downloading ? 'Downloading from Zotero…' : 'Loading PDF…'}
          </div>
        )}
        {!loading && !downloading && error && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, marginTop: 60, padding: '0 32px', textAlign: 'center', maxWidth: 360 }}>
            <div style={{ color: '#f87171', fontSize: 13 }}>
              {error === 'not-found'
                ? 'PDF not found in local Zotero storage.'
                : error}
            </div>
            {error === 'not-found' && resolvedPdfKey.current && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                {userId && apiKey && (
                  <button onClick={handleDownloadFromZotero} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '9px 18px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}>
                    <Download size={14} /> Download from Zotero
                  </button>
                )}
                <button onClick={handleLocatePdf} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '9px 18px', borderRadius: 8, border: '1px solid #3f3f46', background: '#27272a', color: '#e4e4e7', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
                  <FolderOpen size={14} /> Locate PDF on disk
                </button>
              </div>
            )}
            <button onClick={onClose} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #3f3f46', background: 'transparent', color: '#71717a', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
              Back to canvas
            </button>
          </div>
        )}
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
  const textLayerInstance = useRef<InstanceType<typeof TextLayer> | null>(null)

  useEffect(() => {
    let cancelled = false
    async function render() {
      const page = await pdf.getPage(pageIndex + 1)
      if (cancelled) return
      const dpr = window.devicePixelRatio || 1
      const vp = page.getViewport({ scale: SCALE })

      const canvas = canvasRef.current
      if (!canvas || cancelled) return
      canvas.width = Math.round(vp.width * dpr)
      canvas.height = Math.round(vp.height * dpr)
      canvas.style.width = vp.width + 'px'
      canvas.style.height = vp.height + 'px'
      const ctx = canvas.getContext('2d')!
      ctx.scale(dpr, dpr)
      await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise

      if (cancelled) return

      const textDiv = textLayerRef.current
      if (textDiv && !cancelled) {
        textLayerInstance.current?.cancel()
        textDiv.innerHTML = ''
        // Tell pdfjs how to size the container via its CSS calc:
        // setLayerDimensions sets width = calc(var(--total-scale-factor) * pageWidthPx)
        textDiv.style.setProperty('--total-scale-factor', String(SCALE))
        const tl = new TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport: vp })
        textLayerInstance.current = tl
        await tl.render()
      }
      if (!cancelled) setViewport(vp)
    }
    render().catch(e => console.warn(`[PdfPage ${pageIndex + 1}]`, e))
    return () => {
      cancelled = true
      textLayerInstance.current?.cancel()
      const canvas = canvasRef.current
      if (canvas) { canvas.width = 0; canvas.height = 0 }
    }
  }, [pdf, pageIndex])

  const onMouseUp = (e: React.MouseEvent) => {
    if (!viewport || !containerRef.current) return
    const selection = window.getSelection()

    if (!selection || selection.isCollapsed) {
      const cr = containerRef.current.getBoundingClientRect()
      const [px, py] = viewport.convertToPdfPoint(e.clientX - cr.left, e.clientY - cr.top)
      const hit = annotations.find(a =>
        a.rects.some(([x1, y1, x2, y2]) => px >= x1 && px <= x2 && py >= y1 && py <= y2)
      )
      if (hit) onAnnotationClick(hit, e.clientX, e.clientY)
      return
    }

    const textLayer = textLayerRef.current
    if (!textLayer || !selection.anchorNode || !textLayer.contains(selection.anchorNode)) {
      selection.removeAllRanges()
      return
    }

    const text = selection.toString().replace(/\s+/g, ' ').trim()
    if (!text) { selection.removeAllRanges(); return }

    const pdfRects = selectionToPdfRects(selection, containerRef.current, viewport)
    selection.removeAllRanges()

    if (pdfRects.length === 0) return
    onHighlight(pageIndex, pdfRects, text, e.clientX, e.clientY, String(pageIndex + 1))
  }

  return (
    <div ref={containerRef}
      style={{ position: 'relative', width: viewport ? viewport.width : 'auto', boxShadow: '0 4px 24px rgba(0,0,0,0.5)', borderRadius: 2, overflow: 'hidden', cursor: 'text', flexShrink: 0 }}
      onPointerDown={e => e.stopPropagation()}
      onPointerMove={e => e.stopPropagation()}
      onPointerUp={e => e.stopPropagation()}
      onMouseUp={onMouseUp}>

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

      {/* Text layer */}
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
