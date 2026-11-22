import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// معرّف النسخة: بيتغير مع كل commit على Vercel أو GitHub Actions
const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  `local-${Date.now()}`
const BUILT_AT = new Date().toISOString()

// بيكتب dist/version.json عشان التطبيق يعرف إن فيه نسخة أحدث ويقترح التحديث
function versionManifestPlugin(): Plugin {
  let outDir = 'dist'
  return {
    name: 'phantoms-version-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const dir = resolve(process.cwd(), outDir)
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        resolve(dir, 'version.json'),
        `${JSON.stringify({ buildId: BUILD_ID, builtAt: BUILT_AT }, null, 2)}\n`,
        'utf8',
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __PHANTOMS_BUILD_ID__: JSON.stringify(BUILD_ID),
    __PHANTOMS_BUILT_AT__: JSON.stringify(BUILT_AT),
  },
  plugins: [react(), tailwindcss(), versionManifestPlugin(), VitePWA({
    strategies: 'injectManifest',
    srcDir: 'src',
    filename: 'sw.ts',
    registerType: 'autoUpdate',
    includeAssets: ['branding/phantoms-mark.png', 'icons/icon-192.png', 'icons/icon-512.png', 'favicon.ico', 'favicon.png'],
    manifest: false,
    injectManifest: {
      maximumFileSizeToCacheInBytes: 3000000,
      // version.json لازم يفضل من الشبكة دايماً عشان مانعلّقش على نسخة قديمة
      globIgnores: ['**/version.json'],
    },
    devOptions: {
      enabled: true,
      type: 'module',
    }
  })],
})
