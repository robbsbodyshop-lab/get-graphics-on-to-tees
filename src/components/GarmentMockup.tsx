import { useId } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import './GarmentMockup.css'

export type MockupGarmentType =
  | 'tee' | 'long-sleeve' | 'hoodie' | 'zip-hoodie' | 'crewneck' | 'polo'
  | 'crop-tee' | 'crop-hoodie' | 'crop-crew' | 'muscle-tee' | 'tank' | 'hat' | 'tote'
export type MockupView = 'front' | 'back' | 'left-sleeve' | 'right-sleeve'
export type MockupFinish = 'solid' | 'heather' | 'washed' | 'mineral' | 'garment-dyed' | 'pigment'

export interface GarmentMockupProps {
  garmentType: MockupGarmentType
  /** Body width of the garment flat, in inches (chest width pit to pit). e.g. adult L tee ≈ 22. */
  bodyWidthIn: number
  /** Body length from the collar seam (high point shoulder) to hem, in inches. e.g. adult L tee ≈ 29. */
  bodyLengthIn: number
  colorHex: string
  finish: MockupFinish
  /** Design bitmap (object URL or data URL), already transparent where the garment shows. May be null. */
  designUrl: string | null
  /**
   * Printed size of the artwork in inches, as-is. When `rotateDesign` is set the
   * artwork is turned 90 degrees, so its footprint on the garment is designHIn wide
   * by designWIn tall.
   */
  designWIn: number
  designHIn: number
  /** Distance from the collar seam (top of body at centre) down to the TOP of the design, inches. null = centre it vertically in the print area (sleeves, hats, totes). */
  downIn: number | null
  /** Horizontal offset of the design centre from the garment centreline in inches; positive = toward the WEARER'S LEFT, which is the VIEWER'S RIGHT on a front view. */
  offsetIn: number
  view: MockupView
  /** Rotate the design 90° (vertical long-sleeve prints run down the sleeve). */
  rotateDesign?: boolean
  /** Show the inch ruler along the top and left edge (default true). */
  showRuler?: boolean
  /** Draw a dashed line at the kangaroo-pocket seam on hoodies (default true). */
  showPocketLine?: boolean
  /** Optional extra caption text. */
  caption?: string
  /** Visual size class. 'distance' renders the same thing small with no ruler/labels to simulate viewing from 6 feet. */
  variant?: 'full' | 'distance'
  className?: string
}

/** Kangaroo pocket top seam, inches below the collar seam. */
export function pocketTopFromCollarIn(bodyLengthIn: number): number {
  return bodyLengthIn * 0.55
}

/** True when front art sits fully above the kangaroo pocket seam (with a 0.5 in margin). */
export function designClearsPocket(downIn: number, designHIn: number, bodyLengthIn: number): boolean {
  return downIn + designHIn <= pocketTopFromCollarIn(bodyLengthIn) - 0.5
}

/* ------------------------------------------------------------------ */
/* Colour helpers                                                       */
/* ------------------------------------------------------------------ */

type RGB = [number, number, number]

