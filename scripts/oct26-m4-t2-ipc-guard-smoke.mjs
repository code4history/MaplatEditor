// oct26-m4-t2 AC-2: #100 runGuarded 拡張 smoke。
// 設計書 docs/superpowers/specs/2026-09-10-oct26-m4-t2-design.md §7 AC-2 / §4.1(b) 全数調査表 #21〜#27。
//
// 各 (file, channel) について、handler 本体が runGuarded('<channel>', …) を呼んでいることを
// ソース scan で assert する。channel 文字列はハンドラに一意なので、同一文字列の runGuarded 呼び出しが
// そのファイル内に実在すれば wrap 済みと判定する（変更前は appedit:export 以外 0 件 wrap のため FAIL）。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const readSrc = (rel) => readFile(path.join(projectRoot, rel), "utf8");

// §4.1(b) 全数調査表（#21〜#27）。MIN-3 是正済みの wrap 対象定義に一致させる。
const TARGETS = [
  ["electron/ipc/mapedit.ts", ["mapedit:updateTin", "mapedit:download", "mapedit:download-saved", "mapedit:uploadCsv"]],
  ["electron/ipc/poisource.ts", ["poisource:exportFile", "poisource:importFile", "poisource:refreshRemote", "poisource:cloneToLocal"]],
  ["electron/ipc/dataupload.ts", ["dataupload:showDataSelectDialog"]],
  ["electron/ipc/mapupload.ts", ["mapupload:showMapSelectDialog"]],
  ["electron/ipc/wmts.ts", ["wmtsGen:generate"]],
  ["electron/ipc/appassets.ts", ["appassets:upload-tms-thumbnail", "appassets:upload-splash", "appassets:upload-pwa-icon", "appassets:replace-map-thumbnail", "appassets:generate-tms-thumbnail"]],
  ["electron/ipc/assets-images.ts", ["imageassets:add", "imageassets:update-metadata"]],
];

let total = 0;
for (const [file, channels] of TARGETS) {
  const src = await readSrc(file);
  for (const ch of channels) {
    total += 1;
    const wrapped = src.includes(`runGuarded('${ch}'`) || src.includes(`runGuarded("${ch}"`);
    assert.ok(wrapped, `${file} の ${ch} ハンドラが runGuarded('${ch}', …) で wrap されていない`);
  }
}

console.log(`=== AC-2: runGuarded 拡張 ${total} チャネル: PASS ===`);