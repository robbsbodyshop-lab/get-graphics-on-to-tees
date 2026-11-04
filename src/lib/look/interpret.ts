import colorsData from '../../data/colors.json'
import { hexToRgb, lightness01 } from '../image/color'
import { PRESETS, UNSUPPORTED_NOTE, getPreset, mentionsUnsupported } from '../presets'
import type { Preset } from '../presets'
import { DEFAULT_SETTINGS, mergeSettings } from '../settings'
import { PLACEMENTS } from '../sizing'
import type { Edge, MaskKind, ProcessSettings } from '../types'
import type { LookContext, LookPlan, UpscaleChoice } from './types'

// Deterministic, offline prompt interpreter. No AI: keyword and regex rules over the prompt,
// combined with measurements of the image (ImageTraits) and the selected garment.
//
// Order of work: preset -> shirt color/type -> prompt modifiers -> image guardrails -> tips.
// Every decision that matters records one plain-English explanation bullet (what was done, then
// why) and, where useful, a tip that names the control and the step to change.

// ---------------------------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------------------------

/** Lowercase, "gray" -> "grey", "&" -> "and". Keeps punctuation (size parsing needs quotes and dots). */
function prep(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/\bgrays\b/g, 'greys')
    .replace(/\bgray\b/g, 'grey')
}

/** Words separated by single spaces, padded with a space on both sides. Apostrophes vanish (don't -> dont). */
function norm(text: string): string {
  return ` ${prep(text).replace(/'/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `
}

interface Hit {
  text: string
  index: number
}

function allHits(t: string, re: RegExp): Hit[] {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  const out: Hit[] = []
  for (const m of t.matchAll(g)) out.push({ text: m[0].trim(), index: m.index ?? 0 })
  return out
}
const lastHit = (t: string, re: RegExp): Hit | null => allHits(t, re).at(-1) ?? null
const firstHit = (t: string, re: RegExp): Hit | null => allHits(t, re)[0] ?? null

const pct = (v: number) => `${Math.round(v * 100)}%`
const q = (words: string[]) => words.map((w) => `"${w}"`).join(', ')
const uniq = <T,>(xs: T[]) => [...new Set(xs)]

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
}

const MASK_LABEL: Record<MaskKind, string> = {
  cracked: 'Cracked ink',
  scratched: 'Scratched',
  speckle: 'Speckle',
  sandblasted: 'Sandblasted',
}

// ---------------------------------------------------------------------------------------------
// Prompt vocabulary
// ---------------------------------------------------------------------------------------------

const DISTRESS_ON =
  /\b(?:distress\w*|worn|grunge|grungy|crack\w*|scratch\w*|beat up|aged|relics?|scuff\w*|vintage|weathered|battered|speckle\w*|spray\w*|splatter\w*|spatter\w*|sandblast\w*)\b/
const DISTRESS_OFF =
  /\b(?:no distress\w*|not distressed|without distress\w*|undistressed|no texture|pristine|clean(?! (?:edges?|lines?|cuts?))|crisp(?! (?:edges?|lines?)))\b/
const INTENSITY_HEAVY = /\b(?:heavy|heavily|very|super|destroyed|beat up|trashed|extremely|really)\b/
const INTENSITY_LIGHT =
  /\blight(?:ly)?\b(?! (?:grey|blue|pink|green|shirt|tee|garment|colou?r|colou?red|wash|weight))|\bsubtl[ey]\b|\bslight(?:ly)?\b|\ba little\b|\ba touch\b|\ba bit\b|\bscuff\w*|\bhint of\b/

const HALFTONE_ON = /\b(?:half ?tones?|dots|dotted|screen ?tone|newsprint|comic|pop art|ben day)\b/
const HALFTONE_OFF =
  /\b(?:no half ?tones?|no dots|without (?:half ?tones?|dots)|clean edges|hard edges|crisp edges|sharp edges|solid edges|solid (?:ink|fill|colou?rs?))\b/
const LPI_FINE = /\b(?:fine|subtle|small|tiny) (?:half ?tone|dots?|screen)\b|\bfine\b|\btiny dots\b|\bsmall dots\b/
const LPI_COARSE = /\b(?:coarse|big dots|large dots|chunky|bold dots|big halftone|large halftone|chunky dots)\b/

const FADE_ON =
  /\bfad(?:e|es|ing)\b|\bdissolv\w*|\bmelt\w*|(?<!blend )(?<!blends )(?<!blending )\binto the (?:shirt|tee|garment|fabric)\b/
const FADE_OFF = /\bno fade\b|\bwithout (?:a )?fade\b/
const FADE_SHORT = /\b(?:slight|slightly|short|subtle|small|quick)\b/
const FADE_LONG = /\b(?:long|big|deep|gradual|slow|tall|far)\b/

const ONE_COLOR = /\b(?:one|single|1) colou?r\b|\bmono\b|\bstamp\b|\bone ink\b|\bsingle ink\b/
const N_COLORS = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) ?colou?rs?\b|\btwo tone\b/
const POSTERIZE_WORDS = /\bposteri[sz]\w*|\blimited palette\b|\bflat colou?rs?\b|\bflat\b|\bscreen ?print(?:ed|ing)?(?: look| style)?\b/
const KEEP_COLORS =
  /\bkeep (?:the |all the |all )?(?:colou?rs?|red|orange|yellow|green|blue|purple|pink|teal|gold|brown|cyan|magenta)\b|\bfull colou?r\b|\ball (?:the )?colou?rs\b|\bkeep it colorful\b/
const BLACK_WHITE = /\bblack and white\b|\bb and w\b|\bgreyscale\b|\bgrayscale\b|\bmonochrome\b|\bblack white\b/
const FADED_COLORS = /\b(?:faded|muted|washed out|washed|vintage colou?rs|sun faded|sunfaded|sun bleached)\b/
const BOLD = /\b(?:bold|punchy|high contrast|pop)\b(?! (?:art|dots?|outline|keyline|border|stroke))/
const SOFT = /\b(?:soft|low contrast|mellow)\b(?! (?:edges?|shadows?|glow))/

const OUTLINE_ON = /\b(?:outline\w*|key ?line\w*|sticker border|sticker outline|stroke around|border around)\b/
const OUTLINE_OFF = /\b(?:no|without) (?:outline|key ?line|border)\b/
const OUTLINE_THICK = /\b(?:thick|heavy|bold|chunky)\b/
const OUTLINE_THIN = /\b(?:thin|fine|hairline)\b/
const OUTLINE_WHITE = /\bwhite (?:outline|key ?line|border|stroke)\b/
const OUTLINE_GARMENT = /\b(?:shirt|tee|garment) colou?red\b|\bsame colou?r as the (?:shirt|tee)\b/

const BG_REMOVE =
  /\b(?:remove|removing|delete|drop|get rid of|cut out|cutout)(?: the)?(?: white| black| solid)? background\b|\bno background\b|\btransparent background\b|\bbackground removed\b|\bwithout (?:a |the )?background\b/
const BG_KEEP =
  /\bkeep (?:the |its |a )?(?:background|box|patch|square)\b|\b(?:patch|box) (?:look|style)\b|\bas a patch\b/

const KNOCKOUT_ON = [
  /\b(?:black|dark|darks|shadows?|blacks)\s+(?:becomes?|be|is|as|turns? into|acts? as|are)\s+the\s+(?:shirt|tee|garment)\b/,
  /\b(?:let|lets|letting)\s+the\s+(?:shirt|tee|garment)\s+(?:show|showing|shine)\b/,
  /\b(?:shirt|tee|garment) show(?:s|ing)? through\b/,
  /\bnot a sticker\b/,
  /\bno sticker\b/,
  /\bblend(?:s|ing)? (?:in)?to the (?:shirt|tee|garment|fabric)\b/,
]
const KNOCKOUT_OFF =
  /\b(?:keep|print) the (?:black|blacks|whites?|darks?)\b|\bno knock ?out\b|\b(?:dont|do not) knock ?out\b|\b(?:as|like) a sticker\b|\bsticker (?:look|style)\b/

