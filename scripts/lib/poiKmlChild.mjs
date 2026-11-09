// poi-kml-smoke.mjs の子プロセス: 1 つの入力を作って parsePoiKml に通し、時間と RSS の増加を JSON で出す。
// 親の RSS を汚さないため、大きな入力は必ずここで走らせる。
// 使い方: node poiKmlChild.mjs <bundle.mjs> <reject|pass|normal|attack> <番号> <xmldom の index.js>
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { REJECT, PASS, NORMAL, PLACEMARK_ATTACKS } from './poiKmlInputs.mjs';

const [bundle, kind, indexArg, xmldomPath] = process.argv.slice(2);
const table = { reject: REJECT, pass: PASS, normal: NORMAL, attack: PLACEMARK_ATTACKS }[kind];
const entry = table[Number(indexArg)];
const { parsePoiKml } = await import(pathToFileURL(bundle).href);
const { DOMParser } = createRequire(import.meta.url)(xmldomPath);
const noop = { warning() {}, error() {}, fatalError() {} };
const createDocument = (text) => new DOMParser({ locator: {}, errorHandler: noop }).parseFromString(text, 'text/xml');

const bytes = new TextEncoder().encode(entry[1]());
// 入力を作った時点の最大 RSS を基準にして、処理による増加を測る (maxRSS は KB)
const baseKb = process.resourceUsage().maxRSS;
const t0 = performance.now();
const result = parsePoiKml({ bytes, defaultLang: 'ja', createDocument });
const ms = performance.now() - t0;
const deltaMb = Math.max(0, process.resourceUsage().maxRSS - baseKb) / 1024;
const first = result.issues.find((i) => i.level === 'error');
console.log(JSON.stringify({
  name: entry[0],
  code: first ? first.code : null,
  detail: first?.message ?? null,
  fatal: result.fatal,
  rows: result.rows.length,
  warnings: result.issues.filter((i) => i.level === 'warning').map((i) => i.code),
  ms: Math.round(ms),
  deltaMb: Math.round(deltaMb),
  bytes: bytes.length,
}));
