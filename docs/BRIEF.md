# Build "DTF Prep": a browser app that turns artwork into print-ready DTF transfer files

## Who this is for and the problem
I order custom DTF (direct-to-film) transfers from American HTV Supply (11250 Harry Hines Blvd #104, Dallas TX 75229) and press them onto blank tees, hoodies and sweatshirts bought at Aviva Dallas, American HTV Supply and the other blank-apparel sellers on the Harry Hines corridor. Three things go wrong today:
1. Designs come back looking like a solid block sticker pressed on the garment instead of part of the shirt.
2. Source images are too low-resolution for the size I press.
3. I guess at how big the design should be for the garment, size and placement.

The app fixes those three and bakes in the DTF artwork rules so I cannot forget them. The look I want is the skate / streetwear graphic-tee world: Primitive, Creature, Fucking Awesome / Hockey, Urban Outfitters vintage reprints, and GQ's summer-2026 graphic tee picks (details in the presets section).

## Scope
Build a single-page web app, everything client-side: no accounts, no server, no database, no order placement, no payment. Vite + React + TypeScript. Image work in Canvas 2D (WebGL only if needed) inside Web Workers. Deployable as a static site (GitHub Pages or Vercel). Keep dependencies few. A backend is allowed only if an upscaler genuinely cannot run in the browser, and then only as an optional `{upscaler API key}` field that the app never requires.

Build the smallest version that does every step below end to end, then stop.

## The workflow (a left-to-right wizard or one scrolling page, your call)

### 1. Upload
Accept PNG, JPG, WEBP, SVG. Show pixel size, aspect ratio, whether it has alpha, the count of semi-transparent pixels (0 < alpha < 255), and the number of distinct colors after quantizing to 32 levels per channel. Read PNG DPI (pHYs) for display only.

### 2. Describe the look (optional)
A free-text box ("what look are you going for?") plus a dropdown of aesthetic presets (listed below). Choosing a preset sets the default toggles in steps 4 to 6; all stay editable. The text is printed on the job sheet and used only for a simple keyword match that suggests a preset. No AI call needed.

### 3. Garment
Pick store -> garment (brand, style, weight, fit) -> color -> size. Data lives in `src/data/garments.json`, seeded from the catalog below. The garment color drives the mockup background and the default knockout color. Include a "custom garment" option with free text and a color picker.

### 4. Placement and size
Pick a placement (full front, center chest, left chest, full back, upper back, back neck, short sleeve, long sleeve, hoodie front above pocket, zip-hoodie split, youth, toddler, infant, hat, tote). The app proposes a width from the placement table below, scaled by garment size, with height from the aspect ratio. The user can override with a width slider or an inches input. Show a mockup: a flat garment silhouette in the chosen color with the design placed at the stated distance below the collar, plus a ruler. Show the effective DPI at that size with a green / amber / red flag: 300 or more green, 200 to 299 amber, under 150 red. Also show a "seen from 6 feet" zoomed-out view to judge readability.

### 5. Knock out (the "not a block sticker" step)
- Eyedropper plus a tolerance slider measured as Delta E in Lab (default 8, range 2 to 25), not RGB distance. Picks stack; "undo last" works. Live "pixels removed" count and a before/after toggle.
- One-click "knock out garment color": removes pixels within tolerance of the selected garment color (black art on a black tee: the black becomes fabric). Preview live on the mockup.
- "Remove background": flood fill from the canvas edges with tolerance, for white or solid backgrounds.
- "Distress": multiply a coarse grunge mask into alpha. Ship 3 or 4 tiled built-in masks (scratched, cracked, speckle, sandblasted) with an intensity slider. Coarse marks only; fine noise turns to mud in DTF.
- "Halftone": converts selected tone ranges or gradients into dots at a chosen LPI (default 55, range 45 to 65). Includes "fade an edge into the garment" as a halftone gradient on alpha. This replaces every soft-alpha fade.
- Every knockout ends with: alpha hard threshold so each pixel is 0 or 255 (threshold slider, default 50%), optional 1 px choke, speck removal that deletes islands smaller than N px (default 0.03 in, which is 9 px at 300 DPI), and a short report of what was removed.

### 6. Upscale
Target pixels per axis = inches x 300. If the source is smaller, upscale with a client-side super-resolution model (Real-ESRGAN through ONNX Runtime Web, or UpscalerJS; pick one that works offline in the browser) in a Web Worker with progress and cancel; fall back to Lanczos if the model fails to load. Order of operations: upscale first, then color work, knockout, halftone and threshold, so thresholding happens at final resolution. Warn, do not block, when the upscale factor is above 2x. For logos and text with 8 or fewer colors, offer "vectorize instead" (trace to SVG with an existing tracer such as imagetracerjs, then rasterize at 300 DPI).

### 7. Export
- `design_{W}x{H}in_300dpi.png`: PNG-24 RGBA, sRGB, exact pixel size = inches x 300, pHYs set to 300 DPI, canvas trimmed to the art plus 0.1 in margin, not mirrored (mirror toggle available, default off).
- Job sheet (printable panel with a copy button): source file and pixel size; garment (store, style, color, size); placement with distance below collar and offset from center; final print size in inches; the American HTV Supply size variant to order and the exact text to paste in "Leave a Note for our Designers" when the size is not a listed variant; price of that variant; effective DPI; what was knocked out; pressing defaults; care note.
- Optional gang-sheet packer: place N copies or several designs on a 22 in wide sheet with 0.5 in spacing (0.25 in minimum), rotate pieces to fit, output a 300 DPI PNG and the sheet length to order. Simple shelf packing is enough.

## Printer facts: American HTV Supply (read 2026-11-03; re-check the page before relying on prices)
Custom DTF product (`americanhtvsupply.com/products/custom-dtf`): fixed-size variants priced each. Their rule: choose the variant "BASED ON THE LONGEST SIDE OF YOUR PRINT"; for a size not listed, pick the next size up and put the real size in the order note (their example: a 12x20 print -> choose 20x20 and note the size). Bulk discounts apply across the total unit count. Delivered on a roll or precut. Their print-size guide: youth full front 7 to 9 in wide; adult full front 9 to 12 in; left chest 3 to 4.5 in; hat front 3 to 5 in wide with 3 in max height; tote 8 to 10 in.

Variants (inches, USD each): 2x2 0.59; 3x2 0.75; 3x3 0.94; 3x4 1.49; 4x2 0.99; 4x3 1.25; 4x4 1.42; 5x6 1.59; 6x5 1.99; 6x6 2.41; 7x8 2.69; 7x9 2.99; 9x7 3.99; 8x10 3.99; 9x9 3.50; 9x11 3.70; 10x7 3.80; 10x8 4.00; 10x10 4.60; 10x11 4.60; 10x12 4.60; 11x4 4.99; 11x5 4.99; 11x7 4.99; 11x8 4.99; 11x9 4.99; 11x11 4.99; 11x13 5.50; 11x14 5.50; 13x11 6.49; 12x4 5.99; 12x5 5.99; 12x8 5.99; 12x9 5.99; 12x10 5.99; 12x12 5.99; 12x14 5.99; 12x15 5.99; 12x17 5.99; 13x13 6.49; 13x16 6.49; 13x17 6.49; 15x18 7.25; 16x13 7.49; 18x20 8.25; 20x20 9.00.

Put these in `src/data/ahtv-sizes.json` with a `priceDate` field. Variant selection rule: orientation-agnostic. Choose the cheapest variant whose two sides both cover the design's width and height in either orientation. If none covers it, choose the smallest variant whose longest side is at least the design's longest side and emit the custom-size note. Prices are not monotonic with size, so always compare price, not area.

Gang sheet product ("Upload a DTF Gang Sheet"): 22 in wide; lengths 24, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220, 240, 300, 400, 500, 600, 750, 1000 in; upload accepts png, jpg, svg; max file size 500 MB; they ask for a "ready to print template (PNG)".

The AHTV pages state no DPI, color-space, transparency or mirroring rules, so enforce the industry rules below. When fetched, the product page showed every variant as "sold out"; confirm availability in a browser before trusting it.

## DTF artwork rules to enforce (industry consensus from transfer vendors; put them in in-app help)
- 300 DPI at final print size. Under 150 is a red flag; 200 to 250 is acceptable only for very large prints seen from a distance.
- PNG with true transparency, sRGB. The printer's RIP converts to CMYK plus white; do not convert to CMYK.
- No semi-transparent pixels. The RIP lays white underbase under any non-zero alpha, so soft edges print as white halos or hazy fringe, worst on dark garments. After processing every pixel's alpha is 0 or 255. No glows, drop shadows, feathered edges or fades to transparent; use halftone dots instead.
- Minimum line and gap width: 0.04 to 0.06 in is safe, 0.02 to 0.03 in is risky. Minimum text height: 0.15 to 0.20 in safe, 0.10 to 0.12 in risky. Light text on dark garments needs to be bigger and bolder. After processing, flag violations by measuring the thinnest strokes (an erosion test is fine) and offer "thicken strokes 1 px".
- Delete isolated specks; tiny floating pieces lift or wash off. Distress marks must be coarse.
- Trim the canvas to the art with about 0.1 in margin. On gang sheets keep at least 0.25 in between designs, 0.5 in is safer.
- Do not mirror by default; the printer mirrors.
- Saturated and neon oranges, blues, greens and magenta print darker and duller. Colors only shift down, so warn, never auto-"fix". Keep pure black at RGB 0,0,0 and white at 255,255,255.
- Big solid fills feel like a plastic patch and trap sweat. Warn when the design's bounding box is more than 70% solid. Remedies in order: delete non-essential background shapes and borders; knock out garment-color areas; halftone the fades and shading; punch texture or pattern into unavoidable solids; keep designs open and thin. Heavier fabrics (hoodies, tees 6 oz and up) hide stiffness better than 4 oz tees.
- Hoodies: front art stays above the kangaroo pocket seam and off seams. The hood covers the top of a back print, so start back prints lower. Zip hoodies get split or left-chest art, not a full front.
- Upscalers invent detail. After upscaling, show text and logos at 100% for a human check.

## Placement and size table (inches; "down" = top of design below the collar seam). Put it in `src/data/placements.json`.
| Placement | Default W x H | Width range | Down | Notes |
|---|---|---|---|---|
| Adult full front | 11 x 11 | 10 to 12 | 3 | oversize option 12 to 15 wide, 2 down |
| Center chest | 8 x 4 | 6 to 10 | 3 | |
| Left chest | 3.5 x 2 | 2.5 to 4.5 | 3 | center 3.5 to 4 in from the centerline, wearer's left |
| Full back | 12 x 14 | 11 to 13 | 4 | |
| Upper back | 12 x 4 | 10 to 14 | 4 | |
| Back neck | 2.5 x 2.5 | 2 to 3 | 1 to 2 | |
| Short sleeve | 3 x 3 | 2.5 to 3.5 | centered between shoulder seam and hem | |
| Long sleeve / hoodie sleeve | 2.5 x 12 | up to 3.5 x 15 | stop 3.5 above the cuff | vertical |
| Hoodie full front | 11 x 10 | 10 to 12 | 3 | must clear the pocket |
| Hoodie left chest | 4 x 4 | 3 to 4 | 4 | |
| Zip hoodie, per side | 3.5 x 3.5 | 3.5 to 4 | 3 | |
| Crewneck full front | 11.5 x 11 | 11 to 12.5 | 3 | |
| Youth full front | 9 x 9 | 7 to 9 | 2 to 2.5 | matches AHTV's 7 to 9 |
| Youth full back | 10 x 12 | 9 to 10 | 3 | |
| Youth left chest | 2.5 x 1.5 | 2.5 to 3 | 2.5 | |
| Toddler front | 6.5 x 6.5 | 6 to 7 | 2 | |
| Infant front | 4.5 x 4.5 | 4 to 5 | 1.5 | keep above the diaper line |
| Hat front | 4 x 2.25 | 3 to 5 | n/a | max 3 tall (AHTV) |
| Tote | 9 x 9 | 8 to 10 | n/a | |

Width scaling by adult size for full front and full back: XS 9, S 10, M 10.75, L 11, XL 11.25, 2XL 11.75, 3XL 12.25, 4XL 12.75, 5XL 13.25. Collar offset: S to XL 3 in, 2XL and up 3.5 in, youth 2.25 in. Left chest, sleeve and back-neck sizes do not scale with garment size.

## Garment catalog to seed `src/data/garments.json` (store feeds read 2026-11-03; give each store `verified: "2026-11-03"`)
- **Aviva Dallas** (avivadallas.com): Gildan 5000 Heavy Cotton 5.3 oz; 5000B youth; 5100P toddler; 64000 Softstyle 4.5 oz; 64000L ladies; 8000 DryBlend 5.6 oz; 5400B youth long sleeve; 8800 polo; 18500 Heavy Blend hoodie 8 oz; 18500B youth hoodie; 18600 zip hoodie 8 oz; 18000 Heavy Blend crew 8 oz; 18000B youth crew; Bella+Canvas 3001 4.2 oz, 3001CVC, 3001Y, 3001T, 3005 V-neck, 3501 long sleeve; Next Level 1510; Port & Co performance tee; LAT 1910 / 1210 / 1310 sublimation polyester tees; Laviva garment-washed 55/45 sweatshirt. Sizes: adult XS to 3XL, youth XS to XL, toddler 2T to 5T. No heavyweight, boxy or washed finishes here; heathers and "Antique" colors only.
- **American HTV Supply** (11250 Harry Hines Blvd #104, americanhtvsupply.com): Gildan Heavy Cotton tee; Soft-Style tee 4.3 oz; youth premium tee; women's tee; 6 oz polyester tee; long sleeve; Comfort Colors 1717 garment-dyed tee (Washed Denim, Chalky Mint, Hydrangea, Island Reef, Blue Jean, Pepper, Yam, Terracotta, Moss, Crunchberry and more); Adult Mineral Shirt 6.5 oz mineral / acid wash; SmartBlanks and American & Co pullover hoodies; Mineral hoodies (Mineral Brown, Beige, Dark Brown, Navy, Slate, Gray, Black); zip hoodies; crop hoodies and crop sweatshirts; relaxed drop-shoulder crew; Nantucket two-tone textured fleece crew; youth comfort hoodie 7.8 oz. Sizes S to 5XL.
- **Dallas Shirts Wholesale** (11347 Harry Hines Blvd, dallasshirts.com): Shaka Wear 7.5 oz Max Heavyweight garment-dye tee and long sleeve; SmartBlanks MH700 10 oz mineral-wash hoodie; MT600 mineral-dye tee; VT400 vintage sun-kissed tee; UH77 7.7 oz ultra heavy tee; VH500 vintage hoodie; Zuni ZS4010 oversized tee; Zuni ZS4050 12 oz / 400 GSM oversized hoodie; Smart 8005 12 oz ultra heavy hoodie; Comfort Colors 1717; SmartBlanks 4150 women's crop fleece hoodie.
- **Lucky Wholesale / L&B Life** (11422 Harry Hines Blvd Ste 112 and 11409 Denton Dr; luckywholesale.net, landblife.com): LBL 2102 washed tees (pink wash, turquoise, military green, mustard and more); LBL boxy tees; Comfort Colors 1745 Blast (Umber, Sea Glass, Smoke); Comfort Colors 1717; fitted crop tops; L&B 401 hoodie and 501 sweatshirt, 10 to 13 oz sponge fleece.
- **Wholesale T-Shirt Depot** (11311 Harry Hines Blvd #201, wtdtx.com): Pro Club heavyweight short and long sleeve; Smartex oversize tee; Cotton Heritage French terry hoodie and crew. $200 minimum to ship.
- **DTF Dallas** (Richardson, not on Harry Hines; dtfdallas.com): DigiPrint 1300 acid-wash heavyweight oversized tee 180 GSM (grey, cream, indigo); DigiPrint 3300 acid-wash muscle tee; Shaka Wear SHGD, SHGDD drop-shoulder and SHGDC crop garment-dyed 7.5 oz; Comfort Colors 1467 garment-dyed hoodie and 1566 crew.
- **Joinus Dallas** (11311 Harry Hines Blvd Ste 302): HTV shop that also sells tees; stock unverified, include the store name only.

Garment colors: build one shared list in `src/data/colors.json` with an approximate sRGB hex per name (your best estimate, flagged `approx: true`) and a `finish` field (`solid`, `heather`, `washed`, `mineral`, `garment-dyed`, `pigment`) so the mockup can add subtle mottling to washed finishes. Cover at least: Black, Jet Black, Washed Black, Vintage Black, Charcoal, Pepper, Dark Heather, Sport Grey, Athletic Heather, Ash, Ice Grey, Storm Grey Pigment, White, Natural, Ivory, Cream, Bone, Sand, Sandstone, Oatmeal Heather, Beige, Mineral Beige, Mineral Brown, Mineral Dark Brown, Mineral Navy, Mineral Slate, Mineral Gray, Mineral Black, Brown, Dark Chocolate, Coyote Brown, Tan, Khaki, Army, Military Green, Olive, Moss, Forest Green, Pine, Kelly, Irish Green, Lime, Safety Green, Teal, Deep Teal, Seafoam, Chalky Mint, Mint, Island Reef, Lagoon Blue, Turquoise, Carolina Blue, Light Blue, Sky, Chambray, Washed Denim, Blue Jean, Royal, True Royal, Navy, Midnight Navy, Indigo, Sapphire, Hydrangea, Lavender, Lilac, Orchid, Violet, Purple, Maroon, Burgundy, Wine, Cardinal, Crimson, Red, Antique Cherry Red, Crunchberry, Berry, Watermelon, Heliconia, Azalea, Hot Pink, Pink, Light Pink, Blossom, Peach, Coral, Terracotta, Rust, Yam, Burnt Orange, Texas Orange, Orange, Safety Orange, Tangerine, Gold, Mustard, Yellow, Butter, Daisy, Camo, Forest Camo.

## Aesthetic presets for the dropdown, in `src/data/presets.json`
Each preset sets default toggles; everything stays editable. They are grounded in what the brands I like actually sell: Primitive (7.5 oz jersey tees, 500 gsm heavyweight and boxy hoods, enzyme vintage wash, "small hit up front, graphic takes over the back", Old English script, angel-and-skull and cross art, black / cream / washed black / brown / forest green garments), Creature (horror, skull, flame and "Bonehead" art, logo and outline-logo tees, "Relic" distressed logos, "small front and large back" prints in soft-hand ink, heavyweight fleece, black / maroon / navy / military green / forest camo / storm grey pigment), Fucking Awesome and Hockey (stamp, drip and outline logos, hand-drawn "Dillustrated" art, photo and collage prints, bleached-ink and sprayed-dye tees, 10 oz classic hoodies, heavyweight "core line" tees, boxy slightly cropped fits, black / white / navy / forest green / violet / pepper), Urban Outfitters men's graphic tees (vintage band and tour reprints on retro-washed heavyweight blanks, oversized and boxy fits, slub, paint-splatter, sports throwbacks, college colorblock hoodies, auto and racing graphics) and GQ's summer-2026 graphic tee list (playful tongue-in-cheek illustration from Metalwood, Emily Dawn Long, Only NY and Cactus Store; preppy fictional golf, sailing and football club tees; sporty throwbacks like the Mitchell & Ness cream champions tee; print-forward art tees from Kapital and NTS; the advice to "scuff them up a touch").

1. **Skate flat-color** (Primitive, Creature logo tees): posterize to 3 to 6 flat colors, hard edges, 2 to 4 px outline, no gradients, garment-color knockout on.
2. **Horror / metal** (Creature x Cannibal Corpse, Hellraiser, Bonehead, Doom Skull): black-dominant art on a black garment, maximum contrast, knock out all near-black so the tee becomes the black, keep whites plus one accent color, light cracked distress.
3. **Distressed relic** (Creature "Relic" logos, UO vintage reprints): coarse crack and scratch distress at 30 to 50%, slight desaturation, aggressive speck removal.
4. **Vintage band / tour tee** (UO Metallica and Soundgarden tour reprints, J.Crew vintage-wash): halftone photo at 50 LPI, cracked distress, faded palette, recommends washed or mineral blanks.
5. **Stamp / outline logo** (FA stamp, drip and outline logos; Creature Logo Outline): single color, threshold to 1-bit, clean edges, small placements (left chest, bottom-left hem hit, back neck).
6. **Halftone photo / screen-tone** (FA photo and illustration tees): convert a photo to a 1 to 3 ink halftone at 45 to 65 LPI, no soft alpha.
7. **Hand-drawn ink** (FA "Dillustrated"; GQ playful tees): threshold to line art while preserving line weight, 1 to 2 colors, paper white knocked out.
8. **Collage / zine / xerox** (FA Dill Collage): high-contrast cutouts, 1 px white or black keyline around each piece, light speckle.
9. **Old English / blackletter type** (Primitive Realm and Arena boxy tees): sharpen type edges, outline, flat fill, enforce the minimum stroke width.
10. **Collegiate / preppy club** (GQ preppy picks; UO college colorblock hoodies): arched block type, 2 to 3 flat colors, vintage wash distress at 15 to 25%, recommends cream, heather or sand garments.
11. **Sports throwback** (Mitchell & Ness, UO NFL vintage): cream or heather base, cracked ink, retro palette limited to 4 colors.
12. **Playful / tongue-in-cheek** (Metalwood "Excuses", Cactus Store, Only NY): simple color illustration, clean edges, no distress, light garments.
13. **Small front / big back** (Primitive, Creature, FA hoodies): placement preset that exports two files from the same art: a 3.5 in left chest and a 12 in full back, or a secondary logo file.
14. **Fade into garment**: one edge fades into the shirt through a halftone alpha gradient, never soft alpha.
15. **Washed / mineral garment pairing**: no change to the art, but the mockup uses a mottled finish and the job sheet recommends the washed blanks in the catalog (Comfort Colors 1717 and 1745, SmartBlanks MT600 and MH700, DigiPrint acid wash, LBL 2102).

Puff, glow-in-the-dark, foil, flock, rhinestone and UV color-change prints (all seen at Primitive) cannot be reproduced with DTF. Show a one-line note instead of a preset.

## Best practices to build in that the brief above does not spell out
- Fixed processing order: upscale -> color work -> knockout -> halftone -> alpha threshold -> speck removal -> choke -> trim -> export. Thresholding before upscaling makes jagged edges.
- Show the design on the garment color at true scale with a ruler, and the zoomed-out readability view.
- Flag strokes thinner than 0.04 in and text shorter than 0.15 in after processing; offer "thicken strokes 1 px".
- Warn at more than 70% solid coverage inside the bounding box and list the remedies.
- Embed 300 DPI in the PNG so Photoshop and the printer read the right size; encode the final inch size in the file name.
- Job sheet pressing defaults: pre-press 3 to 5 s; 300 to 320 F, 10 to 15 s, medium-firm to firm pressure; peel per the film (cold is the safest default); second press 5 to 10 s with parchment or a Teflon sheet (a linen sheet for matte); wash inside out in cold water, tumble low or hang. Print the line "your film supplier's spec overrides these numbers; test on scrap first" because vendors disagree by 20 F or more.
- Mirror toggle default off.
- Gang sheet packer uses 0.5 in gaps, rotates pieces to fit, never exceeds 22 in width, and reports the sheet length to order.
- Everything works offline after first load. Images over 6000 px process in a Web Worker with progress and cancel; the UI never freezes.
- Accessibility: keyboard-operable controls, a label on every input, status shown with icon plus text, never color alone.
- Treat the store data above as given. Do not re-scrape those sites; they rate-limit.

## Deliverables and done criteria
- A repo with a README: what the app does, how to run and deploy, where the data files are and how to update prices.
- The data files above, each with `source` and `verified` fields.
- Vitest unit tests for: variant selection (including the 12x20 -> 20x20 custom-note case and the cheapest-not-smallest rule), width scaling by garment size, the effective-DPI flag, alpha thresholding (no pixel left with 0 < alpha < 255), Delta E knockout, speck removal, the stroke-width flag, and gang sheet packing (no overlaps, 22 in width respected).
- One Playwright smoke test: upload a sample PNG, choose a black Gildan 5000 size L, full front, apply "Horror / metal", export, and assert the PNG is 3300 px wide (11 in x 300) with only 0 or 255 alpha.
- Three sample inputs in `samples/`: a 600 px JPG logo on a white background, a photo, and a transparent PNG with a soft drop shadow. Each must export cleanly.
- Stop when the smoke test passes and the three samples export cleanly. If no browser upscaler works after two attempts, ship Lanczos only and say so in the README. Report anything you could not verify.

Work in small verified slices: data and sizing math with tests first, then knockout, then upscale, then export, then mockup polish.
