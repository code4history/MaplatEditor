import { BrowserView, BrowserWindow, app } from 'electrobun/bun';
import type { M2ElectrobunRPC } from '../shared/rpc';
import { readM2TextFile, writeM2TextFile, getM2ViteArtifactStatus } from './local-file-access';
import { M2MockStorageAdapter } from './mock-storage-adapter';

const storage = new M2MockStorageAdapter();

const rpc = BrowserView.defineRPC<M2ElectrobunRPC>({
  maxRequestTime: 5000,
  handlers: {
    requests: {
      ping: ({ message }) => ({ message, runtime: 'bun' }),
      storageSaveMock: ({ record }) => storage.save(record),
      storageReadMock: ({ mapID }) => storage.read(mapID),
      writeTextFile: async ({ relativePath, text }) => ({
        ok: true,
        path: await writeM2TextFile(relativePath, text),
      }),
      readTextFile: ({ relativePath }) => readM2TextFile(relativePath),
      statViteArtifact: () => getM2ViteArtifactStatus(),
    },
    messages: {
      viewReady: ({ href }) => {
        console.log(`[m2-electrobun] view ready: ${href}`);
      },
    },
  },
});

const url =
  process.env.MAPLAT_ELECTROBUN_LOAD_APP === '1'
    ? 'views://maplat-editor/index.html'
    : 'views://mainview/index.html';

new BrowserWindow({
  title: 'Maplat Editor M2 Electrobun PoC',
  url,
  frame: {
    x: 80,
    y: 80,
    width: 1120,
    height: 760,
  },
  rpc,
});

app.on('close', () => {
  app.quit();
});
