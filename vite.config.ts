import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  css: {
    preprocessorOptions: {
      scss: {
        silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'if-function'],
      },
    },
  },
  plugins: [
    vue(),
    electron({
      main: {
        entry: {
          main: 'electron/main.ts',
          crsEstimationProcess: 'electron/workers/crsEstimationProcess.ts',
        },
        vite: {
          build: {
            rollupOptions: {
              output: { entryFileNames: '[name].js' },
              // @jsquash/webp は 'jimp' と同型で external にする。バンドルすると
              // wasm を import.meta.url 基準で解決できなくなるため、実 node_modules から解決させる。
              // electron-updater は実行時に動的 require（NsisUpdater・MacUpdater 等）をするので bundle しない
              // jimp/fonts は jimp と同じ理由で external にする（フォントのファイルを import.meta.url 基準で探すため）
              external: [
                'node:sqlite', 'jimp', 'jimp/fonts', '@jsquash/webp', 'pwa-asset-generator', 'electron-updater',
                '@c4h/atlas', '@c4h/teiresias', '@c4h/daedalus', 'proj-wasm', '@maplat/transform',
              ],
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
      }
    }),
  ],
  resolve: {
    alias: [
      { find: '@maplat/core/src', replacement: path.resolve(__dirname, 'node_modules/@maplat/core/src') },
      { find: 'i18next-http-backend', replacement: path.resolve(__dirname, 'node_modules/i18next-http-backend/esm/index.js') },
      { find: 'cross-fetch', replacement: path.resolve(__dirname, 'src/utils/cross-fetch-sham.ts') },
    ]
  }
})
