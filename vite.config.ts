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
    nodePolyfills({
      include: ['path', 'stream', 'util', 'url', 'http', 'https', 'zlib', 'events', 'string_decoder', 'punycode', 'buffer', 'assert', 'process', 'timers', 'fs', 'net', 'tls', 'child_process', 'crypto'],
      globals: {
        process: true,
        Buffer: true,
        global: true,
      },
      protocolImports: true,
    }),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: process.env.NODE_ENV === 'test'
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        ? undefined
        : {},
    }),
  ],
  resolve: {
    alias: [
      { find: '@maplat/core/src', replacement: path.resolve(__dirname, 'node_modules/@maplat/core/src') },
      { find: 'i18next-http-backend', replacement: path.resolve(__dirname, 'node_modules/i18next-http-backend/esm/index.js') },
      { find: 'cross-fetch', replacement: path.resolve(__dirname, 'src/utils/cross-fetch-sham.ts') },
    ]
  },
  // ol-geocoder は UMD のみ提供（ESM なし）のため、CJS → ESM 変換を明示的に有効化
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
    }
  }
})