const MIRROR = /\b(?:mirror\w*|flip\w*)\b/
const FINISH = /\b(?:mineral|acid wash\w*|garment dyed|pigment dyed|enzyme(?: washed)?|stone washed|washed)\b(?! out)/

const OVERSIZE =
  /\b(?:oversized?|huge|giant|massive|jumbo|big front)\b(?! (?:tee|tees|shirt|hoodie|fit|boxy|crew|crewneck|sweatshirt|sweater))/

const VECTOR_WORDS = /\b(?:clean|crisp|sharp|vector\w*|logo)\b/

const PHOTO_WORD = /\b(?:photo|photograph|picture|portrait)\b/

// Placement phrases, in priority order for tie-breaks.
interface PlacementRule {
  label: string
  re: RegExp
  candidates: string[]
}
const PLACEMENT_RULES: PlacementRule[] = [
  { label: 'back-neck', re: /\bback neck\b|\bnape\b|\bneck (?:label|tag)\b|\btag\b|\bhang tag\b|\binside neck\b/, candidates: ['back-neck'] },
  { label: 'upper-back', re: /\bupper back\b|\bshoulder blades?\b/, candidates: ['upper-back'] },
  {
    label: 'full-back',
    re: /\bfull back\b|\bback print\b|\bon the back\b|\bbig back\b|\bacross the back\b|\bback of the (?:shirt|tee|hoodie)\b|\bback hit\b/,
    candidates: ['full-back', 'youth-full-back'],
  },
  {
    label: 'left-chest',
    re: /\bleft chest\b|\bpocket\b|\bbreast\b|\bchest logo\b/,
    candidates: ['left-chest', 'hoodie-left-chest', 'youth-left-chest'],
  },
  { label: 'center-chest', re: /\b(?:center|centre) chest\b/, candidates: ['center-chest'] },
  {
    label: 'full-front',
    re: /\bfull front\b|\bfront print\b|\bfront and center\b|\bbig front\b|\boversized? front\b/,
    candidates: ['adult-full-front', 'hoodie-full-front', 'crewneck-full-front', 'youth-full-front'],
  },
]
const SLEEVE = /(?<!long )(?<!short )\bsleeves?\b/
const FRONT_AND_BACK = /\bfront and back\b|\bsmall front,? (?:and )?big back\b|\bsmall front big back\b/

// Garment types the prompt can name.
interface TypeRule {
  label: string
  re: RegExp
  types: string[]
}
const TYPE_RULES: TypeRule[] = [
  { label: 'Zip hoodie', re: /\bzip(?:per)?(?:ped)? hoodie\b/, types: ['zip-hoodie'] },
  { label: 'Hoodie', re: /\bhoodies?\b|\bhooded sweatshirt\b/, types: ['hoodie', 'zip-hoodie', 'crop-hoodie'] },
  { label: 'Crewneck', re: /\bcrew ?necks?\b|\bsweatshirts?\b/, types: ['crewneck', 'crop-crew'] },
  { label: 'Long sleeve', re: /\blong ?sleeve (?:tee|shirt|t shirt)\b|\blongsleeve\b/, types: ['long-sleeve'] },
  { label: 'Tote', re: /\btote\b/, types: ['tote'] },
  { label: 'Hat', re: /\b(?:hat|cap|beanie)\b/, types: ['hat'] },
]

// ---------------------------------------------------------------------------------------------
// Preset ranking
// ---------------------------------------------------------------------------------------------

/**
 * Same scoring as suggestPreset (whole-word keyword hit = 1, multi-word phrase = 2; first preset
 * wins ties) plus a few extra phrases that settle common ties, e.g. "faded vintage tour tee"
 * should pick the tour-tee look, not the generic distressed one.
 */
const EXTRA_KEYWORDS: Record<string, string[]> = {
  'vintage-tour': ['tour tee', 'band tee', 'concert tee', 'tour shirt', 'band merch', 'tour merch'],
  'horror-metal': ['death metal', 'heavy metal', 'slasher'],
}

function rankPreset(text: string): { preset: Preset; matched: string[] } | null {
  const t = norm(text)
  if (t.trim() === '') return null
  let best: { preset: Preset; score: number; matched: string[] } | null = null
  for (const preset of PRESETS) {
    const matched = [...preset.keywords, ...(EXTRA_KEYWORDS[preset.id] ?? [])].filter((k) => t.includes(norm(k)))
    const score = matched.reduce((sum, k) => sum + (k.includes(' ') ? 2 : 1), 0)
    if (score > 0 && (!best || score > best.score)) best = { preset, score, matched }
  }
  return best ? { preset: best.preset, matched: best.matched } : null
}

/** One short phrase per setting a preset turns on, so the first bullet is honest about what it starts with. */
function describePresetSettings(p: ProcessSettings): string {
  const parts: string[] = []
  if (p.posterize.enabled) parts.push(`Posterize (${p.posterize.colors} colors)`)
  if (p.lineArt.enabled) parts.push('Line art (1-bit)')
  if (p.outline.enabled) parts.push(`Keyline outline (${p.outline.px} px)`)
  if (p.contrast !== 0) parts.push(`Contrast (${p.contrast > 0 ? '+' : ''}${p.contrast})`)
  if (p.desaturate > 0) parts.push(`Desaturate (${pct(p.desaturate)})`)
  if (p.distress.enabled) parts.push(`Distress (${MASK_LABEL[p.distress.mask]}, ${pct(p.distress.intensity)})`)
  if (p.halftone.enabled) parts.push(`Halftone (${p.halftone.mode === 'alpha' ? 'Soft edges and shadows' : 'Tones'}, ${p.halftone.lpi} LPI)`)
  if (p.fadeEdge.enabled) parts.push(`Fade an edge into the garment (${p.fadeEdge.edge})`)
  if (p.knockoutGarment) parts.push('Knock out garment color')
  if (p.removeBackground) parts.push('Remove background')
  if (p.thicken) parts.push('Thicken strokes 1 px')
  return parts.join(', ')
}

// ---------------------------------------------------------------------------------------------
// Shirt color matching
// ---------------------------------------------------------------------------------------------

const GARMENT_NOUN =
  '(?:t shirt|tshirt|tee|tees|shirt|shirts|hoodie|hoodies|sweatshirt|sweater|crewneck|crew|tank|polo|blank|blanks|garment|fabric|apparel|tote|hat|cap|beanie|top|longsleeve|jersey|merch)'
const GARMENT_GAP =
  '(?:(?:short sleeve|long sleeve|oversized|boxy|crew ?neck|cotton|plain|blank|heavyweight|colou?red|vintage|washed|cropped|crop|basic|classic|old|soft|baby|unisex|v neck|ringer|tour|band|graphic|pocket) )?'
const AFTER_OK = new RegExp(`^${GARMENT_GAP}${GARMENT_NOUN}\\b`)
const BEFORE_OK = /\b(?:on|onto|for)(?: (?:a|an|the|some|my|your|our))?(?: (?:solid|plain|dark|light))? $/

const BASIC_COLOR_WORDS = [
  'red', 'blue', 'green', 'pink', 'purple', 'yellow', 'orange', 'brown', 'white', 'black', 'navy', 'tan', 'cream', 'teal',
  'maroon', 'gold', 'beige', 'olive', 'lavender',
]

