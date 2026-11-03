# DTF Prep: handoff to Claude Code desktop

Use this if the cloud session stops (credits, timeout, container reclaimed). Everything needed to
continue is in this folder; the original brief is `docs/BRIEF.md`.

_Last updated: 2026-11-03, build in progress (slice 3 of 6)._

## 1. Get the code onto your machine

The cloud repo has **no GitHub remote**, so the zip that was sent to you in chat is the copy to use.

```bash
unzip dtf-prep-handoff.zip -d ~/code
```

```bash
cd ~/code/dtf-prep
```

```bash
npm install
```

```bash
npm test
```

```bash
npx playwright install chromium
```

The zip contains the `.git` folder, so `git log` shows the history. To put it on GitHub, create an
empty repo and run `git remote add origin <url>` then `git push -u origin HEAD`.

Why not `claude --teleport`? Teleport pulls a cloud session into your terminal, but the docs list
these requirements: the session's branch must be pushed to a remote, you run it from a checkout of the
same repository, git state is clean, and you're signed in to the same claude.ai account
(https://code.claude.com/docs/en/claude-code-on-the-web.md, "Continue a cloud session in your terminal").
This repo has no remote, so use the zip. If you create an empty GitHub repo and give its name to the cloud
session, it can push there, and then teleport becomes an option. The docs don't say whether teleport still
works once usage limits are hit, so don't count on it.

## 2. Resume prompt (paste this into Claude Code desktop, opened in the dtf-prep folder)

```
Continue building DTF Prep. Read HANDOFF.md first, then docs/BRIEF.md (the full spec).
HANDOFF.md section 3 lists what is done and verified, section 4 lists decisions that are already
made (do not reopen them), section 6 lists the remaining work in order. Run `npm test` before
changing anything to confirm the baseline. Work in small verified slices, use cheaper sub-agents
(Sonnet/Haiku) for well-specified, separable pieces, and stop when the Playwright smoke test passes
and all three files in samples/ export cleanly. Update HANDOFF.md as you finish each slice.
```

## 3. Status

| Slice | State | Where |
|---|---|---|
| Scaffold (Vite 8 + React 19 + TS 7, Vitest 5, Playwright 1.63) | done | `package.json`, `vitest.config.ts` |
| Data: AHTV variants + gang sheet, placements, colors, garments | done (colors/garments by a sub-agent: spot-check) | `src/data/*.json` |
| Sizing math: variant pick, width scaling, collar offset, DPI flag | done, 22 tests | `src/lib/sizing.ts` |
| Image ops: analyze, knockout (Delta E + flood), threshold, choke, thicken, specks, strokes, trim/crop/fit | done, 24 tests | `src/lib/image/{analyze,knockout,alpha,strokes,geometry}.ts` |
| PNG encode/decode with pHYs 300 DPI + sRGB, Lanczos resize, color bleed, gang sheet packer + renderer, sample inputs | done, 21 tests | `src/lib/{png,resize,pack}.ts`, `samples/`, `scripts/make-samples.py` |
| Halftone (alpha, luminance, edge fade), grunge masks + distress, posterize/desaturate/contrast/outline/color warnings | sub-agent finishing | `src/lib/image/{halftone,masks,colorwork}.ts` |
| Garment mockup SVG component | sub-agent finishing | `src/components/GarmentMockup.tsx` |
| Settings defaults | done | `src/lib/settings.ts` |
| Presets (15) + keyword suggester | next | `src/data/presets.json`, `src/lib/presets.ts` |
| Pipeline + Web Worker (progress, cancel) | todo | `src/lib/pipeline.ts`, `src/workers/` |
| Upscaler: Real-ESRGAN general-x4v3 via onnxruntime-web, Lanczos fallback | todo | `public/models/`, `src/workers/` |
| Vectorize instead (imagetracerjs) for <= 8 colors | todo | |
| UI: one scrolling page, steps 1-7, job sheet, gang sheet | todo | `src/App.tsx`, `src/components/` |
| Service worker for offline | todo | `public/sw.js` |
| Playwright smoke test | todo | `e2e/smoke.spec.ts` |
| README | todo | `README.md` |

## 4. Decisions already made (with the reason)

- **Delta E is CIE76** (Euclidean in Lab), tolerance 2-25, default 8. Fast enough per pixel with a
  16 MB memo cache (`makeColorMatcher` in `src/lib/image/color.ts`).
- **12x20 conflict in the brief.** The brief's rule (cheapest variant covering both sides, either
  orientation) picks **18x20 ($8.25)** for a 12x20 design, not 20x20 ($9.00) as the AHTV example says.
  The code follows the rule; a test also shows 12x20 -> 20x20 when 18x20 is absent (AHTV's own
  example list). Both cases emit the custom-size note. Tell the user; don't change it silently.
- **Custom-size note** is emitted whenever the design is not exactly a listed size (either orientation).
- **DPI flag gap:** brief says green >= 300, amber 200-299, red < 150. 150-199 is treated as amber "Low".
- **Width scaling:** full front/back use `defaultW x table[size] / table.L`, rounded to 0.25 in
  (full back L = 12, XS = 9.75, 5XL = 14.5). Not clamped to the placement range.
- **Collar offset** rule (S-XL 3 in, 2XL+ 3.5 in) applies to placements with `collarRule: 'adult-front'`.
- **Output size:** the exported PNG is exactly `W x 300` px wide where W includes the 0.1 in
  transparent margin each side; height follows the art. File name `design_{W}x{H}in_300dpi.png`.
