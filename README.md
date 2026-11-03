# DTF Prep

A browser app that turns artwork into print-ready DTF (direct-to-film) transfer files for custom
DTF orders from American HTV Supply (Dallas). It fixes three things that go wrong:

1. **Designs that look like a block sticker.** Knock out the garment color, remove backgrounds,
   add coarse distress, and turn fades into halftone dots so the shirt shows through.
2. **Low-resolution sources.** Upscale in the browser with Real-ESRGAN (or Lanczos, or vector
   tracing for simple logos) to exactly 300 DPI at the print size.
3. **Guessing the size.** Pick store, garment, color, size and placement; the app proposes the print
   width, shows it on a true-scale mockup with a ruler, and tells you which AHTV size to order and what
   to write in the order note.

Everything runs client-side: no accounts, no server, no uploads. After the first load it works offline.

## Workflow

1. **Upload** PNG, JPG, WEBP or SVG. Shows pixel size, aspect ratio, alpha, semi-transparent pixel
   count, distinct colors (32 levels per channel) and PNG DPI.
2. **Look**: free-text description plus 15 aesthetic presets (skate flat-color, horror / metal,
   distressed relic, vintage tour tee, stamp logo, halftone photo, hand-drawn ink, collage, blackletter,
   collegiate, sports throwback, playful, small front / big back, fade into garment, washed pairing).
   A keyword match suggests a preset; no AI call.
3. **Garment**: store → garment → color → size, or a custom garment.
4. **Placement and size**: 19 placements with the proposed width scaled by garment size, a width
   slider, the mockup at true scale, the "seen from 6 feet" view, the effective DPI flag
   (✓ 300+, ⚠ 150-299, ✕ under 150) and the AHTV variant to order.
5. **Knock out**: Delta E eyedropper with stacked picks and undo, garment-color knockout, flood-fill
   background removal, distress masks (scratched, cracked, speckle, sandblasted), halftone (45-65 LPI),
   edge fade into the garment, then hard alpha threshold, speck removal, optional choke / thicken.
6. **Upscale**: Real-ESRGAN in a Web Worker with progress and cancel; Lanczos fallback; vectorize
   for logos with 8 or fewer colors. Warns above 2x.
7. **Export**: `design_{W}x{H}in_300dpi.png`, PNG-24 RGBA, sRGB, pHYs 300 DPI, trimmed to the art plus
   0.1 in, never mirrored unless you ask. A printable job sheet (copy / print) and an optional 22 in
   gang-sheet packer.

Processing order is fixed: crop to the art → upscale → color work → knockout → distress → halftone →
alpha threshold → speck removal → outline → choke / thicken → trim → export. Thresholding happens at
final resolution so edges stay clean. Every exported pixel has alpha 0 or 255.

## Run it

Needs Node 22+.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173.

### Tests

```bash
npm test
```

Vitest unit tests: variant selection, width scaling, DPI flag, alpha threshold, Delta E knockout,
speck removal, stroke-width flag, gang-sheet packing, halftone, masks, PNG encode/decode, the
pipeline on the samples, presets and the job sheet.

```bash
npx playwright install chromium
```

```bash
npm run test:e2e
```

The Playwright smoke test builds the app, uploads `samples/shadow.png`, picks a black Gildan 5000 in
L, full front, applies Horror / metal, exports, and checks the PNG is 3300 px wide (11 in × 300) with
only 0 or 255 alpha. It also exports the three files in `samples/` and checks each one.

## Deploy

It's a static site: `npm run build` writes `dist/`.

- **Vercel**: import the repo. `vercel.json` sets the build and adds the COOP/COEP headers that let
  the upscaler use several CPU threads.
- **GitHub Pages**: push to `main` and set Settings → Pages → Source to "GitHub Actions";
  `.github/workflows/deploy-pages.yml` tests, builds and publishes. Pages can't send custom headers,
  so the service worker adds them; multithreading switches on from the second visit.

