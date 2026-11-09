// POI の表形式 (CSV・JSON) の入出力。ファイルの整形と書き込みだけを担い、保存先のダイアログや
// DB の読み出しは呼び出し側 (ipc/poisource.ts) が関数で渡す。renderer から任意のパスを受け取らない。
import { writeFile } from 'node:fs/promises';
import type { FeatureCollection } from 'geojson';
import { buildPoiCsv, buildPoiJson, type PoiExportOmitted } from '../../src/utils/poiCsvExport';

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
