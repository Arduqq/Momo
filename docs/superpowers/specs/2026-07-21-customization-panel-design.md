# Customization Panel + Pen Size Design

**Date:** 2026-07-21  
**Status:** Approved

## Overview

Two features:
1. Re-enable tldraw's built-in `DefaultStylePanel` for pen/line thickness (and color, fill, dash) control — both during drawing and retroactively on selected shapes.
2. Replace the "Background" button with a unified "Customize" button that opens a panel containing a global font picker (new) and the existing background settings.

## Feature 1: Pen/Line Thickness via DefaultStylePanel

**What changes:**  
Remove `StylePanel: null` from the `components` prop on `<Tldraw>` in `Canvas.tsx`. tldraw's built-in panel renders in the top-right corner and shows context-sensitive style controls:
- Draw tool: size, color, dash
- Geo/arrow tool: fill, color, size, dash
- Selected shapes: all relevant styles for the selection, updated retroactively

**Styling:**  
A scoped CSS block targeting `.tlui-style-panel` overrides tldraw's default light theme to match Momo's dark palette: dark translucent background, white text, indigo accent (`#6366f1`).

**No new logic required** — tldraw handles both "next shape" defaults and retroactive updates on selected shapes internally.

## Feature 2: Unified Customize Panel

### Panel trigger

The "Background" button at `position: absolute, bottom: 60, right: 16` is renamed to "Customize" (same position, same pill style, `Sliders` icon from lucide-react). State variable renamed from `showBgPanel` → `showCustomizePanel`.

### Panel contents

A single floating panel (same position/style as the current BackgroundSettings panel) with two stacked sections:

**Font section (new, top):**
- Section label: "Font"
- `<select>` dropdown listing 8 curated fonts
- Selecting a font: calls `set-store-value('global-font', name)`, updates `--momo-font` CSS custom property on the canvas wrapper div immediately

**Background section (existing, bottom):**
- Current `BackgroundSettings` component, moved inside this panel
- `BackgroundSettings` no longer renders as a separate floating element; it's a child of the Customize panel

### Font list

| Font | Category |
|---|---|
| Inter | Clean modern sans-serif (default) |
| DM Sans | Friendly rounded sans |
| Work Sans | Geometric sans |
| Lora | Elegant reading serif |
| Merriweather | Dense reading serif |
| Playfair Display | Presentation display serif |
| Crimson Text | Academic serif |
| JetBrains Mono | Monospace |

All 8 fonts are pre-loaded upfront via `<link rel="stylesheet">` tags injected into `<head>` at app start (Google Fonts). Pre-loading all fonts means switching feels instant with no flash.

## Feature 3: Global Font Storage and Application

**Storage:** Uses existing `get-store-value` / `set-store-value` IPC handlers with key `'global-font'`. Default: `'Inter'`. No new IPC handlers needed.

**Application:**
- On app load, read `'global-font'` from store and set `document.documentElement.style.setProperty('--momo-font', value)` (or on the canvas wrapper div)
- `PaperCard.tsx` replaces hardcoded `fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'` with `fontFamily: 'var(--momo-font, Inter, sans-serif)'`
- Font choice persists across sessions and applies across all workspaces

## Files Changed

| File | Change |
|---|---|
| `src/components/Canvas.tsx` | Remove `StylePanel: null`; rename bg state; add font state/loading; add CSS override block for tldraw style panel; set `--momo-font` CSS var |
| `src/components/PaperCard.tsx` | Replace hardcoded fontFamily with `var(--momo-font, Inter, sans-serif)` |
| `index.html` | Add Google Fonts `<link>` tags for all 8 fonts |

## Out of Scope

- Per-workspace font (global only)
- System font picker
- Custom stroke width slider (tldraw's S/M/L/XL size picker covers this)
- Font size control for PaperCard text
