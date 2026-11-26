'use strict';
// e2e の Electron が前面に出てフォーカスを奪わないようにする、試験側だけの差し込み。
//
// Playwright の設定（playwright.config.ts）が NODE_OPTIONS の --require でこのファイルを
// 全プロセスへ読み込ませる。Playwright は Electron 起動時の env から NODE_OPTIONS を
// 消すため、Electron の main へは起動引数の -r（Playwright 自身が loader.js を入れるのと
// 同じ手段）で届ける。窓への働きかけは MAPLAT_E2E_ROOT の付いた起動（e2e）だけで行い、
// MAPLAT_E2E_FOCUS=1 で従来どおり（前面に出る）に戻る。
//
// Electron の main でやること（macOS）:
//   - app.setActivationPolicy('accessory') … Dock に出さず、起動による前面化をしない
//   - BrowserWindow#show() を showInactive() に寄せる … 表示はするがキーウィンドウにしない
//   - BrowserWindow#focus() を無効化 … 前面化・フォーカス奪取を止める（focusable は変えない）
//   - 生成時の show: true も表示は同じまま showInactive() に寄せる
//     （show() メソッドを介さず生成時に前面化する経路を塞ぐ。electron モジュールの
//     BrowserWindow は差し替えられないため、require('electron') の戻りを包んで届ける）
// やらないこと:
//   - 窓の表示/非表示の既定の挙動を変えない（e2e の生成時非表示もそのまま。描画は今までどおり）
//
// MAPLAT_E2E_NO_FOCUS_MARKER にファイルパスを渡すと、当たったことをそのファイルへ書く（実測用）。

if (process.env.MAPLAT_E2E_FOCUS === '1') return;
if (process.platform !== 'darwin') return;

const NODE_SIDE = !process.versions || !process.versions.electron;

if (NODE_SIDE) {
  // Playwright の worker（Node）: 全 electron.launch へ -r <このファイル> を差し込む。
  // worker の env に MAPLAT_E2E_ROOT は無いので、この段ではそれを求めない
  try {
    const playwright = require('@playwright/test');
    const electronApi = playwright && playwright._electron;
    if (electronApi && typeof electronApi.launch === 'function' && !electronApi.launch.__maplatNoFocus) {
      const originalLaunch = electronApi.launch;
      const wrapped = function launch(options = {}) {
        const args = Array.isArray(options.args) ? options.args : [];
        const withRequire = args[0] === '-r' && args[1] === __filename;
        return originalLaunch.call(electronApi, withRequire ? options : { ...options, args: ['-r', __filename, ...args] });
      };
      wrapped.__maplatNoFocus = true;
      electronApi.launch = wrapped;
    }
  } catch {
    // Playwright 以外の Node プロセスでは何もしない
  }
  return;
}

if (!process.env.MAPLAT_E2E_ROOT) return;
if (process.type !== 'browser') return;

const Module = require('module');

function markApplied(note) {
  const marker = process.env.MAPLAT_E2E_NO_FOCUS_MARKER;
  if (!marker) return;
  try {
    require('fs').appendFileSync(marker, `applied ${note} ${new Date().toISOString()}\n`);
  } catch {
    // 記録に失敗しても試験には関与させない
  }
}

let noFocusClass = null;
let proxyExports = null;

function ensurePatch(api) {
  if (!api || typeof api !== 'object' || !api.app || !api.BrowserWindow) return null;
  if (!api.BrowserWindow.prototype.__maplatNoFocus) {
    const OriginalBrowserWindow = api.BrowserWindow;
    if (typeof api.app.setActivationPolicy === 'function') {
      api.app.setActivationPolicy('accessory');
    }
    OriginalBrowserWindow.prototype.show = function show() {
      this.showInactive();
    };
    OriginalBrowserWindow.prototype.focus = function focus() {
      // 前面化・フォーカス奪取を止めるだけ（表示状態は変えない）
    };
    OriginalBrowserWindow.prototype.__maplatNoFocus = true;
    class NoFocusBrowserWindow extends OriginalBrowserWindow {
      constructor(rawOptions) {
        const options = rawOptions ?? {};
        const showAtCreation = options.show !== false;
        super(showAtCreation ? { ...options, show: false } : options);
        if (showAtCreation) this.showInactive();
      }
    }
    noFocusClass = NoFocusBrowserWindow;
  }
  if (!proxyExports) {
    proxyExports = new Proxy(api, {
      get(target, property) {
        if (property === 'BrowserWindow') return noFocusClass || target.BrowserWindow;
        return target[property];
      },
    });
  }
  return proxyExports;
}

const immediate = ensurePatch(require('electron'));
markApplied(immediate ? 'immediate' : 'deferred');

// electron モジュールの BrowserWindow は差し替えられないので、
// require('electron') の戻りを包んで差し替えクラスを見せる。
// Playwright は main で require('electron') を評価して評価用の electron を組み立てるため、
// evalMain 経由で作る BrowserWindow もここを通して当たる
const originalLoad = Module._load;
Module._load = function load(request) {
  const result = originalLoad.apply(this, arguments);
  if (request === 'electron') return ensurePatch(result) || result;
  return result;
};
