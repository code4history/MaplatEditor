// IIIF の取り込みの IPC（6 本）。
//
// renderer は取得も判定もしない。main が取れた事実と検査を通した JSON を返し、
// 判定と組み立ては renderer が行う。引数の型と URL は main の側でもう一度検査する
// （URL の形と宛先の検査は fetchIiifResource が行う）。
//
// 返すのは構造化複製できる値だけにする（Buffer も Error も IPC を越えさせない）。

import { ipcMain } from 'electron';
import {
  inspectManifest,
  inspectInfo,
  fetchThumbnails,
  stageDraft,
  takeDraft,
  discardDraft,
  addDraftWarnings,
  iiifDraftFolder,
  type IiifImportDraftPayload,
  type IiifInspectResult,
} from '../services/iiifImportService';
import { saveIiifThumbnails } from '../services/MapUploadService';
import { resolveIiifResponseDeps } from '../services/iiifE2EResponses';

/** 引数が文字列で、空白だけでも空でもないこと。 */
function textArg(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.trim().length === 0) return null;
  return value;
}

/** 引数が素のオブジェクトであること（配列と null は受けない）。 */
function objectArg(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** 取得の結果から、IPC を越えられる事実だけを取り出す。 */
function toInspectReply(result: IiifInspectResult) {
  if (result.ok) {
    return {
      ok: true as const,
      json: result.json,
      requestedUrl: result.requestedUrl,
      finalUrl: result.finalUrl,
      accessControlAllowOrigin: result.accessControlAllowOrigin,
    };
  }
  return { ok: false as const, reason: result.reason, detail: result.detail };
}

/** 引数の不備の返し方（renderer が理由を 1 行で出せるようにする）。 */
function badArgument(detail: string) {
  return { ok: false as const, reason: 'bad-argument' as const, detail };
}

/**
 * IIIF の取り込みの IPC を登録する。二重登録を避けるため、呼ぶ側で解除してから呼ぶ。
 */
export const registerIiifImportHandlers = () => {
  // Manifest か info.json を取得して、検査を通した JSON と応答の事実を返す。
  ipcMain.handle('iiifImport:inspect', async (_event, arg: unknown) => {
    const args = objectArg(arg);
    if (!args) return badArgument('the argument must be an object');

    const deps = resolveIiifResponseDeps();
    const manifestUrl = textArg(args.manifestUrl);
    if (manifestUrl) return toInspectReply(await inspectManifest(manifestUrl, deps));

    const serviceUrl = textArg(args.serviceUrl);
    if (serviceUrl) return toInspectReply(await inspectInfo(serviceUrl, deps));

    return badArgument('manifestUrl or serviceUrl is required');
  });

  // サムネイル 2 枚を取得して、その下書きのフォルダへ書く。画像のバイトは返さない。
  ipcMain.handle('iiifImport:thumbnails', async (_event, arg: unknown) => {
    const args = objectArg(arg);
    if (!args) return badArgument('the argument must be an object');

    const draftId = textArg(args.draftId);
    const url52 = textArg(args.url52);
    const url512 = textArg(args.url512);
    if (!draftId || !url52 || !url512) {
      return badArgument('draftId, url52 and url512 are required');
    }

    const folder = iiifDraftFolder(draftId);
    if (!folder) return { ok: false as const, reason: 'draft-not-found' as const, detail: 'the draft id is unknown or expired' };

    const deps = resolveIiifResponseDeps();
    const fetched = await fetchThumbnails({ url52, url512 }, deps);

    // 52px の取得そのものが失敗したら取り込みを失敗させる（一覧に画像の無い地図を作らない）。
    if (!fetched.url52.ok) {
      return { ok: false as const, reason: fetched.url52.reason, detail: fetched.url52.detail };
    }

    const warnings: Array<{ errorCode: string; err: string }> = [];
    if (!fetched.url512.ok) {
      warnings.push({
        errorCode: 'unknown',
        err: 'thumbnail 512px could not be fetched: ' + fetched.url512.reason,
      });
    }

    const saved = await saveIiifThumbnails(folder, {
      thumb52: { body: fetched.url52.body, contentType: fetched.url52.contentType },
      ...(fetched.url512.ok
        ? { thumb512: { body: fetched.url512.body, contentType: fetched.url512.contentType } }
        : {}),
    });

    if (!saved.ok) {
      return { ok: false as const, reason: saved.errorCode, detail: saved.err };
    }

    // 512px の失敗は捨てず、預かりに印を足す（編集画面の側で 1 回だけ警告を出す）。
    if (warnings.length > 0 || saved.warnings.length > 0) {
      addDraftWarnings(draftId, ['thumbnail-512-failed']);
    }

    return { ok: true as const, warnings: [...warnings, ...saved.warnings] };
  });

  // 取り込みの結果を預かり、短い不透明な id を返す（引数が使えなければ null）。
  ipcMain.handle('iiifImport:stageDraft', async (_event, payload: unknown) => {
    const args = objectArg(payload);
    if (!args) return null;
    return await stageDraft(args as IiifImportDraftPayload);
  });

  // 預けた中身を 1 回だけ返す（無い・期限切れは null）。
  ipcMain.handle('iiifImport:takeDraft', async (_event, draftId: unknown, mapUid: unknown) => {
    const id = textArg(draftId);
    if (!id) return null;
    return await takeDraft(id, textArg(mapUid) ?? undefined);
  });

  // 預かりを捨てる。
  ipcMain.handle('iiifImport:discardDraft', async (_event, draftId: unknown) => {
    const id = textArg(draftId);
    if (!id) return false;
    return await discardDraft(id);
  });

  // Manifest を取り直して、inspect と同じ形で返す（サムネイルは取らない）。
  ipcMain.handle('iiifImport:recopy', async (_event, arg: unknown) => {
    const args = objectArg(arg);
    if (!args) return badArgument('the argument must be an object');
    const manifestUrl = textArg(args.manifestUrl);
    if (!manifestUrl) return badArgument('manifestUrl is required');
    const deps = resolveIiifResponseDeps();
    return toInspectReply(await inspectManifest(manifestUrl, deps));
  });
};
