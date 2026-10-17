/**
 * nov26-m7-t6（#141 決めること 1・6）: 自動更新の形（知らせる → 同意で更新 → 設定で切れる・Linux は Releases を開くだけ）
 * の受け入れ検査。設計書: docs/superpowers/specs/2026-10-11-nov26-m7-t6-task-design.md（§3・§6・§7 が正本）。
 *
 *   [1] t6/AC3 updateActionFor（設計 §3.2 の表のとおり。Linux は open-releases、win32 は windowsNotifyOnly のときだけ）
 *   [2] t6/AC3 releasePageUrl は固定の接頭辞だけ（版の文字列を URL に混ぜない）
 *   [3] t6/AC3 UpdateController の open-releases の分岐からダウンロード・入れ替えへ届かない
 *   [4] t6/AC3 updateCheckEnabled の正規化・resolveStartupDelayMs（製品では env を読まない）
 *   [5] t6/AC3 defaultSettings のキーの集合 ＝ origin/master の集合 ∪ {updateCheckEnabled}（MIN-6）
 *   [6] t6/AC4 updateMessages の全キーが 11 言語にあり、差し込みの {…} が保たれ、無い言語は en
 *   [7] t6/AC4 Settings.vue の項目と翻訳 11 ファイルの 2 キー
 *   [8] t6/AC7 新しい IPC（app-update:）・preload の口が無い。更新の UI は main のダイアログ
 *   [9] main.ts の結線（メニューの About の後・起動の後・macOS の入れ替えで隠さない）
 *
 * 実行: node --experimental-strip-types scripts/nov26-m7-t6-update-ux-smoke.mjs（rtk を付けない）
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (rel) => readFileSync(path.join(projectRoot, rel), 'utf8');
const git = (...args) => spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8' });

let step = 0;
const TOTAL = 9;
const pass = (label) => console.log(`  [${++step}/${TOTAL}] ${label}: PASS`);

const policy = await import('../electron/utils/updatePolicy.ts');
const feed = await import('../electron/utils/updateFeed.ts');
const messagesMod = await import('../electron/services/updateMessages.ts');

/** src の中で、start（開き波括弧の位置）に対応する閉じ波括弧までを返す（文字列・コメントの中の波括弧は数えない） */
function blockFrom(src, start) {
  assert.equal(src[start], '{', `blockFrom: ${start} は { でない`);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('blockFrom: 閉じ波括弧が無い');
}

// ───────────────────────────────────────────────
// [1] updateActionFor（設計 §3.2）
// ───────────────────────────────────────────────
{
  const { updateActionFor, WINDOWS_NOTIFY_ONLY } = policy;
  assert.equal(WINDOWS_NOTIFY_ONLY, false, 'WINDOWS_NOTIFY_ONLY の既定は false（§8.1 (イ) に落ちたときだけ true）');
  const cases = [
    ['linux', false, 'open-releases'],
    ['linux', true, 'open-releases'],
    ['win32', false, 'download'],
    ['win32', true, 'open-releases'],
    ['darwin', false, 'download'],
    ['darwin', true, 'download'],
    // 設計 §3.2「それ以外 → download」。知らない OS もこの表に従う
    ['freebsd', false, 'download'],
    ['openbsd', true, 'download'],
  ];
  for (const [platform, windowsNotifyOnly, expected] of cases) {
    assert.equal(updateActionFor(platform, { windowsNotifyOnly }), expected, `updateActionFor(${platform}, ${windowsNotifyOnly})`);
  }
  pass(`t6/AC3 updateActionFor（${cases.length} 通り・設計 §3.2 の表）・WINDOWS_NOTIFY_ONLY=false`);
}

