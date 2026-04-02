/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * ビルド後のディレクトリ構成
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ または /public/ */
    VITE_PUBLIC: string
  }
}

// レンダラープロセスで使用: preload.ts で expose する
interface Window {
  ipcRenderer: import('electron').IpcRenderer
}
