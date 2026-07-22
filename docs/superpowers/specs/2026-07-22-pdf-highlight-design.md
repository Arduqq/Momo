# PDF Highlight Design

## Goal

Replace the current rubber-band box-drag selection in `PdfViewer` with native browser text selection, producing per-line highlight strips that match the Adobe Acrobat / Zotero Reader UX. Two-column layout support is a natural consequence of the approach, not a special case.

## What Changes

Only `src/components/PdfViewer.tsx` changes. The Zotero annotation storage format (`rects: number[][]` in PDF user-space, `text: string`), the popover UI, the colour picker, the comment field, and all Zotero API calls are unchanged.

## Architecture

### Text layer: make it interactive

Remove the two CSS rules that disable interaction on the text layer:

```css
/* Before */
.pdf-text-layer { pointer-events: none; user-select: none; … }

/* After */
.pdf-text-layer { pointer-events: auto; user-select: text; … }
```

The text layer spans are already pixel-accurately positioned over the canvas by PDF.js. Enabling interaction turns them into a normal selectable text surface.

### Remove the drag system

Delete entirely:
- `DragState` interface
- `drag` state (`useState<DragState | null>`)
- `dragging` ref (`useRef<boolean>`)
- `textItemsRef` (`useRef<any[]>`) and the `page.getTextContent()` call that populates it — text content is no longer needed since native selection handles word-level picking
- `DRAG_THRESHOLD` constant
- `onPointerDown`, `onPointerMove`, `onPointerUp` handlers (including the hit-test loop that filters `textItemsRef.current` and the `hitItems.sort()` reading-order logic)
- The drag-rectangle visual div (the `dragVisual` / `showDragRect` block)
- `touchAction: 'none'` on the container
- `cursor: 'crosshair'` → replace with `cursor: 'text'`

### Selection handler

Add a single `onMouseUp` handler on the `PdfPage` container div:

```ts
const onMouseUp = (e: React.MouseEvent) => {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return

  // Confirm the selection is inside this page's text layer
  const textLayer = textLayerRef.current
  if (!textLayer) return
  const anchor = selection.anchorNode
  if (!anchor || !textLayer.contains(anchor)) return

  if (!viewport || !containerRef.current) return

  const text = selection.toString().replace(/\s+/g, ' ').trim()
  if (!text) return

  const pdfRects = selectionToPdfRects(selection, containerRef.current, viewport)
  selection.removeAllRanges()   // clear browser highlight; ours replaces it

  if (pdfRects.length === 0) return
  onHighlight(pageIndex, pdfRects, text, e.clientX, e.clientY, String(pageIndex + 1))
}
```

### Rect computation: `selectionToPdfRects`

A pure function (defined at module scope, outside any component):

```ts
function selectionToPdfRects(
  selection: Selection,
  container: HTMLElement,
  viewport: PageViewport,
): number[][] {
  const range = selection.getRangeAt(0)
  const containerRect = container.getBoundingClientRect()

  // getClientRects() gives one DOMRect per text-run fragment in screen space
  const raw = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0)

  // Convert each fragment to PDF user-space (Y increases upward in PDF)
  const pdfRects = raw.map(r => {
    const [x1, y1] = viewport.convertToPdfPoint(
      r.left  - containerRect.left,
      r.top   - containerRect.top,
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

### Line merging: `mergeLineRects`

Collapses multiple PDF-space rects that share a baseline into one wide strip per line:

```ts
function mergeLineRects(rects: number[][]): number[][] {
  if (rects.length === 0) return []

  // Sort by descending y1 (top of page has highest PDF Y)
  const sorted = [...rects].sort((a, b) => b[1] - a[1])

  const merged: number[][] = []
  let cur = [...sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i]
    const lineH = cur[3] - cur[1]
    const threshold = Math.max(lineH * 0.5, 2)

    if (Math.abs(r[1] - cur[1]) < threshold) {
      // Same line — extend X extents, union Y
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
```

## Two-Column Handling

PDF.js renders each text run as an absolutely-positioned `<span>`. Columns are spatially separate groups of spans. The browser selection API follows the DOM hit-test order — if the user drags within a single column, the selection anchor and focus both land on spans within that column, and `getClientRects()` only covers those spans. No heuristic column-detection code is needed.

## Visual Highlights

The highlight rendering code (`annotations.map(ann => ann.rects.map(…))`) is unchanged. Because `mergeLineRects` now produces at most one rect per line, each annotation renders as a clean horizontal strip per selected line — the improvement is entirely upstream in the rect computation.

## What Is Not Changing

- `Annotation` and `PopoverState` interfaces
- `toAnnotation`, `parsePosition` helpers
- `AnnotationPopover` component (popover UI, colour picker, comment field, ⌘↵ shortcut)
- Zotero API calls (`createAnnotation`, `updateAnnotationComment`, `deleteAnnotation`)
- Click-to-edit existing annotations (the `hit` test in `onPointerUp` moves to `onMouseUp`)
- `PdfViewer` outer component (loading state, page list, header, error UI)
- `PdfPage` canvas rendering and text layer rendering

## Click-to-Edit Existing Annotations

The existing annotation click handler currently lives inside `onPointerUp`. It moves to `onMouseUp`, with the same logic:

```ts
// At the top of onMouseUp, before checking selection:
const selection = window.getSelection()
if (!selection || selection.isCollapsed) {
  // Treat as a click — check if it hits an existing annotation
  const cr = containerRef.current!.getBoundingClientRect()
  const [px, py] = viewport.convertToPdfPoint(e.clientX - cr.left, e.clientY - cr.top)
  const hit = annotations.find(a =>
    a.rects.some(([x1, y1, x2, y2]) => px >= x1 && px <= x2 && py >= y1 && py <= y2)
  )
  if (hit) onAnnotationClick(hit, e.clientX, e.clientY)
  return
}
```

## Constraints

- `pdfjs-dist` version in use — `viewport.convertToPdfPoint(x, y)` and `range.getClientRects()` are both stable APIs; no new dependencies
- TypeScript strict — `selectionToPdfRects` and `mergeLineRects` are pure functions with explicit `number[][]` types
- The `TextLayer` component from `pdfjs-dist` must continue to render (it positions the spans the selection API reads)
- Popover `onMouseDown={e => e.stopPropagation()}` already prevents the annotation popover from triggering a new selection — no change needed there