function parseHex(hex: string): RGB {
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [128, 128, 128]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function toHex(c: RGB): string {
  return '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function luminance(c: RGB): number {
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
}

interface Palette {
  fill: string
  line: string
  band: string
  inner: string
}

function paletteFor(hex: string): Palette {
  const rgb = parseHex(hex)
  const lum = luminance(rgb)
  const light = lum > 0.35
  return {
    fill: toHex(rgb),
    line: toHex(light ? mix(rgb, [0, 0, 0], 0.42) : mix(rgb, [255, 255, 255], 0.4)),
    band: light ? 'rgba(0,0,0,0.075)' : 'rgba(255,255,255,0.07)',
    inner: light ? 'rgba(0,0,0,0.26)' : 'rgba(255,255,255,0.09)',
  }
}

/* ------------------------------------------------------------------ */
/* Path helpers                                                         */
/* ------------------------------------------------------------------ */

type Pt = [number, number]
interface Seg {
  t: 'L' | 'Q' | 'C'
  p: Pt[]
}
interface HalfPath {
  start: Pt
  segs: Seg[]
}

const lineTo = (x: number, y: number): Seg => ({ t: 'L', p: [[x, y]] })
const cubTo = (x1: number, y1: number, x2: number, y2: number, x: number, y: number): Seg => ({
  t: 'C',
  p: [[x1, y1], [x2, y2], [x, y]],
})

const n3 = (v: number) => String(Math.round(v * 1000) / 1000)

function pathD(start: Pt, segs: Seg[]): string {
  let d = `M${n3(start[0])} ${n3(start[1])}`
  for (const s of segs) d += s.t + s.p.map((q) => `${n3(q[0])} ${n3(q[1])}`).join(' ')
  return d
}

function mirrorHalf(h: HalfPath): HalfPath {
  const m = (p: Pt): Pt => [-p[0], p[1]]
  return { start: m(h.start), segs: h.segs.map((s) => ({ t: s.t, p: s.p.map(m) })) }
}

function reverseHalf(h: HalfPath): HalfPath {
  const ends: Pt[] = [h.start, ...h.segs.map((s) => s.p[s.p.length - 1])]
  const segs: Seg[] = []
  for (let i = h.segs.length - 1; i >= 0; i--) {
    const s = h.segs[i]
    const ctrl = s.p.slice(0, -1).reverse()
    segs.push({ t: s.t, p: [...ctrl, ends[i]] })
  }
  return { start: ends[ends.length - 1], segs }
}

function poly(pts: Pt[], close = true): string {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${n3(p[0])} ${n3(p[1])}`).join('') + (close ? 'Z' : '')
}

/** Garment silhouette from its right half (neck-side point -> hem centre) plus the neckline. */
function closedOutline(right: HalfPath, neck: Seg[]): string {
  const left = reverseHalf(mirrorHalf(right))
  return pathD(right.start, [...right.segs, ...left.segs, ...neck]) + 'Z'
}

/* ------------------------------------------------------------------ */
/* Garment specs                                                        */
/* ------------------------------------------------------------------ */

type NeckKind = 'crew' | 'polo' | 'hood' | 'tank' | 'muscle'

interface Spec {
  label: string
  kind: 'body' | 'hat' | 'tote'
  sleeve: 'none' | 'short' | 'long'
  neck: NeckKind
  ribbed: boolean
  zip: boolean
  hooded: boolean
  /** neck half width as a fraction of body width */
  nh: number
  dropF: number
  dropB: number
  neckBand: number
}

const base = (o: Partial<Spec> & Pick<Spec, 'label'>): Spec => ({
  kind: 'body',
  sleeve: 'short',
  neck: 'crew',
  ribbed: false,
  zip: false,
  hooded: false,
  nh: 0.16,
  dropF: 0.135,
  dropB: 0.045,
  neckBand: 0.04,
  ...o,
})

const hoodSpec = { neck: 'hood', hooded: true, ribbed: true, sleeve: 'long', nh: 0.17, dropF: 0.16, neckBand: 0 } as const
const crewSpec = { sleeve: 'long', ribbed: true, neckBand: 0.05, dropF: 0.125 } as const

const SPECS: Record<MockupGarmentType, Spec> = {
  tee: base({ label: 'T-shirt' }),
  'long-sleeve': base({ label: 'Long-sleeve tee', sleeve: 'long' }),
  hoodie: base({ label: 'Hoodie', ...hoodSpec }),
  'zip-hoodie': base({ label: 'Zip hoodie', ...hoodSpec, zip: true, dropF: 0.17 }),
  crewneck: base({ label: 'Crewneck sweatshirt', ...crewSpec }),
  polo: base({ label: 'Polo shirt', neck: 'polo', nh: 0.15, dropF: 0.1, dropB: 0.04, neckBand: 0 }),
  'crop-tee': base({ label: 'Crop tee' }),
  'crop-hoodie': base({ label: 'Crop hoodie', ...hoodSpec }),
  'crop-crew': base({ label: 'Crop crewneck', ...crewSpec }),
  'muscle-tee': base({ label: 'Muscle tee', sleeve: 'none', neck: 'muscle', nh: 0.18, dropF: 0.2, dropB: 0.09, neckBand: 0.03 }),
  tank: base({ label: 'Tank top', sleeve: 'none', neck: 'tank', nh: 0.17, dropF: 0.27, dropB: 0.1, neckBand: 0.03 }),
  hat: base({ label: 'Cap', kind: 'hat', sleeve: 'none' }),
  tote: base({ label: 'Tote bag', kind: 'tote', sleeve: 'none' }),
}

const VIEW_LABEL: Record<MockupView, string> = {
  front: 'front',
  back: 'back',
  'left-sleeve': 'left sleeve',
  'right-sleeve': 'right sleeve',
}

/* ------------------------------------------------------------------ */
/* Geometry builders                                                    */
/* ------------------------------------------------------------------ */

interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

interface Ids {
  clip: string
  hoodClip: string
  gradH: string
  gradV: string
  tex: string
  blur: string
  rib: string
  hasTex: boolean
  texOpacity: number
}

interface Built {
  /** silhouette */
  d: string
  bounds: Bounds
  /** drawn behind the body */
  under: ReactNode
  /** clipped to the silhouette, on top of fill (bands, hood shadow) */
  shade: ReactNode
  /** seams and details, unclipped, above the shading */
  lines: ReactNode
  /** pieces that sit over the body (back hood, drawstrings) */
  over: ReactNode
  /** extra clip shapes that should also receive the finish texture */
  texClipD?: string
  print: { cx: number; cy: number }
  pocket: { y: number; halfW: number } | null
}

const SIDES = [1, -1] as const

function cls(...c: (string | false | undefined)[]): string {
  return c.filter(Boolean).join(' ')
}

function buildBody(spec: Spec, W: number, len: number, view: 'front' | 'back', ids: Ids): Built {
  const half = W / 2
  const front = view === 'front'
  const nh = spec.nh * W
  const drop = (front ? spec.dropF : spec.dropB) * W
  const armY = Math.min(0.43 * W, 0.62 * len)
  const sy = 0.065 * W
  const bandH = 0.115 * W
  const hasSleeves = spec.sleeve !== 'none'
  const isLong = spec.sleeve === 'long'

  const shoulderTip: Pt = [half + 0.022 * W, sy]
  const shoulderY = (x: number) => Math.max(0, Math.min(1, (x - nh) / (shoulderTip[0] - nh))) * sy

  // Sleeve geometry (right side)
  const ang = ((isLong ? 66 : 32) * Math.PI) / 180
  const dv: Pt = [Math.cos(ang), Math.sin(ang)]
  const pv: Pt = [-Math.sin(ang), Math.cos(ang)]
  const sl = isLong ? 1.0 * W : 0.38 * W
  const cw = isLong ? (spec.ribbed ? 0.17 : 0.19) * W : 0.34 * W
  const E: Pt = [shoulderTip[0] + dv[0] * sl, shoulderTip[1] + dv[1] * sl]
  const F: Pt = [E[0] + pv[0] * cw, E[1] + pv[1] * cw]

  const segs: Seg[] = []
  let xMax = half
  let yMax = len
  let strapX = 0
  if (hasSleeves) {
    segs.push(lineTo(...shoulderTip), lineTo(...E), lineTo(...F), lineTo(half, armY), lineTo(half, len), lineTo(0, len))
    xMax = Math.max(E[0], F[0])
    yMax = Math.max(len, F[1])
  } else {
    strapX = nh + (spec.neck === 'muscle' ? 0.17 : 0.11) * W
    const sTipY = 0.012 * W
    const deep = spec.neck === 'muscle' ? 0.82 : 1
    segs.push(
      lineTo(strapX, sTipY),
      cubTo(strapX - 0.012 * W, armY * 0.5, strapX + (half - strapX) * 0.35 * deep, armY * 0.86, half, armY),
      lineTo(half, len),
      lineTo(0, len),
    )
  }
  const right: HalfPath = { start: [nh, 0], segs }
  const neckSeg = cubTo(-nh, drop * 1.3333, nh, drop * 1.3333, nh, 0)
  const neckD = pathD([-nh, 0], [neckSeg])
  const d = closedOutline(right, [neckSeg])

  const hood = spec.hooded
  const hoodH = 0.38 * W
  const minY = hood && front ? -hoodH : spec.neck === 'polo' ? -2.4 : 0

  const bounds: Bounds = { minX: -xMax, maxX: xMax, minY, maxY: yMax }

  /* ---------------- under / over (hood) ---------------- */
  let under: ReactNode = null
  let over: ReactNode = null
  let shade: ReactNode = null
  let texClipD: string | undefined
  const lines: ReactNode[] = []

  if (hood && front) {
    const hw = nh + 0.05 * W
    const hoodD =
      `M${n3(-hw)} ${n3(0.9)}C${n3(-hw - 0.03 * W)} ${n3(-hoodH * 0.6)} ${n3(-hw * 0.8)} ${n3(-hoodH)} 0 ${n3(-hoodH)}` +
      `C${n3(hw * 0.8)} ${n3(-hoodH)} ${n3(hw + 0.03 * W)} ${n3(-hoodH * 0.6)} ${n3(hw)} 0.9` +
      `L${n3(hw)} ${n3(drop * 0.9)}L0 ${n3(drop + 0.8)}L${n3(-hw)} ${n3(drop * 0.9)}Z`
    const inner =
      `M${n3(-nh - 0.15)} 0.6C${n3(-nh - 0.5)} ${n3(-hoodH * 0.5)} ${n3(-nh * 0.7)} ${n3(-hoodH * 0.8)} 0 ${n3(-hoodH * 0.8)}` +
      `C${n3(nh * 0.7)} ${n3(-hoodH * 0.8)} ${n3(nh + 0.5)} ${n3(-hoodH * 0.5)} ${n3(nh + 0.15)} 0.6` +
      `L${n3(nh + 0.15)} ${n3(drop * 0.7)}L0 ${n3(drop + 0.8)}L${n3(-nh - 0.15)} ${n3(drop * 0.7)}Z`
    texClipD = hoodD
    under = (
      <g>
        <path d={hoodD} className="gm__fill" />
        <g clipPath={`url(#${ids.hoodClip})`}>
          <path d={hoodD} fill={`url(#${ids.gradH})`} />
          <path d={inner} className="gm__inner" />
          <TexSlot ids={ids} />
        </g>
        <path d={hoodD} className="gm__outline" />
        <path
          d={`M${n3(-nh - 0.15)} 0.6C${n3(-nh - 0.5)} ${n3(-hoodH * 0.5)} ${n3(-nh * 0.7)} ${n3(-hoodH * 0.8)} 0 ${n3(-hoodH * 0.8)}C${n3(nh * 0.7)} ${n3(-hoodH * 0.8)} ${n3(nh + 0.5)} ${n3(-hoodH * 0.5)} ${n3(nh + 0.15)} 0.6`}
          className="gm__seam"
        />
      </g>
    )
  }

  if (hood && !front) {
    const hoodDrop = 0.43 * W
    const hw = nh + 0.12 * W
    const hoodD =
      `M${n3(-nh)} 0C${n3(-hw - 0.05 * W)} ${n3(hoodDrop * 0.2)} ${n3(-hw - 0.06 * W)} ${n3(hoodDrop * 0.9)} ${n3(-0.02 * W)} ${n3(hoodDrop)}` +
      `Q0 ${n3(hoodDrop + 0.5)} ${n3(0.02 * W)} ${n3(hoodDrop)}` +
      `C${n3(hw + 0.06 * W)} ${n3(hoodDrop * 0.9)} ${n3(hw + 0.05 * W)} ${n3(hoodDrop * 0.2)} ${n3(nh)} 0` +
      `C${n3(nh)} ${n3(drop * 1.3333)} ${n3(-nh)} ${n3(drop * 1.3333)} ${n3(-nh)} 0Z`
    texClipD = hoodD
    shade = (
      <g filter={`url(#${ids.blur})`} transform="translate(0 0.45)">
        <path d={hoodD} fill="rgba(0,0,0,0.30)" />
      </g>
    )
    over = (
      <g>
        <path d={hoodD} className="gm__fill" />
        <g clipPath={`url(#${ids.hoodClip})`}>
          <path d={hoodD} fill={`url(#${ids.gradH})`} />
          <TexSlot ids={ids} />
        </g>
        <path d={hoodD} className="gm__outline" />
        <path d={`M0 ${n3(drop)}L0 ${n3(hoodDrop)}`} className="gm__seam" />
        <path
          d={`M${n3(-nh - 0.2)} ${n3(drop * 0.6)}Q${n3(-hw * 0.95)} ${n3(hoodDrop * 0.6)} ${n3(-0.1 * W)} ${n3(hoodDrop * 0.93)}M${n3(nh + 0.2)} ${n3(drop * 0.6)}Q${n3(hw * 0.95)} ${n3(hoodDrop * 0.6)} ${n3(0.1 * W)} ${n3(hoodDrop * 0.93)}`}
          className="gm__seam"
        />
      </g>
    )
  }

  /* ---------------- bands, bands, seams ---------------- */
  const bandShapes: ReactNode[] = []
  const bw = spec.neckBand * W
  if (bw > 0) {
    bandShapes.push(<path key="neckband" d={neckD} className="gm__bandline" strokeWidth={bw * 2} />)
    // outer edge of the collar rib
    const dd = drop + bw
    const nx = nh + bw
    lines.push(
      <path
        key="neckedge"
        d={`M${n3(-nx)} ${n3(shoulderY(nx))}C${n3(-nx)} ${n3(dd * 1.3333)} ${n3(nx)} ${n3(dd * 1.3333)} ${n3(nx)} ${n3(shoulderY(nx))}`}
        className="gm__seam"
      />,
    )
  }

  if (spec.ribbed) {
    const top = len - bandH
    bandShapes.push(
      <g key="hem">
        <rect x={-half} y={top} width={W} height={bandH + 1} className="gm__band" />
        <rect x={-half} y={top} width={W} height={bandH + 1} fill={`url(#${ids.rib})`} />
      </g>,
    )
    lines.push(<path key="hemline" d={`M${n3(-half)} ${n3(top)}L${n3(half)} ${n3(top)}`} className="gm__seam" />)
  } else {
    lines.push(
      <path key="hemline" d={`M${n3(-half)} ${n3(len - 0.045 * W)}L${n3(half)} ${n3(len - 0.045 * W)}`} className="gm__seam" />,
    )
  }

  if (hasSleeves) {
    const cb = spec.ribbed ? 0.12 * W : 0.04 * W
    const cA: Pt = [E[0] - dv[0] * cb, E[1] - dv[1] * cb]
    const cB: Pt = [F[0] - dv[0] * cb, F[1] - dv[1] * cb]
    for (const s of SIDES) {
      const sx = (p: Pt): Pt => [p[0] * s, p[1]]
      if (spec.ribbed) {
        bandShapes.push(<path key={`cuff${s}`} d={poly([sx(E), sx(F), sx(cB), sx(cA)])} className="gm__band" />)
      }
      lines.push(
        <path key={`cufl${s}`} d={poly([sx(cA), sx(cB)], false)} className="gm__seam" />,
        <path
          key={`arm${s}`}
          d={`M${n3(shoulderTip[0] * s)} ${n3(shoulderTip[1])}Q${n3((half - 0.06 * W) * s)} ${n3(armY * 0.5)} ${n3(half * s)} ${n3(armY)}`}
          className="gm__seam"
        />,
      )
    }
  } else {
    // armhole edge binding
    for (const s of SIDES) {
      lines.push(
        <path
          key={`bind${s}`}
          d={`M${n3(strapX * s)} ${n3(0.012 * W)}C${n3((strapX - 0.012 * W) * s)} ${n3(armY * 0.5)} ${n3((strapX + (half - strapX) * 0.35) * s)} ${n3(armY * 0.86)} ${n3(half * s)} ${n3(armY)}`}
          className="gm__outline"
          style={{ opacity: 0.0 }}
        />,
      )
    }
  }

  /* ---------------- polo ---------------- */
  if (spec.neck === 'polo') {
    const dp = drop
    const flap = (s: 1 | -1): string =>
      poly([
        [(nh + 0.045 * W) * s, -0.9],
        [0.4 * s, dp + 0.2 * W * 0.7 + 1.1],
        [0.08 * s, dp + 0.1],
        [nh * 0.3 * s, -0.7],
      ])
    const stand = `M${n3(-nh - 0.045 * W)} -0.9Q0 ${n3(-0.1 * W)} ${n3(nh + 0.045 * W)} -0.9L${n3(nh * 0.3)} -0.3Q0 -1.1 ${n3(-nh * 0.3)} -0.3Z`
    const plEnd = dp + 0.28 * W
    lines.push(
      <g key="polo">
        <path d={`M${n3(-0.5)} ${n3(dp - 0.2)}L${n3(-0.5)} ${n3(plEnd)}L0.5 ${n3(plEnd)}L0.5 ${n3(dp - 0.2)}`} className="gm__seam" />
        <path d={`M0 ${n3(dp)}L0 ${n3(plEnd)}`} className="gm__seam" />
        <circle cx={0} cy={dp + 0.07 * W} r={0.17} className="gm__band" />
        <circle cx={0} cy={dp + 0.17 * W} r={0.17} className="gm__band" />
        <path d={stand} className="gm__fill" />
        <path d={stand} className="gm__outline" />
        <path d={flap(1)} className="gm__fill" />
        <path d={flap(-1)} className="gm__fill" />
        <path d={flap(1)} className="gm__band" />
        <path d={flap(-1)} className="gm__band" />
        <path d={flap(1)} className="gm__outline" />
        <path d={flap(-1)} className="gm__outline" />
      </g>,
    )
  }

  /* ---------------- hoodie front details ---------------- */
  let pocket: Built['pocket'] = null
  if (hood && front) {
    const pT = pocketTopFromCollarIn(len)
    const pB = len - bandH
    if (spec.zip) {
      const x0 = 0.27 * W
      const x1 = 0.44 * W
      pocket = { y: pT, halfW: x1 }
      for (const s of SIDES) {
        lines.push(
          <path
            key={`zp${s}`}
            d={`M${n3(x1 * s)} ${n3(pT + 0.1 * W)}L${n3(x0 * s)} ${n3(pT)}L${n3(x0 * s)} ${n3(pB)}`}
            className="gm__seam"
          />,
        )
      }
      lines.push(
        <g key="zip">
          <path d={`M-0.28 ${n3(drop)}L-0.28 ${n3(len)}M0.28 ${n3(drop)}L0.28 ${n3(len)}`} className="gm__seam" />
          <path d={`M0 ${n3(drop)}L0 ${n3(len)}`} className="gm__seam gm__seam--solid" strokeWidth={3} strokeDasharray="1.5 1.5" />
          <rect x={-0.4} y={drop + 0.1} width={0.8} height={1.5} rx={0.2} className="gm__band" />
          <rect x={-0.4} y={drop + 0.1} width={0.8} height={1.5} rx={0.2} className="gm__seam" />
        </g>,
      )
    } else {
      const tw = 0.37 * W
      const bwid = 0.46 * W
      pocket = { y: pT, halfW: bwid }
      lines.push(
        <path
          key="kang"
          d={`M${n3(-bwid)} ${n3(pT + 0.1 * W)}L${n3(-tw)} ${n3(pT)}L${n3(tw)} ${n3(pT)}L${n3(bwid)} ${n3(pT + 0.1 * W)}M${n3(-bwid)} ${n3(pT + 0.1 * W)}L${n3(-bwid)} ${n3(pB)}M${n3(bwid)} ${n3(pT + 0.1 * W)}L${n3(bwid)} ${n3(pB)}`}
          className="gm__seam"
        />,
      )
    }
    // drawstrings
    const sx0 = 0.065 * W
    const sy0 = drop * 0.78
    const endY = drop + 0.3 * W
    const strings = SIDES.map((s) => (
      <g key={`ds${s}`}>
        <path
          d={`M${n3(sx0 * s)} ${n3(sy0)}Q${n3((sx0 + 0.02 * W) * s)} ${n3((sy0 + endY) / 2)} ${n3((sx0 + 0.005 * W) * s)} ${n3(endY)}`}
          className="gm__seam gm__seam--solid"
          strokeWidth={2}
        />
        <rect x={(sx0 + 0.005 * W) * s - 0.15} y={endY - 0.05} width={0.3} height={0.9} rx={0.12} className="gm__band" />
        <rect x={(sx0 + 0.005 * W) * s - 0.15} y={endY - 0.05} width={0.3} height={0.9} rx={0.12} className="gm__seam" />
      </g>
    ))
    over = <g>{strings}</g>
    bounds.maxY = Math.max(bounds.maxY, endY + 1)
  }

  return {
    d,
    bounds,
    under,
    shade: (
      <g>
        {bandShapes}
        {shade}
      </g>
    ),
    lines: <g>{lines}</g>,
    over,
    texClipD,
    print: { cx: 0, cy: 0.3 * len },
    pocket,
  }
}

