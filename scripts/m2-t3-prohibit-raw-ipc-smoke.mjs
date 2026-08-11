import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const workDir = await mkdtemp(path.join(tmpdir(), 'maplat-editor-m2-t3-'));

try {
  // --- Part 1: preload.ts ipcRenderer 暴露撤廃 ---
  const preloadSource = await readFile(
    path.join(projectRoot, 'electron/preload.ts'),
    'utf8'
  );

  // exposeInMainWorld('ipcRenderer', ...) が存在しないことを確認
  assert.doesNotMatch(
    preloadSource,
    /exposeInMainWorld\s*\(\s*['"]ipcRenderer['"]\s*,/,
    'preload.ts に exposeInMainWorld("ipcRenderer", ...) が残存している'
  );

  // window.maplist に onRefresh メソッドが存在することを確認
  assert.match(
    preloadSource,
    /onRefresh\s*\(\s*listener\s*:\s*\(\s*\)\s*=>\s*void\s*\)\s*:\s*\(\s*\)\s*=>\s*void/,
    'preload.ts に onRefresh メソッドがない'
  );

  // ipcRenderer.on('maplist:refresh', wrapper) を呼んでいることを確認
  assert.match(
    preloadSource,
    /ipcRenderer\.on\s*\(\s*['"]maplist:refresh['"]\s*,\s*wrapper\s*\)/,
    'preload.ts が maplist:refresh の ipcRenderer.on を呼んでいない'
  );

  // ipcRenderer.removeListener を呼ぶ unsubscribe 関数を返していることを確認
  assert.match(
    preloadSource,
    /return\s*\(\)\s*=>\s*\{[\s\S]*?ipcRenderer\.removeListener\s*\(\s*['"]maplist:refresh['"]\s*,\s*wrapper\s*\)/,
    'preload.ts が unsubscribe 関数を返していない'
  );

  // window.maplist に汎用 on メソッドが存在しないことを確認
  assert.doesNotMatch(
    preloadSource,
    /exposeInMainWorld\s*\(\s*['"]maplist['"][\s\S]*?\bon\s*\(\s*channel\s*:/,
    'preload.ts の window.maplist に汎用 on メソッドが残存している'
  );

  // window.maplist に汎用 off メソッドが存在しないことを確認
  assert.doesNotMatch(
    preloadSource,
    /exposeInMainWorld\s*\(\s*['"]maplist['"][\s\S]*?\boff\s*\(\s*channel\s*:/,
    'preload.ts の window.maplist に汎用 off メソッドが残存している'
  );

  console.log('  [1/4] preload.ts ipcRenderer 暴露撤廃: PASS');

  // --- Part 2: MapList.vue 移行確認 ---
  const maplistSource = await readFile(
    path.join(projectRoot, 'src/views/MapList.vue'),
    'utf8'
  );

  // MapList.vue が window.maplist.onRefresh を使っていることを確認
  assert.match(
    maplistSource,
    /window\.maplist\.onRefresh\s*\(/,
    'MapList.vue が window.maplist.onRefresh を使っていない'
  );

  // MapList.vue が window.maplist.on('maplist:refresh', ...) を使っていないことを確認
  assert.doesNotMatch(
    maplistSource,
    /window\.maplist\.on\s*\(\s*['"]maplist:refresh['"]/,
    "MapList.vue に旧 window.maplist.on('maplist:refresh', ...) が残存している"
  );

  // @ts-ignore コメントが削除されていることを確認
  assert.doesNotMatch(
    maplistSource,
    /\/\/\s*@ts-ignore/,
    'MapList.vue に @ts-ignore が残存している'
  );

  console.log('  [2/4] MapList.vue 移行確認: PASS');

  // --- Part 3: electron.d.ts 型宣言 ---
  const electronDts = await readFile(
    path.join(projectRoot, 'src/electron.d.ts'),
    'utf8'
  );

  // MapListAPI に onRefresh が定義されていることを確認
  assert.match(
    electronDts,
    /onRefresh\s*\(\s*listener\s*:\s*\(\s*\)\s*=>\s*void\s*\)\s*:\s*\(\s*\)\s*=>\s*void/,
    'MapListAPI に onRefresh がない'
  );

  // MapListAPI に汎用 on が存在しないことを確認
  assert.doesNotMatch(
    electronDts,
    /interface\s+MapListAPI[\s\S]*?\bon\s*\(\s*channel\s*:/,
    'MapListAPI に汎用 on が残存している'
  );

  // MapListAPI に汎用 off が存在しないことを確認
  assert.doesNotMatch(
    electronDts,
    /interface\s+MapListAPI[\s\S]*?\boff\s*\(\s*channel\s*:/,
    'MapListAPI に汎用 off が残存している'
  );

  // Window interface に maplist が含まれていることを確認
  assert.match(
    electronDts,
    /maplist\s*:\s*MapListAPI/,
    'Window interface に maplist がない'
  );

  console.log('  [3/4] electron.d.ts 型宣言: PASS');

  // --- Part 4: electron-env.d.ts 型宣言 ---
  const envDts = await readFile(
    path.join(projectRoot, 'electron/electron-env.d.ts'),
    'utf8'
  );

  // electron-env.d.ts に ipcRenderer 宣言が存在しないことを確認
  assert.doesNotMatch(
    envDts,
    /ipcRenderer/,
    'electron-env.d.ts に ipcRenderer 宣言が残存している'
  );

  console.log('  [4/4] electron-env.d.ts 型宣言: PASS');

  // --- Part 5: i18next 補間の HTML エスケープ無効化 (house rule) ---
  // Vue は自動エスケープするため escapeValue は false が正 (Vue 環境の標準)。
  // true のままだと t() をネイティブダイアログ (showMessageBox) に渡す箇所で
  // エンティティが生表示される (2026-07-12 実機バグ: export 完了パスが &#x2F; 化)。
  // 引き換えに t() の結果を v-html に渡すことは禁止 (XSS 面)
  {
    const i18nSource = await readFile(path.join(projectRoot, 'src/i18n.ts'), 'utf8');
    assert.match(
      i18nSource,
      /interpolation:\s*\{\s*escapeValue:\s*false\s*\}/,
      'i18n.ts に interpolation.escapeValue: false がない (ネイティブダイアログでエンティティが生表示される)'
    );
    // t() 出力の v-html 流し込み禁止の全域確認 (escapeValue: false の安全条件)。
    // コメント中の言及に誤爆しないよう、ディレクティブ実使用 (v-html=) のみを .vue 限定で検査
    const { execFileSync } = await import('node:child_process');
    let vHtmlHits = '';
    try {
      vHtmlHits = execFileSync(
        'grep',
        ['-rln', '--include=*.vue', 'v-html=', path.join(projectRoot, 'src')],
        { encoding: 'utf8' }
      );
    } catch (e) {
      // grep は不一致で exit 1 = ヒットなし (正常)
      vHtmlHits = '';
    }
    assert.equal(vHtmlHits.trim(), '', `src に v-html 使用がある (escapeValue:false と併用不可): ${vHtmlHits}`);
  }

  console.log('  [5/5] i18next interpolation house rule: PASS');

  console.log('M2-T3 prohibit-raw-ipc smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
