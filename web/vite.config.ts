import { defineConfig } from 'vite'

export default defineConfig({
  // Relative base keeps the built bundle working from any sub-path
  // (GitHub Pages project sites, a CDN folder, or a Capacitor webview).
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    // Sprite sheets are already compressed; re-compressing only costs startup time.
    assetsInlineLimit: 0,
  },
  server: {
    host: true,
    port: 5173,
  },
})
