// IPC の唯一の登録口。renderer から届くすべての呼び出しに、送信元の frame の検査を掛ける。
//
// preload は main window の main frame にだけ載るので、正当な送信元は同梱の画面（開発時は dev サーバー）だけ。
// 判定の規則は遷移ガードと同じ `isAllowedNavigationUrl` を使い、許可の集合を 2 つに分けない。
// origin は data: や about:blank で文字列の 'null' になるので、URL で判定する。
//
// electron/ の中で ipcMain に直接触ってよいのはこのファイルだけ。新しい channel も `ipc` で登録する。
import { app, ipcMain, type IpcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { isAllowedNavigationUrl } from '../navigation-guard';

const UNTRUSTED_SENDER = 'IPC call from an untrusted frame';

export interface IpcRegistryDeps {
  ipcMain: Pick<IpcMain, 'handle' | 'on' | 'removeHandler' | 'removeAllListeners'>;
  /** 開発時の dev サーバーの URL。製品では null（この origin を増やさない） */
  devServerUrl?: string | null;
  warn: (...args: unknown[]) => void;
}

/** 検査が見る frame の形。破棄された frame の `url` は参照だけで例外になることがある */
type SenderFrame = { url: string } | null | undefined;

export function isTrustedSender(frame: SenderFrame, devServerUrl?: string | null): boolean {
  if (!frame) return false;
  let url: string;
  try {
    url = frame.url;
  } catch {
    return false;
  }
  return isAllowedNavigationUrl(url, devServerUrl);
}

function describeSender(frame: SenderFrame): string {
  try {
    return frame?.url ?? 'null';
  } catch {
    return 'disposed';
  }
}

export function createIpcRegistry(deps: IpcRegistryDeps) {
  const rejected = (channel: string, frame: SenderFrame) => {
    deps.warn(`[ipc] rejected ${channel} from ${describeSender(frame)}`);
  };
  return {
    /** ipcMain.handle と同じ形。登録の直前に解除するので、HMR で読み直されても二重登録にならない */
    handle(channel: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
      deps.ipcMain.removeHandler(channel);
      deps.ipcMain.handle(channel, (event, ...args) => {
        if (!isTrustedSender(event.senderFrame, deps.devServerUrl)) {
          rejected(channel, event.senderFrame);
          throw new Error(UNTRUSTED_SENDER);
        }
        return handler(event, ...args);
      });
    },
    /**
     * ipcMain.on と同じ形。相手は sendSync で待っているので、拒否でも例外でも必ず returnValue を書く
     * （書かないと renderer が固まる）。
     */
    on(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void): void {
      deps.ipcMain.removeAllListeners(channel);
      deps.ipcMain.on(channel, (event, ...args) => {
        try {
          if (!isTrustedSender(event.senderFrame, deps.devServerUrl)) {
            rejected(channel, event.senderFrame);
            event.returnValue = { ok: false, error: UNTRUSTED_SENDER };
            return;
          }
          listener(event, ...args);
        } catch (e) {
          event.returnValue = { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      });
    },
  };
}

/** 製品では環境変数から dev の origin を増やさない。権限の判定も同じ値を使う */
export const trustedDevServerUrl: string | null = app.isPackaged ? null : (process.env['VITE_DEV_SERVER_URL'] ?? null);

export const ipc = createIpcRegistry({ ipcMain, devServerUrl: trustedDevServerUrl, warn: console.warn });
