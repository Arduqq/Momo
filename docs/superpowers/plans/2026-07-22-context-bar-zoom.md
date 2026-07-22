# Context Bar & Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the always-visible SizeBar with a floating ContextBar that appears above selected shapes and shows context-sensitive style controls; extend zoom range to 0.5% minimum.

**Architecture:** `ContextBar` is a sibling of `<Tldraw>` inside the canvas container div, receives `editor` as a prop, subscribes to `editor.store.listen()` for reactivity, computes position from `editor.getSelectionPageBounds()` + `editor.pageToScreen()`, and renders four rows of controls (color, size, fill, align) with the fill and align rows shown only when the selection contains shape types that support them. `SizeBar` and `SIZE_OPTIONS` are deleted.

**Tech Stack:** React 19, TypeScript 6 strict, tldraw 4.5.9, lucide-react

## Global Constraints

- tldraw 4.5.9 — only APIs confirmed to exist: `DefaultColorStyle`, `DefaultSizeStyle`, `DefaultFillStyle`, `DefaultTextAlignStyle`, `editor.setStyleForSelectedShapes`, `editor.setStyleForNextShapes`, `editor.getStyleForNextShape`, `editor.getSelectionPageBounds`, `editor.pageToScreen`, `editor.getSelectedShapes`, `editor.store.listen`
- No new npm dependencies
- TypeScript strict — no `any`, no unused variables, all style values typed
- Single file modified: `src/components/Canvas.tsx`
- `strokeExtra` state variable and SVG filter in Canvas.tsx stay (they are driven by CustomizePanel, not SizeBar)

---

### Task 1: Extend zoom range

**Files:**
- Modify: `src/components/Canvas.tsx:705` (the `cameraOptions` prop on `<Tldraw>`)

**Interfaces:**
- Consumes: nothing from prior tasks
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Change `zoomSteps` in the `<Tldraw>` component**

Find this line in Canvas.tsx (currently around line 705):
```tsx
cameraOptions={{ zoomSteps: [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8] }}
```

Replace it with:
```tsx
cameraOptions={{ zoomSteps: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8] }}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Canvas.tsx
git commit -m "feat: extend zoom range to 0.5% minimum via zoomSteps"
```

---

### Task 2: Replace SizeBar with ContextBar

**Files:**
- Modify: `src/components/Canvas.tsx`
  - Update imports (lines 1–2): add `DefaultFillStyle`, `DefaultTextAlignStyle` to value imports; add `AlignLeft`, `AlignCenter`, `AlignRight` to lucide-react imports
  - Remove: `SIZE_OPTIONS` constant (~lines 73–81)
  - Remove: `SizeBar` function (~lines 1209–1315)
  - Add: `ContextBar` function in place of `SizeBar`
  - Update JSX (~line 710): replace `<SizeBar … />` with `<ContextBar editor={editor} />`

**Interfaces:**
- Consumes: `editor` (type `Editor` from tldraw), `TLDRAW_COLORS` constant (already in file, unchanged)
- Produces: `ContextBar` component (used inline in Canvas JSX)

- [ ] **Step 1: Update imports at the top of Canvas.tsx**

Find the first two import lines:
```tsx
import { Tldraw, createShapeId, Editor, DefaultColorStyle, DefaultSizeStyle } from 'tldraw'
import type { TLDefaultColorStyle, TLDefaultSizeStyle } from 'tldraw'
```

Replace with:
```tsx
import { Tldraw, createShapeId, Editor, DefaultColorStyle, DefaultSizeStyle, DefaultFillStyle, DefaultTextAlignStyle } from 'tldraw'
import type { TLDefaultColorStyle, TLDefaultSizeStyle } from 'tldraw'
```

> Note: tldraw 4.5.9 may or may not export named types `TLDefaultFillStyle` / `TLDefaultTextAlignStyle`. The plan uses local literal types instead (defined inside ContextBar) to avoid the dependency on unexported names.

Also find the lucide-react import:
```tsx
import { X, FileText, Download, Check, Loader2, RefreshCw, Palette, Image as ImageIcon, Copy, ClipboardCheck, Link, SlidersHorizontal } from 'lucide-react'
```

Replace with:
```tsx
import { X, FileText, Download, Check, Loader2, RefreshCw, Palette, Image as ImageIcon, Copy, ClipboardCheck, Link, SlidersHorizontal, AlignLeft, AlignCenter, AlignRight } from 'lucide-react'
```

- [ ] **Step 2: Remove `SIZE_OPTIONS` constant**

