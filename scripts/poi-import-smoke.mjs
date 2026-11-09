// POI の一括入出力の結線・文言の静的検査。
// - 新しい IPC が ipc.handle で登録され runGuarded で包まれ、preload・型・ハンドラでチャネル名が揃う
// - 書き出しの IPC は renderer からパスを受け取らない
// - 文言: poiio の節に、データを指す名詞の「設定」相当の語が無い (11 言語の語で検査)
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const read = (rel) => readFile(path.join(projectRoot, rel), 'utf8');

const ipcSrc = await read('electron/ipc/poisource.ts');
const preloadSrc = await read('electron/preload.ts');
const typesSrc = await read('src/electron.d.ts');
const guardSrc = await read('scripts/oct26-m4-t2-ipc-guard-smoke.mjs');

// --- (a) ipc.handle 登録 + runGuarded + ガード smoke の列挙 ---
{
  assert.match(ipcSrc, /ipc\.handle\(\s*'poisource:exportTable'/, 'poisource:exportTable が ipc.handle で登録されていない');
  assert.match(ipcSrc, /runGuarded\(\s*'poisource:exportTable'/, 'poisource:exportTable が runGuarded で包まれていない');
  assert.match(guardSrc, /"poisource:exportTable"/, 'ipc-guard smoke の列挙に poisource:exportTable がない');
  console.log('  case a (ipc.handle・runGuarded・列挙): PASS');
}

// --- (b) チャネル名が preload・型・ハンドラで一致 ---
{
  assert.match(preloadSrc, /exportTable:\s*\(uid: string, format: 'csv' \| 'json'\)\s*=>\s*ipcRenderer\.invoke\('poisource:exportTable', uid, format\)/);
  assert.match(typesSrc, /exportTable\(uid: string, format: 'csv' \| 'json'\): Promise<PoiExportTableResult>/);
  console.log('  case b (3 か所でチャネル名・引数が一致): PASS');
}

// --- (c) 書き出しの IPC はパスを受け取らず、保存先は保存ダイアログの返値だけ ---
{
  const sig = typesSrc.match(/exportTable\(([^)]*)\)/);
  assert.ok(sig, 'exportTable の型がない');
  assert.doesNotMatch(sig[1], /path|file/i, 'exportTable の引数にパスがある');
  const handler = ipcSrc.slice(ipcSrc.indexOf("'poisource:exportTable'"));
  assert.match(handler.slice(0, 1200), /\(event, uid, format\)/, 'ハンドラの引数は (event, uid, format) だけ');
  assert.match(handler.slice(0, 1600), /showSaveDialog/, '保存先を保存ダイアログから得ていない');
  console.log('  case c (パスを受け取らない): PASS');
}

// --- (e) 文言: poiio の節に「設定」相当の語が無い ---
{
  const WORDS = {
    ja: ['設定'], en: ['setting'], de: ['einstellung'], fr: ['paramètre', 'réglage'],
    es: ['configuración', 'ajuste'], ko: ['설정'], zh: ['设置'], 'zh-TW': ['設定', '設置'],
    vi: ['cài đặt'], th: ['ตั้งค่า'], id: ['pengaturan'],
  };
  for (const [lang, words] of Object.entries(WORDS)) {
    const json = JSON.parse(await read(`public/locales/${lang}/translation.json`));
    assert.ok(json.poiio && Object.keys(json.poiio).length > 0, `${lang}: poiio がない`);
    const text = JSON.stringify(json.poiio).toLowerCase();
    for (const w of words) assert.ok(!text.includes(w.toLowerCase()), `${lang}: poiio に「${w}」が含まれる`);
  }
  console.log('  case e (poiio に「設定」相当の語が無い・11 言語): PASS');
}

console.log('poi-import smoke: PASS');
