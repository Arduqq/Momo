# Customization Panel + Pen Size Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unified "Customize" panel (font picker + background) and re-enable tldraw's built-in style panel for pen/line size control.

**Architecture:** Three-file change: `index.html` adds Google Fonts preload + CSP fix; `Canvas.tsx` renames the background panel to a unified Customize panel (adds font state/IPC + refactors `BackgroundSettings` → `CustomizePanel`) and removes `StylePanel: null` to restore tldraw's built-in size/color controls; `PaperCard.tsx` consumes the new `--momo-font` CSS custom property.

**Tech Stack:** React 19, TypeScript, tldraw 4.5.9, Electron 41, electron-store, lucide-react, Google Fonts

## Global Constraints

- tldraw version: 4.5.9 — do not upgrade
- Font stored globally via existing `get-store-value` / `set-store-value` IPC (key: `'global-font'`, default: `'Inter'`)
- CSS custom property name: `--momo-font`, set on `document.documentElement`
- All 8 fonts loaded upfront from Google Fonts (not lazily)
- No new IPC handlers — reuse existing `get-store-value` / `set-store-value`
- TypeScript must pass `tsc -p tsconfig.app.json --noEmit` with no errors

---

### Task 1: Google Fonts preload + CSP fix

**Files:**
- Modify: `index.html`

**Interfaces:**
- Produces: `--momo-font` fallback font families available in-browser; CSP allows googleapis.com stylesheets

- [ ] **Step 1: Add `https://fonts.googleapis.com` to `style-src` in the CSP meta tag and add the Google Fonts `<link>` tags**

Replace the existing `<meta http-equiv="Content-Security-Policy" ...>` line and add the font links so `index.html` head looks like this:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: file: https:; connect-src 'self' https:; font-src 'self' data: https:; worker-src 'self' blob:;" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Crimson+Text:wght@400;600&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Lora:wght@400;500;600;700&family=Merriweather:wght@400;700&family=Playfair+Display:wght@400;700&family=Work+Sans:wght@400;500;600;700&display=swap" />
    <title>Momo</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Type-check**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: preload Google Fonts and allow googleapis.com in CSP"
```

---

### Task 2: Canvas.tsx — Customize panel (font + background unified)

**Files:**
- Modify: `src/components/Canvas.tsx`

**Interfaces:**
- Consumes: `get-store-value('global-font')` → `string | null`, `set-store-value('global-font', string)` (existing IPC)
- Produces: `document.documentElement` CSS variable `--momo-font` set to the active font family name

- [ ] **Step 1: Add `SlidersHorizontal` to the lucide-react import**

Find the existing lucide import line (currently: `import { X, FileText, Download, Check, Loader2, RefreshCw, Palette, Image as ImageIcon, Copy, ClipboardCheck, Link } from 'lucide-react'`) and add `SlidersHorizontal`:

```typescript
import { X, FileText, Download, Check, Loader2, RefreshCw, Palette, Image as ImageIcon, Copy, ClipboardCheck, Link, SlidersHorizontal } from 'lucide-react'
```

- [ ] **Step 2: Add the `FONTS` constant at module level (after the imports, before the component)**

Add this after the existing `const BG_PRESETS = [...]` line:

```typescript
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
```

- [ ] **Step 3: Replace `showBgPanel` state with `showCustomizePanel` and add `font` state**

Find (around line 70):
```typescript
  const [showBgPanel, setShowBgPanel] = useState(false)
```

Replace with:
```typescript
  const [showCustomizePanel, setShowCustomizePanel] = useState(false)
  const [font, setFont] = useState('Inter')
```

- [ ] **Step 4: Add font load effect + `saveFont` callback**

After the existing `pickBgImage` callback (around line 100), add:

```typescript
  useEffect(() => {
    window.ipcRenderer.invoke('get-store-value', 'global-font').then((stored: string | null) => {
      const f = stored ?? 'Inter'
      setFont(f)
      document.documentElement.style.setProperty('--momo-font', f)
    })
  }, [])

  const saveFont = useCallback(async (fontName: string) => {
    setFont(fontName)
    document.documentElement.style.setProperty('--momo-font', fontName)
    await window.ipcRenderer.invoke('set-store-value', 'global-font', fontName)
  }, [])
```

- [ ] **Step 5: Update the BackgroundSettings render call to use `showCustomizePanel` + pass font props**

Find (around line 638):
```tsx
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
```

Replace with:
```tsx
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
```

- [ ] **Step 6: Update the Background button to become the Customize button**

Find (around line 669):
```tsx
      <button
        onClick={() => setShowBgPanel(p => !p)}
        title="Canvas background"
        style={{
          position: 'absolute', bottom: 60, right: 16, zIndex: 201,
          ...
          backgroundColor: showBgPanel ? '#374151' : 'rgba(30,30,40,0.75)',
          ...
        }}
        ...
      >
        <Palette size={13} /> Background
      </button>
```

Replace with:
```tsx
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
```

- [ ] **Step 7: Replace the `BackgroundSettings` component with `CustomizePanel`**

Find the comment `// ─── BackgroundSettings ───────────────────────────────────────────────────────` near the bottom of the file and replace the entire `BackgroundSettings` function with `CustomizePanel`:

```typescript
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
```

- [ ] **Step 8: Type-check**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Expected: no output (clean).

- [ ] **Step 9: Commit**

```bash
git add src/components/Canvas.tsx
git commit -m "feat: add Customize panel with font picker; merge background settings in"
```

---

### Task 3: Canvas.tsx — Re-enable tldraw DefaultStylePanel

**Files:**
- Modify: `src/components/Canvas.tsx` (one line)

**Interfaces:**
- Consumes: nothing new
- Produces: tldraw's built-in size/color/fill/dash style panel visible top-right when draw/geo/arrow/text tool active or shapes selected

- [ ] **Step 1: Remove `StylePanel: null` from the `<Tldraw>` components prop**

Find (around line 592):
```tsx
      <Tldraw onMount={onMount} shapeUtils={customShapeUtils} inferDarkMode components={{ StylePanel: null, Background: () => null }} />
```

Replace with:
```tsx
      <Tldraw onMount={onMount} shapeUtils={customShapeUtils} inferDarkMode components={{ Background: () => null }} />
```

- [ ] **Step 2: Type-check**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add src/components/Canvas.tsx
git commit -m "feat: re-enable tldraw DefaultStylePanel for pen size and color controls"
```

---

### Task 4: PaperCard.tsx — Consume `--momo-font`

**Files:**
- Modify: `src/components/PaperCard.tsx`

**Interfaces:**
- Consumes: `--momo-font` CSS custom property set on `document.documentElement` by Canvas.tsx Task 2

- [ ] **Step 1: Replace the hardcoded `fontFamily` in `PaperCardInner`**

Find (line 51):
```typescript
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
```

Replace with:
```typescript
        fontFamily: "var(--momo-font, 'Inter', -apple-system, BlinkMacSystemFont, sans-serif)",
```

- [ ] **Step 2: Type-check**

```bash
npx tsc -p tsconfig.app.json --noEmit
```

Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add src/components/PaperCard.tsx
git commit -m "feat: apply --momo-font CSS var to PaperCard font family"
```