Find and delete this block (around line 73):
```tsx
const SIZE_OPTIONS: { label: string; size: TLDefaultSizeStyle; extra: number }[] = [
  { label: 'S',   size: 's',  extra: 0 },
  { label: 'M',   size: 'm',  extra: 0 },
  { label: 'L',   size: 'l',  extra: 0 },
  { label: 'XL',  size: 'xl', extra: 0 },
  { label: '2XL', size: 'xl', extra: 2 },
  { label: '3XL', size: 'xl', extra: 4 },
  { label: '4XL', size: 'xl', extra: 6 },
]
```

- [ ] **Step 3: Remove `SizeBar` function**

Find and delete the entire `SizeBar` function from the `// ─── SizeBar ─────` comment through its closing `}` (around lines 1209–1315).

- [ ] **Step 4: Replace `<SizeBar>` JSX with `<ContextBar>`**

Find (around line 709):
```tsx
      {editor && (
        <SizeBar
          editor={editor}
          strokeExtra={strokeExtra}
          onStrokeExtraChange={saveStrokeExtra}
        />
      )}
```

Replace with:
```tsx
      {editor && <ContextBar editor={editor} />}
```

- [ ] **Step 5: Add `ContextBar` function**

Add the following complete function in place of where `SizeBar` was (after the last `}` of the preceding function, before `// ─── CustomizePanel ───`):

```tsx
// ─── ContextBar ──────────────────────────────────────────────────────────────

type FillStyle = 'none' | 'semi' | 'solid' | 'pattern'
type AlignStyle = 'start' | 'middle' | 'end'

const CB_SIZES: { label: string; value: TLDefaultSizeStyle }[] = [
  { label: 'S',  value: 's'  },
  { label: 'M',  value: 'm'  },
  { label: 'L',  value: 'l'  },
  { label: 'XL', value: 'xl' },
]

const CB_FILLS: { label: string; value: FillStyle }[] = [
  { label: 'None',  value: 'none'  },
  { label: 'Semi',  value: 'semi'  },
  { label: 'Solid', value: 'solid' },
]

const CB_ALIGNS: { label: string; value: AlignStyle; Icon: React.FC<{ size?: number }> }[] = [
  { label: 'Left',   value: 'start',  Icon: AlignLeft   },
  { label: 'Center', value: 'middle', Icon: AlignCenter },
  { label: 'Right',  value: 'end',    Icon: AlignRight  },
]

function ContextBar({ editor }: { editor: Editor }) {
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    return editor.store.listen(() => forceUpdate(n => n + 1), { scope: 'session' })
  }, [editor])

  const shapes = editor.getSelectedShapes()
  if (shapes.length === 0) return null

  const bounds = editor.getSelectionPageBounds()
  if (!bounds) return null

  const topLeft  = editor.pageToScreen({ x: bounds.minX, y: bounds.minY })
  const topRight = editor.pageToScreen({ x: bounds.maxX, y: bounds.minY })
  const centerX  = (topLeft.x + topRight.x) / 2
  const top      = Math.max(8, topLeft.y - 52)

  const types = new Set(shapes.map(s => s.type))
  const hasFill  = types.has('text') || types.has('note') || types.has('geo') || types.has('draw') || types.has('arrow')
  const hasAlign = types.has('text') || types.has('note') || types.has('geo')

  const currentColor = editor.getStyleForNextShape(DefaultColorStyle)
  const currentSize  = editor.getStyleForNextShape(DefaultSizeStyle)
  const currentFill  = editor.getStyleForNextShape(DefaultFillStyle) as FillStyle
  const currentAlign = editor.getStyleForNextShape(DefaultTextAlignStyle) as AlignStyle

  const setColor = (color: TLDefaultColorStyle) => {
    editor.setStyleForNextShapes(DefaultColorStyle, color)
    editor.setStyleForSelectedShapes(DefaultColorStyle, color)
  }
  const setSize = (size: TLDefaultSizeStyle) => {
    editor.setStyleForNextShapes(DefaultSizeStyle, size)
    editor.setStyleForSelectedShapes(DefaultSizeStyle, size)
  }
  const setFill = (fill: FillStyle) => {
    editor.setStyleForNextShapes(DefaultFillStyle, fill)
    editor.setStyleForSelectedShapes(DefaultFillStyle, fill)
  }
  const setAlign = (align: AlignStyle) => {
    editor.setStyleForNextShapes(DefaultTextAlignStyle, align)
    editor.setStyleForSelectedShapes(DefaultTextAlignStyle, align)
  }

  const barStyle = {
    position: 'absolute' as const,
    left: centerX,
    top,
    transform: 'translateX(-50%)',
    zIndex: 300,
    display: 'flex',
    flexDirection: 'column' as const,
    background: 'rgba(20, 20, 30, 0.92)',
    backdropFilter: 'blur(8px)',
    borderRadius: 10,
    padding: '4px 12px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
    border: '1px solid rgba(255,255,255,0.08)',
    pointerEvents: 'all' as const,
  }

  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 0',
  }

  const dividerStyle = {
    height: 1,
    background: 'rgba(255,255,255,0.1)',
    margin: '0 -12px',
  }

  const activeBtn = {
    border: '1.5px solid #818cf8',
    background: '#4f46e5',
    color: '#fff',
    fontWeight: 600,
  }

  const inactiveBtn = {
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'transparent',
    color: 'rgba(255,255,255,0.65)',
    fontWeight: 400,
  }

  const btnBase = {
    height: 26,
    borderRadius: 6,
    fontSize: 11,
    cursor: 'pointer',
    padding: '0 8px',
    transition: 'all 0.1s',
    fontFamily: 'inherit',
    minWidth: 34,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }

  return (
    <div style={barStyle}>
      {/* Color row */}
      <div style={rowStyle}>
        {TLDRAW_COLORS.map(c => (
          <button
            key={c.name}
            onClick={() => setColor(c.name)}
            title={c.name}
            style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: c.hex,
              border: currentColor === c.name
                ? '2px solid #818cf8'
                : c.name === 'white' ? '1px solid rgba(255,255,255,0.3)' : '1.5px solid transparent',
              padding: 0,
              cursor: 'pointer',
              flexShrink: 0,
              boxShadow: currentColor === c.name ? '0 0 0 2px rgba(129,140,248,0.5)' : 'none',
              transition: 'box-shadow 0.1s',
            }}
          />
        ))}
      </div>

      <div style={dividerStyle} />

      {/* Size row */}
      <div style={rowStyle}>
        {CB_SIZES.map(opt => (
          <button
            key={opt.value}
            onClick={() => setSize(opt.value)}
            style={{ ...btnBase, ...(currentSize === opt.value ? activeBtn : inactiveBtn) }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {hasFill && <>
        <div style={dividerStyle} />
        <div style={rowStyle}>
          {CB_FILLS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setFill(opt.value)}
              style={{ ...btnBase, ...(currentFill === opt.value ? activeBtn : inactiveBtn) }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </>}

      {hasAlign && <>
        <div style={dividerStyle} />
        <div style={rowStyle}>
          {CB_ALIGNS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setAlign(opt.value)}
              title={opt.label}
              style={{ ...btnBase, ...(currentAlign === opt.value ? activeBtn : inactiveBtn) }}
            >
              <opt.Icon size={13} />
            </button>
          ))}
        </div>
      </>}
    </div>
  )
}
```

