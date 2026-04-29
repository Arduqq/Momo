# Momo

I heavily dislike wrangling a bunch of programs, so I put one together that follows my process on reading papers. Momo connects to your Zotero library and lets you build visual workspaces out of your papers — drag them onto a canvas, annotate them, read highlights, draw connections, and export a `.bib` file straight into Overleaf.

This is not a product, and I will not broaden its general scope.

## Getting started

Download the latest `.dmg` from [Releases](https://github.com/Arduqq/Momo/releases), open it, and drag Momo into Applications. On first launch it will ask for your Zotero credentials.

### Zotero API key and user ID

1. **User ID** — go to [zotero.org/settings/keys](https://www.zotero.org/settings/keys). Your numeric user ID is shown at the top of the page ("Your userID for use in API calls is …").

2. **API key** — on the same page, click **Create new private key**. Give it a name (e.g. "Momo"), make sure **Allow library access** is checked, and save. Copy the key shown — it is only displayed once.

Paste both into Momo's Settings (gear icon, top right).

## What it does

- **Library sidebar** — your full Zotero library, searchable and sortable. Drag any paper onto the canvas to place it.
- **Canvas** — a freeform tldraw workspace. Papers appear as cards; double-click a card to open the PDF.
- **Detail panel** — click a card to open a side panel with the abstract, your notes ("contribution" and "relevance"), and all highlights pulled live from Zotero.
- **Workspaces** — multiple named canvases, each with its own set of placed papers and a custom background (color or image).
- **Cross-page tags** — if a paper is already on another canvas page, a small tag appears next to it in the sidebar.
- **BibTeX export** — exports all cards on the current page as a `.bib` file, ready for Overleaf.
- **Auto-update** — the app checks for new releases on launch and walks you through updating.

## Building from source

```bash
npm install
npm run dev        # development (Electron + Vite)
npm run dist:mac   # build a local .dmg
```

Releasing a new version requires a GitHub personal access token with `repo` scope set as `GH_TOKEN`:

```bash
export GH_TOKEN=ghp_...
npm run release:mac
```
