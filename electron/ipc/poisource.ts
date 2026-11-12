import { dialogDefaultPath, rememberDialogPath } from '../utils/dialogFolders';
import { dialog, BrowserWindow } from 'electron';
import { ipc } from './registry';
import path from 'path';
import os from 'os';
import poiSourceService from '../services/PoiSourceService';
import { inspectPoiExport, writePoiExport } from '../services/PoiPackageService';
// #100: 長時間 IPC ハンドラを uncaughtException 時の settle 保証で wrap する
import { runGuarded } from '../utils/inflightGuard';
import { exportPoiTable, pickAndParsePoiMerge } from '../services/PoiTableIoService';
import { normalizePoiExportOptions } from '../../src/utils/exportOptions';
import { createPickedPathStore } from '../utils/pickedPathStore';

// 取り込み用に利用者が選んだファイルのパスを覚える表（画像の一次表示と同じ実装・別のインスタンス）。
// renderer には token だけを返し、importFile・detectImportLanguage は token だけを受け取る。
// renderer からパス文字列を受け取って開く口は作らない（乗っ取られた renderer に任意のファイルを読ませない）
const pickedImportPaths = createPickedPathStore();

/** token → 選ばれたパス。token 以外（パス文字列を含む）は解決しない */
function resolvePickedImportPath(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const resolved = pickedImportPaths.resolve(token);
  return resolved.ok ? resolved.filePath : null;
}

/**
 * renderer から届いた取り込みの依頼を、main だけが知るパスへ置き換える。
 * 受け取るのは token と slug などの値だけで、`filePath` が混じっていても使わない。
 */
function toImportInput(input: unknown) {
  const raw = (input ?? {}) as Record<string, unknown>;
  const filePath = resolvePickedImportPath(raw.token);
  if (filePath === null) return null;
  return {
    slug: raw.slug as string,
    title: raw.title as Record<string, string>,
    filePath,
    lang: raw.lang as string | undefined,
    langOverride: raw.langOverride as boolean | undefined,
    uid: raw.uid as string | undefined,
  };
}

/**
 * 取り込みの失敗の応答の message から、利用者の手元のパスだけを伏せる。
 * service の message には `ENOENT … '<絶対パス>'` が入ることがある。一方、ZIP の中の名前
 * （`pois/*.geojson`・`imgs/…`）を含む検証の文言は利用者に役立つので、message ごとは落とさない。
 * 伏せるのは選んだパス・その親・ホームディレクトリ（長い順）。原文は main のログへだけ出す。
 */
function withoutPathInMessage<T>(result: T, filePath: string): T {
  if (!result || typeof result !== 'object') return result;
  const record = result as Record<string, unknown>;
  const { message } = record;
  if (record.result !== 'Error' || typeof message !== 'string') return result;
  const replacements: Array<[string, string]> = [
    [filePath, '<file>'],
    [path.dirname(filePath), '<dir>'],
    [os.homedir(), '~'],
  ];
  let redacted = message;
  for (const [needle, label] of replacements.sort((a, b) => b[0].length - a[0].length)) {
    if (needle && needle !== path.sep && needle !== '.') redacted = redacted.split(needle).join(label);
  }
  if (redacted === message) return result;
  console.error('[poisource:importFile] failed:', message);
  return { ...record, message: redacted } as T;
}

