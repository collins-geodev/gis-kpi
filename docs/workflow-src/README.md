# Workflow documentation — sources

Sources for the two downloadable documents served from `server-assets/docs/` through
the auth-gated `/api/docs/[doc]` route and offered on the **/profile** page
(Documentation card). Access: the **deck** is available to every signed-in user; the
**full guide (PDF) is management-only** — any role beyond plain Employee — enforced
server-side in the route and mirrored in the card's visibility:

| Deliverable | Source | Rebuild |
|---|---|---|
| `GIS-KPI-Dashboard-Workflow.pdf` (13-page A4 guide) | `gis-kpi-workflow.html` (+ `ie-logo.png`) | Headless Edge print, see below |
| `GIS-KPI-Dashboard-Workflow-Deck.pptx` (8 slides, 16:9) | `build-deck.js` (+ `bg-title.png`, `bg-content.png`) | `npm i pptxgenjs && node build-deck.js` |

> The deliverables intentionally do NOT live under `public/` — signed-out visitors get
> 401 from `/api/docs/[doc]`. Note the repository itself is public on GitHub, so the
> committed files (and these sources) are still visible there; the gate protects the
> deployed app only.

Both follow the Ikeja Electric corporate template (Calibri, `#C00000` red, the IE
title/content slide backgrounds) in the same format as the SwitchTrace workflow docs.

## Rebuild the PDF

Run from this directory (the HTML references `ie-logo.png` relatively):

```bash
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless --disable-gpu \
  --no-pdf-header-footer --print-to-pdf="GIS-KPI-Dashboard-Workflow.pdf" \
  "file:///$(pwd -W 2>/dev/null || pwd)/gis-kpi-workflow.html"
```

## Rebuild the deck

```bash
npm install pptxgenjs
node build-deck.js   # writes gis-kpi-workflow-deck.pptx next to the script
```

After rebuilding, copy the outputs into `server-assets/docs/` under their published
names and update the version/size/page metadata in
`src/app/(app)/profile/page.tsx` (`WORKFLOW_DOCS`) if they changed.
