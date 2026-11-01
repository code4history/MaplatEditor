// IIIF の取り込みで main が行う取得の入口（Manifest・info.json・サムネイル）。
//
// 取得の道は electron/services/iiifFetch.ts の fetchIiifResource 1 本だけを通す
// （別の道を作らない）。ここでは配れるかの判定をせず、取れた事実と JSON を返す
// だけにする。renderer とのやり取り（IPC）は electron/ipc/iiifimport.ts が持つ。
//
// あわせて、取り込みの結果を新規モードへ渡すための下書きの預かり所（main のメモリ・
// 期限つき）を置く。預ける中身は renderer が作り、ここは中身の意味づけをしない。

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  fetchIiifResource,
  type IiifFetchDeps,
  type IiifFetchFailure,
  type IiifFetchReason,
  type IiifFetchResult,
} from './iiifFetch';
import { draftTileRoot, resolveDraftTileDir } from './draftTilePaths';

/** 取得の依存の差し込み口。省略したら本物（名前解決・分類・要求）を使う。 */
export type IiifServiceDeps = Partial<IiifFetchDeps>;

/** JSON を読めなかったときの理由。取得の失敗の語彙に 1 語だけ足す。 */
export type IiifInspectReason = IiifFetchReason | 'not-json';

/** 取得の失敗、または本文を JSON として読めなかったこと。 */
export type IiifInspectFailure = Omit<IiifFetchFailure, 'reason'> & {
  reason: IiifInspectReason;
};

/** 取得して JSON にしたものと、応答の事実。 */
export type IiifInspectSuccess = {
  ok: true;
  /** `JSON.parse` に通した値。生の応答の文字列は返さない。 */
  json: unknown;
  /** 要求した URL。 */
  requestedUrl: string;
  /** 転送を追った後の最終 URL。 */
  finalUrl: string;
  /** 応答の `Access-Control-Allow-Origin`（無ければ undefined）。 */
  accessControlAllowOrigin?: string;
};

export type IiifInspectResult = IiifInspectSuccess | IiifInspectFailure;

/** サムネイル 1 枚の取得の結果。本文のバイトと `Content-Type` を返す。 */
export type IiifThumbnailResult = IiifFetchResult;

export type IiifThumbnailsResult = {
  url52: IiifThumbnailResult;
  url512: IiifThumbnailResult;
};

/** サムネイルの URL の組。URL は renderer が作って渡す。 */
export type IiifThumbnailUrls = { url52: string; url512: string };

/**
 * 画像サービスの URL から info.json の URL を作る。
 * すでに `/info.json` で終わっていれば足さない。末尾の `/` は 1 つにまとめる。
 */
export function iiifInfoJsonUrl(serviceUrl: string): string {
  if (serviceUrl.endsWith('/info.json')) return serviceUrl;
  // 末尾の / は 1 つにまとめる（Core が info.json の URL を作るときと同じ形）
  return serviceUrl.replace(/\/+$/, '') + '/info.json';
}

/**
 * 取得して本文を JSON として読む。JSON かどうかは `JSON.parse` で決める
 * （`Content-Type` は見ない）。読めなければ `not-json` を返す。
 */
async function fetchJsonResource(
  url: string,
  kind: 'manifest' | 'info',
  deps: IiifServiceDeps,
): Promise<IiifInspectResult> {
  const result = await fetchIiifResource(url, { kind }, deps);
  if (!result.ok) return result;

  let json: unknown;
  try {
    json = JSON.parse(result.body.toString('utf8'));
  } catch {
    return { ok: false, reason: 'not-json', detail: 'the response is not json: ' + url };
  }

  return {
    ok: true,
    json,
    requestedUrl: result.requestedUrl,
    finalUrl: result.finalUrl,
    accessControlAllowOrigin: result.accessControlAllowOrigin,
  };
}

/** Manifest を取得して JSON にする。 */
export async function inspectManifest(
  url: string,
  deps: IiifServiceDeps = {},
): Promise<IiifInspectResult> {
  return fetchJsonResource(url, 'manifest', deps);
}

/**
 * 画像サービスの info.json を取得して JSON にする。
 * `serviceUrl` の末尾に `/info.json` を足して取る（すでに終わっていれば足さない）。
 */
