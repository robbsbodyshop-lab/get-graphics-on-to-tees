# DTF Prep: handoff to Claude Code desktop

Use this if the cloud session stops (credits, timeout, container reclaimed). Everything needed to
continue is in this folder; the original brief is `docs/BRIEF.md`.

_Last updated: 2026-11-03. Build complete: all done criteria met (118 unit tests, Playwright smoke + 3 samples pass)._

## 1. Get the code onto your machine

The code is on GitHub: https://github.com/robbsbodyshop-lab/get-graphics-on-to-tees (private, branch `main`).

```bash
git clone https://github.com/robbsbodyshop-lab/get-graphics-on-to-tees ~/code/get-graphics-on-to-tees
```

```bash
cd ~/code/get-graphics-on-to-tees
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

The zip sent in chat is the same code, if you ever need an offline copy.

`claude --teleport` is also an option now that the branch is on GitHub. The docs list these requirements:
run it from a clean checkout of this repo, and be signed in to the same claude.ai account
(https://code.claude.com/docs/en/claude-code-on-the-web.md, "Continue a cloud session in your terminal").
The docs don't say whether teleport still works once usage limits are hit, so the clone above is the safe route.

## 2. Resume prompt (paste this into Claude Code desktop, opened in the repo folder)

```
Continue building DTF Prep. Read HANDOFF.md first, then docs/BRIEF.md (the full spec).
HANDOFF.md section 3 lists what is done and verified, section 4 lists decisions that are already
made (do not reopen them), section 6 lists the remaining work in order. Run `npm test` before
changing anything to confirm the baseline. Work in small verified slices, use cheaper sub-agents
(Sonnet/Haiku) for well-specified, separable pieces, and stop when the Playwright smoke test passes
and all three files in samples/ export cleanly. Update HANDOFF.md as you finish each slice.
```

## 3. Status

Everything in the brief is built and verified:

- **Unit:** `npm test` → 15 files, 118 tests pass.
- **End to end:** `npm run test:e2e` → 4 Playwright tests pass. The smoke test (shadow.png, black Gildan 5000 L, full front, Horror / metal, default AI upscaler) gives 3300 px wide, pHYs 300 DPI, sRGB, only 0/255 alpha, and asserts that Real-ESRGAN actually ran. The other three tests each export one file from `samples/` cleanly.
- **Manual checks in headless Chromium:** SVG upload; the vectorize upscaler; offline reload through the service worker (cross-origin isolated); phone width (no horizontal scroll); gang sheet download; keyboard eyedropper; job sheet copy.
- **Not verified:**
  - the WebGPU path (the container has no GPU, so WASM was used);
  - the Print button's paper output;
  - real-world prints;
  - live AHTV prices and availability.

Two bugs were found and fixed during e2e:
1. The model URL resolved against the worker folder in production. The model now lives in
   `src/assets/models/` and is loaded with `new URL(..., import.meta.url)`.
2. The bundled onnxruntime starts its pthread workers from our worker file (name `em-pthread`), and
   our message handler deadlocked them. The handler is now skipped in those instances
   (`src/workers/pipeline.worker.ts`).
Model setup also has timeouts (20 s WebGPU, 60 s WASM) and falls back to Lanczos.

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
  Input `[1,3,H,W]` RGB 0..1, output 4x, clamp. It lives in `src/assets/models/` and is referenced with `new URL(..., import.meta.url)` from the worker (a BASE_URL path broke in production because it resolved against `assets/`).
  Run in tiles (~256 px, 16 px overlap). Alpha goes through Lanczos, not the model. If it fails after
  two attempts, ship Lanczos only and say so in the README (brief's rule).
- **Playwright** is pinned to 1.63.0 because the cloud box had Chromium for that version. On desktop,
  `npx playwright install chromium` fetches the matching browser.
- **Added setting `lineArt`** (1-bit threshold to ink) for the stamp and hand-drawn presets.
- **From the first real session (playbook, 2026-11-03):**
  - Exports clear RGB under alpha 0 (it caused white "splatter" in viewers and can fringe in a RIP).
  - The PNG embeds an sRGB ICC profile in iCCP (LittleCMS "sRGB built-in", `src/lib/srgbIcc.ts`) instead of
    the sRGB chunk; the spec says not to write both.
  - The halftone "dark ink" direction is derived from the shirt, never stored (the stored default
    wiped light art on black tees).
  - Dots under 0.01 in are removed even inside halftones (`MIN_DOT_IN`).
  - Snap near-black/white and its warning share one range (10 levels), so the toggle clears the warning.
  - Posterize rescues small saturated accents and reports when it shifts or loses colors.
  - The eyedropper only picks in an explicit pick mode.
  - New warnings: ink close to the shirt color (>25% within 40 brightness levels), garment knockout
    deleting >30% of the art on a mid-tone shirt, Tones halftone keeping <50% of the ink, and a note when
    thin strokes and narrow gaps are both under 1%.

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

## 6. Possible follow-ups (not required by the brief)

- Long-sleeve placements: pass `rotateDesign` to the mockup and add a "rotate 90°" note to the job sheet.
- Try the WebGPU path on a machine with a GPU (Chrome desktop). It should be much faster than WASM.
- Deploy: import the repo into Vercel (vercel.com/new); `vercel.json` already sets the build, output and headers.
- `dev/esrgan-check.html` is a dev-only harness (open it on `npm run dev`) that runs the AI upscaler through the worker and logs timings.
- Oxlint shows 3 fast-refresh warnings (helpers exported next to components). They're harmless.
