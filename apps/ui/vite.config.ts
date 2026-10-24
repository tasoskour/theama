import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

export default defineConfig({
  // Relative base so the bundle works under the app:// protocol in Electron.
  base: './',
  plugins: [vue(), vuetify({ autoImport: true })],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { host: 'localhost', port: 5173, strictPort: true },
  // The three.js chunk (~525 kB) is only fetched in the optional immersive mode, so it is exempt from the size warning.
  build: { target: 'chrome140', sourcemap: false, chunkSizeWarningLimit: 600 },
})