export async function inspectInfo(
  serviceUrl: string,
  deps: IiifServiceDeps = {},
): Promise<IiifInspectResult> {
  return fetchJsonResource(iiifInfoJsonUrl(serviceUrl), 'info', deps);
}

/**
 * サムネイル 2 枚（52px・512px）を取得する。URL は renderer が作って渡す。
 * この段では取るだけで、保存はしない。
 */
export async function fetchThumbnails(
  urls: IiifThumbnailUrls,
  deps: IiifServiceDeps = {},
): Promise<IiifThumbnailsResult> {
  const url52 = await fetchIiifResource(urls.url52, { kind: 'thumbnail' }, deps);
  const url512 = await fetchIiifResource(urls.url512, { kind: 'thumbnail' }, deps);
  return { url52, url512 };
}

// ---- 下書きの預かり所（main のメモリ・期限つき）------------------------------------
//
// 取り込みの結果（`delivery`・`iiif`・`width`・`height`・写した書誌）は URL の query に
// 載せきれない。renderer が作った中身を main がしばらく預かり、短い不透明な id だけを
// 受け渡しに使う。預けた中身は 1 回だけ返し、返したら消す。期限を過ぎたものは中身と
// サムネイルの下書きのフォルダごと消す。

/**
 * 預ける中身（renderer が作る）。中身の意味づけは renderer が持つ。
 * `warnings` は編集画面の側で 1 回だけ出す警告の印。
 */
export type IiifImportDraftPayload = {
  /** 配信先（IIIF の画像サービス）。書誌だけの道では持たない。 */
  delivery?: { type: 'iiifImage'; url: string };
  /** 地図データの iiif 節（結び付きと写した書誌）。 */
  iiif?: Record<string, unknown>;
  width?: number;
  height?: number;
  /** 写した地図の書誌（鍵 → 値）。 */
  metadata?: Record<string, unknown>;
  /** 編集画面の側で 1 回だけ出す警告の印。 */
  warnings?: string[];
};

/** 預かりの期限（ミリ秒）。 */
export const IIIF_DRAFT_TTL_MS = 15 * 60 * 1000;

/** サムネイルの下書きのフォルダの名前の前置き（`iiif-<draftId>`）。 */
const IIIF_DRAFT_FOLDER_PREFIX = 'iiif-';

type IiifDraftEntry = {
  payload: IiifImportDraftPayload;
  expiresAt: number;
  /** サムネイルの下書きのフォルダ（既存の検証つきの関数で解決した絶対パス）。 */
  folder: string | null;
  /** 預けた後に分かった警告の印（サムネイルの取得の結果など）。 */
  warnings: string[];
};

const iiifDrafts = new Map<string, IiifDraftEntry>();

let draftClock: () => number = () => Date.now();

/**
 * 預かり所の時計を差し替える。省略すると実時計へ戻す。
 * 期限の判定を、待たずに進めて確かめるための口。
 */
export function setIiifDraftStoreClock(clock?: () => number): void {
  draftClock = clock ?? (() => Date.now());
}

/** サムネイルの下書きのフォルダを、既存の検証つきの関数で解決する（手で組み立てない）。 */
function draftFolderOf(draftId: unknown): string | null {
  if (typeof draftId !== 'string' || draftId.length === 0) return null;
  return resolveDraftTileDir(draftTileRoot, IIIF_DRAFT_FOLDER_PREFIX + draftId);
}

/** 下書きのフォルダを丸ごと消す（無ければ何もしない）。 */
async function removeDraftFolder(folder: string): Promise<void> {
  await fs.promises.rm(folder, { recursive: true, force: true });
}

/** 期限を過ぎた預かりを、中身とフォルダごと消す。 */
async function sweepExpiredDrafts(): Promise<void> {
  const now = draftClock();
  for (const [draftId, entry] of iiifDrafts) {
    if (entry.expiresAt > now) continue;
    iiifDrafts.delete(draftId);
    if (entry.folder) {
      try {
        await removeDraftFolder(entry.folder);
      } catch {
        // 消せなくても預かりからは外す（残骸は起動時の孤児の回収が拾う）
      }
    }
  }
}