// POI ソース IPC (Phase 2 Task 3, ADR-0007)。channel prefix は poisource:* を維持しつつ
// 引数契約を uid/slug へ刷新。結果 union は maps/apps と同形 (PoiSourceSaveResult)
export function registerPoisourceHandlers() {
  ipc.handle('poisource:list', (_, request) => poiSourceService.list(request));
  ipc.handle('poisource:get', (_, uid) => poiSourceService.get(uid));
  ipc.handle('poisource:createLocal', (_, input) => poiSourceService.createLocal(input));
  ipc.handle('poisource:save', (_, uid, payload) => poiSourceService.save(uid, payload));
  // 取り込むファイルは pickImportFile が返した token で指す。選んでいない・期限切れの token は
  // ファイルを開かずに invalid-request で返す。token が正しくても、選んだ後でファイルが消えたときなどの
  // 失敗の応答には、パスを含みうる message を載せない（例外も同じ。原文はログへ）
  ipc.handle('poisource:importFile', async (_, input) => {
    const importInput = toImportInput(input);
    if (!importInput) return { result: 'Error', code: 'invalid-request' } as const;
    try {
      const result = await runGuarded('poisource:importFile', () => poiSourceService.importFile(importInput));
      return withoutPathInMessage(result, importInput.filePath);
    } catch (error) {
      console.error('[poisource:importFile] failed:', error);
      return { result: 'Error', code: 'internal' } as const;
    }
  });
  // 言語の判定は補助なので、token が解決しないとき・読めないとき（選んだ後で消えた等）は
  // 既定の言語を返す。例外の原文（パスを含む）を renderer へ渡さない。続く importFile が失敗を返す
  ipc.handle('poisource:detectImportLanguage', async (_, token, fallbackLang) => {
    const filePath = resolvePickedImportPath(token);
    if (filePath === null) return poiSourceService.defaultImportLanguage(fallbackLang);
    try {
      return await poiSourceService.detectImportLanguage(filePath, fallbackLang);
    } catch (error) {
      console.error('[poisource:detectImportLanguage] failed:', error);
      return poiSourceService.defaultImportLanguage(fallbackLang);
    }
  });
  ipc.handle('poisource:registerRemote', (_, input) => poiSourceService.registerRemote(input));
  ipc.handle('poisource:refreshRemote', (_, uid) =>
    runGuarded('poisource:refreshRemote', () => poiSourceService.refreshRemote(uid)));
  ipc.handle('poisource:cloneToLocal', (_, uid, input) =>
    runGuarded('poisource:cloneToLocal', () => poiSourceService.cloneToLocal(uid, input)));
  ipc.handle('poisource:findReferences', (_, uid) => poiSourceService.findReferences(uid));
  ipc.handle('poisource:delete', (_, uid) => poiSourceService.delete(uid));
  // rendererから任意pathを受け取らず、保存先はnative dialogの返値だけを使う。
  // options は画像を含めるか（GeoJSON・zip の書き出し。省くと含める）。CSV・JSON は exportTable が受け持つ
  ipc.handle('poisource:exportFile', async (event, uid: string, options?: unknown) => {
    try {
      const { includeImages } = normalizePoiExportOptions({
        format: 'geojson',
        includeImages: (options as { includeImages?: unknown } | null | undefined)?.includeImages,
      });
      const fc = await poiSourceService.exportForm(uid);
      if (!fc) return { result: 'Error', message: 'POI source not found' } as const;
      const inspection = await inspectPoiExport(fc, { includeImages });
      const extension = inspection.kind === 'zip' ? 'zip' : 'geojson';
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const dialogOptions = {
        filters: inspection.kind === 'zip'
          ? [{ name: 'POI package', extensions: ['zip'] }]
          : [{ name: 'GeoJSON', extensions: ['geojson', 'json'] }],
        defaultPath: dialogDefaultPath('export', `${inspection.slug}.${extension}`),
      };
      const ret = win
        ? await dialog.showSaveDialog(win, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions);
      if (ret.canceled || !ret.filePath) return { result: 'Canceled' } as const;
      rememberDialogPath('export', ret.filePath, 'file');
      await runGuarded('poisource:exportFile', () => writePoiExport(inspection, ret.filePath));
      return { result: 'Success', filePath: ret.filePath } as const;
    } catch (error) {
      console.error('[poisource:exportFile] failed:', error);
      return {
        result: 'Error',
        message: error instanceof Error ? error.message : String(error),
      } as const;
    }
  });

  // CSV・JSON の書き出し。rendererから任意pathを受け取らず、保存先は保存ダイアログの返値だけを使う。
  ipc.handle('poisource:exportTable', (event, uid, format) =>
    runGuarded('poisource:exportTable', () =>
      exportPoiTable({
        uid,
        format,
        loadFc: (ref) => poiSourceService.exportForm(ref),
        pickSavePath: async ({ fileName, extension }) => {
          const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
          const options = {
            filters: extension === 'csv'
              ? [{ name: 'CSV', extensions: ['csv'] }]
              : [{ name: 'JSON', extensions: ['json'] }],
            defaultPath: dialogDefaultPath('export', fileName),
          };
          const ret = win
            ? await dialog.showSaveDialog(win, options)
            : await dialog.showSaveDialog(options);
          if (ret.canceled || !ret.filePath) return null;
          rememberDialogPath('export', ret.filePath, 'file');
          return ret.filePath;
        },
      })));

  // 開いているソースへの取り込み（追記・上書き）。ファイルの選択と解析を 1 回で行い、パスは受け取らず返さない。
  ipc.handle('poisource:pickAndParseMerge', (event, input) =>
    runGuarded('poisource:pickAndParseMerge', () =>
      pickAndParsePoiMerge({
        input,
        pickOpenPath: async () => {
          const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
          const options = {
            defaultPath: dialogDefaultPath('import'),
            properties: ['openFile' as const],
            filters: [{ name: 'CSV / KML', extensions: ['csv', 'kml'] }],
          };
          const ret = win
            ? await dialog.showOpenDialog(win, options)
            : await dialog.showOpenDialog(options);
          if (ret.canceled || ret.filePaths.length === 0) return null;
          rememberDialogPath('import', ret.filePaths[0], 'file');
          return ret.filePaths[0];
        },
      })));

  // インポート用ファイル選択 (Phase 3)。GeoJSON/JSON/ZIP/CSV/KML を選ばせ、token とファイル名を返す（パスは返さない）。
  // 実取り込みは renderer が slug/title を収集後に token を添えて poisource:importFile を呼ぶ二段構え。
  ipc.handle('poisource:pickImportFile', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = {
      defaultPath: dialogDefaultPath('import'),
      properties: ['openFile' as const],
      filters: [{ name: 'POI data', extensions: ['geojson', 'json', 'zip', 'csv', 'kml'] }],
    };
    const ret = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (ret.canceled || ret.filePaths.length === 0) return null;
    const filePath = ret.filePaths[0];
    rememberDialogPath('import', filePath, 'file');
    return { token: pickedImportPaths.register(filePath), fileName: path.basename(filePath) };
  });
}
