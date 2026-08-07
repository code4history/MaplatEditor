/**
 * draftTilePaths.ts (M12-T20)
 *
 * 下書きタイルの永続 staging 領域 `<draftTileRoot>/<assetUid>` のパス解決・検証の
 * Single Source of Truth（設計 §5.0）。
 *
 * `<draftTileRoot>/<assetUid>` およびそれに類するパスを組み立てる**すべての箇所**
 * （upload IPC / AssetDraftService onRemoved / mapedit:stagingStatus / mapedit:save の
 * stagingCheck / 起動時孤児 GC）は本モジュールを import して使う。検証ロジックを各所へ
 * コピーしないこと（恒久指示「同一扱いの処理は共通実装へ寄せる」）。
 *
 * 契約: `resolveDraftTileDir` / `resolveStagingDirFromUrl` は解決不能なとき例外を投げず
 * `null` を返す（decode 失敗 = `fileURLToPath` の throw も null へ写像する。設計 §5.0 v1.2）。
 * 呼び出し側は catch を書かなくてよい。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import fileUrl from 'file-url';
import { resolveRuntimeStoragePaths } from './runtimeStoragePaths';

/** 非 isolated 環境での staging ルート既定値（設計 §5.1: userData/draft-tiles） */
export function defaultDraftTileRoot(): string {
  return path.join(app.getPath('userData'), 'draft-tiles');
}

/** 実行時の staging ルート（E2E: MAPLAT_E2E_ROOT/draft-tiles / 通常: userData/draft-tiles） */
export const draftTileRoot: string = resolveRuntimeStoragePaths(
  process.env.MAPLAT_E2E_ROOT,
  path.join(app.getPath('documents'), app.getName()),
  defaultDraftTileRoot(),
).draftTileRoot;

// 条件1: validUid と同一基準（src/services/assetDraftStore.ts の validUid と同条件:
// string・trim() 一致・長さ 1..256・制御文字 U+0000〜U+001F なし）
const validSegmentBase = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f]/.test(value);

/**
 * `<rootDir>/<segment>` を検証付きで解決する（設計 §5.0 の4条件）。
 * 4条件をすべて満たす場合のみ解決済み絶対パスを返し、1つでも欠ければ null（例外は投げない）:
 *   1. validUid 同基準
 *   2. `'.'` / `'..'` の明示拒否（validUid とパス区切り拒否だけでは素通りするため独立条件。
 *      v1.0 設計レビュー Major1: `assetUid='..'` で `<draftTileRoot>/..` = userData 自体を
 *      指し、クリア/削除が userData を破壊し得た欠陥の直接対応）
 *   3. パス区切り文字（`/` および `\`）を含まない（`\` は POSIX ではファイル名有効文字だが安全側で拒否）
 *   4. `path.resolve(root, segment)` が `root + path.sep` で始まり（セパレータ境界込み包含。
 *      素朴な startsWith(root) は兄弟 dir `draft-tiles-evil` を通す）、かつ残余セグメントに
 *      パス区切りを含まない（= root 直下1階層のみ許可）
 */
export function resolveDraftTileDir(rootDir: string, segment: unknown): string | null {
  try {
    if (!validSegmentBase(segment)) return null;
    if (segment === '.' || segment === '..') return null;
    if (segment.includes('/') || segment.includes('\\')) return null;
    const root = path.resolve(rootDir);
    const resolved = path.resolve(root, segment);
    const prefix = root + path.sep;
    if (!resolved.startsWith(prefix)) return null;
    const rest = resolved.slice(prefix.length);
    if (rest.length === 0 || rest.includes('/') || rest.includes('\\')) return null;
    return resolved;
  } catch {
    return null;
  }
}

/**
 * url_ が staging 領域（`fileUrl(draftTileRoot) + '/'`）を指しているかのプレフィックス判定
 * （セパレータ境界込み）。save の stagingCheck 分岐と stagingStatus が「staging 候補か」の
 * 一次判定に使う（候補だが resolveStagingDirFromUrl が null の場合の挙動は構築点ごとに
 * 設計 §5.0 の表で規定される）。
 */
export function isDraftTileUrl(stagingRoot: string, url_: unknown): boolean {
  try {
    return typeof url_ === 'string' && url_.startsWith(fileUrl(path.resolve(stagingRoot)) + '/');
  } catch {
    return false;
  }
}

// タイルテンプレート `/{z}/{x}/{y}.<ext>` のサフィックス（imageCutter が生成する url 形式）
const TILE_TEMPLATE_SUFFIX_RE = /\/\{z\}\/\{x\}\/\{y\}\.[^./\\]+$/;

/**
 * url_ から staging dir を導出する唯一の経路（設計 §5.0）。
 *   1. staging プレフィックス（セパレータ境界込み）で始まらなければ null
 *   2. `/{z}/{x}/{y}.<ext>` サフィックスを除いた部分を `fileURLToPath` で**実パスへ復号
 *      してから**、`path.relative(root, resolved)` で得たセグメントを `resolveDraftTileDir`
 *      に委譲する（包含判定は同一実装を必ず通る）。検証は percent-decode 後の実パスに対して
 *      行う（`%2e%2e` 等のエンコード表現による `'..'` 迂回を防ぐため、生文字列比較で代替しない）
 *   3. decode 失敗（`fileURLToPath` の throw: `%2F` や不正 percent-encoding 等）を含め、
 *      内部処理で発生する例外はすべて捕捉して null を返す（v1.2・レビュー v2 Minor1）
 */
export function resolveStagingDirFromUrl(stagingRoot: string, url_: string): string | null {
  try {
    if (!isDraftTileUrl(stagingRoot, url_)) return null;
    const suffixMatch = url_.match(TILE_TEMPLATE_SUFFIX_RE);
    if (!suffixMatch || suffixMatch.index === undefined) return null;
    const dirUrl = url_.slice(0, suffixMatch.index);
    const root = path.resolve(stagingRoot);
    const resolved = path.resolve(fileURLToPath(dirUrl));
    const segment = path.relative(root, resolved);
    return resolveDraftTileDir(root, segment);
  } catch {
    return null;
  }
}
