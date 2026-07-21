# Momo UI Polish v2 Design

**Date:** 2026-07-21
**Status:** Approved

## Overview

Five targeted fixes following the v0.0.6 release:

1. **tldraw pages panel invisible** — regression from v0.0.6; restore visibility
2. **StylePanel misplaced** — move from top-right to bottom-center above toolbar
3. **Gradient backgrounds + themes** — richer Customize panel
4. **Zoom range + stroke weight** — bigger canvas reach, thicker brushes
5. **Right panel stays open blank** — auto-close when nothing is selected

All changes are in `src/components/Canvas.tsx`. No new files, no new IPC handlers.

---

## Fix 1: tldraw pages panel visibility

**Root cause**: `inferDarkMode` reads the OS color-scheme preference, not the canvas background. On a light-mode OS, tldraw renders its navigation (pages panel, top-left) in light-theme mode — which in some system/tldraw configurations produces nearly-invisible buttons against Momo's dark canvas.

**Fix**: Remove `inferDarkMode` from `<Tldraw>`. Replace with an explicit `isDarkMode: boolean` state that is:
- Loaded from electron-store key `'global-dark-mode'` on mount (default `true`)
- Applied via `editor.user.updateUserPreferences({ isDarkMode })` in a `useEffect` watching both `editor` and `isDarkMode`
- Settable from the Customize panel's Theme presets (Fix 3)

**Storage**: `get-store-value('global-dark-mode')` / `set-store-value('global-dark-mode', bool)` — existing IPC, no new handlers.

---

## Fix 2: StylePanel relocated to bottom-center

**What changes**: Inject a `<style>` block inside the canvas container that repositions tldraw's `.tlui-layout__top__right` wrapper to the bottom-center of the canvas, above the toolbar. The style panel's content and behavior are unchanged.

```css
.tlui-layout__top__right {
  position: absolute !important;
  top: auto !important;
  bottom: 68px !important;
  left: 50% !important;
  right: auto !important;
  transform: translateX(-50%) !important;
}
```

This puts the style panel just above tldraw's bottom toolbar (`height ≈ 56px` + 12px gap = `bottom: 68px`). The `<style>` tag renders inside the `containerRef` div so it is scoped to the canvas area.

---

## Fix 3: Gradient backgrounds + themes

### BackgroundConfig extension

Add `'gradient'` type and `gradient` string field:

```typescript
interface BackgroundConfig {
  type: 'color' | 'image' | 'gradient';
  color: string;
  gradient: string;   // CSS gradient string; used when type === 'gradient'
  imageDataUrl: string;
  imageMode: 'fill' | 'tile';
}
const DEFAULT_BG: BackgroundConfig = {
  type: 'color', color: '#1a1a2e', gradient: '', imageDataUrl: '', imageMode: 'fill'
}
```

### Background rendering

Update the background `<div>` to handle the three types:

```typescript
const bgStyle: React.CSSProperties =
  background.type === 'color'
    ? { backgroundColor: background.color }
    : background.type === 'gradient'
    ? { backgroundImage: background.gradient, backgroundSize: 'cover' }
    : {
        backgroundImage: `url(${background.imageDataUrl})`,
        backgroundSize: background.imageMode === 'fill' ? 'cover' : 'auto',
        backgroundRepeat: background.imageMode === 'tile' ? 'repeat' : 'no-repeat',
        backgroundPosition: 'center',
      }
```

### IPC serialization

`saveBackground` and the load effect include `gradient` in the stored object:

```typescript
await window.ipcRenderer.invoke('set-workspace-background', workspaceId, {
  type: bg.type, color: bg.color, gradient: bg.gradient,
  imagePath: bgPathRef.current, imageMode: bg.imageMode,
})
// load:
setBackground({
  type: stored.type ?? 'color', color: stored.color ?? DEFAULT_BG.color,
  gradient: stored.gradient ?? '', imageDataUrl, imageMode: stored.imageMode ?? 'fill'
})
```

### New module-level constants