function buildSleeve(spec: Spec, W: number, ids: Ids): Built {
  const isLong = spec.sleeve === 'long'
  const topW = 0.37 * W
  const cw = (isLong ? (spec.ribbed ? 0.17 : 0.19) : 0.33) * W
  const total = (isLong ? 1.0 : 0.38) * W + 1.0
  const d =
    `M${n3(-topW / 2)} 1.3C${n3(-topW / 2)} 0.3 ${n3(-topW * 0.22)} 0 0 0C${n3(topW * 0.22)} 0 ${n3(topW / 2)} 0.3 ${n3(topW / 2)} 1.3` +
    `L${n3(cw / 2)} ${n3(total)}L${n3(-cw / 2)} ${n3(total)}Z`
  const cb = spec.ribbed ? 0.12 * W : 0.04 * W
  const wAt = (y: number) => topW + (cw - topW) * ((y - 1.3) / (total - 1.3))
  const cy = total - cb
  const shade = spec.ribbed ? (
    <path d={poly([[-cw / 2, total], [cw / 2, total], [wAt(cy) / 2, cy], [-wAt(cy) / 2, cy]])} className="gm__band" />
  ) : null
  const lines = (
    <g>
      <path d={`M${n3(-wAt(cy) / 2)} ${n3(cy)}L${n3(wAt(cy) / 2)} ${n3(cy)}`} className="gm__seam" />
      <path d={`M${n3(-topW / 2 + 0.7)} 0.5Q0 -0.2 ${n3(topW / 2 - 0.7)} 0.5`} className="gm__seam" style={{ opacity: 0.0 }} />
      <path d={`M${n3(-topW / 2)} 1.3Q0 2.1 ${n3(topW / 2)} 1.3`} className="gm__seam" />
    </g>
  )
  void ids
  return {
    d,
    bounds: { minX: -topW / 2, maxX: topW / 2, minY: 0, maxY: total },
    under: null,
    shade,
    lines,
    over: null,
    print: { cx: 0, cy: total * 0.45 },
    pocket: null,
  }
}

