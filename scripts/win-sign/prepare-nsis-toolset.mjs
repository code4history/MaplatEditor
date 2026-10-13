#!/usr/bin/env node
// nov26-m7-t2（MAJ-1）: --prepackaged の electron-builder を起動する**前の step** で、署名済みのプラグインに
// 差し替えた NSIS ツールセットを用意する。
//
// --prepackaged では beforePack が呼ばれない（app-builder-lib 26.17.0 out/platformPackager.js の doPack が先頭で
// return し、emitBeforePack はその後）。∴ build.yml の pack のジョブは、electron-builder の外でこれを呼び、
// ELECTRON_BUILDER_NSIS_DIR・ELECTRON_BUILDER_NSIS_RESOURCES_DIR を $GITHUB_ENV に書いて次の step へ渡す。
// electron-builder がプラグインの置き場を読むのは呼ばれた時点（out/toolsets/windows.js:232）なので、環境変数で足りる。
// 用意した印（<root>/.win-sign-prepared.json）は、collect の sign() が NSIS の出力を署名する前に確かめる（fail-closed）。
//
// WIN_SIGN_MODE が collect 以外なら何もしない（record・esigner・off は従来どおり beforePack が用意する）。
// プラグインの記録（kind: nsis-plugin）は WIN_SIGN_RECORD_FILE に、electron-builder の記録と同じファイルへ書く。
//
// 実行: WIN_SIGN_MODE=collect node scripts/win-sign/prepare-nsis-toolset.mjs
import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// fileURLToPath で読む（B31 MAJ-1）。URL の pathname を使うと Windows で /D:/… になり、
// path.resolve が D:\D:\… を作って electron-builder.config.cjs が見つからない（run 38369214775 の measure-prod-a/b）
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const winSign = require('./win-sign.cjs');

const mode = winSign.getMode();
if (mode !== 'collect') {
  console.log(`prepare-nsis-toolset: WIN_SIGN_MODE=${mode} では何もしない（beforePack が用意する）`);
  process.exit(0);
}
const config = require(path.join(projectRoot, 'electron-builder.config.cjs'));
const r = await winSign.prepareSignedNsisToolset({ config });
const lines = [`ELECTRON_BUILDER_NSIS_DIR=${r.nsisDir}`, `ELECTRON_BUILDER_NSIS_RESOURCES_DIR=${r.resourcesDir}`];
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `${lines.join('\n')}\n`);
for (const l of lines) console.log(l);
for (const p of r.plugins) console.log(`  ${p.name}: ${p.decision}`);
