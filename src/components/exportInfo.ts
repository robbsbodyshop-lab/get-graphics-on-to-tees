import { useEffect, useState } from 'react'
import { readPngInfo } from '../lib/png'
import type { JobSheetExportCheck } from '../lib/jobSheet'
import type { ExportedDesign } from './studio'

/** Reads the exported PNG's bytes and reports whether it embeds an sRGB ICC profile (null while loading). */
export function useIccName(pngUrl: string | undefined): string | null | undefined {
  const [state, setState] = useState<{ url: string; name: string | null } | null>(null)
  useEffect(() => {
    if (!pngUrl) return
    let live = true
    fetch(pngUrl)
      .then((r) => r.arrayBuffer())
      .then((b) => {
        if (live) setState({ url: pngUrl, name: readPngInfo(new Uint8Array(b))?.iccProfileName ?? null })
      })
      .catch(() => {
        if (live) setState({ url: pngUrl, name: null })
      })
    return () => {
      live = false
    }
  }, [pngUrl])
  if (!pngUrl || state?.url !== pngUrl) return undefined
  return state.name
}

export function jobSheetExportCheck(d: ExportedDesign | undefined, icc: string | null | undefined): JobSheetExportCheck | undefined {
  if (!d || icc === undefined) return undefined
  const c = d.report.check
  return {
    partial: c.partial,
    clearPct: c.clearFraction * 100,
    solidPct: c.solidFraction * 100,
    hiddenColor: c.hiddenColor,
    iccSrgb: icc !== null && /srgb/i.test(icc),
    garmentClosePct: c.garmentClose * 100,
  }
}