function buildHat(view: 'front' | 'back', ids: Ids): Built {
  const crown =
    'M-3.55 4.7C-3.75 1.4 -2.1 0 0 0C2.1 0 3.75 1.4 3.55 4.7Q0 5.5 -3.55 4.7Z'
  const brim =
    'M-3.6 4.55C-4.3 5.7 -2.6 6.85 0 6.85C2.6 6.85 4.3 5.7 3.6 4.55C2.2 5.35 -2.2 5.35 -3.6 4.55Z'
  const shade = (
    <g>
      <path d="M-3.8 4.2L3.8 4.2L3.8 6L-3.8 6Z" fill="none" />
    </g>
  )
  const front = view === 'front'
  const lines = (
    <g>
      {front ? (
        <>
          <path d="M0 0L0 5.1" className="gm__seam" />
          <path d="M-2.05 0.55C-2.55 1.8 -2.6 3.4 -2.5 5" className="gm__seam" />
          <path d="M2.05 0.55C2.55 1.8 2.6 3.4 2.5 5" className="gm__seam" />
          <circle cx={0} cy={0.1} r={0.28} className="gm__band" />
          <circle cx={0} cy={0.1} r={0.28} className="gm__seam" />
        </>
      ) : (
        <>
          <path d="M0 0L0 4.1" className="gm__seam" />
          <path d="M-2.05 0.55C-2.55 1.8 -2.6 3.2 -2.5 4.8" className="gm__seam" />
          <path d="M2.05 0.55C2.55 1.8 2.6 3.2 2.5 4.8" className="gm__seam" />
          <rect x={-1.9} y={3.7} width={3.8} height={0.8} rx={0.15} className="gm__band" />
          <rect x={-1.9} y={3.7} width={3.8} height={0.8} rx={0.15} className="gm__seam" />
          <circle cx={0} cy={0.1} r={0.28} className="gm__seam" />
        </>
      )}
      <path d="M-3.45 4.35Q0 5.15 3.45 4.35" className="gm__seam" />
    </g>
  )
  void ids
  const body = front ? (
    <g>
      <path d={brim} className="gm__fill" />
      <path d={brim} className="gm__band" />
      <path d={brim} className="gm__band" />
      <path d={brim} className="gm__outline" />
    </g>
  ) : null
  return {
    d: crown,
    bounds: { minX: -4.4, maxX: 4.4, minY: -0.3, maxY: front ? 6.95 : 5.6 },
    under: body,
    shade,
    lines,
    over: null,
    print: { cx: 0, cy: 2.3 },
    pocket: null,
  }
}

