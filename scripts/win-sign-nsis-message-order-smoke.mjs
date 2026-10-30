/**
 * NSIS の言語メッセージの取り込み順の固定（scripts/win-sign/nsis-message-order.cjs）の検査。
 *
 * 背景: 1.2.0-rc.2 の mode=full（run 40789858962・40945342825）が pack-win-2 の「Collect the installers to sign」で
 * 「前の phase（uninstaller）の would-sign が残っている」で停止した。pack-win-1 と pack-win-2 のアンインストーラーの
 * SHA-256 が違ったため。app-builder-lib が messages.yml と assistedMessages.yml を並行に書き出し、書き終えた順に
 * !include するので、言語表の並び（∴ アンインストーラーのバイト列）がビルドごとに変わる。
 *
 *   [1] 上流の形: NsisTarget が exports 経由で messages.yml → assistedMessages.yml の順に呼んでいる（包みが効く前提）
 *   [2] 再現: 包み無しでは、書き出しの遅い側が後に取り込まれる（順が I/O の早さで決まる）
 *   [3] 対処: 包みを入れると、書き出しの遅さに関わらず messages.yml → assistedMessages.yml の順で、生成物が毎回同じ
 *   [4] electron-builder.config.cjs: Windows 署名が有効なら包みを入れ、off なら入れない
 *
 * 実行: node scripts/win-sign-nsis-message-order-smoke.mjs（rtk を付けない）
 * 実物の app-builder-lib の NsisTarget.computeCommonInstallerScriptHeader を、偽の packager で呼ぶ（makensis は動かさない）。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ORDER = path.join(projectRoot, 'scripts/win-sign/nsis-message-order.cjs');
const { install, resolveNsisLang, MARK } = require(ORDER);

const ebDir = path.dirname(require.resolve('electron-builder/package.json'));
const ablDir = path.dirname(require.resolve('app-builder-lib/package.json', { paths: [ebDir] }));
const NSIS_TARGET = path.join(ablDir, 'out', 'targets', 'nsis', 'NsisTarget.js');

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failures++;
    console.log(`  ❌ ${name}\n     ${e.message.split('\n').join('\n     ')}`);
  }
}

const work = mkdtempSync(path.join(tmpdir(), 'nsis-msg-order-'));
// ELECTRON_BUILDER_NSIS_RESOURCES_DIR を置くと getNsisPluginsPath が取りに行かない（ダウンロードしない）
const nsisResources = path.join(work, 'nsis-resources');
mkdirSync(path.join(nsisResources, 'plugins'), { recursive: true });
process.env.ELECTRON_BUILDER_NSIS_RESOURCES_DIR = nsisResources;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// nsisLang は `(0, fs_extra_1.outputFile)(file, data)` と呼ぶ（呼び出しのたびに exports から引く）。
// 書き出しを中身ごとに遅らせて、I/O の早さの違いを作る
let currentDelays = { messages: 0, assisted: 0 };
const fsExtra = require(require.resolve('fs-extra', { paths: [path.join(ablDir, 'out', 'targets', 'nsis')] }));
const realOutputFile = fsExtra.outputFile;
fsExtra.outputFile = async (file, data, ...rest) => {
  if (typeof data === 'string' && data.startsWith('LangString win7Required ')) await sleep(currentDelays.messages);
  else if (typeof data === 'string' && data.startsWith('LangString chooseInstallationOptions ')) await sleep(currentDelays.assisted);
  return realOutputFile.call(fsExtra, file, data, ...rest);
};

/**
 * 実物の computeCommonInstallerScriptHeader を呼び、取り込まれたメッセージファイルの順（呼び出し順の番号）を返す。
 * delays は書き出し（nsisLang が呼ぶ fs-extra の outputFile）の遅れ（ms）。中身で messages.yml / assistedMessages.yml を見分ける
 */
