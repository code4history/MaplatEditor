// NSIS スクリプトの言語メッセージの取り込み順を固定する（アンインストーラーを再ビルドで同じバイト列にする）
//
// なぜ（2026-10-30・1.2.0-rc.2 の mode=full が 2 回とも pack-win-2 で停止）:
//   build.yml は pack-win-1 で作ったアンインストーラーを署名専用ジョブで署名し、pack-win-2 で electron-builder が
//   もう一度作ったアンインストーラーを、SHA-256 が同じときだけ署名済みに差し替える（win-sign.cjs の collect）。
//   ところが app-builder-lib（26.17.0。26.18.1 でも同じ）の NsisTarget.computeCommonInstallerScriptHeader は
//   messages.yml と assistedMessages.yml の 2 つの LangString ファイルを AsyncTaskManager で**並行に**一時ファイルへ
//   書き出し、書き終えた順に `!include` を足す。どちらが先かは I/O の早さで決まる。
//   makensis は最初に現れた LangString の言語の並びで言語表を作るため（2 つの yml は言語の並びが違う）、
//   先に取り込まれた側によって文字列表の並びが変わり、アンインストーラーのバイト列（と圧縮後の大きさ）が変わる。
//   実測: run 40789858962・40945342825 の pack-win-1 のアンインストーラーを展開すると、解凍後のヘッダーは
//   大きさも文字列の集合も同じで、言語の並びだけが messages.yml 順（fr→it→de→en）と assistedMessages.yml 順
//   （…→fr→cs→sk→de→en）に分かれていた。x64 / arm64 の別ではなく、ビルドごとに当たり外れが出る。
//
// 対処: nsisLang.addCustomMessageFileInclude を包み、同じスクリプト生成器への取り込みを呼んだ順に直列にする
//   （NsisTarget は messages.yml → assistedMessages.yml の順に呼ぶ）。NsisTarget は
//   `(0, nsisLang_1.addCustomMessageFileInclude)(…)` と呼び出しのたびに exports から引くため、exports の差し替えが効く。
//   上流の形が変わって効かなくなったら install() が落ちる（Windows 署名が有効なビルドだけ。fail-closed）。
//   検査: scripts/win-sign-nsis-message-order-smoke.mjs
'use strict';

const path = require('node:path');

const MARK = Symbol.for('maplat-editor.win-sign.nsis-message-order');

/** electron-builder が使う app-builder-lib の nsisLang（electron-builder から解決する ＝ 同じモジュールの実体） */
function resolveNsisLang() {
  const ebDir = path.dirname(require.resolve('electron-builder/package.json'));
  const ablDir = path.dirname(require.resolve('app-builder-lib/package.json', { paths: [ebDir] }));
  return require(path.join(ablDir, 'out', 'targets', 'nsis', 'nsisLang.js'));
}

/**
 * 取り込みを直列にする包みを入れる。入れたら true、入れ済みなら false。形が想定と違えば例外。
 * @param {object} [nsisLang] テスト用。省略時は electron-builder の app-builder-lib から解決する
 */
function install(nsisLang = resolveNsisLang()) {
  const original = nsisLang.addCustomMessageFileInclude;
  if (typeof original !== 'function') {
    throw new Error('nsis-message-order: app-builder-lib の nsisLang.addCustomMessageFileInclude が見つからない（上流の形が変わった）');
  }
  if (original[MARK]) return false;
  /** スクリプト生成器ごとの、直前の取り込みの完了 */
  const tails = new WeakMap();
  const serialized = function addCustomMessageFileIncludeInOrder(input, packager, scriptGenerator, langConfigurator) {
    const prev = tails.get(scriptGenerator) || Promise.resolve();
    const next = prev.then(() => original.call(this, input, packager, scriptGenerator, langConfigurator));
    // 前の取り込みの失敗は前の呼び出し側（AsyncTaskManager）が受け取る。ここでは順番待ちだけに使う
    tails.set(scriptGenerator, next.catch(() => {}));
    return next;
  };
  serialized[MARK] = true;
  nsisLang.addCustomMessageFileInclude = serialized;
  if (nsisLang.addCustomMessageFileInclude !== serialized) {
    throw new Error('nsis-message-order: nsisLang.addCustomMessageFileInclude を差し替えられない（上流の形が変わった）');
  }
  return true;
}

module.exports = { install, resolveNsisLang, MARK };