function buildTote(W: number, len: number): Built {
  const half = W / 2
  const r = 0.4
  const d =
    `M${n3(-half + r)} 0L${n3(half - r)} 0Q${n3(half)} 0 ${n3(half)} ${r}L${n3(half)} ${n3(len - r)}Q${n3(half)} ${n3(len)} ${n3(half - r)} ${n3(len)}` +
    `L${n3(-half + r)} ${n3(len)}Q${n3(-half)} ${n3(len)} ${n3(-half)} ${n3(len - r)}L${n3(-half)} ${r}Q${n3(-half)} 0 ${n3(-half + r)} 0Z`
  const a = 0.27 * W
  const hh = (0.5 * W + 0.1) / 0.75
  const handle = `M${n3(-a)} 0.6C${n3(-a)} ${n3(-hh)} ${n3(a)} ${n3(-hh)} ${n3(a)} 0.6`
  const strapW = Math.max(0.7, 0.07 * W)
  const under = (
    <g>
      <path d={handle} className="gm__strap" stroke="var(--gm-line)" strokeWidth={strapW + 0.1} strokeLinecap="butt" />
      <path d={handle} className="gm__strap" stroke="var(--gm-fill)" strokeWidth={strapW - 0.1} strokeLinecap="butt" />
    </g>
  )
  const lines = (
    <g>
      <path d={`M${n3(-half + 0.05)} 1.1L${n3(half - 0.05)} 1.1`} className="gm__seam" />
      {SIDES.map((s) => (
        <g key={s}>
          <rect x={a * s - 0.5} y={0} width={1} height={2.6} className="gm__band" />
          <rect x={a * s - 0.5} y={0} width={1} height={2.6} className="gm__seam" />
          <path d={`M${n3(a * s - 0.5)} 2.6L${n3(a * s + 0.5)} 0`} className="gm__seam" />
        </g>
      ))}
      <path d={`M${n3(-half + 0.1)} ${n3(len - 0.9)}L${n3(half - 0.1)} ${n3(len - 0.9)}`} className="gm__seam" style={{ opacity: 0.35 }} />
    </g>
  )
  return {
    d,
    bounds: { minX: -half, maxX: half, minY: -(0.5 * W + 0.6), maxY: len },
    under,
    shade: null,
    lines,
    over: null,
    print: { cx: 0, cy: len * 0.5 },
    pocket: null,
  }
}