```typescript
const GRADIENT_PRESETS = [
  { label: 'Space',  value: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)' },
  { label: 'Dusk',   value: 'linear-gradient(135deg, #2c3e50 0%, #4a1942 100%)' },
  { label: 'Forest', value: 'linear-gradient(135deg, #134e5e 0%, #71b280 100%)' },
  { label: 'Ember',  value: 'linear-gradient(135deg, #1a0000 0%, #3d1c00 100%)' },
  { label: 'Ocean',  value: 'linear-gradient(135deg, #000428 0%, #004e92 100%)' },
  { label: 'Slate',  value: 'linear-gradient(135deg, #1e2433 0%, #2d3748 100%)' },
] as const

const THEMES = [
  { label: 'Dark',  bg: { type: 'color' as const,    color: '#1a1a2e', gradient: '' }, dark: true  },
  { label: 'Slate', bg: { type: 'gradient' as const, color: '',        gradient: 'linear-gradient(135deg, #1e2433 0%, #2d3748 100%)' }, dark: true },
  { label: 'Paper', bg: { type: 'color' as const,    color: '#faf6f0', gradient: '' }, dark: false },
] as const
```

### Customize panel additions

`CustomizePanel` gets two new props: `isDarkMode: boolean` and `onThemeSelect: (t: typeof THEMES[number]) => void`. The panel gains two new sections at the top, before "Font":

**Theme section** — 3 pill buttons (Dark / Slate / Paper), the active one highlighted indigo. Selecting one calls `onThemeSelect(theme)`.

**Gradient section** (inside the Background section, rendered before the Color/Image tab toggle when `background.type === 'gradient'` OR always as a row of 6 swatches above the toggle) — clicking a swatch calls `onGradientChange(gradient)` which sets `type: 'gradient'`.

`applyTheme` callback in Canvas:

```typescript
const applyTheme = useCallback(async (theme: typeof THEMES[number]) => {
  const newBg: BackgroundConfig = { ...DEFAULT_BG, ...theme.bg, imageDataUrl: '', imageMode: 'fill' }
  await saveBackground(newBg)
  setIsDarkMode(theme.dark)
  await window.ipcRenderer.invoke('set-store-value', 'global-dark-mode', theme.dark)
}, [saveBackground])
```

---

## Fix 4: Zoom range + stroke weight

### Zoom

Add `cameraOptions` to `<Tldraw>`:

```tsx
<Tldraw
  cameraOptions={{ minZoom: 0.05, maxZoom: 8 }}
  ...
/>
```

This allows zooming out to 5% (tldraw default is ~12.5%) and zooming in to 800%.

### Stroke weight

Add `strokeExtra: number` state (default 0, range 0–6) to Canvas:
- Loaded from `get-store-value('global-stroke-extra')` on mount
- Saved via `set-store-value('global-stroke-extra', n)` in `saveStrokeExtra` callback

When `strokeExtra > 0`, render an SVG filter and inject CSS to apply it to tldraw's shapes layer:

```tsx
{strokeExtra > 0 && <>
  <svg width="0" height="0" aria-hidden style={{ position: 'absolute' }}>
    <defs>
      <filter id="momo-stroke-thicken" x="-20%" y="-20%" width="140%" height="140%">
        <feMorphology operator="dilate" radius={strokeExtra} in="SourceGraphic" />
      </filter>
    </defs>
  </svg>
  <style>{`.tlui-canvas__svg { filter: url(#momo-stroke-thicken); }`}</style>
</>}
```

> **Implementer note**: Inspect the rendered tldraw DOM to confirm the SVG shapes container class. Likely candidates: `.tl-svg-container`, `.tlui-canvas__svg`, or `.tl-canvas svg`. Apply the filter to whichever wraps the shape paths (not the entire canvas including UI).

**UI in Customize panel** — new "Stroke weight" section at the bottom of the panel, 4 preset buttons: `None (0) / +2 / +4 / +6`. Active value highlighted indigo.

---

## Fix 5: Right panel auto-close

In the selection tracking effect, change the branch that fires when selection changes:

```typescript
// Before:
if (card) setPinnedCard({ id: card.id, props: card.props })

// After:
if (card) setPinnedCard({ id: card.id, props: card.props })
else setPinnedCard(null)
```

When the user deselects (clicks empty canvas, switches workspaces, or changes monitors causing a resize), `card` is undefined and `pinnedCard` clears.

---

## Files Changed

| File | Changes |
|---|---|
| `src/components/Canvas.tsx` | All 5 fixes; no new files or IPC handlers |

## Out of Scope

- Per-workspace theme (global only)
- Custom gradient builder
- Font size control for card text
- tldraw page creation UI (tldraw's native page menu is restored by Fix 1)