// ───────────────────────────────────────────────
// [2] releasePageUrl
// ───────────────────────────────────────────────
{
  const { releasePageUrl } = policy;
  const TAG = 'https://github.com/code4history/MaplatEditor/releases/tag/v';
  const LATEST = 'https://github.com/code4history/MaplatEditor/releases/latest';
  assert.equal(releasePageUrl('9.0.0'), `${TAG}9.0.0`);
  assert.equal(releasePageUrl('1.12.345'), `${TAG}1.12.345`);
  const bad = ['../x', '9.0.0-rc.1', 'javascript:alert(1)', '9.0.0/../../evil', '9.0.0?x=1', '', ' 9.0.0', '9.0.0 ', 'v9.0.0', '9.0', '9.0.0.0', '９.０.０'];
  for (const v of bad) assert.equal(releasePageUrl(v), LATEST, `releasePageUrl(${JSON.stringify(v)}) が latest でない`);
  for (const v of [undefined, null, 9, {}, []]) assert.equal(releasePageUrl(v), LATEST, `releasePageUrl(${String(v)}) が latest でない`);
  pass(`t6/AC3 releasePageUrl（${bad.length + 5} 通り）は固定の接頭辞だけ`);
}

// ───────────────────────────────────────────────
// [3] UpdateController の open-releases の分岐
// ───────────────────────────────────────────────
{
  const src = read('electron/services/UpdateController.ts');
  const checkAt = src.search(/export\s+async\s+function\s+check\s*\(/);
  assert.ok(checkAt >= 0, 'UpdateController.ts に export async function check( が無い');
  const checkBody = blockFrom(src, src.indexOf('{', src.indexOf(')', checkAt)));
  const branchAt = checkBody.search(/if\s*\(\s*action\s*===\s*'open-releases'\s*\)\s*\{/);
  assert.ok(branchAt >= 0, "check の中に if (action === 'open-releases') { が無い");
  const branch = blockFrom(checkBody, checkBody.indexOf('{', branchAt));
  for (const name of ['downloadUpdate', 'quitAndInstall', 'runDownload', 'installNow']) {
    assert.ok(!branch.includes(name), `open-releases の分岐に ${name} がある`);
  }
  assert.match(branch, /\breturn\b[\s\S]*\}$/, 'open-releases の分岐が return で閉じていない');
  assert.match(branch, /shell\.openExternal\(\s*releasePageUrl\(/, 'open-releases の分岐が releasePageUrl を開いていない');
  const beforeBranch = checkBody.slice(0, branchAt);
  for (const name of ['downloadUpdate', 'quitAndInstall']) {
    assert.ok(!beforeBranch.includes(name), `open-releases の判定より前に ${name} がある`);
  }
  assert.match(src, /updateActionFor\(\s*process\.platform\s*,\s*\{\s*windowsNotifyOnly:\s*WINDOWS_NOTIFY_ONLY\s*\}\s*\)/, 'action を updateActionFor(process.platform, { windowsNotifyOnly: WINDOWS_NOTIFY_ONLY }) で決めていない');
  pass('t6/AC3 open-releases の分岐からダウンロード・入れ替えへ届かない');
}

// ───────────────────────────────────────────────
// [4] updateCheckEnabled の正規化・resolveStartupDelayMs
// ───────────────────────────────────────────────
{
  const { normalizeUpdateCheckEnabled } = policy;
  for (const v of [false, 'false']) assert.equal(normalizeUpdateCheckEnabled(v), false, `normalize(${JSON.stringify(v)})`);
  for (const v of [true, 'true', undefined, null, 0, '', 'no', 'FALSE', {}, []]) {
    assert.equal(normalizeUpdateCheckEnabled(v), true, `normalize(${JSON.stringify(v)})`);
  }
  const ss = read('electron/services/SettingsService.ts');
  const getAt = ss.search(/public\s+get\s*\(\s*key:\s*string\s*\)/);
  assert.ok(getAt >= 0, 'SettingsService に public get が無い');
  const getBody = blockFrom(ss, ss.indexOf('{', getAt));
  assert.match(getBody, /key\s*===\s*'updateCheckEnabled'\)[\s\S]{0,200}?normalizeUpdateCheckEnabled\(this\.store\.get\('updateCheckEnabled'\)\)/, 'get が updateCheckEnabled を正規化していない');
  const setAt = ss.search(/public\s+set\s*\(\s*key:\s*string/);
  assert.ok(setAt >= 0, 'SettingsService に public set が無い');
  const setBody = blockFrom(ss, ss.indexOf('{', setAt));
  assert.match(setBody, /key\s*===\s*'updateCheckEnabled'\)[\s\S]{0,300}?value\s*=\s*normalizeUpdateCheckEnabled\(value\)/, 'set が updateCheckEnabled を正規化していない');

  const { resolveStartupDelayMs } = feed;
  const root = '/tmp/e2e-root';
  const cases = [
    [true, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_DELAY_MS: '500' }, 15000],
    [true, {}, 15000],
    [false, {}, 15000],
    [false, { MAPLAT_E2E_UPDATE_DELAY_MS: '500' }, 15000],
    [false, { MAPLAT_E2E_ROOT: '', MAPLAT_E2E_UPDATE_DELAY_MS: '500' }, 15000],
    [false, { MAPLAT_E2E_ROOT: root }, 15000],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_DELAY_MS: '500' }, 500],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_DELAY_MS: '0' }, 0],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_DELAY_MS: '60000' }, 60000],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_DELAY_MS: '60001' }, 15000],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_DELAY_MS: '-1' }, 15000],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_DELAY_MS: '1.5' }, 15000],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_DELAY_MS: '1e3' }, 15000],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_DELAY_MS: ' 500' }, 15000],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_DELAY_MS: 'abc' }, 15000],
    [false, { MAPLAT_E2E_ROOT: root, MAPLAT_E2E_UPDATE_DELAY_MS: '' }, 15000],
  ];
  for (const [isPackaged, env, expected] of cases) {
    assert.equal(resolveStartupDelayMs({ isPackaged, env }), expected, `resolveStartupDelayMs(${isPackaged}, ${JSON.stringify(env)})`);
  }
  let touched = false;
  const spy = new Proxy({}, { get() { touched = true; return undefined; }, has() { touched = true; return false; } });
  assert.equal(resolveStartupDelayMs({ isPackaged: true, env: spy }), 15000);
  assert.equal(touched, false, 'isPackaged: true なのに env を読んだ');
  pass(`t6/AC3 updateCheckEnabled の正規化・resolveStartupDelayMs（${cases.length + 1} 通り・製品では env を読まない）`);
}