/* ------------------------------------------------------------------ */
/* Finish texture                                                       */
/* ------------------------------------------------------------------ */

interface TexCfg {
  freq: number
  octaves: number
  contrast: number
  opacity: number
  seed: number
}

const TEX: Record<Exclude<MockupFinish, 'solid'>, TexCfg> = {
  heather: { freq: 10, octaves: 1, contrast: 5, opacity: 0.22, seed: 3 },
  washed: { freq: 0.24, octaves: 4, contrast: 1.6, opacity: 0.2, seed: 11 },
  'garment-dyed': { freq: 0.2, octaves: 3, contrast: 1.4, opacity: 0.16, seed: 5 },
  pigment: { freq: 0.34, octaves: 4, contrast: 1.8, opacity: 0.18, seed: 8 },
  mineral: { freq: 0.3, octaves: 5, contrast: 3, opacity: 0.3, seed: 21 },
}

/** The texture rectangle lives in <defs> as a symbol-less element; rendered here by reference. */
function TexSlot({ ids }: { ids: Ids }): ReactElement | null {
  if (!ids.hasTex) return null
  return <rect x={-80} y={-80} width={160} height={200} fill="#000" filter={`url(#${ids.tex})`} opacity={ids.texOpacity} />
}

/* ------------------------------------------------------------------ */
/* Component                                                            */
/* ------------------------------------------------------------------ */

const fmtIn = (v: number) => `${Math.round(v * 100) / 100}`

function Arrow({ x, y1, y2, s }: { x: number; y1: number; y2: number; s: number }): ReactElement {
  const h = 0.45 * s
  const w = 0.2 * s
  const path = `M${n3(x)} ${n3(y1)}L${n3(x)} ${n3(y2)}`
  return (
    <g>
      <path d={path} className="gm__dim-halo" />
      <path d={path} className="gm__dim" />
      <path d={poly([[x, y1], [x - w, y1 + h], [x + w, y1 + h]])} className="gm__dim-head" />
      <path d={poly([[x, y2], [x - w, y2 - h], [x + w, y2 - h]])} className="gm__dim-head" />
    </g>
  )
}

