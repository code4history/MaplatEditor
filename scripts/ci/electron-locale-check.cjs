// oct26-m4-t5（#121・マージ判断 追補 1）: Electron の app.getLocale() が期待の言語か。違えば exit 1
// CI の e2e job で Playwright の前に実行する。手元の e2e 測定でも各シャードの直前に実行する
// macOS の Electron は bundle に含まれる localization（Electron.app の *.lproj）と AppleLanguages の preference から言語を選ぶ。
// .lproj が欠けていても NG になる
const { app } = require('electron');
const want = process.env.EXPECT_LOCALE || 'ja';
app.whenReady().then(() => {
  const loc = app.getLocale();
  const ok = loc === want || loc.startsWith(`${want}-`);
  console.log(`app.getLocale()=${loc} preferred=${JSON.stringify(app.getPreferredSystemLanguages())} expect=${want} -> ${ok ? 'OK' : 'NG'}`);
  app.exit(ok ? 0 : 1);
});