/** 下書きのフォルダの中身を、保存のときに使う場所へ移す（移せなければ下書きに残す）。 */
async function moveDraftFolderContents(source: string, target: string): Promise<void> {
  await fs.promises.mkdir(target, { recursive: true });
  const names = await fs.promises.readdir(source);
  for (const name of names) {
    const from = path.join(source, name);
    const to = path.join(target, name);
    const stat = await fs.promises.stat(from).catch(() => null);
    if (!stat) continue;
    if (stat.isDirectory()) {
      await fs.promises.rm(to, { recursive: true, force: true });
      await fs.promises.rename(from, to);
      continue;
    }
    try {
      await fs.promises.rename(from, to);
    } catch {
      await fs.promises.copyFile(from, to);
      await fs.promises.unlink(from);
    }
  }
}

/**
 * 取り込みの結果を預かり、短い不透明な id を返す。期限は 15 分。
 * サムネイルの下書きのフォルダは、この id から既存の検証つきの関数で解決する。
 */
export async function stageDraft(payload: IiifImportDraftPayload): Promise<string> {
  await sweepExpiredDrafts();
  const draftId = crypto.randomUUID();
  iiifDrafts.set(draftId, {
    payload,
    expiresAt: draftClock() + IIIF_DRAFT_TTL_MS,
    folder: draftFolderOf(draftId),
    warnings: [],
  });
  return draftId;
}

/**
 * 預けた後に分かった警告の印を足す（サムネイルの取得の結果など）。
 * 預かっていない・期限切れの id は何もしない。
 */
export function addDraftWarnings(draftId: string, warnings: string[]): void {
  const entry = iiifDrafts.get(draftId);
  if (!entry || warnings.length === 0) return;
  entry.warnings.push(...warnings);
}

/** 預かっている下書きのサムネイルのフォルダ（無い・期限切れなら null）。 */
export function iiifDraftFolder(draftId: string): string | null {
  const entry = iiifDrafts.get(draftId);
  if (!entry) return null;
  if (entry.expiresAt <= draftClock()) return null;
  return entry.folder;
}

/**
 * 預かりから中身を 1 回だけ返して消す。`mapUid` があれば、サムネイルの下書きの
 * フォルダの中身を、保存のときに既存の決まりで動かす場所（`resolveDraftTileDir`）へ
 * 移す。無い・期限切れの id は null。
 */
export async function takeDraft(
  draftId: string,
  mapUid?: string,
): Promise<IiifImportDraftPayload | null> {
  await sweepExpiredDrafts();
  const entry = iiifDrafts.get(draftId);
  if (!entry) return null;
  iiifDrafts.delete(draftId);

  const target = typeof mapUid === 'string' && mapUid.length > 0 ? resolveDraftTileDir(draftTileRoot, mapUid) : null;
  if (entry.folder && target) {
    try {
      await moveDraftFolderContents(entry.folder, target);
      await removeDraftFolder(entry.folder);
    } catch {
      // 移せなかったときは下書きの場所に残す（起動時の孤児の回収が拾う）
    }
  }

  // 預けた中身の警告と、預けた後に分かった警告（サムネイルの取得など）を合わせて返す。
  if (entry.warnings.length === 0) return entry.payload;
  const carried = Array.isArray(entry.payload.warnings) ? entry.payload.warnings : [];
  return { ...entry.payload, warnings: [...carried, ...entry.warnings] };
}

/** 預かりを捨てる（中身とサムネイルのフォルダを消す）。預かっていなければ false。 */
export async function discardDraft(draftId: string): Promise<boolean> {
  await sweepExpiredDrafts();
  const entry = iiifDrafts.get(draftId);
  if (!entry) return false;
  iiifDrafts.delete(draftId);
  if (entry.folder) {
    try {
      await removeDraftFolder(entry.folder);
    } catch {
      // 消せなくても預かりからは外す
    }
  }
  return true;
}

/** アプリの終了のときに、残っている預かりを全部消す（同期的に消す）。 */
export function clearAllIiifDrafts(): void {
  for (const [draftId, entry] of iiifDrafts) {
    iiifDrafts.delete(draftId);
    if (!entry.folder) continue;
    try {
      fs.rmSync(entry.folder, { recursive: true, force: true });
    } catch {
      // 消せなくても預かりからは外す
    }
  }
}
