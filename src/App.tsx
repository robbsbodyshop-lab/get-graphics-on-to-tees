import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { PipelineClient } from './lib/workerClient'
import { decodeFile } from './lib/decode'
import { analyzeImage } from './lib/image/analyze'
import { dominantColorCount } from './lib/upscale/vectorize'
import { DEFAULT_SETTINGS, mergeSettings } from './lib/settings'
import { getPreset } from './lib/presets'
import { describeImage } from './lib/look/traits'
import { interpretLook } from './lib/look/interpret'
import type { LookContext, LookPlan } from './lib/look/types'
import type { MockupFinish } from './components/GarmentMockup'
import { exportFileName } from './lib/pipeline'
import {
  PLACEMENTS,
  dpiFlag,
  downFor,
  garmentDims,
  getPlacement,
  placementsFor,
  proposeWidth,
  selectVariant,
  sizeFromWidth,
} from './lib/sizing'
import type { ProcessSettings, RGBAImage } from './lib/types'
import type { UpscaleMode } from './workers/pipeline.worker'
import {
  DEFAULT_CUSTOM,
  StudioContext,
  colorByName,
  resolveSelection,
} from './components/studio'
import type {
  CustomGarment,
  ExportState,
  ExportedDesign,
  Loaded,
  LookResult,
  PreviewState,
  Selection,
  Sizing,
  Studio,
} from './components/studio'
import { UploadSection } from './components/UploadSection'
import { LookSection } from './components/LookSection'
import { GarmentSection } from './components/GarmentSection'
import { PlacementSection } from './components/PlacementSection'
import { KnockoutSection } from './components/KnockoutSection'
import { UpscaleSection } from './components/UpscaleSection'
import { ExportSection } from './components/ExportSection'
import { SidePanel } from './components/SidePanel'
import { HelpPanel } from './components/HelpPanel'

interface Snapshot {
  settings: ProcessSettings
  presetId: string
  upscaler: UpscaleMode
  sel: Selection
  finishOverride: MockupFinish | null
}

const EMPTY_PREVIEW: PreviewState = { status: 'idle', stage: '', fraction: 0, url: null, report: null, areaRatio: 1, error: null }

function initialSelection(): Selection {
  const base: Selection = {
    storeId: 'aviva-dallas',
    garmentId: 'aviva-gildan-5000',
    color: 'Black',
    size: 'L',
    placementId: 'adult-full-front',
    oversize: false,
    showAll: false,
    widthIn: 11,
  }
  const r = resolveSelection(base, DEFAULT_CUSTOM)
  return { ...r.sel, widthIn: proposeWidth(r.placement, r.sel.size, r.garment.sizeClass, r.sel.oversize) }
}

async function toBlob(img: RGBAImage): Promise<Blob> {
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available.')
  ctx.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0)
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'))
  if (!blob) throw new Error('Could not build the image.')
  return blob
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 15_000)
}