async function generate(delays) {
  currentDelays = delays;
  require(ablDir); // 直接 NsisTarget から読むと循環 require で基底クラスが未定義になる。入口から読む
  const { NsisTarget } = require(NSIS_TARGET);
  const runDir = mkdtempSync(path.join(work, 'run-'));
  let n = 0;
  const packager = {
    info: { cancellationToken: { cancelled: false }, buildResourcesDir: path.join(runDir, 'build') },
    config: {},
    getResource: async () => null,
    getTempFile: async (suffix) => {
      const i = n++;
      return path.join(runDir, `${i}-${suffix}`);
    },
  };
  const self = { packager, options: { oneClick: false }, isUnicodeEnabled: true, isPortable: false };
  const script = await NsisTarget.prototype.computeCommonInstallerScriptHeader.call(self);
  const order = [...script.matchAll(/!include "[^"]*[\\/](\d+)-messages\.nsh"/g)].map((m) => Number(m[1]));
  // 中身からどちらのファイルかを判定する（messages.yml の先頭は win7Required・assistedMessages.yml は chooseInstallationOptions）
  const kinds = order.map((i) => {
    const body = readFileSync(path.join(runDir, `${i}-messages.nsh`), 'utf8');
    if (body.startsWith('LangString win7Required ')) return 'messages.yml';
    if (body.startsWith('LangString chooseInstallationOptions ')) return 'assistedMessages.yml';
    return `unknown(${body.slice(0, 40)})`;
  });
  // 一時ファイルの名前（番号）は実行ごとに違ってよい（makensis には中身しか効かない）。比べるのは名前を中身の種類に置き換えた形
  let k = 0;
  return { kinds, normalized: script.replace(/"[^"]*[\\/]\d+-messages\.nsh"/g, () => `"<${kinds[k++]}>"`) };
}

console.log('[1] 上流の形');
await check('NsisTarget は exports 経由で messages.yml → assistedMessages.yml の順に呼ぶ', () => {
  const src = readFileSync(NSIS_TARGET, 'utf8');
  const a = src.indexOf('(0, nsisLang_1.addCustomMessageFileInclude)("messages.yml"');
  const b = src.indexOf('(0, nsisLang_1.addCustomMessageFileInclude)("assistedMessages.yml"');
  assert.ok(a > 0, `messages.yml の呼び出しが見つからない: ${NSIS_TARGET}`);
  assert.ok(b > a, 'assistedMessages.yml の呼び出しが messages.yml の後に無い');
});

console.log('[2] 再現（包み無し）');
await check('書き出しの遅い側が後に取り込まれる（＝順が I/O の早さで決まり、ビルドごとに変わりうる）', async () => {
  assert.equal(resolveNsisLang().addCustomMessageFileInclude[MARK], undefined, '包みが既に入っている');
  const messagesSlow = await generate({ messages: 60, assisted: 0 });
  const assistedSlow = await generate({ messages: 0, assisted: 60 });
  assert.deepEqual(messagesSlow.kinds, ['assistedMessages.yml', 'messages.yml']);
  assert.deepEqual(assistedSlow.kinds, ['messages.yml', 'assistedMessages.yml']);
  assert.notEqual(messagesSlow.normalized, assistedSlow.normalized);
});

console.log('[3] 対処（包みあり）');
await check('install() は 1 回目 true・2 回目 false（二重に包まない）', () => {
  assert.equal(install(), true);
  assert.equal(install(), false);
  assert.equal(resolveNsisLang().addCustomMessageFileInclude[MARK], true);
});
await check('書き出しの遅さに関わらず messages.yml → assistedMessages.yml の順で、スクリプトが毎回同じ', async () => {
  const base = await generate({ messages: 0, assisted: 0 });
  assert.deepEqual(base.kinds, ['messages.yml', 'assistedMessages.yml']);
  const patterns = [{ messages: 60, assisted: 0 }, { messages: 0, assisted: 60 }, { messages: 30, assisted: 5 }, { messages: 5, assisted: 30 }];
  for (let i = 0; i < 12; i++) patterns.push({ messages: Math.floor(Math.random() * 40), assisted: Math.floor(Math.random() * 40) });
  for (const d of patterns) {
    const r = await generate(d);
    assert.deepEqual(r.kinds, ['messages.yml', 'assistedMessages.yml'], `delays=${JSON.stringify(d)}`);
    assert.equal(r.normalized, base.normalized, `delays=${JSON.stringify(d)} でスクリプトが変わった`);
  }
});
await check('前の取り込みが失敗しても後の取り込みは走り、失敗はその呼び出しに返る', async () => {
  const lang = { addCustomMessageFileInclude: null };
  const seen = [];
  lang.addCustomMessageFileInclude = async (input, _p, gen) => {
    if (input === 'bad') throw new Error('boom');
    gen.include(input);
    seen.push(input);
  };
  install(lang);
  const gen = { lines: [], include(f) { this.lines.push(f); } };
  const p1 = lang.addCustomMessageFileInclude('bad', null, gen, null);
  const p2 = lang.addCustomMessageFileInclude('ok', null, gen, null);
  await assert.rejects(p1, /boom/);
  await p2;
  assert.deepEqual(gen.lines, ['ok']);
});
await check('形が違えば install() は落ちる', () => {
  assert.throws(() => install({}), /見つからない/);
  const frozen = Object.freeze({ addCustomMessageFileInclude: async () => {} });
  assert.throws(() => install(frozen));
});

console.log('[4] electron-builder.config.cjs');
const probe = `
const cfg = require(${JSON.stringify(path.join(projectRoot, 'electron-builder.config.cjs'))});
const { resolveNsisLang, MARK } = require(${JSON.stringify(ORDER)});
process.stdout.write(String(resolveNsisLang().addCustomMessageFileInclude[MARK] === true));
`;
for (const [mode, expected] of [['collect', 'true'], ['record', 'true'], ['off', 'false']]) {
  await check(`WIN_SIGN_MODE=${mode} で包み ${expected === 'true' ? 'あり' : '無し'}`, () => {
    const env = { ...process.env, WIN_SIGN_MODE: mode };
    const r = spawnSync(process.execPath, ['-e', probe], { cwd: projectRoot, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim().split('\n').pop(), expected);
  });
}

if (failures) {
  console.log(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log('\nすべて通過');