interface ColorMatch {
  start: number
  end: number
  phrase: string
  name?: string
  hex?: string
  onPrefix: boolean
  /** Prompt named a color this garment does not come in. */
  notOffered?: string
}

function contextOk(t: string, start: number, end: number, name: string): { ok: boolean; onPrefix: boolean } {
  const after = t.slice(end).trimStart()
  const before = t.slice(0, start)
  if (name === 'black' && /^and white\b/.test(after)) return { ok: false, onPrefix: false }
  if (name === 'white' && /\bblack and $/.test(before)) return { ok: false, onPrefix: false }
  const onPrefix = BEFORE_OK.test(before)
  if (AFTER_OK.test(after)) return { ok: true, onPrefix }
  return { ok: onPrefix && !/^(?:ink|print|art|text|letters|lines|outline)\b/.test(after), onPrefix }
}

function occurrences(t: string, name: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  const needle = ` ${name} `
  let from = 0
  for (;;) {
    const i = t.indexOf(needle, from)
    if (i < 0) break
    out.push({ start: i + 1, end: i + 1 + name.length })
    from = i + 1
  }
  return out
}

function pickMatch(cands: ColorMatch[]): ColorMatch | undefined {
  return cands.find((c) => c.onPrefix) ?? cands[0]
}

function findShirtColor(t: string, available: { name: string; hex: string }[]): ColorMatch | null {
  const names = available
    .map((c) => ({ ...c, n: norm(c.name).trim() }))
    .sort((a, b) => b.n.length - a.n.length || a.n.localeCompare(b.n))
  const taken: { start: number; end: number }[] = []
  const overlaps = (s: number, e: number) => taken.some((r) => s < r.end && e > r.start)

  // 1. Exact catalog names for this garment, longest name first.
  const exact: ColorMatch[] = []
  for (const c of names) {
    for (const o of occurrences(t, c.n)) {
      if (overlaps(o.start, o.end)) continue
      const ctx = contextOk(t, o.start, o.end, c.n)
      if (!ctx.ok) continue
      taken.push(o)
      exact.push({ ...o, phrase: c.n, name: c.name, hex: c.hex, onPrefix: ctx.onPrefix })
    }
  }
  const sorted = exact.sort((a, b) => a.start - b.start)
  const best = pickMatch(sorted)
  if (best) return best

  // 2. Grey family: "heather gray", "light grey", "charcoal" -> closest grey this blank comes in.
  const greyRe = /\b(?:(?:light|dark|heather|sport|athletic|storm|charcoal) )*(?:grey|heather|ash|charcoal)\b/g
  for (const m of t.matchAll(greyRe)) {
    const start = (m.index ?? 0) + 0
    const end = start + m[0].length
    const ctx = contextOk(t, start, end, 'grey')
    if (!ctx.ok) continue
    const phrase = m[0]
    const wantsHeather = /heather|sport|athletic/.test(phrase)
    const target = /dark|charcoal/.test(phrase) ? 0.3 : /light|ash/.test(phrase) ? 0.8 : 0.64
    const family = available.filter((c) => /grey|heather|ash|charcoal|pepper|slate|storm|smoke/i.test(c.name))
    let bestC: { name: string; hex: string } | undefined
    let bestScore = Infinity
    for (const c of family) {
      const L = lightness01(hexToRgb(c.hex).r, hexToRgb(c.hex).g, hexToRgb(c.hex).b)
      const score = Math.abs(L - target) - (wantsHeather && /heather/i.test(c.name) ? 0.15 : 0)
      if (score < bestScore) {
        bestScore = score
        bestC = c
      }
    }
    if (bestC) return { start, end, phrase, name: bestC.name, hex: bestC.hex, onPrefix: ctx.onPrefix }
    return { start, end, phrase, onPrefix: ctx.onPrefix, notOffered: phrase }
  }

  // 3. A color this garment doesn't come in (catalog names and basic color words).
  const have = new Set(names.map((c) => c.n))
  const wanted = uniq([...(colorsData.colors as { name: string }[]).map((c) => norm(c.name).trim()), ...BASIC_COLOR_WORDS])
    .filter((n) => !have.has(n))
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
  const missing: ColorMatch[] = []
  const taken2: { start: number; end: number }[] = []
  for (const n of wanted) {
    for (const o of occurrences(t, n)) {
      if (taken2.some((r) => o.start < r.end && o.end > r.start)) continue
      const ctx = contextOk(t, o.start, o.end, n)
      if (!ctx.ok) continue
      taken2.push(o)
      missing.push({ ...o, phrase: n, onPrefix: ctx.onPrefix, notOffered: n })
    }
  }
  return pickMatch(missing.sort((a, b) => a.start - b.start)) ?? null
}

// ---------------------------------------------------------------------------------------------
// Bullets with priorities (so the list can be trimmed to 8 without losing the important ones)
// ---------------------------------------------------------------------------------------------

interface Item {
  p: number
  text: string
}

/** A friendly name for a hex color when it is clearly white, black or grey, else the hex. */
function colorWord(hex: string): string {
  const { r, g, b } = hexToRgb(hex)
  const L = lightness01(r, g, b)
  const chroma = Math.max(r, g, b) - Math.min(r, g, b)
  if (chroma < 24) return L > 0.93 ? 'white' : L < 0.12 ? 'black' : 'grey'
  return hex
}

function placementLabel(id: string): string {
  return PLACEMENTS.find((p) => p.id === id)?.label ?? id
}

// ---------------------------------------------------------------------------------------------
// The interpreter
// ---------------------------------------------------------------------------------------------

