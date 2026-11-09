import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA({
    strategies: 'injectManifest',
    srcDir: 'src',
    filename: 'sw.ts',
    registerType: 'autoUpdate',
    includeAssets: ['branding/phantoms-mark.png', 'icons/icon-192.png', 'icons/icon-512.png', 'favicon.ico', 'favicon.png'],
    manifest: false,
    injectManifest: {
      maximumFileSizeToCacheInBytes: 3000000,
    },
    devOptions: {
      enabled: true,
      type: 'module',
    }
  })],
})