export default function GarmentMockup(props: GarmentMockupProps): ReactElement {
  const {
    garmentType, bodyWidthIn, bodyLengthIn, colorHex, finish, designUrl, designWIn, designHIn,
    downIn, offsetIn, view, rotateDesign = false, showRuler = true, showPocketLine = true,
    caption, variant = 'full', className,
  } = props
  const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const uid = `gm${rawId}`
  const ids: Ids = {
    clip: `${uid}-clip`, hoodClip: `${uid}-hood`, gradH: `${uid}-gh`, gradV: `${uid}-gv`,
    tex: `${uid}-tex`, blur: `${uid}-blur`, rib: `${uid}-rib`, hasTex: finish !== 'solid',
    texOpacity: finish !== 'solid' ? TEX[finish].opacity : 0,
  }

  const spec = SPECS[garmentType]
  const W = Math.max(4, bodyWidthIn || 20)
  const len = Math.max(4, bodyLengthIn || 28)
  const isSleeveView = view === 'left-sleeve' || view === 'right-sleeve'
  const effView: MockupView = isSleeveView && spec.sleeve === 'none' ? 'front' : view
  const pal = paletteFor(colorHex)
  const distance = variant === 'distance'
  const full = !distance

  let built: Built
  if (spec.kind === 'hat') built = buildHat(effView === 'back' ? 'back' : 'front', ids)
  else if (spec.kind === 'tote') built = buildTote(W, len)
  else if (effView === 'left-sleeve' || effView === 'right-sleeve') built = buildSleeve(spec, W, ids)
  else built = buildBody(spec, W, len, effView === 'back' ? 'back' : 'front', ids)

  /* ---- design placement ---- */
  const hasDesign = !!designUrl && designWIn > 0 && designHIn > 0
  const fw = rotateDesign ? designHIn : designWIn
  const fh = rotateDesign ? designWIn : designHIn
  const sign = effView === 'back' ? -1 : 1
  const dcx = built.print.cx + sign * (offsetIn || 0)
  const top = downIn !== null && downIn !== undefined ? downIn : built.print.cy - fh / 2
  const dcy = top + fh / 2
  const fx0 = dcx - fw / 2

  /* ---- bounds & viewBox ---- */
  const b: Bounds = { ...built.bounds }
  if (hasDesign) {
    b.minX = Math.min(b.minX, fx0)
    b.maxX = Math.max(b.maxX, fx0 + fw)
    b.maxY = Math.max(b.maxY, top + fh)
  }
  const s = Math.max(0.5, (b.maxX - b.minX + 6) / 38)
  const showRulers = full && showRuler
  const padL = showRulers ? 3.1 * s : full ? 1.2 * s : 0.6
  const padT = showRulers ? 3.1 * s : full ? 1.2 * s : 0.6
  const padR = full ? 1.2 * s : 0.6
  const padB = full ? 2.4 * s : 0.6
  const vx = b.minX - padL
  const vy = b.minY - padT
  const vw = b.maxX - b.minX + padL + padR
  const vh = b.maxY - b.minY + padT + padB

  const showPocket =
    full && showPocketLine && spec.hooded && effView === 'front' && built.pocket !== null

  /* ---- labels ---- */
  const viewLabel = VIEW_LABEL[effView]
  const placement = !hasDesign
    ? 'no design placed'
    : downIn === null
      ? 'centred on the print area'
      : `${fmtIn(downIn)} inches below the collar` +
        (Math.abs(offsetIn) > 0.01
          ? `, ${fmtIn(Math.abs(offsetIn))} inches toward the wearer's ${offsetIn > 0 ? 'left' : 'right'}`
          : ', centred')
  const aria =
    `${spec.label}, ${viewLabel} view, colour ${colorHex.toUpperCase()}, ${finish} finish. ` +
    (hasDesign
      ? `Design ${fmtIn(fw)} by ${fmtIn(fh)} inches, ${placement}.`
      : 'No design placed.')
  const figText = `${spec.label} - ${viewLabel}${caption ? ` - ${caption}` : ''}`

  const tex = finish !== 'solid' ? TEX[finish] : null
  const svgStyle = {
    '--gm-fill': pal.fill,
    '--gm-line': pal.line,
    '--gm-band': pal.band,
    '--gm-inner': pal.inner,
    '--gm-s': s,
  } as CSSProperties

  /* ---- fold shading ---- */
  const half = W / 2
  const folds =
    spec.kind === 'body' && !isSleeveView ? (
      <g filter={`url(#${ids.blur})`} fill="none" strokeLinecap="round">
        <path d={`M${n3(-half * 0.62)} ${n3(len * 0.3)}Q${n3(-half * 0.3)} ${n3(len * 0.6)} ${n3(-half * 0.5)} ${n3(len * 0.98)}`} stroke="rgba(0,0,0,0.07)" strokeWidth={1.3} />
        <path d={`M${n3(half * 0.5)} ${n3(len * 0.33)}Q${n3(half * 0.25)} ${n3(len * 0.62)} ${n3(half * 0.42)} ${n3(len * 0.98)}`} stroke="rgba(255,255,255,0.08)" strokeWidth={1.6} />
        <path d={`M${n3(-half * 0.1)} ${n3(len * 0.55)}Q${n3(half * 0.05)} ${n3(len * 0.75)} ${n3(-half * 0.05)} ${n3(len * 0.98)}`} stroke="rgba(0,0,0,0.05)" strokeWidth={1.8} />
      </g>
    ) : null

  const labelY = top + fh + 1.15 * s
  const labelAbove = labelY > b.maxY + 1.2 * s && top > 2
  const labelText = `${fw.toFixed(2)} × ${fh.toFixed(2)} in`
  const labelX = Math.min(Math.max(dcx, b.minX + 3 * s), b.maxX - 3 * s)
  const arrowX = Math.max(fx0 - 0.9 * s, b.minX + 0.7 * s)

  return (
    <figure className={cls('gm', `gm--${variant}`, className)}>
      <svg
        className="gm__svg"
        viewBox={`${n3(vx)} ${n3(vy)} ${n3(vw)} ${n3(vh)}`}
        role="img"
        aria-label={aria}
        preserveAspectRatio="xMidYMid meet"
        style={svgStyle}
      >
        <defs>
          <clipPath id={ids.clip}>
            <path d={built.d} />
          </clipPath>
          {built.texClipD && (
            <clipPath id={ids.hoodClip}>
              <path d={built.texClipD} />
            </clipPath>
          )}
          <linearGradient id={ids.gradH} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#000" stopOpacity="0.13" />
            <stop offset="0.2" stopColor="#000" stopOpacity="0" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.06" />
            <stop offset="0.8" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.15" />
          </linearGradient>
          <linearGradient id={ids.gradV} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.07" />
            <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.1" />
          </linearGradient>
          <filter id={ids.blur} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="0.4" />
          </filter>
          <pattern id={ids.rib} width="0.34" height="1" patternUnits="userSpaceOnUse">
            <rect x="0" y="0" width="0.07" height="1" fill="rgba(0,0,0,0.12)" />
          </pattern>
          {tex && (
            <>
              <filter
                id={ids.tex}
                filterUnits="userSpaceOnUse"
                x={b.minX - 1}
                y={b.minY - 1}
                width={b.maxX - b.minX + 2}
                height={b.maxY - b.minY + 2}
                colorInterpolationFilters="sRGB"
              >
                <feTurbulence type="fractalNoise" baseFrequency={tex.freq} numOctaves={tex.octaves} seed={tex.seed} result="n" />
                <feColorMatrix
                  in="n"
                  type="matrix"
                  values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${tex.contrast} 0 0 0 ${-tex.contrast * 0.5}`}
                  result="dark"
                />
                <feColorMatrix
                  in="n"
                  type="matrix"
                  values={`0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  ${-tex.contrast} 0 0 0 ${tex.contrast * 0.5}`}
                  result="light"
                />
                <feMerge>
                  <feMergeNode in="dark" />
                  <feMergeNode in="light" />
                </feMerge>
              </filter>
              
            </>
          )}
        </defs>

        {built.under}

        <path d={built.d} className="gm__fill" />
        <g clipPath={`url(#${ids.clip})`}>
          <path d={built.d} fill={`url(#${ids.gradH})`} />
          <path d={built.d} fill={`url(#${ids.gradV})`} />
          {folds}
          <TexSlot ids={ids} />
          {built.shade}
        </g>
        <path d={built.d} className="gm__outline" />
        {built.lines}
        {built.over}

        {/* ---- rulers ---- */}
        {showRulers && (
          <g aria-hidden="true">
            {(() => {
              const ticks: ReactNode[] = []
              const yBase = b.minY - 1.3 * s
              const nx = Math.floor(b.maxX - b.minX)
              ticks.push(
                <path key="top" d={`M${n3(b.minX)} ${n3(yBase)}L${n3(b.maxX)} ${n3(yBase)}`} className="gm__ruler" />,
              )
              for (let i = 0; i <= nx; i++) {
                const x = b.minX + i
                const major = i % 2 === 0
                ticks.push(
                  <path key={`tx${i}`} d={`M${n3(x)} ${n3(yBase)}L${n3(x)} ${n3(yBase + (major ? 0.55 * s : 0.3 * s))}`} className="gm__ruler" />,
                )
                if (major) {
                  ticks.push(
                    <text key={`tl${i}`} x={x} y={yBase - 0.3 * s} textAnchor="middle" className="gm__ruler-text">
                      {i}
                    </text>,
                  )
                }
              }
              const xBase = b.minX - 1.3 * s
              const ny = Math.floor(b.maxY)
              ticks.push(
                <path key="left" d={`M${n3(xBase)} 0L${n3(xBase)} ${n3(ny)}`} className="gm__ruler" />,
              )
              for (let i = 0; i <= ny; i++) {
                const major = i % 2 === 0
                ticks.push(
                  <path key={`ty${i}`} d={`M${n3(xBase)} ${i}L${n3(xBase + (major ? 0.55 * s : 0.3 * s))} ${i}`} className="gm__ruler" />,
                )
                if (major) {
                  ticks.push(
                    <text key={`yl${i}`} x={xBase - 0.3 * s} y={i + 0.28 * s} textAnchor="end" className="gm__ruler-text">
                      {i}
                    </text>,
                  )
                }
              }
              ticks.push(
                <text key="unit" x={xBase - 0.3 * s} y={yBase - 0.3 * s} textAnchor="end" className="gm__ruler-text">
                  in
                </text>,
              )
              return ticks
            })()}
          </g>
        )}

        {/* ---- pocket seam ---- */}
        {showPocket && built.pocket && (
          <g aria-hidden="true">
            <path d={`M${n3(-built.pocket.halfW)} ${n3(built.pocket.y)}L${n3(built.pocket.halfW)} ${n3(built.pocket.y)}`} className="gm__pocket-halo" />
            <path d={`M${n3(-built.pocket.halfW)} ${n3(built.pocket.y)}L${n3(built.pocket.halfW)} ${n3(built.pocket.y)}`} className="gm__pocket" />
            <text x={built.pocket.halfW - 0.2 * s} y={built.pocket.y - 0.35 * s} textAnchor="end" className="gm__label gm__label--small gm__pocket-text" style={{ fill: 'var(--gm-warn, #e5484d)' }}>
              {`pocket seam ${fmtIn(built.pocket.y)} in`}
            </text>
          </g>
        )}

        {/* ---- design ---- */}
        {hasDesign && (
          <g>
            <image
              href={designUrl ?? undefined}
              x={dcx - designWIn / 2}
              y={dcy - designHIn / 2}
              width={designWIn}
              height={designHIn}
              preserveAspectRatio="none"
              transform={rotateDesign ? `rotate(90 ${n3(dcx)} ${n3(dcy)})` : undefined}
            />
            {full && (
              <g aria-hidden="true">
                <rect x={fx0} y={top} width={fw} height={fh} className="gm__dash gm__dash--light" />
                <rect x={fx0} y={top} width={fw} height={fh} className="gm__dash gm__dash--dark" />
              </g>
            )}
          </g>
        )}

        {/* ---- dimension labels ---- */}
        {full && hasDesign && (
          <g aria-hidden="true">
            <text
              x={labelX}
              y={labelAbove ? top - 0.55 * s : labelY}
              textAnchor="middle"
              className="gm__label"
            >
              {labelText}
            </text>
            {downIn !== null && downIn >= 0.6 && !isSleeveView && spec.kind === 'body' && (
              <g>
                <path d={`M${n3(arrowX - 0.5)} 0L${n3(arrowX + 0.5)} 0M${n3(arrowX)} ${n3(top)}L${n3(fx0)} ${n3(top)}`} className="gm__dim-halo" style={{ strokeWidth: 3 }} />
                <path d={`M${n3(arrowX - 0.5)} 0L${n3(arrowX + 0.5)} 0M${n3(arrowX)} ${n3(top)}L${n3(fx0)} ${n3(top)}`} className="gm__dim" style={{ strokeWidth: 1 }} />
                <Arrow x={arrowX} y1={0} y2={top} s={s} />
                <text x={arrowX - 0.4 * s} y={top / 2 + 0.35 * s} textAnchor="end" className="gm__label">
                  {`${fmtIn(downIn)} in`}
                </text>
              </g>
            )}
          </g>
        )}
      </svg>
      <figcaption className="gm__cap">{figText}</figcaption>
    </figure>
  )
}