export default function App(): ReactElement {
  const [client] = useState(() => new PipelineClient())
  useEffect(() => () => client.dispose(), [client])

  const [source, setSourceState] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [look, setLook] = useState('')
  const [presetId, setPresetId] = useState('')
  const [settings, setSettings] = useState<ProcessSettings>(() => structuredClone(DEFAULT_SETTINGS))
  const [sel, setSel] = useState<Selection>(initialSelection)
  const [custom, setCustomState] = useState<CustomGarment>(DEFAULT_CUSTOM)
  const [upscaler, setUpscaler] = useState<UpscaleMode>('ai')
  const [showGarment, setShowGarment] = useState(true)
  const [preview, setPreview] = useState<PreviewState>(EMPTY_PREVIEW)
  const [exp, setExp] = useState<ExportState>({ status: 'idle', stage: '', fraction: 0, message: null, results: [] })
  const [gang, setGang] = useState<ExportedDesign[]>([])
  const [model, setModel] = useState<Studio['model']>({ state: 'idle', backend: null })
  const [warmNonce, setWarmNonce] = useState(0)
  const [finishOverride, setFinishOverride] = useState<MockupFinish | null>(null)
  const [lookApplied, setLookApplied] = useState<{ plan: LookPlan; before: Snapshot; afterKey: string } | null>(null)

  const preset = getPreset(presetId)
  const r = useMemo(() => resolveSelection(sel, custom), [sel, custom])
  const vectorOk = !!source && source.dominantColors <= 8 && source.dominantColors > 0

  // ---- selection handlers --------------------------------------------------------------------
  const pick = useCallback(
    (patch: Partial<Selection>, resetWidth = true) => {
      setSel((prev) => {
        const r0 = resolveSelection({ ...prev, ...patch }, custom)
        const widthIn = resetWidth
          ? proposeWidth(r0.placement, r0.sel.size, r0.garment.sizeClass, r0.sel.oversize)
          : r0.sel.widthIn
        return { ...r0.sel, widthIn }
      })
    },
    [custom],
  )
  const setCustom = useCallback(
    (p: Partial<CustomGarment>) => {
      const nc = { ...custom, ...p }
      setCustomState(nc)
      setSel((prev) => {
        const r0 = resolveSelection(prev, nc)
        const reset = 'type' in p || 'sizeClass' in p
        const widthIn = reset ? proposeWidth(r0.placement, r0.sel.size, r0.garment.sizeClass, r0.sel.oversize) : r0.sel.widthIn
        return { ...r0.sel, widthIn }
      })
    },
    [custom],
  )
  const setWidth = useCallback((w: number) => setSel((p) => ({ ...p, widthIn: Math.min(20, Math.max(0.5, w)) })), [])
  const resetWidth = useCallback(
    () => setSel((p) => ({ ...p, widthIn: proposeWidth(r.placement, r.sel.size, r.garment.sizeClass, r.sel.oversize) })),
    [r],
  )
  const update = useCallback((fn: (s: ProcessSettings) => void) => {
    setSettings((prev) => {
      const next = structuredClone(prev)
      fn(next)
      return next
    })
  }, [])

  const applyPreset = useCallback(
    (id: string) => {
      setPresetId(id)
      setFinishOverride(null)
      const p = getPreset(id)
      setSettings(mergeSettings(DEFAULT_SETTINGS, p?.settings))
      if (!p) return
      setSel((prev) => {
        const next = { ...prev }
        let widthIn = prev.widthIn
        const list = prev.showAll ? PLACEMENTS : placementsFor(r.garment.type, r.garment.sizeClass)
        if (p.placement && list.some((x) => x.id === p.placement)) {
          next.placementId = p.placement
          next.oversize = false
          const r1 = resolveSelection(next, custom)
          widthIn = proposeWidth(r1.placement, r1.sel.size, r1.garment.sizeClass, false)
        }
        if (p.garmentColor && r.garment.colors.includes(p.garmentColor)) next.color = p.garmentColor
        const r2 = resolveSelection(next, custom)
        return { ...r2.sel, widthIn }
      })
      if (p.upscale && (p.upscale !== 'vectorize' || vectorOk)) setUpscaler(p.upscale)
    },
    [r, custom, vectorOk],
  )

  // ---- prompt-first look ---------------------------------------------------------------------
  const stateKey = useMemo(
    () => JSON.stringify([settings, presetId, upscaler, finishOverride, sel.color, sel.placementId, sel.oversize, sel.widthIn]),
    [settings, presetId, upscaler, finishOverride, sel],
  )

  const applyLook = useCallback((): string | null => {
    if (!source) return 'Upload your artwork first.'
    if (!source.traits) return `Could not read the image: ${source.traitsError ?? 'unknown error'}`
    // Re-applying a look the user hasn't adjusted starts from the state before that look, so a new
    // prompt doesn't inherit the old prompt's placement, width or shirt color, and Undo still goes
    // back to the user's own settings. After manual adjustments, the current state is the base.
    const unadjusted = lookApplied !== null && stateKey === lookApplied.afterKey
    const before: Snapshot = unadjusted ? lookApplied.before : { settings, presetId, upscaler, sel, finishOverride }
    const baseSel = before.sel
    const rb = resolveSelection(baseSel, custom)
    let plan: LookPlan
    try {
      const ctx: LookContext = {
        prompt: look,
        traits: source.traits,
        garment: {
          colorName: rb.colorName,
          colorHex: rb.colorHex,
          type: rb.garment.type,
          sizeClass: rb.garment.sizeClass,
          availableColors: rb.garment.colors.map((n) => ({ name: n, hex: colorByName(n).hex })),
        },
        availablePlacementIds: rb.placements.map((p) => p.id),
      }
      plan = interpretLook(ctx)
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
    let next: Selection = { ...baseSel }
    let widthIn = baseSel.widthIn
    if (plan.garmentColor && rb.garment.colors.includes(plan.garmentColor)) next.color = plan.garmentColor
    if (plan.placementId && rb.placements.some((x) => x.id === plan.placementId)) {
      next.placementId = plan.placementId
      next.oversize = !!plan.oversize
      const r1 = resolveSelection(next, custom)
      next = r1.sel
      widthIn = proposeWidth(r1.placement, r1.sel.size, r1.garment.sizeClass, r1.sel.oversize)
    }
    if (plan.widthIn) widthIn = Math.min(20, Math.max(0.5, plan.widthIn))
    next = { ...resolveSelection(next, custom).sel, widthIn }
    const nextSettings = structuredClone(plan.settings)
    nextSettings.knockoutPicks = []
    const nextUpscaler: UpscaleMode = plan.upscale === 'vectorize' && !vectorOk ? 'ai' : plan.upscale
    const nextPreset = plan.presetId && getPreset(plan.presetId) ? plan.presetId : ''
    const nextFinish = plan.mockupFinish ?? null
    setSettings(nextSettings)
    setPresetId(nextPreset)
    setUpscaler(nextUpscaler)
    setSel(next)
    setFinishOverride(nextFinish)
    setLookApplied({
      plan,
      before,
      afterKey: JSON.stringify([nextSettings, nextPreset, nextUpscaler, nextFinish, next.color, next.placementId, next.oversize, next.widthIn]),
    })
    return null
  }, [source, look, r, custom, sel, settings, presetId, upscaler, finishOverride, vectorOk, lookApplied, stateKey])

  const undoLook = useCallback(() => {
    if (!lookApplied) return
    const b = lookApplied.before
    setSettings(b.settings)
    setPresetId(b.presetId)
    setUpscaler(b.upscaler)
    setSel(b.sel)
    setFinishOverride(b.finishOverride)
    setLookApplied(null)
  }, [lookApplied])
  const lookResult: LookResult | null = lookApplied ? { plan: lookApplied.plan, adjusted: stateKey !== lookApplied.afterKey } : null

  // ---- loading a file ------------------------------------------------------------------------
  const loadFile = useCallback(
    (file: File) => {
      setLoading(true)
      setLoadError(null)
      decodeFile(file)
        .then((d) => {
          const analysis = analyzeImage(d.image)
          const dominantColors = dominantColorCount(d.image)
          let traits: Loaded['traits'] = null
          let traitsError: string | null = null
          try {
            traits = describeImage(d.image)
          } catch (e) {
            traitsError = e instanceof Error ? e.message : String(e)
          }
          client.setSource(d.image)
          setLookApplied(null)
          setSourceState({ ...d, analysis, dominantColors, traits, traitsError })
          setUpscaler((u) => (u === 'vectorize' && (dominantColors > 8 || dominantColors === 0) ? 'ai' : u))
        })
        .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Could not read the file.'))
        .finally(() => setLoading(false))
    },
    [client],
  )

  // ---- sizing --------------------------------------------------------------------------------
  const rep = preview.report
  const sz: Sizing = useMemo(() => {
    const aspect = rep && rep.heightIn > 0 ? rep.widthIn / rep.heightIn : (source?.analysis.aspect ?? 1)
    const sized = sizeFromWidth(r.placement, r.sel.widthIn, aspect)
    const cropPx = rep ? rep.sourceCrop.w * Math.sqrt(preview.areaRatio) : (source?.image.width ?? 0)
    const artIn = Math.max(0.05, sized.w - 0.2)
    const dpi = cropPx > 0 ? cropPx / artIn : 0
    const dims = garmentDims(r.garment.sizeClass, r.sel.size, r.garment.fit, r.garment.type)
    let secondary: Sizing['secondary'] = null
    if (preset?.secondary) {
      const sp = getPlacement(preset.secondary.placement)
      const ss = sizeFromWidth(sp, preset.secondary.widthIn, aspect)
      secondary = { label: sp.label, widthIn: ss.w, heightIn: ss.h, variant: selectVariant(ss.w, ss.h) }
    }
    return {
      effW: sized.w,
      heightIn: sized.h,
      capped: sized.capped,
      downIn: downFor(r.placement, r.sel.size, r.garment.sizeClass, r.sel.oversize),
      aspect,
      cropPx,
      artPx: artIn * 300,
      targetPx: sized.w * 300,
      factor: cropPx > 0 ? (artIn * 300) / cropPx : 1,
      dpi,
      flag: dpiFlag(dpi),
      variant: selectVariant(sized.w, sized.h),
      bodyWidthIn: dims.bodyWidthIn,
      bodyLengthIn: dims.bodyLengthIn,
      secondary,
      quantity: r.placement.id === 'zip-hoodie-side' ? 2 : 1,
    }
  }, [r, rep, preview.areaRatio, source, preset])

  // ---- live preview --------------------------------------------------------------------------
  const seq = useRef(0)
  const urlRef = useRef<string | null>(null)
  const previewWidth = Math.round(sz.effW * 1000) / 1000
  useEffect(() => {
    if (!source) return
    const id = ++seq.current
    setPreview((p) => ({ ...p, status: 'running', stage: 'Starting', fraction: 0, error: null }))
    const timer = setTimeout(() => {
      client
        .run(
          'preview',
          { settings, garmentHex: r.colorHex, printWidthIn: previewWidth, upscale: upscaler === 'vectorize' ? 'vectorize' : 'lanczos', previewMaxPx: 1200 },
          (stage, fraction) => {
            if (id === seq.current) setPreview((p) => ({ ...p, stage, fraction }))
          },
        )
        .then(async (res) => {
          if (id !== seq.current) return
          const url = URL.createObjectURL(await toBlob(res.image))
          if (id !== seq.current) {
            URL.revokeObjectURL(url)
            return
          }
          const old = urlRef.current
          urlRef.current = url
          if (old) URL.revokeObjectURL(old)
          setPreview({ status: 'ready', stage: '', fraction: 1, url, report: res.report, areaRatio: res.areaRatio, error: null })
        })
        .catch((e: unknown) => {
          if (id !== seq.current) return
          const msg = e instanceof Error ? e.message : String(e)
          if (msg === 'Cancelled') return
          setPreview((p) => ({ ...p, status: 'error', error: msg }))
        })
    }, 250)
    return () => clearTimeout(timer)
  }, [client, source, settings, r.colorHex, previewWidth, upscaler])
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    },
    [],
  )

  // ---- AI model warm-up ----------------------------------------------------------------------
  useEffect(() => {
    if (upscaler !== 'ai') return
    let alive = true
    setModel({ state: 'loading', backend: null })
    client
      .warmModel()
      .then((backend) => alive && setModel({ state: 'ready', backend }))
      .catch((e: unknown) => {
        if (!alive) return
        if (e instanceof Error && e.message === 'Cancelled') return
        setModel({ state: 'unavailable', backend: null })
      })
    return () => {
      alive = false
    }
  }, [client, upscaler, warmNonce])

  // ---- export --------------------------------------------------------------------------------
  const resultsRef = useRef<ExportedDesign[]>([])
  useEffect(() => {
    resultsRef.current = exp.results
  }, [exp.results])
  useEffect(
    () => () => {
      for (const d of resultsRef.current) URL.revokeObjectURL(d.pngUrl)
    },
    [],
  )

  const runExport = useCallback(() => {
    if (!source) return
    const jobs: { label: string; width: number; suffix: string }[] = [
      { label: preset?.secondary ? `Main file (${r.placement.label})` : 'Exported file', width: sz.effW, suffix: '' },
    ]
    if (preset?.secondary) {
      jobs.push({
        label: `Second file (${getPlacement(preset.secondary.placement).label})`,
        width: sizeFromWidth(getPlacement(preset.secondary.placement), preset.secondary.widthIn, sz.aspect).w,
        suffix: `_${preset.secondary.placement}`,
      })
    }
    const runSettings = structuredClone(settings)
    setExp((p) => ({ ...p, status: 'running', stage: 'Starting', fraction: 0, message: null }))
    void (async () => {
      const results: ExportedDesign[] = []
      try {
        for (let i = 0; i < jobs.length; i++) {
          const job = jobs[i]
          const res = await client.run(
            'export',
            { settings: runSettings, garmentHex: r.colorHex, printWidthIn: job.width, upscale: upscaler },
            (stage, f) => setExp((p) => ({ ...p, stage: jobs.length > 1 ? `File ${i + 1} of ${jobs.length}: ${stage}` : stage, fraction: (i + f) / jobs.length })),
          )
          if (!res.png) throw new Error('The export finished without a PNG.')
          const fileName = exportFileName(res.report.widthIn, res.report.heightIn, job.suffix)
          const blob = new Blob([res.png as Uint8Array<ArrayBuffer>], { type: 'image/png' })
          triggerDownload(blob, fileName)
          results.push({
            id: fileName,
            fileName,
            label: job.label,
            widthPx: res.report.widthPx,
            heightPx: res.report.heightPx,
            widthIn: res.report.widthIn,
            heightIn: res.report.heightIn,
            upscaledWith: res.upscaledWith,
            report: res.report,
            image: res.image,
            pngUrl: URL.createObjectURL(blob),
            settings: runSettings,
          })
        }
        for (const d of resultsRef.current) URL.revokeObjectURL(d.pngUrl)
        setExp({
          status: 'done',
          stage: '',
          fraction: 1,
          message: `Exported ${results.map((d) => `${d.fileName} (${d.widthPx} × ${d.heightPx} px)`).join(' and ')}`,
          results,
        })
        setGang((g) => [...g.filter((x) => !results.some((n) => n.id === x.id)), ...results])
      } catch (e) {
        for (const d of results) URL.revokeObjectURL(d.pngUrl)
        const msg = e instanceof Error ? e.message : String(e)
        setExp((p) =>
          msg === 'Cancelled'
            ? { ...p, status: 'idle', message: 'Export cancelled.' }
            : { ...p, status: 'error', message: msg },
        )
      }
    })()
  }, [client, source, preset, r, sz.effW, sz.aspect, settings, upscaler])

  const cancelExport = useCallback(() => {
    client.cancel('export')
    setWarmNonce((n) => n + 1)
  }, [client])
  const addThicken = useCallback(() => update((s) => void (s.thicken = true)), [update])
  const removeGang = useCallback((id: string) => setGang((g) => g.filter((d) => d.id !== id)), [])

  const studio: Studio = {
    client,
    source,
    loading,
    loadError,
    loadFile,
    look,
    setLook,
    preset,
    applyPreset,
    applyLook,
    undoLook,
    lookResult,
    settings,
    update,
    r,
    custom,
    setCustom,
    pick,
    setWidth,
    resetWidth,
    sz,
    finish: finishOverride ?? preset?.mockupFinish ?? r.finish,
    upscaler,
    setUpscaler,
    vectorOk,
    model,
    preview,
    showGarment,
    setShowGarment,
    exp,
    gang,
    removeGang,
    runExport,
    cancelExport,
    addThicken,
  }

  return (
    <StudioContext.Provider value={studio}>
      <div className="app">
        <header className="top">
          <h1>DTF Prep</h1>
          <p className="tag">Artwork in. Print-ready transfer out. Not a block sticker.</p>
          <p className="flow">Upload your art, describe the look you want, and the app sets everything up and explains it. Then check the garment, size and fine-tuning. Steps: 1 Upload, 2 Describe the look, 3 Garment, 4 Placement &amp; size, 5 Knock out (fine-tune), 6 Upscale, 7 Export.</p>
        </header>
        <main className="layout">
          <div className="controls">
            <HelpPanel />
            <UploadSection />
            <LookSection />
            <GarmentSection />
            <PlacementSection />
            <KnockoutSection />
            <UpscaleSection />
            <ExportSection />
          </div>
          <div className="side-wrap">
            <SidePanel />
          </div>
        </main>
        <footer className="foot">
          <p>Everything runs in your browser; nothing is uploaded. Prices and store data verified 2026-11-03: re-check before ordering.</p>
        </footer>
      </div>
    </StudioContext.Provider>
  )
}
