import { describe, it, expect } from 'vitest'
import { createImage, fillRect } from './core'
import { applyDistress, generateMask, MASK_LABELS } from './masks'
import type { MaskKind } from '../types'

const kinds: MaskKind[] = ['scratched', 'cracked', 'speckle', 'sandblasted']
const N = 256

function meanDiff(f: Uint8Array, n: number, wrap: boolean): number {
  let s = 0
  let c = 0
  // horizontal neighbours
  for (let y = 0; y < n; y++) {
    if (wrap) {
      s += Math.abs(f[y * n + n - 1] - f[y * n])
      c++
    } else {
      for (let x = 0; x < n - 1; x++) {
        s += Math.abs(f[y * n + x] - f[y * n + x + 1])
        c++
      }
    }
  }
  // vertical neighbours
  for (let x = 0; x < n; x++) {
    if (wrap) {
      s += Math.abs(f[(n - 1) * n + x] - f[x])
      c++
    } else {
      for (let y = 0; y < n - 1; y++) {
        s += Math.abs(f[y * n + x] - f[(y + 1) * n + x])
        c++
      }
    }
  }
  return s / c
}

function removedFraction(field: Uint8Array, size: number, intensity: number) {
  const img = createImage(size, size)
  fillRect(img, 0, 0, size, size, [0, 0, 0, 255])
  const { removed } = applyDistress(img, field, size, intensity, size)
  for (let i = 3; i < img.data.length; i += 4) expect([0, 255]).toContain(img.data[i])
  return removed / (size * size)
}

describe('masks', () => {
  for (const kind of kinds) {
    describe(kind, () => {
      const field = generateMask(kind, N, 3)
      it('has a label and right size', () => {
        expect(MASK_LABELS[kind].length).toBeGreaterThan(0)
        expect(field.length).toBe(N * N)
      })
      it('tiles seamlessly', () => {
        const inside = meanDiff(field, N, false)
        const edge = meanDiff(field, N, true)
        expect(edge).toBeLessThan(inside * 1.6 + 2)
      })
      it('is deterministic per seed and differs across seeds', () => {
        expect(Array.from(generateMask(kind, 128, 5))).toEqual(Array.from(generateMask(kind, 128, 5)))
        expect(Array.from(generateMask(kind, 128, 5))).not.toEqual(Array.from(generateMask(kind, 128, 6)))
      })
      it('removed fraction grows with intensity, capped near 0.6', () => {
        const f = [0.1, 0.3, 0.6, 1].map((i) => removedFraction(field, N, i))
        for (let i = 1; i < f.length; i++) expect(f[i]).toBeGreaterThan(f[i - 1])
        expect(f[3]).toBeLessThanOrEqual(0.65)
        expect(f[3]).toBeGreaterThan(0.5)
        expect(f[0]).toBeGreaterThan(0.03)
        expect(removedFraction(field, N, 0)).toBe(0)
      })
      it('marks grow rather than move', () => {
        const a = removedFraction(field, N, 0.3)
        const img1 = createImage(N, N)
        const img2 = createImage(N, N)
        fillRect(img1, 0, 0, N, N, [0, 0, 0, 255])
        fillRect(img2, 0, 0, N, N, [0, 0, 0, 255])
        applyDistress(img1, field, N, 0.3, N)
        applyDistress(img2, field, N, 0.6, N)
        for (let i = 3; i < img1.data.length; i += 4) if (img1.data[i] === 0) expect(img2.data[i]).toBe(0)
        expect(a).toBeGreaterThan(0)
      })
    })
  }
})
