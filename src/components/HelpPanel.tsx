import type { ReactElement } from 'react'

export function HelpPanel(): ReactElement {
  return (
    <details className="details help">
      <summary>DTF artwork rules</summary>
      <ul className="rules">
        <li><strong>300 DPI at final print size.</strong> Under 150 is a red flag; 200 to 250 is acceptable only for very large prints seen from a distance.</li>
        <li><strong>PNG with true transparency, sRGB.</strong> The printer's RIP converts to CMYK plus white; do not convert to CMYK yourself.</li>
        <li><strong>No semi-transparent pixels.</strong> The RIP lays white underbase under any non-zero alpha, so soft edges, glows and shadows print as white halos. Use halftone dots instead.</li>
        <li><strong>Minimum line and gap: 0.04 to 0.06 in</strong> is safe (0.02 to 0.03 in is risky). <strong>Minimum text height: 0.15 to 0.20 in</strong> (0.10 to 0.12 in is risky). Light text on dark garments needs to be bigger and bolder.</li>
        <li><strong>Delete specks.</strong> Tiny floating pieces lift or wash off. Distress marks must be coarse.</li>
        <li><strong>Trim the canvas</strong> to the art with about 0.1 in margin. On gang sheets keep 0.25 in between designs at minimum; 0.5 in is safer.</li>
        <li><strong>Do not mirror.</strong> The printer mirrors the file.</li>
        <li><strong>Neon colors print duller.</strong> Saturated oranges, blues, greens and magenta shift darker; the app warns but never changes them. Keep pure black at 0,0,0 and white at 255,255,255.</li>
        <li><strong>Avoid big solids.</strong> More than 70% solid feels like a plastic patch and traps sweat. Delete background shapes, knock out garment-color areas, halftone fades, punch texture into solids, keep it open and thin. Heavier fabrics hide stiffness better.</li>
        <li><strong>Hoodies:</strong> front art stays above the kangaroo pocket seam and off seams. The hood covers the top of a back print, so start lower. Zip hoodies get split or left-chest art, not a full front.</li>
        <li><strong>Upscalers invent detail.</strong> After upscaling, look at text and logos at 100%.</li>
        <li><strong>Order of work:</strong> upscale, color work, knockout, halftone, hard alpha threshold, speck removal, choke, trim, export.</li>
      </ul>
    </details>
  )
}