export function interpretLook(ctx: LookContext): LookPlan {
  const { traits, garment, availablePlacementIds } = ctx
  const prompt = ctx.prompt ?? ''
  const rawLower = prep(prompt)
  let t = norm(prompt)

  const expl: Item[] = []
  const tips: Item[] = []
  const warnings: string[] = []
  const matched: string[] = []
  const say = (p: number, text: string) => expl.push({ p, text })
  const tip = (p: number, text: string) => tips.push({ p, text })
  const warn = (text: string) => {
    if (!warnings.includes(text)) warnings.push(text)
  }
  const note = (...words: (string | undefined)[]) => {
    for (const w of words) if (w && w.trim()) matched.push(w.trim())
  }

  const hasPrompt = t.trim().length > 0

  // ---- 1. Preset ---------------------------------------------------------------------------
  let preset: Preset | undefined
  let presetWords: string[] = []
  const fb = firstHit(t, FRONT_AND_BACK)
  if (fb) {
    preset = getPreset('small-front-big-back')
    presetWords = [fb.text]
  } else {
    const hit = rankPreset(prompt)
    if (hit) {
      preset = hit.preset
      presetWords = hit.matched
    }
  }
  note(...presetWords)

  let s: ProcessSettings = mergeSettings(DEFAULT_SETTINGS, preset?.settings)
  const presetStart = structuredClone(s)

  if (preset) {
    const starts = describePresetSettings(presetStart)
    say(
      10,
      `Started from the "${preset.name}" preset because your prompt says ${q(presetWords)}${starts ? `. It turns on ${starts}; the points below adjust that for your image and wording.` : '.'}`,
    )
  } else if (hasPrompt) {
    say(10, 'No preset matched your words, so I started from the app defaults and changed only what your prompt and the image call for.')
  } else {
    say(10, 'You did not describe a look, so I started from the app defaults and only fixed things your image needs to print well.')
  }

  // ---- 2. Shirt color and garment type -----------------------------------------------------
  let garmentColor: string | undefined
  let garmentName = garment.colorName
  let garmentHex = garment.colorHex
  const colorMatch = findShirtColor(t, garment.availableColors)
  if (colorMatch) {
    note(colorMatch.phrase)
    t = ` ${t.slice(0, colorMatch.start).trimEnd()} garmentcolor ${t.slice(colorMatch.end).trimStart()}`.replace(/ +/g, ' ')
    if (colorMatch.name && colorMatch.hex) {
      garmentName = colorMatch.name
      garmentHex = colorMatch.hex
      garmentColor = colorMatch.name
      const exactSaid = norm(colorMatch.name).trim() === colorMatch.phrase
      say(
        9,
        exactSaid
          ? `Set the shirt color to ${colorMatch.name} (step 3) because your prompt names it; every knockout and halftone choice below is judged against that shirt color, not the one that was selected before.`
          : `Set the shirt color to ${colorMatch.name} (step 3), the closest match this blank offers for "${colorMatch.phrase}"; every knockout and halftone choice below is judged against that shirt color.`,
      )
    } else if (colorMatch.notOffered) {
      tip(
        9,
        `You mentioned a ${colorMatch.notOffered} shirt, but ${garment.colorName} is selected and this blank does not list ${colorMatch.notOffered}. Pick the closest color, or a different blank, under Color in step 3; the settings above were chosen for ${garment.colorName}.`,
      )
    }
  }
  const gRgb = hexToRgb(garmentHex)
  const gLight = lightness01(gRgb.r, gRgb.g, gRgb.b)
  const garmentClass: 'dark' | 'light' | 'mid' = gLight < 0.35 ? 'dark' : gLight > 0.8 ? 'light' : 'mid'

  for (const rule of TYPE_RULES) {
    const h = firstHit(t, rule.re)
    if (!h) continue
    note(h.text)
    if (!rule.types.includes(garment.type)) {
      tip(8, `You described a ${rule.label.toLowerCase()}, but the selected garment is a ${garment.type}. Choose ${rule.label} in step 3 so the mockup and the Placement list in step 4 match.`)
    }
    break
  }

  // ---- 3. Prompt modifiers -----------------------------------------------------------------

  // Distress
  {
    const offHits = allHits(t, DISTRESS_OFF)
    // "no distress" contains the word "distress"; do not count that as asking for it.
    const onHits = allHits(t, DISTRESS_ON).filter((h) => !offHits.some((o) => h.index >= o.index && h.index < o.index + o.text.length))
    const on = onHits.at(-1) ?? null
    const off = offHits.at(-1) ?? null
    let enable: boolean | null = null
    if (on && off) {
      enable = on.index > off.index
      warn(`Your prompt asks for both ${q([off.text])} and ${q([on.text])} (distress). I went with the later one, ${q([enable ? on.text : off.text])}; change Distress in step 5 if you meant the other.`)
      note(on.text, off.text)
    } else if (on) {
      enable = true
      note(on.text)
    } else if (off) {
      enable = false
      note(off.text)
    }
    if (enable === false && s.distress.enabled) {
      s.distress.enabled = false
      say(7, `Turned Distress off because you asked for a clean print (${q([off?.text ?? 'clean'])}); the preset would otherwise have roughed up the ink.`)
    } else if (enable === true) {
      const presetHad = presetStart.distress.enabled
      const all = onHits.map((h) => h.text)
      let mask: MaskKind = presetHad ? presetStart.distress.mask : 'cracked'
      if (/\bcrack\w*/.test(t)) mask = 'cracked'
      else if (/\bscratch\w*/.test(t)) mask = 'scratched'
      else if (/\b(?:speckle\w*|spray\w*|splatter\w*|spatter\w*)\b/.test(t)) mask = 'speckle'
      else if (/\b(?:sandblast\w*|worn|faded|aged|sun faded)\b/.test(t)) mask = 'sandblasted'
      let intensity = presetHad ? presetStart.distress.intensity : 0.3
      const heavy = lastHit(t, INTENSITY_HEAVY)
      const light = lastHit(t, INTENSITY_LIGHT)
      let how = ''
      if (heavy && light) {
        intensity = heavy.index > light.index ? 0.5 : 0.15
        how = intensity === 0.5 ? heavy.text : light.text
      } else if (heavy) {
        intensity = 0.5
        how = heavy.text
      } else if (light) {
        intensity = 0.15
        how = light.text
      }
      if (/\bbeat up\b/.test(t) && !light) intensity = 0.5
      note(heavy?.text, light?.text)
      s.distress = { enabled: true, mask, intensity }
      const reason = how
        ? intensity > 0.3
          ? `${q([how])} asks for heavy wear, so I raised the strength`
          : `${q([how])} asks for a light touch, so I kept the strength low and the art readable`
        : intensity === presetStart.distress.intensity && presetHad
          ? 'the preset already sets a strength that suits this look'
          : 'a mid-strength wear keeps the art readable while still looking aged'
      say(7, `Turned on Distress with the ${MASK_LABEL[mask]} mask at ${pct(intensity)} because you said ${q(uniq(all).slice(0, 3))}; ${reason}.`)
    }
  }

  // Fade
  let fadeOn = false
  {
    const on = lastHit(t, FADE_ON)
    const off = lastHit(t, FADE_OFF)
    if (on && !(off && off.index > on.index)) {
      fadeOn = true
      note(on.text)
      const words = t.split(' ').filter(Boolean)
      const fadeWordIdx = t.slice(0, on.index).trim().split(' ').filter(Boolean).length
      let edge: Edge = presetStart.fadeEdge.enabled ? presetStart.fadeEdge.edge : 'bottom'
      let bestDist = Infinity
      const edgeWords: Record<string, Edge> = { top: 'top', upper: 'top', bottom: 'bottom', lower: 'bottom', base: 'bottom', left: 'left', right: 'right' }
      words.forEach((w, i) => {
        const e = edgeWords[w]
        if (!e) return
        if (/^(?:chest|sleeve|pocket|hip|hand|side)$/.test(words[i + 1] ?? '')) return
        const d = Math.abs(i - fadeWordIdx)
        if (d < bestDist && d <= 8) {
          bestDist = d
          edge = e
          note(w)
        }
      })
      let fraction = presetStart.fadeEdge.enabled ? presetStart.fadeEdge.fraction : 0.35
      const sh = firstHit(t, FADE_SHORT)
      const lo = firstHit(t, FADE_LONG)
      if (sh && !lo) {
        fraction = 0.2
        note(sh.text)
      } else if (lo && !sh) {
        fraction = 0.5
        note(lo.text)
      }
      s.fadeEdge = { enabled: true, edge, fraction }
      say(
        7,
        `Faded the ${edge} edge into the shirt over the last ${pct(fraction)} of the art, using halftone dots, because you said ${q([on.text])}; DTF cannot print a smooth see-through gradient, so the dots stand in for it.`,
      )
    } else if (off && s.fadeEdge.enabled) {
      s.fadeEdge.enabled = false
      note(off.text)
      say(7, 'Turned Fade an edge into the garment off because you asked for no fade.')
    }
  }

  // Colors: one-color / N-colors / keep colors / posterize words (the later phrase wins).
  const askedFlat = POSTERIZE_WORDS.test(t) || N_COLORS.test(t) || ONE_COLOR.test(t)
  {
    type Ev = { index: number; text: string; kind: 'lineart' | 'posterize' | 'keep'; n?: number }
    const evs: Ev[] = []
    for (const h of allHits(t, ONE_COLOR)) evs.push({ index: h.index, text: h.text, kind: 'lineart' })
    for (const h of allHits(t, N_COLORS)) {
      const m = /^(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)/.exec(h.text)
      const n = /two tone/.test(h.text) ? 2 : m ? (NUMBER_WORDS[m[1]] ?? Number(m[1])) : NaN
      if (n === 1) {
        if (!evs.some((e) => e.kind === 'lineart' && Math.abs(e.index - h.index) < 3)) evs.push({ index: h.index, text: h.text, kind: 'lineart' })
      } else if (n >= 2 && n <= 12) evs.push({ index: h.index, text: h.text, kind: 'posterize', n })
    }
    for (const h of allHits(t, POSTERIZE_WORDS)) {
      if (!evs.some((e) => Math.abs(e.index - h.index) < 12)) evs.push({ index: h.index, text: h.text, kind: 'posterize' })
    }
    for (const h of allHits(t, KEEP_COLORS)) evs.push({ index: h.index, text: h.text, kind: 'keep' })
    evs.sort((a, b) => a.index - b.index)
    const win = evs.at(-1)
    if (win) {
      const kinds = uniq(evs.map((e) => e.kind))
      if (kinds.length > 1) {
        const other = [...evs].reverse().find((e) => e.kind !== win.kind)
        if (other) warn(`Your prompt pulls two ways on color count: ${q([other.text])} and ${q([win.text])}. I followed the later one, ${q([win.text])}; adjust Posterize in Color work (step 5) if you meant the other.`)
      }
      note(...evs.map((e) => e.text))
      if (win.kind === 'lineart') {
        s.lineArt = { ...s.lineArt, enabled: true, ink: 'auto' }
        s.posterize.enabled = false
        say(6, `Turned on Line art (1-bit) in Color work with the ink set to Auto, so the whole print becomes one solid color (black or white, whichever contrasts with the shirt), because you said ${q([win.text])}.`)
      } else if (win.kind === 'posterize') {
        const colors = win.n ?? (presetStart.posterize.enabled ? presetStart.posterize.colors : 4)
        s.posterize = { enabled: true, colors }
        say(6, `Turned on Posterize with ${colors} colors in Color work because you said ${q([win.text])}; a small flat palette prints like a screen print and avoids muddy gradients.`)
      } else {
        const was = s.posterize.enabled
        s.posterize.enabled = false
        if (was) say(6, `Turned Posterize off in Color work because you said ${q([win.text])}; the preset would have reduced the palette.`)
      }
    }
  }

  // Desaturate / contrast
  {
    const bw = firstHit(t, BLACK_WHITE)
    const faded = firstHit(t, FADED_COLORS)
    if (bw) {
      note(bw.text)
      s.desaturate = 1
      say(6, `Set Desaturate to 100% in Color work because you asked for ${q([bw.text])}; the art prints in grey tones only.`)
    } else if (faded) {
      note(faded.text)
      s.desaturate = Math.max(s.desaturate, 0.25)
      say(6, `Set Desaturate to ${pct(s.desaturate)} in Color work because you said ${q([faded.text])}; muting the colors a little gives the sun-faded look of an old print.`)
    }
    const bold = firstHit(t, BOLD)
    const soft = firstHit(t, SOFT)
    if (bold && (!soft || bold.index > soft.index)) {
      note(bold.text)
      s.contrast = Math.max(s.contrast, 0.3)
      say(6, `Raised Contrast to +${s.contrast.toFixed(2)} in Color work because you said ${q([bold.text])}; stronger darks and lights read better from a distance.`)
    } else if (soft) {
      note(soft.text)
      s.contrast = -0.15
      say(6, `Lowered Contrast to ${s.contrast.toFixed(2)} in Color work because you said ${q([soft.text])}, for a gentler look.`)
    }
  }

  // Outline
  {
    const on = lastHit(t, OUTLINE_ON)
    const off = lastHit(t, OUTLINE_OFF)
    if (off && (!on || off.index >= on.index)) {
      note(off.text)
      if (s.outline.enabled) {
        s.outline.enabled = false
        say(5, 'Turned Keyline outline off because you asked for no outline.')
      }
    } else if (on) {
      note(on.text)
      let px = 4
      const thick = firstHit(t, OUTLINE_THICK)
      const thin = firstHit(t, OUTLINE_THIN)
      if (thick && !thin) px = 8
      else if (thin && !thick) px = 2
      const white = OUTLINE_WHITE.test(t)
      const shirtColored = OUTLINE_GARMENT.test(t)
      const color = shirtColored ? 'garment' : white ? '#ffffff' : presetStart.outline.enabled && presetStart.outline.color !== '#000000' ? presetStart.outline.color : '#000000'
      s.outline = { enabled: true, px, color }
      const colorWords = color === 'garment' ? 'shirt-colored' : color === '#ffffff' ? 'white' : 'black'
      say(5, `Turned on Keyline outline at ${px} px, ${colorWords}, because you said ${q([on.text])}; at 300 DPI anything thinner than about 2 px may not hold on the film.`)
    }
  }

  // Background
  let bgIntent: 'remove' | 'keep' | null = null
  {
    const rm = lastHit(t, BG_REMOVE)
    const keep = lastHit(t, BG_KEEP)
    if (rm && keep) {
      bgIntent = rm.index > keep.index ? 'remove' : 'keep'
      warn(`Your prompt says both ${q([rm.text])} and ${q([keep.text])}. I went with the later one; flip Remove background (flood fill from edges) in step 5 if you meant the other.`)
    } else if (rm) bgIntent = 'remove'
    else if (keep) bgIntent = 'keep'
    note(rm?.text, keep?.text)
  }

  // Knockout intent
  let koIntent: 'on' | 'off' | null = null
  let koWords = ''
  {
    const ons = KNOCKOUT_ON.map((re) => lastHit(t, re)).filter((h): h is Hit => h !== null)
    const onHit = ons.sort((a, b) => b.index - a.index)[0]
    const offHit = lastHit(t, KNOCKOUT_OFF)
    if (onHit && offHit) {
      koIntent = onHit.index > offHit.index ? 'on' : 'off'
      koWords = koIntent === 'on' ? onHit.text : offHit.text
      warn(`Your prompt says both ${q([onHit.text])} and ${q([offHit.text])}. I followed the later one, ${q([koWords])}; toggle Knock out garment color in step 5 if you meant the other.`)
    } else if (onHit) {
      koIntent = 'on'
      koWords = onHit.text
    } else if (offHit) {
      koIntent = 'off'
      koWords = offHit.text
    }
    note(onHit?.text, offHit?.text)
  }

  // Placement
  let placementId: string | undefined
  let oversize: boolean | undefined
  {
    const pick = (cands: string[]) => cands.find((c) => availablePlacementIds.includes(c))
    type Found = { index: number; text: string; label: string; id?: string; wanted: string }
    const found: Found[] = []
    if (fb) {
      const id = pick(['full-back', 'youth-full-back'])
      found.push({ index: fb.index, text: fb.text, label: 'full-back', id, wanted: 'Full back' })
    } else {
      for (const rule of PLACEMENT_RULES) {
        const h = firstHit(t, rule.re)
        if (h) found.push({ index: h.index, text: h.text, label: rule.label, id: pick(rule.candidates), wanted: placementLabel(rule.candidates[0]) })
      }
      const sl = firstHit(t, SLEEVE)
      if (sl) {
        const longFirst = !['tee', 'polo', 'crop-tee'].includes(garment.type)
        found.push({ index: sl.index, text: sl.text, label: 'sleeve', id: pick(longFirst ? ['long-sleeve', 'short-sleeve'] : ['short-sleeve', 'long-sleeve']), wanted: 'Sleeve' })
      }
    }
    found.sort((a, b) => a.index - b.index)
    const first = found[0]
    if (first) {
      note(first.text)
      if (found.length > 1 && !fb) {
        const others = found.slice(1).map((f) => f.text)
        warn(`Your prompt mentions more than one placement (${q([first.text, ...others])}). One file has one placement, so I used ${q([first.text])}; make a second export for the others by changing Placement in step 4.`)
      }
      if (first.id) {
        placementId = first.id
        say(4, `Set Placement to ${placementLabel(first.id)} (step 4) because you said ${q([first.text])}; the print size and distance below the collar come from that placement.`)
      } else {
        tip(8, `You asked for ${q([first.text])}, but ${first.wanted} is not available on this garment. Open Placement in step 4 and pick the closest option, or choose a different garment in step 3.`)
      }
    }
    // Oversize
    const ov = firstHit(t, OVERSIZE)
    if (ov) {
      note(ov.text)
      let target = placementId
      if (!target && !first) {
        target = availablePlacementIds.find((id) => id.endsWith('full-front'))
        if (target) {
          placementId = target
          say(4, `Set Placement to ${placementLabel(target)} (step 4) because an ${q([ov.text])} print is a full-front design.`)
        }
      }
      const pl = target ? PLACEMENTS.find((p) => p.id === target) : undefined
      if (pl?.oversize) {
        oversize = true
        say(4, `Turned on Oversize (step 4) because you said ${q([ov.text])}; ${pl.label} then runs ${pl.oversize.minW} to ${pl.oversize.maxW} in wide and starts ${pl.oversize.downIn} in below the collar.`)
      } else {
        tip(8, `You asked for an oversized print, but ${pl ? pl.label : 'the selected placement'} has no Oversize option. In step 4, use Adult full front and turn on Oversize, or raise Print width (inches) within that placement's limit.`)
      }
    }
  }

  // Size
  let widthIn: number | undefined
  {
    const raw = rawLower
    const re = /(\d+(?:\.\d+)?)\s*(?:-\s*)?(?:inches|inch|in(?![a-z])(?!\s+(?:the|a|an|my|your|this|that|our|front|back|one|color|colour))|["”″])/g
    const m = re.exec(raw)
    if (m) {
      const v = Number(m[1])
      note(m[0].trim())
      if (v >= 1 && v <= 20) {
        widthIn = v
        say(4, `Set Print width to ${v} in (step 4) because you asked for ${q([m[0].trim()])}.`)
      } else {
        warn(`I ignored the size ${q([m[0].trim()])}: Print width must be between 1 and 20 inches. Type the width in Print width (inches) in step 4.`)
      }
    }
  }

  // Finish
  let mockupFinish: LookPlan['mockupFinish'] = preset?.mockupFinish
  {
    const f = firstHit(t, FINISH)
    if (f) {
      note(f.text)
      mockupFinish = /mineral/.test(f.text) ? 'mineral' : 'washed'
      const rec = getPreset('washed-pairing')?.recommendGarments ?? []
      say(3, `Switched the mockup finish to ${mockupFinish} because you said ${q([f.text])}; this only changes how the preview looks, not the art.`)
      tip(5, `For a real ${mockupFinish} look, print on a washed or garment-dyed blank such as ${rec.slice(0, 3).join(', ')}; pick it as the garment in step 3.`)
    } else if (mockupFinish && preset) {
      say(3, `Switched the mockup finish to ${mockupFinish} because the ${preset.name} look is meant for washed blanks; this only changes the preview.`)
      const rec = preset.recommendGarments ?? getPreset('washed-pairing')?.recommendGarments ?? []
      if (rec.length) tip(5, `${preset.name} reads best on a washed blank such as ${rec.slice(0, 3).join(', ')}; choose one as the garment in step 3.`)
    }
  }

  // Mirror
  if (MIRROR.test(t)) {
    const h = firstHit(t, MIRROR)
    note(h?.text)
    warn('I left Mirror off. The printer mirrors the file when it prints, so the file you export should read the right way round. Turn on Mirror in step 5 only if your print shop asks for a pre-mirrored file.')
  }

  // Unsupported effects
  if (mentionsUnsupported(prompt)) warn(UNSUPPORTED_NOTE)

  // ---- 4. Image guardrails -----------------------------------------------------------------

  // Background
  {
    const wasOn = s.removeBackground
    if (traits.solidBackground && !traits.hasAlpha) {
      const bg = traits.backgroundHex ? colorWord(traits.backgroundHex) : 'one color'
      if (bgIntent === 'keep') {
        s.removeBackground = false
        say(8, `Left Remove background (flood fill from edges) off because you asked to keep the background; the solid ${bg} area will print as a box.`)
        tip(8, `Changed your mind about the box? Turn on Remove background (flood fill from edges) in step 5.`)
      } else {
        s.removeBackground = true
        say(8, `Turned on Remove background (flood fill from edges) because your image has a solid ${bg} background; left in, it would print as a box.`)
      }
    } else if (bgIntent === 'remove') {
      s.removeBackground = true
      say(
        8,
        traits.hasAlpha
          ? 'Turned on Remove background (flood fill from edges) because you asked for it; your image already has transparency, so this mostly cleans up leftover edge pixels.'
          : 'Turned on Remove background (flood fill from edges) because you asked for it; there is no single clear border color, so check the result and raise Tolerance (Delta E) if some background is left.',
      )
    } else if (wasOn) {
      s.removeBackground = false
      say(
        8,
        traits.hasAlpha
          ? 'Turned Remove background (flood fill from edges) off even though the preset enables it, because your image already has a transparent background and the flood fill could eat into light parts of the artwork.'
          : 'Turned Remove background (flood fill from edges) off even though the preset enables it, because your image has no solid-color border to flood from and it could eat into the artwork.',
      )
    }
  }

  // Halftone and soft alpha
  {
    const on = lastHit(t, HALFTONE_ON)
    const off = lastHit(t, HALFTONE_OFF)
    const soft = traits.softAlphaFraction
    let explicitOn = false
    if (on && off) {
      explicitOn = on.index > off.index
      warn(`Your prompt says both ${q([off.text])} and ${q([on.text])} about halftone. I followed the later one, ${q([explicitOn ? on.text : off.text])}; change Halftone in step 5 if you meant the other.`)
    } else if (on) explicitOn = true
    const explicitOff = !!off && !explicitOn
    note(on?.text, off?.text)

    const photoWord = PHOTO_WORD.test(t)
    const lpiFine = LPI_FINE.test(t)
    const lpiCoarse = LPI_COARSE.test(t)

    if (explicitOff) {
      if (s.halftone.enabled) {
        s.halftone.enabled = false
      }
      if (soft > 0.005) {
        say(
          8,
          `Left Halftone off because you asked for ${q([off?.text ?? 'clean edges'])}, even though ${pct(soft)} of your pixels are semi-transparent; Alpha threshold (${s.alphaThreshold}) will snap those soft edges to hard ones, so shadows and glows turn into a sharp edge.`,
        )
        tip(8, `Soft shadow lost its glow? Turn on Halftone with Dots from set to Soft edges and shadows in step 5 to keep it as dots.`)
      } else if (presetStart.halftone.enabled) {
        say(8, `Turned Halftone off because you asked for ${q([off?.text ?? 'clean edges'])}.`)
      }
      if (fadeOn) warn('The fade is built from halftone dots, so it still shows dots even though you asked for none; turn Fade an edge into the garment off in step 5 if you want hard edges only.')
    } else if (explicitOn) {
      const opaque = !traits.hasAlpha
      const lum = (opaque && traits.kind === 'photo') || (photoWord && opaque)
      const mode: 'alpha' | 'luminance' = lum ? 'luminance' : 'alpha'
      let lpi = lpiCoarse ? 45 : lpiFine ? 65 : presetStart.halftone.enabled ? presetStart.halftone.lpi : 55
      if (lpiCoarse && lpiFine) lpi = 55
      s.halftone = { ...s.halftone, enabled: true, mode, lpi, ink: mode === 'luminance' ? 'auto' : DEFAULT_SETTINGS.halftone.ink, lumLo: 0, lumHi: 1 }
      const dotWords = lpiCoarse ? 'big dots' : lpiFine ? 'fine dots' : 'standard dots'
      if (mode === 'luminance') {
        say(8, `Turned on Halftone with Dots from set to Tones / photo at ${lpi} LPI, with ink on Auto, because you said ${q([on?.text ?? 'halftone'])} and your image is an opaque photo; one ink color (white on dark shirts, black on light ones) is what keeps photos clean on film.`)
      } else {
        say(8, `Turned on Halftone with Dots from set to Soft edges and shadows at ${lpi} LPI (${dotWords}) because you said ${q([on?.text ?? 'halftone'])}; this art ${traits.hasAlpha ? 'has transparency, so Tones mode would drop ink' : 'is not a photo'}.`)
        if (soft <= 0.005 && !fadeOn) {
          tip(8, `Few dots showing? Your art has almost no soft edges, so Soft edges mode has little to turn into dots. For a photo-style screen, set Dots from to Tones / photo under Halftone in step 5 (opaque art only).`)
        }
      }
    } else if (soft > 0.005) {
      if (!s.halftone.enabled) {
        s.halftone = { ...s.halftone, enabled: true, mode: 'alpha', lpi: lpiCoarse ? 45 : lpiFine ? 65 : s.halftone.lpi }
        say(8, `Turned soft edges into halftone dots (Halftone, Dots from: Soft edges and shadows, ${s.halftone.lpi} LPI) because ${pct(soft)} of your pixels are semi-transparent; DTF prints a white underbase under them, so they would otherwise become blotchy or vanish at the Alpha threshold.`)
      } else if (s.halftone.mode === 'alpha') {
        say(8, `Kept Halftone on in Soft edges and shadows mode because ${pct(soft)} of your pixels are semi-transparent; DTF cannot print partial transparency, so they become dots.`)
      }
    }

    // Tones (luminance) mode must never run on art that already has transparency or on flat art.
    if (s.halftone.enabled && s.halftone.mode === 'luminance') {
      if (traits.hasAlpha) {
        s.halftone = { ...s.halftone, mode: 'alpha', ink: DEFAULT_SETTINGS.halftone.ink, lumLo: 0, lumHi: 1 }
        say(8, `Switched Halftone to Dots from: Soft edges and shadows instead of Tones because your art already has transparency; Tones mode treats the clear area as tone and in a real test dropped the ink from 20% to 2%.`)
      } else if (traits.kind === 'flat') {
        s.halftone = { ...s.halftone, mode: 'alpha', ink: DEFAULT_SETTINGS.halftone.ink, lumLo: 0, lumHi: 1 }
        say(8, `Switched Halftone to Dots from: Soft edges and shadows instead of Tones because your art is flat color (${traits.dominantColors} main colors); Tones would screen the solid fills into dots.`)
      }
    }
    // Make sure a leftover luminance ink never carries into alpha mode.
    if (s.halftone.enabled && s.halftone.mode === 'alpha' && s.halftone.ink === 'auto') s.halftone.ink = DEFAULT_SETTINGS.halftone.ink
  }

  // Knockout
  {
    const kind = garmentClass
    const inkShare = kind === 'dark' ? traits.darkInkFraction : kind === 'light' ? traits.lightInkFraction : 0
    const dropWord = kind === 'dark' ? 'near-black' : 'white'
    const was = s.knockoutGarment
    if (kind === 'mid') {
      s.knockoutGarment = false
      if (was || koIntent === 'on') {
        say(
          8,
          `Left Knock out garment color off because ${garmentName} is a mid-tone shirt; knocking out a mid-tone shirt color would delete real ink from your art (any grey, tan or muted color close to it), so those tones print instead.`,
        )
        if (koIntent === 'on') tip(8, `You wanted the shirt to show through, which works best on a very dark or very light shirt. Choose a darker or lighter Color in step 3 and the knockout can be turned on.`)
      }
    } else if (koIntent === 'off') {
      s.knockoutGarment = false
      say(8, `Left Knock out garment color off because you said ${q([koWords])}; the ${dropWord} areas print as ink.`)
      if (kind === 'dark') tip(8, `Black ink printed on a ${garmentName} shirt can look dull because it sits on a white underbase. To let the shirt be the black, turn on Knock out garment color in step 5.`)
    } else if (koIntent === 'on' || inkShare > 0.05) {
      s.knockoutGarment = true
      const why =
        koIntent === 'on'
          ? `because you said ${q([koWords])}`
          : `because ${pct(inkShare)} of your ink is ${dropWord} and ${garmentName} is a ${kind} shirt`
      say(8, `Turned on Knock out garment color (Tolerance ${s.tolerance}) ${why}; the ${dropWord} parts of your art become the shirt itself instead of printing as ink.`)
    }
  }

  // Posterize guardrail
  {
    const photoish = traits.kind !== 'flat' && traits.distinctColors > 512
    if (s.posterize.enabled && photoish && !askedFlat) {
      s.posterize.enabled = false
      say(
        7,
        `Turned Posterize off in Color work because your image is ${traits.kind === 'photo' ? 'a photo' : 'a detailed illustration'} (${traits.distinctColors} colors) and you did not ask for a flat, limited palette; posterizing smooth tones makes visible bands and can turn small accent colors grey, as happened to a red hat in testing.`,
      )
      tip(7, `Want the flat screen-print look anyway? Turn Posterize back on in Color work (step 5) and set Colors to 4 to 6, then check the accent colors survived.`)
    }
  }

  // Upscale
  let upscale: UpscaleChoice = 'ai'
  const placementDef = placementId ? PLACEMENTS.find((p) => p.id === placementId) : PLACEMENTS.find((p) => p.id === (preset?.placement ?? availablePlacementIds[0]))
  const printIn = widthIn ?? (oversize && placementDef?.oversize ? (placementDef.oversize.minW + placementDef.oversize.maxW) / 2 : placementDef?.defaultW ?? 11)
  const neededPx = printIn * 300
  const needsUpscale = traits.width < neededPx
  const effDpi = Math.round(traits.width / Math.max(printIn, 0.1))
  if (traits.kind === 'flat' && traits.dominantColors <= 8 && needsUpscale) {
    const w = firstHit(t, VECTOR_WORDS)
    if (w) {
      upscale = 'vectorize'
      note(w.text)
      say(3, `Chose Vectorize instead in step 6 because your art is flat color (${traits.dominantColors} main colors) and you said ${q([w.text])}; tracing keeps edges perfectly sharp at any print size.`)
      tip(6, `If the traced shapes look too blobby or lose small details, switch step 6 back to AI (Real-ESRGAN).`)
    } else {
      tip(6, `Your art is flat color with only ${traits.dominantColors} main colors, so Vectorize instead in step 6 can give razor-sharp edges at ${printIn} in; use AI (Real-ESRGAN) if the art has fine texture, or try Vectorize and compare.`)
    }
  } else if (firstHit(t, /\bvector\w*/) && traits.kind !== 'flat') {
    tip(6, `Vectorize instead in step 6 only works well on flat art with 8 or fewer colors; yours has ${traits.dominantColors} main colors, so I kept AI (Real-ESRGAN).`)
  }

  // ---- 5. Finish: clamp, size sanity, tips -------------------------------------------------
  s.tolerance = Math.min(25, Math.max(2, s.tolerance))
  s.distress.intensity = Math.min(1, Math.max(0, s.distress.intensity))
  s.halftone.lpi = Math.min(65, Math.max(45, s.halftone.lpi))
  s.fadeEdge.fraction = Math.min(0.9, Math.max(0.05, s.fadeEdge.fraction))

  // Preset placement when the prompt named none.
  if (!placementId && preset?.placement && availablePlacementIds.includes(preset.placement)) {
    placementId = preset.placement
    say(4, `Set Placement to ${placementLabel(placementId)} (step 4) because the ${preset.name} preset is made for that spot.`)
  }
  if (preset?.secondary) {
    const sec = preset.secondary
    tip(5, `Want the small front too? Export again with Placement set to ${placementLabel(sec.placement)} at ${sec.widthIn} in in step 4; both files come from the same art.`)
  }
  if (preset?.recommendColors?.length) {
    const rec = preset.recommendColors.filter((c) => garment.availableColors.some((a) => a.name === c))
    if (rec.length && !rec.includes(garmentName)) tip(5, `${preset.name} looks best on ${rec.slice(0, 3).join(', ')}. Change Color in step 3 if you want that look, then export again.`)
  }
  if (preset?.garmentColor && !garmentColor && garmentName !== preset.garmentColor && garment.availableColors.some((a) => a.name === preset.garmentColor)) {
    tip(5, `${preset.name} art is designed for a ${preset.garmentColor} shirt. Pick ${preset.garmentColor} under Color in step 3 for the intended look.`)
  }

  // Width sanity against the placement.
  if (widthIn !== undefined && placementDef) {
    const lo = oversize && placementDef.oversize ? placementDef.oversize.minW : placementDef.minW
    const hi = oversize && placementDef.oversize ? placementDef.oversize.maxW : placementDef.maxW
    if (widthIn < lo || widthIn > hi) {
      tip(7, `${widthIn} in is outside the usual ${lo} to ${hi} in for ${placementDef.label}. Check Print width (inches) in step 4; the app will flag it if it is too big for the shirt size.`)
    }
  }

  // Upscale quality
  if (needsUpscale) {
    tip(
      6,
      `Your art is ${traits.width} px wide and the print is ${printIn} in wide (about ${effDpi} DPI). The upscale in step 6 takes it to 300 DPI, so zoom to 100% after upscaling and check edges and small text before export.`,
    )
  }

  // ---- Tips tied to what was applied ----
  if (s.distress.enabled) {
    tip(7, `Too much texture? Lower Distress intensity in step 5 (now ${pct(s.distress.intensity)}) or switch Distress mask to Speckle (now ${MASK_LABEL[s.distress.mask]}).`)
  } else {
    tip(4, `Want some wear? Turn on Distress in step 5 and pick a Distress mask (Cracked, Scratched, Speckle or Sandblasted); start at 15% and raise it until it looks right.`)
  }
  if (s.halftone.enabled) {
    tip(7, `Dots too visible up close? Raise LPI (lines per inch) in step 5 (now ${s.halftone.lpi}) toward 65. Want a bolder, more graphic dot? Lower it toward 45.`)
  }
  if (s.fadeEdge.enabled) {
    tip(7, `Fade too short or too long? Change Fade length in step 5 (now ${pct(s.fadeEdge.fraction)}), or move the fade with Edge (now ${s.fadeEdge.edge}).`)
  }
  if (s.posterize.enabled) {
    tip(6, `Lost a color you wanted? Turn off Posterize in Color work (step 5), or raise Colors above ${s.posterize.colors}.`)
    if (traits.kind !== 'flat' && traits.saturatedFraction > 0.15) {
      tip(5, `About ${pct(traits.saturatedFraction)} of your ink is strongly colored, so check that small accent colors survived Posterize in the crop inspector in step 7.`)
    }
  }
  if (s.lineArt.enabled) {
    tip(6, `Lines too thin or too heavy? Change the Line art (1-bit) threshold in Color work (step 5, now ${s.lineArt.threshold}); lower is thinner. Thicken strokes 1 px can also help.`)
  }
  if (s.knockoutGarment) {
    tip(7, `Want the shirt to show through more? Raise Tolerance (Delta E) in step 5 (now ${s.tolerance}). Losing parts you wanted to keep? Lower it, or use Pick a color to remove for a single color instead.`)
    tip(5, `Printing this on a lighter or darker shirt too? Change Color in step 3 and export again: make one file per shirt color, because the knockout depends on the shirt.`)
  } else if (garmentClass !== 'mid') {
    tip(5, `Want the ${garmentClass === 'dark' ? 'dark' : 'light'} areas to become the shirt? Turn on Knock out garment color in step 5 (Tolerance is ${s.tolerance}).`)
  }
  if (s.outline.enabled) {
    tip(5, `Outline too heavy or too light? Change Keyline width in Color work (step 5, now ${s.outline.px} px).`)
    if (s.outline.color === '#000000' && garmentClass === 'dark') {
      tip(6, `A black keyline disappears on ${garmentName}. Set Keyline color to White in Color work (step 5) if you want it visible.`)
    }
  }
  if (s.desaturate > 0 && s.desaturate < 1) {
    tip(4, `Colors too dull or too bright? Change Desaturate in Color work (step 5, now ${pct(s.desaturate)}).`)
  }
  tip(3, `Edges look jagged after export? Check the crop inspector in step 7 at 2× over the shirt color.`)
  tip(3, `Tiny loose bits in the print? Raise Remove specks smaller than (in) in step 5 (now ${s.speckMinIn}). Thin lines breaking up? Try Thicken strokes 1 px.`)
  tip(2, `Edges too hard or too ragged? Adjust Alpha threshold in step 5 (now ${s.alphaThreshold}); lower keeps more of a soft edge, higher trims it.`)
  tip(2, `Size feels off? Change Print width (inches) or Placement in step 4 (now ${printIn} in).`)

  // ---- Assemble ----------------------------------------------------------------------------
  const pickTop = (items: Item[], max: number, sortByPriority = false): string[] => {
    const seen = new Set<string>()
    const unique = items.filter((i) => (seen.has(i.text) ? false : (seen.add(i.text), true)))
    const keep = new Set(
      unique
        .map((it, idx) => ({ it, idx }))
        .sort((a, b) => b.it.p - a.it.p || a.idx - b.idx)
        .slice(0, max)
        .map((x) => x.idx),
    )
    const kept = unique.filter((_, idx) => keep.has(idx))
    if (sortByPriority) kept.sort((a, b) => b.p - a.p) // stable: ties keep their original order
    return kept.map((i) => i.text)
  }

  if (expl.length < 3) {
    say(2, `Kept Alpha threshold at ${s.alphaThreshold}: every pixel ends fully solid or fully clear, which is what DTF film needs.`)
    say(1, `Kept Remove specks smaller than (in) at ${s.speckMinIn} so tiny loose dots do not wash off the shirt${s.snapBlackWhite ? ', and left Snap near-black/white on so almost-black and almost-white print as true black and white' : ''}.`)
  }

  const plan: LookPlan = {
    presetId: preset?.id ?? null,
    settings: mergeSettings(DEFAULT_SETTINGS, s),
    upscale,
    explanation: pickTop(expl, 8),
    tips: pickTop(tips, 8, true),
    warnings,
    matched: uniq(matched.map((m) => m.trim()).filter(Boolean)),
  }
  if (garmentColor) plan.garmentColor = garmentColor
  if (placementId) plan.placementId = placementId
  if (oversize) plan.oversize = true
  if (widthIn !== undefined) plan.widthIn = widthIn
  if (mockupFinish) plan.mockupFinish = mockupFinish
  return plan
}
