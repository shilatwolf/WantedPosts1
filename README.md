# Recruitment Banner Generator — Maintenance Guide

Self-serve internal tool for creating on-brand recruitment banners (LinkedIn 1:1 + Stories 9:16).

---

## Adding new images

1. Drop the image file into `assets/images/{brand}/`  
   e.g. `assets/images/overwolf/wolf-forest.jpg`

2. Add an entry to `images.json` under the matching brand key:

```json
{
  "overwolf": [
    {
      "id": "ow-01",
      "file": "assets/images/overwolf/wolf-forest.jpg",
      "label": "Wolf in forest",
      "layouts": ["left", "right", "center"]
    }
  ]
}
```

3. Push to `main` → Netlify auto-deploys in ~30 seconds. Done.

### `images.json` field reference

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier for this image. Prefix with brand shortcode (`ow-`, `tb-`, `op-`). Never reuse an ID. |
| `file` | string | Relative path from the repo root. Always starts with `assets/images/`. |
| `label` | string | Human-readable name shown in the image grid thumbnail tooltip. |
| `layouts` | array of strings | Which layout options are offered when this image is selected. Valid values: `"left"`, `"right"`, `"center"`. Omit layouts that don't look good compositionally. |

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

2. **Add the horizontal SVG logo** to `assets/logos/mybrand-h.svg`.  
   Logo must be white on transparent background. Use `fill="white"` on all paths.

3. **Add an image pool key** to `images.json`:

```json
{
  "overwolf": [...],
  "tebex": [...],
  "outplayed": [...],
  "mybrand": []
}
```

4. **Create the image folder**: `assets/images/mybrand/` (drop a `.gitkeep` in it to commit the empty dir).

5. Push to `main` → the new brand card appears automatically.

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
├── images.json         ← image manifest (designers maintain this)
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
        └── outplayed/
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
- Layout (left / right / center — per the image's `layouts` array)
- Headline (one preset phrase OR a job title — not both simultaneously)
- CTA phrase (from the approved list)
