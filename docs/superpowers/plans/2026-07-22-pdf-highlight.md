# PDF Native-Selection Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rubber-band box-drag selection in PdfViewer with native browser text selection so highlights follow reading flow and two-column layouts work correctly.

**Architecture:** Two pure utility functions (`mergeLineRects`, `selectionToPdfRects`) added at module scope handle coordinate conversion and line consolidation; the `PdfPage` component's drag system is deleted and replaced with a single `onMouseUp` handler that reads `window.getSelection()`, maps it to PDF rects via the utilities, and triggers the existing annotation popover.

**Tech Stack:** React 19, TypeScript 6 strict, pdfjs-dist (`PageViewport.convertToPdfPoint`, `Range.getClientRects`)

## Global Constraints

- Only `src/components/PdfViewer.tsx` changes — no other files
- No new npm dependencies
- TypeScript strict — no `any` in new code, explicit `number[][]` return types on both utilities
- `Annotation` interface, `PopoverState` interface, `AnnotationPopover` component, and all Zotero API calls are unchanged
- `TextLayer` from pdfjs-dist must continue to render (it positions the spans the Selection API reads)
- `page.getTextContent()` call is removed — `page.streamTextContent()` (used by TextLayer) stays

---

### Task 1: Add `mergeLineRects` and `selectionToPdfRects` utility functions

**Files:**
- Modify: `src/components/PdfViewer.tsx` — insert two functions between the `toAnnotation` helper and the `// ─── PdfViewer ─` section comment (around line 50)

**Interfaces:**
- Consumes: `PageViewport` (already imported from `pdfjs-dist`)
- Produces:
  - `mergeLineRects(rects: number[][]): number[][]`
  - `selectionToPdfRects(selection: Selection, container: HTMLElement, viewport: PageViewport): number[][]`
  Both consumed by Task 2's `onMouseUp` handler.

- [ ] **Step 1: Insert the utility functions**

Find the line:
```ts
// ─── PdfViewer ────────────────────────────────────────────────────────────────
```

Insert immediately before it:

```ts
// ─── Highlight utilities ──────────────────────────────────────────────────────

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
```

- [ ] **Step 2: Type-check**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/PdfViewer.tsx
git commit -m "feat: add mergeLineRects + selectionToPdfRects utilities for native PDF selection"
```

---

### Task 2: Replace drag system with native text selection

**Files:**
- Modify: `src/components/PdfViewer.tsx`
  - `TEXT_LAYER_CSS` constant (line ~13): enable pointer-events and user-select
  - `PdfPage` component: remove drag state/refs/handlers, simplify render effect, add `onMouseUp`
  - `PdfPage` JSX: update container div attributes

**Interfaces:**
- Consumes: `mergeLineRects` and `selectionToPdfRects` from Task 1
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Update `TEXT_LAYER_CSS` to enable interaction**

Find:
```ts
const TEXT_LAYER_CSS = `
  .pdf-text-layer { position: absolute; top: 0; left: 0; overflow: hidden; line-height: 1;
                    pointer-events: none; user-select: none; }
  .pdf-text-layer span, .pdf-text-layer br { color: transparent; white-space: pre; }
  .pdf-text-layer .endOfContent { display: none; }
`
```

Replace with:
```ts
const TEXT_LAYER_CSS = `
  .pdf-text-layer { position: absolute; top: 0; left: 0; overflow: hidden; line-height: 1;
                    pointer-events: auto; user-select: text; }
  .pdf-text-layer span, .pdf-text-layer br { color: transparent; white-space: pre; }
  .pdf-text-layer .endOfContent { display: none; }
`
```

- [ ] **Step 2: Remove `DragState` interface and `DRAG_THRESHOLD` constant**

Delete:
```ts
const DRAG_THRESHOLD = 4
```

Delete:
```ts
interface DragState { startX: number; startY: number; endX: number; endY: number }
```

- [ ] **Step 3: Remove drag state, refs, and the `textItemsRef` from `PdfPage`**

Inside `PdfPage`, find and delete these three lines:
```ts
  const textItemsRef = useRef<any[]>([])
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragging = useRef(false)
```

- [ ] **Step 4: Simplify the render `useEffect` — remove `page.getTextContent()` and `textItemsRef` population**

Find the entire `useEffect` body (lines ~266–316). Replace it with:

```ts
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
    return () => {
      cancelled = true
      textLayerInstance.current?.cancel()
      const canvas = canvasRef.current
      if (canvas) { canvas.width = 0; canvas.height = 0 }
    }
  }, [pdf, pageIndex])
```

- [ ] **Step 5: Delete `onPointerDown`, `onPointerMove`, `onPointerUp` handlers**

Delete the three functions (lines ~318–386):
```ts
  const onPointerDown = (e: React.PointerEvent) => { … }
  const onPointerMove = (e: React.PointerEvent) => { … }
  const onPointerUp = (e: React.PointerEvent) => { … }
```

Also delete the two variables that follow them:
```ts
  const showDragRect = drag && …
  const dragVisual = showDragRect ? { … } : null
```

- [ ] **Step 6: Add `onMouseUp` handler**

Insert the following after the `useEffect` block (where `onPointerDown` used to be):

```ts
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
    if (!textLayer || !textLayer.contains(selection.anchorNode)) {
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
```

- [ ] **Step 7: Update the `PdfPage` container div**

Find the container div opening tag:
```tsx
      <div ref={containerRef}
        style={{ position: 'relative', width: viewport ? viewport.width : 'auto', boxShadow: '0 4px 24px rgba(0,0,0,0.5)', borderRadius: 2, overflow: 'hidden', cursor: 'crosshair', flexShrink: 0, touchAction: 'none' }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
```

Replace with:
```tsx
      <div ref={containerRef}
        style={{ position: 'relative', width: viewport ? viewport.width : 'auto', boxShadow: '0 4px 24px rgba(0,0,0,0.5)', borderRadius: 2, overflow: 'hidden', cursor: 'text', flexShrink: 0 }}
        onMouseUp={onMouseUp}>
```

- [ ] **Step 8: Delete the drag-rectangle visual div**

Find and delete this block from the JSX:
```tsx
      {dragVisual && (
        <div style={{ position: 'absolute', pointerEvents: 'none', zIndex: 3, border: '1px solid rgba(99,102,241,0.7)', backgroundColor: 'rgba(99,102,241,0.1)', ...dragVisual }} />
      )}
```

- [ ] **Step 9: Type-check**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Expected: no errors. Common pitfalls:
- If TypeScript complains about `selection.anchorNode` being `null`, add a null guard: `selection.anchorNode && textLayer.contains(selection.anchorNode)`
- If `useState` or `useRef` for removed items give "declared but not read" errors, confirm those declarations were fully deleted in Steps 3–5

- [ ] **Step 10: Visual verification**

Start the dev server:
```bash
npm run dev
```

Open a PDF from a Zotero paper. Verify:
1. Hovering over text shows a text cursor (not crosshair)
2. Click and drag across a sentence → browser text selection appears (blue highlight)
3. Release → browser selection clears and annotation popover appears
4. Add a comment, click Highlight → coloured strip appears over the selected lines (one bar per line, not per-word boxes)
5. On a two-column paper: drag within one column → only that column's text is selected; dragging into the other column selects across columns as expected
6. Click an existing annotation → edit popover opens
7. Delete an existing annotation → it disappears

- [ ] **Step 11: Commit**

```bash
git add src/components/PdfViewer.tsx
git commit -m "feat: replace drag-box selection with native browser text selection for PDF highlights"
```