The build uses a relative base path, so it works at a domain root or under `/<repo>/`.

## Data files (`src/data/`)

Every file has `source` and `verified` fields.

| File | What |
|---|---|
| `ahtv-sizes.json` | American HTV Supply custom DTF variants and prices (`priceDate`), the gang-sheet product (22 in wide, lengths), their print-size guide |
| `placements.json` | Placement table: default size, width range, distance below the collar, size scaling and collar offset rules |
| `garments.json` | Stores on and near Harry Hines (Aviva Dallas, American HTV Supply, Dallas Shirts Wholesale, Lucky Wholesale / L&B Life, Wholesale T-Shirt Depot, DTF Dallas, Joinus Dallas) with their blanks |
| `colors.json` | Garment color names with approximate sRGB hex (`approx: true`) and finish (solid, heather, washed, mineral, garment-dyed, pigment) |
| `presets.json` | The 15 aesthetic presets and the DTF-can't-do note (puff, glow, foil, flock, rhinestone, UV) |

### Updating AHTV prices

1. Open https://americanhtvsupply.com/products/custom-dtf in a browser (the page showed every variant
   as sold out when last read, so check availability too).
2. Edit `variants` in `src/data/ahtv-sizes.json`: each entry is `{ "label": "10x12", "w": 10, "h": 12, "price": 4.60 }`.
3. Set `priceDate` and `verified` to today.
4. Run `npm test`. The tests check the selection rule against whatever prices are in the file.

Variant selection is orientation-agnostic: the cheapest variant whose sides cover the design either
way round. Prices aren't monotonic with size, so price is compared, never area. When the size isn't a
listed variant the app writes the note for "Leave a Note for our Designers".

Adding a garment: add it to the store's `garments` array in `garments.json`. Every color name must
exist in `colors.json`.

## Upscaler

`public/models/realesr-general-x4v3.onnx` is Real-ESRGAN general x4 v3 (SRVGGNetCompact, 1.2 M
parameters, 4.9 MB), BSD-3-Clause, © 2021 Xintao Wang (license next to the model). It came from the
Hugging Face conversion `vlad-grig/realesr-general-x4v3-onnx`. Its 101 weight tensors were checked
against the official `realesr-general-x4v3.pth` from the Real-ESRGAN v0.2.5.0 release (sha256
`8dc7edb9…6292`) and match exactly. It runs with onnxruntime-web (WebGPU when available, otherwise
WASM) in 128 px tiles. Alpha is resized with Lanczos, not the model. If the model fails to load the app
falls back to Lanczos and says so on the export summary.

Upscalers invent detail. After an upscale, check text and logos in the 100% view before ordering.

## Project layout

```
src/lib/            pure image + sizing code (runs in workers and in Vitest)
  image/            knockout, alpha, halftone, masks, color work, strokes, geometry
  pipeline.ts       the fixed processing order
  sizing.ts         placements, size scaling, DPI flag, AHTV variant selection
  png.ts resize.ts pack.ts presets.ts settings.ts jobSheet.ts
src/workers/        pipeline worker (preview + export), gang-sheet worker
src/components/     UI, including the SVG garment mockup
public/sw.js        offline cache + cross-origin isolation headers
samples/            logo-600.jpg (logo on white), photo.jpg, shadow.png (soft drop shadow)
e2e/                Playwright smoke test
```

## Known limits

- Pressing numbers on the job sheet are defaults. Your film supplier's spec overrides them; test on scrap first.
- Garment colors are approximate screen estimates, not color-managed swatches.
- Store catalogs and prices are as read on 2026-11-03; the app doesn't re-check them.
- Gang sheets render in the browser up to about 120 megapixels (22 × about 60 in at 300 DPI); split longer sheets.
- Puff, glow-in-the-dark, foil, flock, rhinestone and UV color-change effects can't be made with DTF.