- **Speck rule:** an island is a speck when its bounding box is under N px in both directions
  (0.03 in = 9 px). Halftone dots are protected by a mask from the halftone step, otherwise speck
  removal would delete every dot.
- **Distress masks** are grayscale fields; a pixel is removed when field < intensity x 255, so marks
  grow with intensity and alpha stays binary. One tile spans 3 in of fabric.
- **Processing order:** crop to art at source res -> upscale -> color work (posterize, desaturate,
  contrast, snap B/W, line art) -> knockout (garment, picks, flood) -> distress -> halftone / edge
  fade -> alpha threshold -> speck removal -> outline (after specks so specks aren't outlined) ->
  choke / thicken -> trim + fit exact canvas -> mirror (default off) -> PNG with pHYs 300 DPI.
- **Upscaler model:** Real-ESRGAN `realesr-general-x4v3` (SRVGGNetCompact, 1.2 M params, BSD-3).
  ONNX conversions on Hugging Face: `vlad-grig/realesr-general-x4v3-onnx` (`onnx/model.onnx` 4.9 MB fp32,
  `model_fp16.onnx` 2.4 MB) and `CoderViking/realesr-general-x4v3-onnx`. Both claim the official
  weights (sha256 of the .pth: `8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292`).
  Input `[1,3,H,W]` RGB 0..1, output 4x, clamp. Ship it in `public/models/` so it works offline.
  Run in tiles (~256 px, 16 px overlap). Alpha goes through Lanczos, not the model. If it fails after
  two attempts, ship Lanczos only and say so in the README (brief's rule).
- **Playwright** is pinned to 1.63.0 because the cloud box had Chromium for that version. On desktop,
  `npx playwright install chromium` fetches the matching browser.
- **Added setting `lineArt`** (1-bit threshold to ink) for the stamp and hand-drawn presets.

## 5. Module map (exports other code relies on)

- `src/lib/types.ts`: `RGBAImage`, `RGB`, `Lab`, `BBox`, `ProcessSettings`, `MaskKind`, `Edge`.
- `src/lib/image/core.ts`: `createImage`, `cloneImage`, `fillRect`, `countSemiTransparent`, `countOpaque`, `padImage`, `inToPx`.
- `src/lib/image/color.ts`: `srgbToLab`, `deltaE76`, `relativeLuminance`, `lightness01`, `hexToRgb`, `rgbToHex`, `makeColorMatcher`.
- `analyze.ts`: `analyzeImage` -> size, aspect, alpha, semi-transparent count, distinct colors (32 levels).
- `knockout.ts`: `knockoutColors(img, colors, tol)`, `removeBackgroundFlood(img, tol, {reference, fringeRings})`.
- `alpha.ts`: `hardThreshold`, `choke`, `thicken`, `removeSpecks(img, minPx, protect?)`, `speckSizePx`, `morphMask`.
- `strokes.ts`: `checkStrokes(img, {minStrokePx, minGapPx, minDetailPx, protect})` (about 1 s at 3000 px; run in the worker).
- `geometry.ts`: `alphaBBox`, `solidCoverage`, `crop`, `trim`, `mirrorHorizontal`, `fitCanvas`.
- `png.ts`: `encodePng(img, {dpi})`, `decodePng`, `readPngInfo` (pHYs DPI), `crc32`.
- `resize.ts`: `resizeLanczos` (premultiplied), `bleedColors`.
- `pack.ts`: `packGangSheet(items, {gap, edge})`, `renderGangSheet`, `GANG_SHEET_LENGTHS_IN`.
- `sizing.ts`: `selectVariant`, `proposeWidth`, `sizeFromWidth`, `downFor`, `placementsFor`, `garmentDims`, `dpiFlag`, `effectiveDpi`.
- `settings.ts`: `DEFAULT_SETTINGS`, `mergeSettings`, constants (300 DPI, 0.1 in margin, 0.04 in stroke, 0.15 in text, 70% solid).

## 6. Remaining work, in order

1. `src/data/presets.json` (15 presets from the brief, each a `SettingsPatch` + placement/garment
   hints + keywords) and `src/lib/presets.ts` (`suggestPreset(text)`), plus the one-line note that puff,
   glow, foil, flock, rhinestone and UV color-change can't be done with DTF.
2. `src/lib/pipeline.ts`: the fixed order above as one function with progress callbacks and a
   report (pixels removed, specks, thin strokes, solid coverage, color warnings). Unit-test it on the
   three samples (each must end with only 0/255 alpha).
3. Worker (`src/workers/pipeline.worker.ts`): preview runs (fast, Lanczos) and export runs (AI upscale),
   progress + cancel (terminate the worker).
4. Upscaler in the worker with onnxruntime-web, tiles, cancel, Lanczos fallback; warn when > 2x.
5. UI (one scrolling page): upload stats + PNG DPI; look text + preset dropdown; store -> garment ->
   color -> size (+ custom garment); placement, width slider/inches, mockup + ruler + 6 ft view + DPI
   flag; knockout (eyedropper stack, undo, tolerance, before/after, removed count), distress, halftone,
   fade, threshold, choke, specks, thicken; upscale; export PNG, job sheet (copy + print), gang sheet.
   Keyboard operable, every input labelled, status = icon + text.
6. `public/sw.js` cache-first service worker; warm-cache the model and ORT wasm after first load.
7. `e2e/smoke.spec.ts`: upload a sample PNG, black Gildan 5000 L, full front, Horror / metal, export,
   assert 3300 px wide and only 0/255 alpha.
8. README (what, run, deploy to GitHub Pages / Vercel, data files, how to update prices).
