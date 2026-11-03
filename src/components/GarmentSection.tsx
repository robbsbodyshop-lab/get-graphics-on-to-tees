import type { ReactElement } from 'react'
import { Section, Select, Swatch } from './ui'
import { CUSTOM_STORE, GARMENT_TYPES, SIZES_BY_CLASS, STORES, colorByName, garmentOptionText, useStudio } from './studio'

export function GarmentSection(): ReactElement {
  const { r, custom, setCustom, pick } = useStudio()
  const isCustom = r.sel.storeId === CUSTOM_STORE
  return (
    <Section id="garment" num={3} title="Garment" lead="The garment color drives the mockup and the default knockout color.">
      <Select label="Store" value={r.sel.storeId} onChange={(v) => pick({ storeId: v })}>
        {STORES.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
        <option value={CUSTOM_STORE}>Custom garment…</option>
      </Select>
      {r.store && (
        <p className="muted small">
          {r.store.address ? `${r.store.address}. ` : ''}
          {r.store.notes} Store data verified {r.store.verified}; stock changes, confirm in store.
        </p>
      )}
      {!isCustom && r.store && (
        <>
          <Select label="Garment" value={r.sel.garmentId} onChange={(v) => pick({ garmentId: v })}>
            {r.store.garments.map((g) => (
              <option key={g.id} value={g.id}>{garmentOptionText(g)}</option>
            ))}
          </Select>
          {r.garment.notes && <p className="muted small">{r.garment.notes}</p>}
          <div className="row">
            <Select label="Color" value={r.sel.color} onChange={(v) => pick({ color: v }, false)}>
              {r.garment.colors.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
            <Swatch hex={colorByName(r.sel.color).hex} label={`Garment color ${r.sel.color}, ${colorByName(r.sel.color).hex}`} />
          </div>
        </>
      )}
      {isCustom && (
        <>
          <div className="field">
            <label htmlFor="cg-desc">Garment description</label>
            <input id="cg-desc" type="text" value={custom.desc} onChange={(e) => setCustom({ desc: e.target.value })} />
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="cg-color">Garment color</label>
              <input id="cg-color" type="color" value={custom.colorHex} onChange={(e) => setCustom({ colorHex: e.target.value })} />
            </div>
            <span className="muted small">{custom.colorHex}</span>
          </div>
          <Select label="Garment type" value={custom.type} onChange={(v) => setCustom({ type: v as typeof custom.type })}>
            {GARMENT_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </Select>
          <Select label="Size class" value={custom.sizeClass} onChange={(v) => setCustom({ sizeClass: v as typeof custom.sizeClass })}>
            <option value="adult">Adult</option>
            <option value="youth">Youth</option>
            <option value="toddler">Toddler</option>
          </Select>
        </>
      )}
      <Select label="Size" value={r.sel.size} onChange={(v) => pick({ size: v })}>
        {(isCustom ? SIZES_BY_CLASS[custom.sizeClass] : r.garment.sizes).map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </Select>
    </Section>
  )
}