// ───────────────────────────────────────────────
// [5] defaultSettings（MIN-6）
// ───────────────────────────────────────────────
{
  const defaultsOf = (src) => {
    const at = src.search(/const\s+defaultSettings\s*:\s*AppSettings\s*=\s*\{/);
    assert.ok(at >= 0, 'defaultSettings が無い');
    const body = blockFrom(src, src.indexOf('{', at)).slice(1, -1);
    const map = new Map();
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (line === '' || line.startsWith('//')) continue;
      const m = line.match(/^([A-Za-z_$][\w$]*)\s*:\s*(.+?),?$/);
      assert.ok(m, `defaultSettings の行が読めない: ${line}`);
      map.set(m[1], m[2].replace(/,$/, ''));
    }
    return map;
  };
  const head = defaultsOf(read('electron/services/SettingsService.ts'));
  const r = git('show', 'origin/master:electron/services/SettingsService.ts');
  assert.equal(r.status, 0, `origin/master の SettingsService.ts を読めない: ${r.stderr}`);
  const base = defaultsOf(r.stdout);
  const want = new Set([...base.keys(), 'updateCheckEnabled']);
  assert.deepEqual([...head.keys()].sort(), [...want].sort(), 'defaultSettings のキーが origin/master ∪ {updateCheckEnabled} でない');
  for (const [k, v] of base) assert.equal(head.get(k), v, `defaultSettings.${k} の字面が origin/master と違う`);
  assert.equal(head.get('updateCheckEnabled'), 'true', 'defaultSettings.updateCheckEnabled が true でない');
  assert.equal(head.get('lastDialogFolders'), '{}', 'm6 t7 の lastDialogFolders: {} が残っていない');
  pass(`t6/AC3 defaultSettings = origin/master ∪ {updateCheckEnabled: true}（${[...head.keys()].join(', ')}）`);
}

