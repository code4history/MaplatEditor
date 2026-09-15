// oct26-m4-t5（#121・マージ判断 追補 1）: Electron の app.getLocale() が期待の言語か。違えば exit 1
// CI の e2e job で Playwright の前に実行する。手元の e2e 測定でも各シャードの直前に実行する
// macOS の Electron は bundle に含まれる localization（Electron.app の *.lproj）と AppleLanguages の preference から言語を選ぶ。
// .lproj が欠けていても NG になる
// 追補 2: macOS では Electron.app の Resources 直下の *.lproj の数を lproj=<n> として出し、0 個なら getLocale に依らず NG にする
// （pnpm の side-effects cache は空ディレクトリの .lproj を記録しないので、キャッシュから復元した Electron.app では 0 個になる）
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const want = process.env.EXPECT_LOCALE || 'ja';

function countLproj() {
  if (process.platform !== 'darwin') return null;
  const resources = path.resolve(path.dirname(process.execPath), '..', 'Resources');
  try {
    return fs.readdirSync(resources, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.endsWith('.lproj')).length;
  } catch {
    return 0;
  }
}

app.whenReady().then(() => {
  const loc = app.getLocale();
  const lproj = countLproj();
  const localeOk = loc === want || loc.startsWith(`${want}-`);
  const lprojOk = lproj === null || lproj > 0;
  const ok = localeOk && lprojOk;
  const reason = lprojOk ? '' : '（Electron.app に .lproj が無い（pnpm の side-effects cache から復元された可能性））';
  console.log(`app.getLocale()=${loc} lproj=${lproj === null ? '-' : lproj} preferred=${JSON.stringify(app.getPreferredSystemLanguages())} expect=${want} -> ${ok ? 'OK' : 'NG'}${reason}`);
  app.exit(ok ? 0 : 1);
});
