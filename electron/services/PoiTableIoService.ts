// POI の表形式 (CSV・JSON) の入出力。ファイルの整形と書き込みだけを担い、保存先のダイアログや
// DB の読み出しは呼び出し側 (ipc/poisource.ts) が関数で渡す。renderer から任意のパスを受け取らない。
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FeatureCollection } from 'geojson';
import { buildPoiCsv, buildPoiJson, type PoiExportOmitted } from '../../src/utils/poiCsvExport';
import { LANG_CODES } from '../../src/utils/editorLanguages';
import { POI_IMPORT_MAX_BYTES, parsePoiImportFile, type PoiImportParseResult } from '../../src/utils/poiImportRows';
import { parsePoiKml, type KmlDocument } from '../../src/utils/poiKml';

export type PoiExportFormat = 'csv' | 'json';

export type PoiExportTableResult =
  | { result: 'Success'; filePath: string; omitted: PoiExportOmitted }
  | { result: 'Canceled' }
  | { result: 'Error'; message?: string };

export function isPoiExportFormat(value: unknown): value is PoiExportFormat {
  return value === 'csv' || value === 'json';
}

export function formatPoiExport(fc: FeatureCollection, format: PoiExportFormat) {
  const built = format === 'csv' ? buildPoiCsv(fc) : buildPoiJson(fc);
  return { ...built, extension: format };
}

export async function exportPoiTable(args: {
  uid: unknown;
  format: unknown;
  loadFc: (uid: string) => Promise<FeatureCollection | null>;
  // 保存ダイアログ。返値 (ユーザーが選んだパス) だけが保存先になる。キャンセルは null
  pickSavePath: (suggested: { fileName: string; extension: PoiExportFormat; format: PoiExportFormat }) => Promise<string | null>;
}): Promise<PoiExportTableResult> {
  if (typeof args.uid !== 'string' || args.uid === '' || !isPoiExportFormat(args.format)) {
    return { result: 'Error', message: 'invalid request' };
  }
  const format = args.format;
  try {
    const fc = await args.loadFc(args.uid);
    if (!fc) return { result: 'Error', message: 'POI source not found' };
    const built = formatPoiExport(fc, format);
    const fcId = (fc as unknown as { id?: unknown }).id;
    const slug = typeof fcId === 'string' && fcId !== '' ? fcId : 'poi';
    const filePath = await args.pickSavePath({ fileName: `${slug}.${built.extension}`, extension: format, format });
    if (!filePath) return { result: 'Canceled' };
    await writeFile(filePath, built.bytes);
    return { result: 'Success', filePath, omitted: built.omitted };
  } catch (error) {
    console.error('[PoiTableIoService] exportPoiTable failed:', error);
    return { result: 'Error', message: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// 取り込み (選択と解析を 1 回の呼び出しにする。パスは受け取らず、返さない)
// ---------------------------------------------------------------------------

// 取り込みの解析の唯一の入口。拡張子 (.csv・.kml) で振り分ける。ファイルを読む部分は呼び出し側に残る
// (返すコードが呼び出し側ごとに違う)。xmldom は KML のときだけ動的に読み込む (CSV や既存の処理の
// 読み込みに影響させない)。createDocument は試験が差し替えるための引数。
export async function parsePoiImportBytes(args: {
  ext: string;
  bytes: Uint8Array;
  defaultLang: string;
  createDocument?: (text: string) => KmlDocument;
}): Promise<PoiImportParseResult> {
  if (args.ext === '.csv') return parsePoiImportFile({ format: 'csv', bytes: args.bytes, defaultLang: args.defaultLang });
  if (args.ext === '.kml') {
    const createDocument = args.createDocument ?? (await loadXmlDocumentFactory());
    return parsePoiKml({ bytes: args.bytes, defaultLang: args.defaultLang, createDocument });
  }
  throw new Error(`unsupported extension: ${args.ext}`);
}

async function loadXmlDocumentFactory(): Promise<(text: string) => KmlDocument> {
  const imported = (await import('@xmldom/xmldom')) as unknown as {
    DOMParser?: typeof import('@xmldom/xmldom').DOMParser;
    default?: { DOMParser: typeof import('@xmldom/xmldom').DOMParser };
  };
  const DOMParser = imported.DOMParser ?? imported.default?.DOMParser;
  if (!DOMParser) throw new Error('xmldom DOMParser is unavailable');
  const quiet = { warning() {}, error() {}, fatalError() {} };
  return (text) => new DOMParser({ locator: {}, errorHandler: quiet }).parseFromString(text, 'text/xml') as unknown as KmlDocument;
}

export type PoiPickAndParseMergeResult =
  | { result: 'Canceled' }
  | { result: 'Parsed'; fileName: string; parse: PoiImportParseResult }
  | {
      result: 'Error';
      code: 'file-too-large' | 'unsupported-extension' | 'kmz-unsupported' | 'read-failed' | 'invalid-request' | 'internal';
      message?: string;
    };

// message は固定文。システムのエラー文 (パスを含みうる) は載せない
export async function pickAndParsePoiMerge(args: {
  input: unknown;
  // ファイル選択のダイアログ。返値 (ユーザーが選んだパス) だけを読む。キャンセルは null
  pickOpenPath: () => Promise<string | null>;
}): Promise<PoiPickAndParseMergeResult> {
  const lang = args.input && typeof args.input === 'object' ? (args.input as { lang?: unknown }).lang : undefined;
  if (typeof lang !== 'string' || !(LANG_CODES as readonly string[]).includes(lang)) {
    return { result: 'Error', code: 'invalid-request', message: 'invalid language' };
  }
  try {
    const picked = await args.pickOpenPath();
    if (!picked) return { result: 'Canceled' };
    const ext = path.extname(picked).toLowerCase();
    if (ext === '.kmz') return { result: 'Error', code: 'kmz-unsupported', message: 'KMZ is not supported' };
    if (ext !== '.csv' && ext !== '.kml') return { result: 'Error', code: 'unsupported-extension', message: 'unsupported file type' };
    let bytes: Uint8Array;
    try {
      if ((await stat(picked)).size > POI_IMPORT_MAX_BYTES) {
        return { result: 'Error', code: 'file-too-large', message: 'file too large' };
      }
      bytes = new Uint8Array(await readFile(picked));
    } catch {
      return { result: 'Error', code: 'read-failed', message: 'failed to read the file' };
    }
    if (bytes.length > POI_IMPORT_MAX_BYTES) return { result: 'Error', code: 'file-too-large', message: 'file too large' };
    const parse = await parsePoiImportBytes({ ext, bytes, defaultLang: lang });
    return { result: 'Parsed', fileName: path.basename(picked), parse };
  } catch (error) {
    console.error('[PoiTableIoService] pickAndParsePoiMerge failed:', error);
    return { result: 'Error', code: 'internal', message: 'internal error' };
  }
}
