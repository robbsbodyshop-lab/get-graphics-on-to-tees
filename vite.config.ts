import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/** Lists every emitted file so public/sw.js can precache the whole app (offline after first load). */
function precacheManifest(): Plugin {
  return {
    name: 'precache-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'))
      this.emitFile({ type: 'asset', fileName: 'precache-manifest.json', source: JSON.stringify(files) })
    },
  }
}

// Cross-origin isolation lets onnxruntime-web use multiple threads. Vercel gets the same headers
// from vercel.json; on GitHub Pages public/sw.js adds them after the first load.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  // Relative base so the build works at any path (GitHub Pages project sites, Vercel root).
  base: './',
  plugins: [react(), precacheManifest()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  server: { headers: isolation },
  preview: { headers: isolation },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
})