- [ ] **Step 6: Type-check**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Expected: no errors. If TypeScript complains about `DefaultFillStyle` or `DefaultTextAlignStyle` not being exported from `'tldraw'`, run:

```bash
grep -r "export.*FillStyle\|export.*TextAlign" node_modules/tldraw/dist-esm/index.d.ts 2>/dev/null | head -10
```

Use whatever name the export has. If neither is exported, derive the types:
```ts
type FillStyle = 'none' | 'semi' | 'solid' | 'pattern'
type AlignStyle = 'start' | 'middle' | 'end'
```
…and cast the `setStyleForSelectedShapes` calls with `as any` on the style arg only.

- [ ] **Step 7: Lint check**

```bash
npx eslint src/components/Canvas.tsx --max-warnings 0
```

Expected: no warnings.

- [ ] **Step 8: Verify visually**

Start dev server:
```bash
npm run dev
```

Check these behaviors:
1. Select a tldraw shape (e.g., draw a rectangle with the geo tool) → ContextBar appears above it
2. Deselect (click empty canvas) → ContextBar disappears
3. Click a color swatch → shape stroke color changes, swatch gets highlighted ring
4. Click S/M/L/XL → shape size changes, button highlights
5. Select a geo/note shape → Fill row appears; click Semi/Solid → fill changes
6. Select a text/note/geo shape → Align row appears; click L/C/R icons → text alignment changes
7. Scroll far out → zoom can now reach 0.5%
8. Verify no bottom SizeBar is visible

- [ ] **Step 9: Commit**

```bash
git add src/components/Canvas.tsx
git commit -m "feat: replace SizeBar with floating ContextBar (color/size/fill/align above selection)"
```
