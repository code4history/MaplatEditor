// IIIF の配信先 URL の文字列の検査を確かめる smoke。
//
// (a) isAllowedDeliveryUrl が https だけを通し、IP のリテラルの私的・loopback な宛先を
//     拒むこと（拒む見本 4 件・通す見本 1 件）。
// (b) その検査を掛ける 3 か所（保存・ZIP の取り込み・開き直し）の関数の本体を
//     ソースから切り出し、それぞれの本体に isAllowedDeliveryUrl( の呼び出しがあること
//     （数ではなく、有無で見る）。
//
// 使い方: node scripts/iiif-delivery-url-smoke.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const ipClassifyPath = path.join(projectRoot, 'src/utils/ipClassify.ts');
const storeHandlerPath = path.join(projectRoot, 'electron/utils/store_handler.ts');
const dataUploadPath = path.join(projectRoot, 'electron/services/DataUploadService.ts');
const mapEditPath = path.join(projectRoot, 'src/views/MapEdit.vue');

const { isAllowedDeliveryUrl } = await import(pathToFileURL(ipClassifyPath).href);

// ---- (a) URL の文字列の検査 ----
const rejected = [
  'https://127.0.0.1/x',
  'https://[::1]/x',
  'https://10.0.0.5/x',
  'http://example.org/x',
];
const allowed = ['https://example.org/x'];

for (const url of rejected) {
  assert.equal(isAllowedDeliveryUrl(url), false, '拒むべき URL を通した: ' + url);
}
for (const url of allowed) {
  assert.equal(isAllowedDeliveryUrl(url), true, '通すべき URL を拒んだ: ' + url);
}
console.log('ok: delivery-url-rules (reject 4/4, allow 1/1)');

// ---- (b) 検査を掛ける 3 か所 ----
const storeSource = await readFile(storeHandlerPath, 'utf8');
const dataUploadSource = await readFile(dataUploadPath, 'utf8');
const mapEditSource = await readFile(mapEditPath, 'utf8');

// 行番号ではなく関数の構造で本体を切り出す。
const saveMatch = storeSource.match(
  /export async function histMap2Store\([\s\S]*?\n\}\n/u,
);
assert.ok(saveMatch, '保存の関数 histMap2Store の定義が見つからない');
assert.match(
  saveMatch[0],
  /isAllowedDeliveryUrl\(/u,
  '保存の関数は keys を通す前に isAllowedDeliveryUrl( を掛けること',
);
console.log('ok: call-in-save-body');

const zipMatch = dataUploadSource.match(
  /    async extractZip\(zipFile: string(?:, deps\?: [^\n]*)?\): Promise<any> \{[\s\S]*?\n    \}/u,
);
assert.ok(zipMatch, 'ZIP の取り込みの関数 extractZip の定義が見つからない');
assert.match(
  zipMatch[0],
  /isAllowedDeliveryUrl\(/u,
  'ZIP の取り込みの関数は isAllowedDeliveryUrl( を掛けること',
);
console.log('ok: call-in-zip-import-body');

const reopenMatch = mapEditSource.match(
  /const deliveryForSource = \([\s\S]*?\n\};/u,
);
assert.ok(reopenMatch, '開き直しの関数 deliveryForSource の定義が見つからない');
assert.match(
  reopenMatch[0],
  /isAllowedDeliveryUrl\(/u,
  '開き直しの関数は isAllowedDeliveryUrl( を掛けること',
);
console.log('ok: call-in-reopen-body');

console.log('ok: delivery-url (3/3)');
