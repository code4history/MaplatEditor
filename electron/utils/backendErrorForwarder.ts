import { BrowserWindow } from 'electron';
import { failAllInflight } from './inflightGuard';

// バックエンド(メインプロセス)のエラー/警告をレンダラのDevToolsコンソールへ
// 転送する (#18)。メイン側のログはターミナルにしか出ず、開発時に見落とされる
// ため、console.error/warn と uncaughtException / unhandledRejection を
// 全ウィンドウへブロードキャストする。

export type BackendLogPayload = {
  level: 'error' | 'warn';
  message: string;
  timestamp: string;
};

let installed = false;
let broadcasting = false;

function serialize(value: unknown): string {
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function broadcast(level: BackendLogPayload['level'], args: unknown[], original: (...a: unknown[]) => void) {
  // send中に発生したエラーを再転送して無限ループしないようガードする
  if (broadcasting) return;
  broadcasting = true;
  try {
    const payload: BackendLogPayload = {
      level,
      message: args.map(serialize).join(' '),
      timestamp: new Date().toISOString(),
    };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send('backend:log', payload);
      }
    }
  } catch (e) {
    original('[backendErrorForwarder] failed to forward log', e);
  } finally {
    broadcasting = false;
  }
}

export function installBackendErrorForwarding() {
  if (installed) return;
  installed = true;

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  console.error = (...args: unknown[]) => {
    originalError(...args);
    broadcast('error', args, originalError);
  };
  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    broadcast('warn', args, originalError);
  };

  process.on('uncaughtException', (err) => {
    failAllInflight(err); // t1: 実行中の appedit:export を settle させる（設計書 §4.5。unhandledRejection には結線しない）
    originalError('[uncaughtException]', err);
    broadcast('error', ['[uncaughtException]', err], originalError);
  });
  process.on('unhandledRejection', (reason) => {
    originalError('[unhandledRejection]', reason);
    broadcast('error', ['[unhandledRejection]', reason], originalError);
  });
}
