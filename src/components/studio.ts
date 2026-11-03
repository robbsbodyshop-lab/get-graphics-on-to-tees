import { createContext, useContext } from 'react'
import garmentsData from '../data/garments.json'
import colorsData from '../data/colors.json'
import { PLACEMENTS, placementsFor, type DpiFlag, type Placement, type SizeClass, type VariantChoice } from '../lib/sizing'
import type { Preset } from '../lib/presets'
import type { ProcessSettings, RGBAImage } from '../lib/types'
import type { ImageAnalysis } from '../lib/image/analyze'
import type { PipelineClient } from '../lib/workerClient'
import type { PipelineReport } from '../lib/pipeline'
import type { SourceFormat } from '../lib/decode'
import type { UpscaleMode } from '../workers/pipeline.worker'
import type { MockupFinish, MockupGarmentType } from './GarmentMockup'

// ---------------------------------------------------------------------------------------------
// Catalog data
// ---------------------------------------------------------------------------------------------

export interface CatalogGarment {
  id: string
  brand: string
  style: string
  name: string
  type: MockupGarmentType
  weightOz: number | null
  fit: string
  sizeClass: SizeClass
  sizes: string[]
  colors: string[]
  notes: string
}
export interface Store {
  id: string
  name: string
  url: string
  address: string | null
  verified: string
  notes: string
  garments: CatalogGarment[]
}
export const STORES = garmentsData.stores as unknown as Store[]
export const CUSTOM_STORE = 'custom'

export interface ColorInfo {
  name: string
  hex: string
  finish: MockupFinish
}
const COLOR_MAP = new Map<string, ColorInfo>(
  (colorsData.colors as unknown as ColorInfo[]).map((c) => [c.name, c]),
)
export function colorByName(name: string): ColorInfo {
  return COLOR_MAP.get(name) ?? { name, hex: '#808080', finish: 'solid' }
}

export const GARMENT_TYPES: { id: MockupGarmentType; label: string }[] = [
  { id: 'tee', label: 'T-shirt' },
  { id: 'long-sleeve', label: 'Long sleeve tee' },
  { id: 'hoodie', label: 'Pullover hoodie' },
  { id: 'zip-hoodie', label: 'Zip hoodie' },
  { id: 'crewneck', label: 'Crewneck sweatshirt' },
  { id: 'polo', label: 'Polo' },
  { id: 'crop-tee', label: 'Crop tee' },
  { id: 'crop-hoodie', label: 'Crop hoodie' },
  { id: 'crop-crew', label: 'Crop crewneck' },
  { id: 'muscle-tee', label: 'Muscle tee' },
  { id: 'tank', label: 'Tank' },
  { id: 'hat', label: 'Hat' },
  { id: 'tote', label: 'Tote bag' },
]

export const SIZES_BY_CLASS: Record<string, string[]> = {
  adult: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'],
  youth: ['XS', 'S', 'M', 'L', 'XL'],
  toddler: ['2T', '3T', '4T', '5T'],
}

export interface CustomGarment {
  desc: string
  colorHex: string
  type: MockupGarmentType
  sizeClass: 'adult' | 'youth' | 'toddler'
}
export const DEFAULT_CUSTOM: CustomGarment = { desc: 'Custom blank', colorHex: '#141414', type: 'tee', sizeClass: 'adult' }

export interface Selection {
  storeId: string
  garmentId: string
  color: string
  size: string
  placementId: string
  oversize: boolean
  showAll: boolean
  widthIn: number
}

export interface Resolved {
  store: Store | null
  garment: CatalogGarment
  garmentLabel: string
  colorName: string
  colorHex: string
  finish: MockupFinish
  placements: Placement[]
  placement: Placement
  sel: Selection
}

export function garmentLabel(g: CatalogGarment): string {
  return `${g.brand} ${g.style} ${g.name}`
}
export function garmentOptionText(g: CatalogGarment): string {
  const bits = [g.weightOz ? `${g.weightOz} oz` : null, g.fit]
  return `${garmentLabel(g)} · ${bits.filter(Boolean).join(', ')}`
}

function customAsGarment(c: CustomGarment): CatalogGarment {
  return {
    id: 'custom',
    brand: '',
    style: '',
    name: c.desc || 'Custom garment',
    type: c.type,
    weightOz: null,
    fit: 'classic',
    sizeClass: c.sizeClass,
    sizes: SIZES_BY_CLASS[c.sizeClass],
    colors: [],
    notes: '',
  }
}