// ───────────────────────────────────────────────
// [6] updateMessages
// ───────────────────────────────────────────────
{
  const { UPDATE_MESSAGES, UPDATE_MESSAGE_KEYS, updateText } = messagesMod;
  const LANGS = ['de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'th', 'vi', 'zh', 'zh-TW'];
  assert.deepEqual(Object.keys(UPDATE_MESSAGES).sort(), [...LANGS].sort(), 'updateMessages の言語が 11 でない');
  const designKeys = ['menu.check_updates', 'dialog.update_available.message', 'dialog.update_available.detail', 'button.update',
    'button.open_releases', 'button.later', 'dialog.downloaded.message', 'button.restart_now', 'dialog.up_to_date.message',
    'dialog.check_failed.message', 'dialog.download_failed.message'];
  for (const k of designKeys) assert.ok(UPDATE_MESSAGE_KEYS.includes(k), `設計 §3.5 のキー ${k} が無い`);
  const vars = (s) => (s.match(/\{[a-z]+\}/g) ?? []).sort().join(',');
  for (const lang of LANGS) {
    const table = UPDATE_MESSAGES[lang];
    assert.deepEqual(Object.keys(table).sort(), [...UPDATE_MESSAGE_KEYS].sort(), `${lang} のキーが揃っていない`);
    for (const k of UPDATE_MESSAGE_KEYS) {
      assert.equal(typeof table[k], 'string', `${lang}.${k}`);
      assert.ok(table[k].trim() !== '', `${lang}.${k} が空`);
      assert.equal(vars(table[k]), vars(UPDATE_MESSAGES.en[k]), `${lang}.${k} の差し込みが en と違う`);
    }
  }
  assert.ok(UPDATE_MESSAGES.en['dialog.update_available.message'].includes('{version}'));
  assert.ok(UPDATE_MESSAGES.en['dialog.up_to_date.message'].includes('{version}'));
  assert.equal(updateText('ja', 'dialog.update_available.message', { version: '9.0.0' }).includes('9.0.0'), true);
  assert.equal(updateText('xx', 'menu.check_updates'), UPDATE_MESSAGES.en['menu.check_updates'], '無い言語が en に戻らない');
  assert.equal(updateText(undefined, 'button.later'), UPDATE_MESSAGES.en['button.later']);
  assert.equal(updateText('ja', 'no.such.key'), 'no.such.key');
  assert.equal(updateText('en', 'dialog.up_to_date.message', { version: '{version}' }).includes('{version}'), true);
  assert.equal(updateText('en', 'dialog.up_to_date.message', { version: '9.0.0' }).includes('{version}'), false);
  assert.doesNotMatch(read('electron/services/updateMessages.ts'), /from\s+['"]electron['"]/);
  pass(`t6/AC4 updateMessages（${UPDATE_MESSAGE_KEYS.length} キー × ${LANGS.length} 言語）`);
}

// ───────────────────────────────────────────────
// [7] Settings.vue と翻訳 11 ファイル
// ───────────────────────────────────────────────
{
  const vue = read('src/views/Settings.vue');
  assert.match(vue, /id="updateCheckEnabled"/);
  assert.match(vue, /data-testid="settings-update-check"/);
  assert.match(vue, /t\("settings\.update_check"\)|t\('settings\.update_check'\)/);
  assert.match(vue, /settings\.update_check_desc/);
  assert.match(vue, /class="form-check form-switch/);
  assert.match(vue, /v-model="state\.updateCheckEnabled"/);
  assert.match(vue, /state\.updateCheckEnabled\s*!==\s*original\.updateCheckEnabled/, 'isDirty に updateCheckEnabled が無い');
  assert.match(vue, /window\.settings\.set\(\s*"updateCheckEnabled"/, 'saveSettings が updateCheckEnabled を保存しない');
  assert.match(vue, /window\.settings\.get\(\s*"updateCheckEnabled"/, 'onMounted が updateCheckEnabled を読まない');
  assert.match(vue, /state\.updateCheckEnabled\s*=\s*original\.updateCheckEnabled/, 'resetSettings が updateCheckEnabled を戻さない');
  const jpeg = vue.indexOf('id="jpegDecodeMaxResolutionMP"');
  const item = vue.indexOf('id="updateCheckEnabled"');
  const buttons = vue.indexOf('<!-- Buttons -->');
  assert.ok(jpeg >= 0 && jpeg < item && item < buttons, '項目の位置が JPEG の 2 項目の後・ボタンの前でない');

  const dir = path.join(projectRoot, 'public/locales');
  const langs = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  assert.equal(langs.length, 11, `public/locales の言語が 11 でない: ${langs.join(',')}`);
  for (const lang of langs) {
    const json = JSON.parse(read(`public/locales/${lang}/translation.json`));
    for (const k of ['update_check', 'update_check_desc']) {
      assert.equal(typeof json.settings?.[k], 'string', `${lang}: settings.${k} が無い`);
      assert.ok(json.settings[k].trim() !== '', `${lang}: settings.${k} が空`);
    }
  }
  pass('t6/AC4 Settings.vue の項目・翻訳 11 ファイルの settings.update_check(_desc)');
}

// ───────────────────────────────────────────────
// [8] 新しい IPC・preload の口が無い（t6/AC7）・ダイアログは main から
// ───────────────────────────────────────────────
{
  const r = git('grep', '--untracked', '-n', 'app-update:', '--', 'electron', 'src');
  assert.equal(r.status, 1, `app-update: の該当がある（または git grep の失敗）: ${r.stdout}${r.stderr}`);
  const ctl = read('electron/services/UpdateController.ts');
  assert.doesNotMatch(ctl, /ipcMain|ipcRenderer|webContents\.send|contextBridge/, 'UpdateController が IPC を持つ');
  assert.doesNotMatch(read('electron/preload.ts'), /app-update|autoUpdater|updateCheck|checkForUpdates|quitAndInstall/, 'preload に更新の口がある');
  assert.match(ctl, /dialog\.showMessageBox\(/);
  assert.doesNotMatch(ctl, /\{\s*showMessageBox\s*\}\s*=\s*dialog|const\s+showMessageBox\s*=/, 'showMessageBox を手元に取っている');
  const opens = ctl.match(/shell\.openExternal\([^)]*\)?/g) ?? [];
  assert.ok(opens.length >= 1, 'shell.openExternal が無い');
  for (const o of opens) assert.match(o, /shell\.openExternal\(\s*releasePageUrl\(/, `releasePageUrl 以外を開く: ${o}`);
  const autoAt = ctl.search(/export\s+function\s+startAutomaticCheck\s*\(/);
  assert.ok(autoAt >= 0, 'startAutomaticCheck が無い');
  const autoBody = blockFrom(ctl, ctl.indexOf('{', ctl.indexOf(')', autoAt)));
  const off = autoBody.search(/if\s*\(\s*!isUpdateCheckEnabled\(\)\s*\)\s*return/);
  const timer = autoBody.search(/setTimeout\(/);
  assert.ok(off >= 0 && timer > off, 'startAutomaticCheck が設定のオフを setTimeout より先に見ていない');
  pass('t6/AC7 app-update: の IPC・preload の口なし・ダイアログは main・開く URL は releasePageUrl だけ');
}

// ───────────────────────────────────────────────
// [9] main.ts の結線
// ───────────────────────────────────────────────
{
  const main = read('electron/main.ts');
  assert.match(main, /import\s+\*\s+as\s+UpdateController\s+from\s+'\.\/services\/UpdateController'/);
  const aboutAt = main.search(/label:\s*t\('menu\.about'\),\s*click:\s*createAboutWindow\s*\}/);
  assert.ok(aboutAt >= 0, 'About の項目が無い');
  const after = main.slice(aboutAt, aboutAt + 400);
  assert.match(after, /\{\s*id:\s*'check-updates',\s*label:\s*updateText\(lang,\s*'menu\.check_updates'\),\s*click:\s*\(\)\s*=>\s*UpdateController\.check\(\{\s*manual:\s*true\s*\}\)\s*\}/, 'About の後に check-updates の項目が無い');
  assert.match(main, /createWindow\(\)\s*\n\s*setupMenu\(\)\s*\n[\s\S]{0,400}UpdateController\.startAutomaticCheck\(\s*\(\)\s*=>\s*win\s*\)/, 'createWindow・setupMenu の後に startAutomaticCheck が無い');
  assert.match(main, /autoUpdater\.on\(\s*'before-quit-for-update'\s*,\s*\(\)\s*=>\s*\{\s*forceQuit\s*=\s*true/, 'before-quit-for-update で forceQuit を立てていない');
  assert.doesNotMatch(main, /'menu\.check_updates'\s*:/, 'messages の表に menu.check_updates を足している');
  pass('main.ts: About の後の check-updates・起動の後の startAutomaticCheck・入れ替えの前の forceQuit');
}

console.log('nov26-m7-t6 update-ux smoke: PASS');
