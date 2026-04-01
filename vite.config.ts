import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import vue from '@vitejs/plugin-vue'

import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    vue(),
    electron({
      main: {
        entry: 'electron/main.ts',
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