/** Fix a selection so every field is valid for the chosen store / garment. */
export function resolveSelection(sel: Selection, custom: CustomGarment): Resolved {
  const isCustom = sel.storeId === CUSTOM_STORE
  const store = isCustom ? null : (STORES.find((s) => s.id === sel.storeId) ?? STORES[0])
  const garment = isCustom
    ? customAsGarment(custom)
    : (store!.garments.find((g) => g.id === sel.garmentId) ?? store!.garments[0])

  let colorName = sel.color
  if (!isCustom && !garment.colors.includes(colorName)) colorName = garment.colors.includes('Black') ? 'Black' : garment.colors[0]
  const info = isCustom ? { name: 'Custom color', hex: custom.colorHex, finish: 'solid' as MockupFinish } : colorByName(colorName)
  if (isCustom) colorName = `Custom ${custom.colorHex}`

  let size = sel.size
  if (!garment.sizes.includes(size)) size = garment.sizes.includes('L') ? 'L' : garment.sizes[Math.floor(garment.sizes.length / 2)]

  const list = sel.showAll ? PLACEMENTS : placementsFor(garment.type, garment.sizeClass)
  const placement =
    list.find((p) => p.id === sel.placementId) ?? list.find((p) => p.id.endsWith('full-front')) ?? list[0] ?? PLACEMENTS[0]
  const oversize = sel.oversize && placement.oversize !== null

  return {
    store,
    garment,
    garmentLabel: isCustom ? garment.name : garmentLabel(garment),
    colorName,
    colorHex: info.hex,
    finish: info.finish,
    placements: list,
    placement,
    sel: { ...sel, storeId: isCustom ? CUSTOM_STORE : store!.id, garmentId: garment.id, color: colorName, size, placementId: placement.id, oversize },
  }
}

// ---------------------------------------------------------------------------------------------
// Studio context: all app state shared by the sections
// ---------------------------------------------------------------------------------------------

export interface Loaded {
  image: RGBAImage
  name: string
  format: SourceFormat
  pngDpi: number | null
  note: string | null
  analysis: ImageAnalysis
  dominantColors: number
}

export interface PreviewState {
  status: 'idle' | 'running' | 'ready' | 'error'
  stage: string
  fraction: number
  url: string | null
  report: PipelineReport | null
  areaRatio: number
  error: string | null
}

export interface ExportedDesign {
  id: string
  fileName: string
  label: string
  widthPx: number
  heightPx: number
  widthIn: number
  heightIn: number
  upscaledWith: string
  report: PipelineReport
  image: RGBAImage
  pngUrl: string
  settings: ProcessSettings
}

export interface ExportState {
  status: 'idle' | 'running' | 'done' | 'error'
  stage: string
  fraction: number
  message: string | null
  results: ExportedDesign[]
}

export interface Sizing {
  effW: number
  heightIn: number
  capped: boolean
  downIn: number | null
  aspect: number
  cropPx: number
  artPx: number
  targetPx: number
  factor: number
  dpi: number
  flag: DpiFlag
  variant: VariantChoice | null
  bodyWidthIn: number
  bodyLengthIn: number
  secondary: { label: string; widthIn: number; heightIn: number; variant: VariantChoice | null } | null
  quantity: number
}

export interface Studio {
  client: PipelineClient
  source: Loaded | null
  loading: boolean
  loadError: string | null
  loadFile: (f: File) => void

  look: string
  setLook: (s: string) => void
  preset: Preset | undefined
  applyPreset: (id: string) => void

  settings: ProcessSettings
  update: (fn: (s: ProcessSettings) => void) => void

  r: Resolved
  custom: CustomGarment
  setCustom: (p: Partial<CustomGarment>) => void
  pick: (p: Partial<Selection>, resetWidth?: boolean) => void
  setWidth: (w: number) => void
  resetWidth: () => void

  sz: Sizing
  finish: MockupFinish

  upscaler: UpscaleMode
  setUpscaler: (u: UpscaleMode) => void
  vectorOk: boolean
  model: { state: 'idle' | 'loading' | 'ready' | 'unavailable'; backend: string | null }

  preview: PreviewState
  showGarment: boolean
  setShowGarment: (b: boolean) => void

  exp: ExportState
  gang: ExportedDesign[]
  removeGang: (id: string) => void
  runExport: () => void
  cancelExport: () => void
  addThicken: () => void
}

export const StudioContext = createContext<Studio | null>(null)
export function useStudio(): Studio {
  const s = useContext(StudioContext)
  if (!s) throw new Error('StudioContext missing')
  return s
}
