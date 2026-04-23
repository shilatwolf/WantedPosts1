# Recruitment Banner Generator — Maintenance Guide

Self-serve internal tool for creating on-brand recruitment banners (LinkedIn 1:1 + Stories 9:16).

---

## Adding new images

1. Drop the image files into `Assets/images/{brand}/`  
   e.g. `Assets/images/overwolf/wolf-forest-1_1.png` and `Assets/images/overwolf/wolf-forest-9_16.png`

2. Run `node generate-manifest.js` from the repo root.
   That rewrites `images-data.js` with the current asset list.

3. Commit the updated `images-data.js` and push to `main`.

### `images-data.js` manifest format

`images-data.js` is auto-generated and should not be edited by hand.
Each entry contains:

- `id`: unique image identifier
- `label`: human-readable visual name
- `file11`: 1:1 square image path
- `file916`: 9:16 Stories image path

---

## Adding preset copy or CTA options

Open `brands.js` and edit either array:

```js
const PRESET_COPY = [
  'Alpha Talent Required',
  'On The Hunt For New Wolves',
  'Your New Phrase Here',   // ← add here
  ...
];

const CTA_OPTIONS = [
  'Join Our Pack',
  'Apply Now',
  'Your New CTA Here',     // ← add here
  ...
];
```

Push to `main` → live in ~30 seconds.

---

## Brand roster

| Key           | Name          | Image pool     | Notes                                       |
| ------------- | ------------- | -------------- | ------------------------------------------- |
| `overwolf`    | Overwolf      | `overwolf`     | Shows positions from **all** brands in Step 3 |
| `tebex`       | Tebex         | `tebex`        |                                             |
| `outplayed`   | Outplayed     | `outplayed`    |                                             |
| `overwolfads` | Overwolf Ads  | `overwolf`     | **Shares** the Overwolf image pool          |
| `curseforge`  | CurseForge    | `curseforge`   | Own image pool                              |

Overwolf Ads reuses the Overwolf image library intentionally — no separate
`Assets/images/overwolfads/` folder is needed (the `.gitkeep` is there just to
keep the directory visible in git). CurseForge has its own pool under
`Assets/images/curseforge/`.

---

## Step 3 — Multi-note behaviour

The note chips under Step 4 ("Add a note") are **multi-select**. Click any
number of chips and they'll all render on the exported banner, joined with a
`·` (middle dot) separator. Click again to deselect. The "Other…" chip still
lets you type a free-form note that's appended to the list.

When a position is selected in Step 3, the tool auto-selects any note that
matches its `sublabelHint` / `workplaceType` (e.g. Remote, Hybrid). Those
auto-selected chips are badged with a `✦` marker and a "Smart Suggestions"
header appears above the full chip pool so it's clear the pre-selection is
intentional. You can deselect a suggestion and pick different ones — the
suggestion is just a starting point.

---

## Adding a new brand

1. **Add to `brands.js`** under `BRANDS`:

```js
const BRANDS = {
  // existing brands...
  mybrand: {
    name: 'My Brand',
    accent: '#HEXCOLOR',
    accentHover: '#HEXHOVER',
    ctaTextColor: '#FFFFFF',   // or '#000000' if accent is light
    logo: 'assets/logos/mybrand-h.svg',
    imagePool: 'mybrand'
  }
};
```

2. **Add the horizontal SVG logo** to `Assets/logos/mybrand-h.svg`.  
   Logo must be white on transparent background. Use `fill="white"` on all paths.

3. Create the image folder: `Assets/images/mybrand/` (drop a `.gitkeep` in it to commit the empty dir).

4. Add your 1:1 and 9:16 image files into `Assets/images/mybrand/`.

5. Run `node generate-manifest.js` to regenerate `images-data.js`.

6. Push to `main` → the new brand card appears automatically.

---

## Live job positions dropdown

The Position Name field auto-populates with open roles on each page load.

### How it works

A Netlify Function (`netlify/functions/jobs.js`) proxies a request to `https://careers.overwolf.com/api/jobs` (the same public API that powers the careers page) and returns a clean JSON array. The proxy exists purely to avoid a browser CORS restriction — there's no token or secret involved.

The frontend populates a `<datalist>` on the position input. Users can pick a live role from the list or type any custom title freely. If the function fails or the API returns nothing, the field silently falls back to plain text input.

### What the function returns

```json
{
  "positions": [
    { "title": "Analytics Manager",       "department": "Data",   "location": "Ramat Gan · Hybrid", "brand": "overwolf" },
    { "title": "Product Designer - Tebex","department": "Design", "location": "Ramat Gan · Hybrid", "brand": "tebex"    }
  ]
}
```

All active positions are included, sorted alphabetically by title. The `brand` field is derived from the job title (`"tebex"` / `"outplayed"` / `"overwolf"`) and is available for future brand-based filtering.

### No secrets or environment variables required

This function needs no configuration. It will work immediately on deploy.

---

## Deploying

Deployment is automatic. Every push to `main` triggers a Netlify build.

- Publish directory is `.` (repo root) — no build step required.
- Typically live within 30 seconds of push.
- Check the Netlify dashboard for build status and the live URL.

### `netlify.toml` reference

```toml
[build]
  publish = "."
```

That's the entire config. The site is fully static — no server, no framework.

---

## Repo structure

```
recruitment-banner-generator/
├── index.html          ← page shell, nav, wizard layout, preview panel
├── style.css           ← all styling + design system CSS variables
├── app.js              ← wizard flow, state management, step logic
├── canvas.js           ← canvas compositing (background, smoke, text, logo)
├── export.js           ← PNG / GIF / WebM export + ZIP packaging
├── brands.js           ← brand config + preset copy + CTA options
├── images-data.js      ← auto-generated asset manifest loaded by the app
├── netlify.toml        ← Netlify publish config
│
└── assets/
    ├── logos/
    │   ├── overwolf-h.svg
    │   ├── tebex-h.svg
    │   └── outplayed-h.svg
    └── images/
        ├── overwolf/
        ├── tebex/
        ├── outplayed/
        ├── overwolfads/   ← empty; Overwolf Ads reads from the overwolf pool
        └── curseforge/
```

---

## What is locked (cannot be changed by users)

- Font family (Montserrat + Lato always)
- Logo (always from brand config, always in its zone)
- Colors (always from brand config — no color pickers)
- Text zone positions (always per safezone spec)
- Image pool (always from the approved manifest — no device upload)
- Canvas output dimensions (1080×1080 and 1080×1920 always)

## What users control

- Brand (Overwolf / Tebex / Outplayed)
- Image (from the approved pool for the selected brand)
- Layout is fixed to left-aligned in the current design.
- Headline (one preset phrase OR a job title — not both simultaneously)
- CTA phrase (from the approved list)
