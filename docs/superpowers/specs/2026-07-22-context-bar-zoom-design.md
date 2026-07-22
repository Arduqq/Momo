# Context Bar & Zoom Design

## Goal

Replace the always-visible `SizeBar` with a floating `ContextBar` that appears above whatever is selected on the canvas. The bar shows context-sensitive style controls (color, size, fill, alignment). Additionally extend the zoom range to 0.5% minimum.

## Architecture

`ContextBar` is a new component added to `src/components/Canvas.tsx` (same file as `SizeBar`). It follows the exact same external-sibling pattern: defined outside the `<Tldraw>` component tree, rendered as a sibling of `<Tldraw>` inside the canvas container div, receives `editor` as a prop, and uses `editor.store.listen({scope: 'session'})` inside a `useEffect` to trigger re-renders on any state change.

`SizeBar` is removed entirely. Its props are removed from `Canvas`. The `strokeExtra` / `onStrokeExtraChange` flow that went through SizeBar also goes away — stroke weight control moves into `CustomizePanel` only (it was already there).

## ContextBar Component

**File:** `src/components/Canvas.tsx` — new function `ContextBar` alongside where `SizeBar` was.

**Props:**
```ts
interface ContextBarProps {
  editor: Editor
}
```

**Visibility:** rendered only when `editor.getSelectedShapes().length > 0`.

**Shape-type detection** (for conditional rows):
```ts
const shapes = editor.getSelectedShapes()
const types = new Set(shapes.map(s => s.type))
const hasFill  = types.has('text') || types.has('note') || types.has('geo')
                 || types.has('draw') || types.has('arrow')
const hasAlign = types.has('text') || types.has('note') || types.has('geo')
```

**Control rows:**

| Row | Shown when | Action |
|-----|-----------|--------|
| Color (9 swatches) | always | `editor.setStyleForSelectedShapes(DefaultColorStyle, name)` |
| Size (S / M / L / XL) | always | `editor.setStyleForSelectedShapes(DefaultSizeStyle, size)` |
| Fill (none / semi / solid) | `hasFill` | `editor.setStyleForSelectedShapes(DefaultFillStyle, fill)` |
| Align (L / C / R) | `hasAlign` | `editor.setStyleForSelectedShapes(DefaultTextAlignStyle, align)` |

Size row uses only the four native tldraw sizes (S/M/L/XL — no 2XL/3XL/4XL, those were strokeExtra hacks that go away with SizeBar).

**Active-state readback** (highlight the currently-active value in each row):
```ts
const currentColor = editor.getStyleForNextShape(DefaultColorStyle)
const currentSize  = editor.getStyleForNextShape(DefaultSizeStyle)
const currentFill  = editor.getStyleForNextShape(DefaultFillStyle)
const currentAlign = editor.getStyleForNextShape(DefaultTextAlignStyle)
```
tldraw keeps next-shape defaults in sync with the current selection, so these values reflect what's set on the selected shape(s).

**Required new imports from 'tldraw':**
- `DefaultFillStyle`
- `DefaultTextAlignStyle`
- types: `TLDefaultFillStyle`, `TLDefaultTextAlignStyle`

**Positioning logic:**
```ts
const bounds = editor.getSelectionPageBounds()       // null when nothing selected
if (!bounds) return null

const topLeft  = editor.pageToScreen({ x: bounds.minX, y: bounds.minY })
const topRight = editor.pageToScreen({ x: bounds.maxX, y: bounds.minY })
const centerX  = (topLeft.x + topRight.x) / 2

// Use CSS transform to center the bar at centerX; clamp so it doesn't leave
// the container horizontally. BAR_HEIGHT is the single-row height (44px);
// the bar may be taller when fill/align rows are present (up to ~4 × 44px).
// Clamp top to 8px to avoid going above the container.
const BAR_HEIGHT = 44

const left = centerX   // style: `left: ${left}px; transform: translateX(-50%)`
const top  = Math.max(8, topLeft.y - BAR_HEIGHT - 8)
```

Apply the bar element style as:
```tsx
style={{
  position: 'absolute',
  left: left,
  top: top,
  transform: 'translateX(-50%)',
  zIndex: 300,
}}
```
This centers the bar over the selection without needing to know its width. No horizontal clamping is needed because the bar uses `max-content` width and the container clips it at its edges.

`containerRef` is the existing `useRef` on the canvas container div. The bar is `position: absolute` inside that container.

**Reactivity:** one `useEffect` registers `editor.store.listen(handler, {scope: 'session'})` and forces a local state update (via a `useState` tick counter) so React re-reads position and selection on every store change. Cleanup unsubscribes the listener.

## Zoom Extension

Single change in `Canvas.tsx` on the `<Tldraw>` component's `cameraOptions` prop:

```ts
// Before:
cameraOptions={{ zoomSteps: [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8] }}

// After:
cameraOptions={{ zoomSteps: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8] }}
```

Adds 0.5%, 1%, and 2.5% zoom levels. All native tldraw zoom controls (scroll wheel, Cmd+− keyboard, zoom menu) use this array automatically.

## What's Removed

- `SizeBar` function in Canvas.tsx
- `SIZE_OPTIONS` constant — ContextBar inlines the four size labels (`s`/`m`/`l`/`xl`) directly; no shared constant needed
- `strokeExtra` / `onStrokeExtraChange` props on the `SizeBar` call site — these are removed from the `<SizeBar … />` JSX and from SizeBar's prop interface, but **the `strokeExtra` state variable and the SVG filter code in Canvas.tsx stay** — they are driven by `CustomizePanel`'s stroke-weight slider, which is unchanged

## Visual Appearance

Bar style: semi-transparent dark background (`rgba(0,0,0,0.75)`), 8px border-radius, subtle backdrop-blur, white text/icons. Matches the aesthetic of the existing SizeBar. Rows are separated by a 1px divider. Active swatches/buttons get a white ring outline.

## Constraints

- tldraw version: 4.5.9 — use only APIs known to exist (`DefaultColorStyle`, `DefaultSizeStyle`, `DefaultFillStyle`, `DefaultTextAlignStyle`, `editor.setStyleForSelectedShapes`, `editor.getStyleForNextShape`, `editor.getSelectionPageBounds`, `editor.pageToScreen`, `editor.getSelectedShapes`, `editor.store.listen`)
- No new npm dependencies
- TypeScript strict — all style values must be typed with tldraw's own type exports
- Canvas.tsx is the only file that changes (plus any trivial import cleanup in adjacent files if SizeBar was exported, which it wasn't)
