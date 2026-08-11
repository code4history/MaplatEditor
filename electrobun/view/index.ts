import { Electroview } from 'electrobun/view';
import type { M2ElectrobunRPC } from '../shared/rpc';

const resultEl = document.getElementById('result');

const rpc = Electroview.defineRPC<M2ElectrobunRPC>({
  maxRequestTime: 5000,
  handlers: {
    requests: {
      reportLoaded: () => ({
        href: window.location.href,
        title: document.title,
      }),
    },
    messages: {
      smokeResult: ({ ok, details }) => {
        if (resultEl) {
          resultEl.textContent = `${ok ? 'OK' : 'NG'}\n${details}`;
        }
      },
    },
  },
});

new Electroview({ rpc });

async function runSmoke() {
  const ping = await rpc.request.ping({ message: 'm2-electrobun-webview' });
  const saved = await rpc.request.storageSaveMock({
    record: {
      mapID: 'm2-electrobun-webview',
      title: 'M2 Electrobun WebView Map',
      payload: {
        source: 'webview',
      },
    },
  });
  const loaded = await rpc.request.storageReadMock({ mapID: saved.mapID });
  const file = await rpc.request.writeTextFile({
    relativePath: 'webview/rpc.txt',
    text: 'M2 typed RPC local file access passed',
  });
  const readBack = await rpc.request.readTextFile({ relativePath: 'webview/rpc.txt' });
  const viteArtifact = await rpc.request.statViteArtifact();

  const details = JSON.stringify(
    {
      ping,
      saved,
      loadedTitle: loaded?.title,
      filePath: file.path,
      readBack: readBack.text,
      viteArtifact,
    },
    null,
    2,
  );

  if (resultEl) {
    resultEl.textContent = details;
  }
  rpc.send.viewReady({ href: window.location.href });
}

runSmoke().catch((error) => {
  if (resultEl) {
    resultEl.textContent = String(error instanceof Error ? error.stack : error);
  }
});
