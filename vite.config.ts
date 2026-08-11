import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import vue from '@vitejs/plugin-vue'

import { nodePolyfills } from 'vite-plugin-node-polyfills'

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
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              // m19-t5: @jsquash/webp は 'jimp' と同型で external にする。バンドルすると
              // wasm を import.meta.url 基準で解決できなくなるため、実 node_modules から解決させる。
              external: ['node:sqlite', 'jimp', '@jsquash/webp', 'pwa-asset-generator', '@duckdb/node-api', '@duckdb/node-bindings', /^@duckdb\/node-bindings-.*/],
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
