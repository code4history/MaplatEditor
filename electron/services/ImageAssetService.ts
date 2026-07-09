// 画像アセットの domain layer (Phase 2 Task 4, ADR-0007)。正本は Write Store (maplat.sqlite) の
// assets テーブル(メタデータのみ)。バイト実体は {saveFolder}/assets/{uid}.{ext} に置く
// (43 §7: 画像等バイト列は fs、メタデータのみ DB)。PoiSourceService と同じく SqliteDataService の
// CRUD に LangResource 正規化 (ADR-0005) と結果 union の慣習を被せる薄い層。
//
// デコード/メタデータ抽出(mime/width/height)は AppAssetService のサムネイル生成と同じ jimp を
// 再利用する(新規依存を足さない)。バイトはコピーのみ(Jimpで再エンコードしない — 元画質を保つ)。
// ファイル書込は atomic tmp-rename: `{dest}.tmp` へコピー後 fs.move(overwrite:false) で確定する。
// 削除は DB 行削除後、実体を `{saveFolder}/assets/_trash/{uid}.{ext}` へ退避する(ユーザーデータの
// 即時物理削除はしない)。ファイル操作は DB コミット後のベストエフォート(MapEditService.save と
// 同じ「DBは正、ファイル操作の失敗はログのみ」方針)。
import path from 'node:path';
import fs from 'fs-extra';
import { Jimp } from 'jimp';
import SqliteDataService, { RevisionConflictError, type AssetRecord } from './SqliteDataService';
import SettingsService from './SettingsService';
import { normalizeLangResource, type LangResource } from '../../src/utils/langResource';

// POI editor と同じ既定言語 (ADR-0005)
const DEFAULT_LANG = 'ja';

// jimp が mime を返さない場合の拡張子フォールバック(通常は各デコーダが mime を設定する)
const EXT_MIME_FALLBACK: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

// Error 結果の機械可読コード: 'not-found' = 対象アセット/元ファイル不在、
// 'invalid-request' = 引数不正(slug欠落・拡張子不明・デコード不能な非画像ファイル)、
// 'internal' = 予期しない内部エラー
export type ImageAssetErrorCode = 'not-found' | 'invalid-request' | 'internal';

// 保存系の結果 union (PoiSourceSaveResult と同形の慣習)。Error は post-commit のファイル操作失敗時
// (MapEditService.save と同様) に uid/slug/revision を伴うことがある
export type ImageAssetSaveResult =
  | { result: 'Success'; uid: string; slug: string; revision: number; mime: string; ext: string; width: number | null; height: number | null }
  | { result: 'Exist' }
  | { result: 'Error'; code: ImageAssetErrorCode; message?: string; uid?: string; slug?: string; revision?: number }
  | { error: 'revision-conflict'; current: number };

// 一覧/取得行: バイト実体を含まない (43 §7)
export interface ImageAssetSummary {
  uid: string;
  slug: string;
  title: Record<string, string>;
  mime: string;
  ext: string;
  width: number | null;
  height: number | null;
  byteSize: number;
  revision: number;
  updatedAt: string;
}

export class ImageAssetService {
  private get saveFolder(): string {
    return SettingsService.get('saveFolder') as string;
  }

  private get assetsDir(): string {
    return path.join(this.saveFolder, 'assets');
  }

  private titleInternal(title: unknown): Record<string, string> {
    return normalizeLangResource(title as LangResource | null | undefined, DEFAULT_LANG);
  }

  private summary(record: AssetRecord): ImageAssetSummary {
    return {
      uid: record.uid,
      slug: record.slug,
      title: this.titleInternal(record.title),
      mime: record.mime,
      ext: record.ext,
      width: record.width,
      height: record.height,
      byteSize: record.byteSize,
      revision: record.revision,
      updatedAt: record.updatedAt,
    };
  }

  // registerAsset/renameAssetSlug の slug 衝突(レースで先取り)を 'Exist' に写像
  // (PoiSourceService.mapWriteError と同機構)。asset は upsert-as-insert のみで
  // not-found ガードを持たないため、ここでは revision-conflict / slug衝突 / internal のみ扱う
  private mapWriteError(e: any): ImageAssetSaveResult {
    if (e instanceof RevisionConflictError) {
      return { error: 'revision-conflict', current: e.current };
    }
    if (e && typeof e.message === 'string' && e.message.startsWith('Slug already in use')) {
      return { result: 'Exist' };
    }
    console.error('[ImageAssetService] write error:', e);
    return { result: 'Error', code: 'internal', message: e instanceof Error ? e.message : String(e) };
  }

  // atomic tmp-rename: 同名 dest への書込中に読まれる/クラッシュで壊れたファイルが残ることを防ぐ。
  // dest は新規採番された uid を含むため通常は衝突しないが、失敗時は tmp を掃除してから再送出する
  private async copyBytesAtomic(sourcePath: string, destPath: string): Promise<void> {
    const tmpPath = `${destPath}.tmp`;
    try {
      await fs.remove(tmpPath);
      await fs.copy(sourcePath, tmpPath);
      await fs.move(tmpPath, destPath, { overwrite: false });
    } catch (e) {
      try {
        await fs.remove(tmpPath);
      } catch {
        // noop
      }
      throw e;
    }
  }

  // 任意の画像ファイルを読み、mime/width/height を抽出する。デコード不能(非画像/未対応形式)なら null
  private async readImageMeta(sourcePath: string, ext: string): Promise<{ mime: string; width: number; height: number } | null> {
    try {
      const image = await Jimp.read(sourcePath);
      const mime = image.mime ?? EXT_MIME_FALLBACK[ext] ?? `image/${ext}`;
      return { mime, width: image.width, height: image.height };
    } catch {
      return null;
    }
  }

  // --- Public API ---

  // sourcePath のバイトを {saveFolder}/assets/{uid}.{ext} へコピーし、メタデータを新規登録する
  async add(input: { slug: string; title: LangResource; sourcePath: string }): Promise<ImageAssetSaveResult> {
    const slug = String(input.slug ?? '').trim();
    if (!slug) return { result: 'Error', code: 'invalid-request', message: 'slug is required' };
    if (!(await SqliteDataService.isSlugAvailable(slug))) return { result: 'Exist' };

    const sourcePath = String(input.sourcePath ?? '');
    if (!sourcePath) return { result: 'Error', code: 'invalid-request', message: 'sourcePath is required' };
    if (!(await fs.pathExists(sourcePath))) {
      return { result: 'Error', code: 'not-found', message: `File not found: ${sourcePath}` };
    }
    const ext = path.extname(sourcePath).slice(1).toLowerCase();
    if (!ext) return { result: 'Error', code: 'invalid-request', message: 'sourcePath must have a file extension' };

    const meta = await this.readImageMeta(sourcePath, ext);
    if (!meta) {
      return { result: 'Error', code: 'invalid-request', message: `Unsupported or corrupt image file: ${sourcePath}` };
    }
    const stat = await fs.stat(sourcePath);

    let uid: string;
    try {
      const created = await SqliteDataService.createAsset(slug, {
        title: this.titleInternal(input.title),
        mime: meta.mime,
        ext,
        width: meta.width,
        height: meta.height,
        byteSize: stat.size,
      });
      uid = created.uid;
    } catch (e: any) {
      return this.mapWriteError(e);
    }

    try {
      await fs.ensureDir(this.assetsDir);
      await this.copyBytesAtomic(sourcePath, path.join(this.assetsDir, `${uid}.${ext}`));
    } catch (e: any) {
      // DBは既にコミット済み: uid/slug/revision を返し、レンダラが再アップロード等で復旧できるようにする
      // (MapEditService.save の post-commit file operation failure と同じ方針)
      console.error('[ImageAssetService.add] post-commit file copy failed:', e);
      return { result: 'Error', code: 'internal', message: e?.message ?? String(e), uid, slug, revision: 1 };
    }

    return { result: 'Success', uid, slug, revision: 1, mime: meta.mime, ext, width: meta.width, height: meta.height };
  }

  // uid正準 + slug フォールバック (SqliteDataService.findAssetByRef, ADR-0007)
  async get(ref: string): Promise<ImageAssetSummary | null> {
    const record = await SqliteDataService.findAssetByRef(ref);
    return record ? this.summary(record) : null;
  }

  async list(): Promise<ImageAssetSummary[]> {
    const rows = await SqliteDataService.listAssets();
    return rows.map((row) => this.summary(row));
  }

  async search(query: string): Promise<ImageAssetSummary[]> {
    const trimmed = String(query ?? '').trim();
    const rows = trimmed ? await SqliteDataService.searchAssets(trimmed) : await SqliteDataService.listAssets();
    return rows.map((row) => this.summary(row));
  }

  // slug/title の改名。expectedRevision は楽観ロック。mime/ext/width/height/byteSize はバイト実体を
  // 変えないため既存値を維持する(rename はメタデータのみの操作)
  async rename(
    uid: string,
    input: { slug: string; title: LangResource; expectedRevision?: number },
  ): Promise<ImageAssetSaveResult> {
    const existing = await SqliteDataService.findAsset(uid);
    if (!existing) return { result: 'Error', code: 'not-found', message: `Asset not found: ${uid}` };

    const slug = String(input.slug ?? '').trim();
    if (!slug) return { result: 'Error', code: 'invalid-request', message: 'slug is required' };
    if (slug !== existing.slug && !(await SqliteDataService.isSlugAvailable(slug, uid))) {
      return { result: 'Exist' };
    }

    try {
      const { revision } = await SqliteDataService.upsertAssetMeta(
        uid,
        slug,
        {
          title: this.titleInternal(input.title),
          mime: existing.mime,
          ext: existing.ext,
          width: existing.width ?? undefined,
          height: existing.height ?? undefined,
          byteSize: existing.byteSize,
        },
        input.expectedRevision ?? undefined,
      );
      return {
        result: 'Success',
        uid,
        slug,
        revision,
        mime: existing.mime,
        ext: existing.ext,
        width: existing.width,
        height: existing.height,
      };
    } catch (e: any) {
      return this.mapWriteError(e);
    }
  }

  // 削除: DB行・registryを掃除した後、実体は削除せず _trash へ退避する(ユーザーデータの保全)。
  // 対象が既に存在しない場合は no-op として成功扱い(冪等)
  async delete(uid: string): Promise<{ ok: true }> {
    const existing = await SqliteDataService.findAsset(uid);
    if (!existing) return { ok: true };

    await SqliteDataService.deleteAsset(uid);

    const from = path.join(this.assetsDir, `${existing.uid}.${existing.ext}`);
    if (await fs.pathExists(from)) {
      const trashDir = path.join(this.assetsDir, '_trash');
      try {
        await fs.ensureDir(trashDir);
        let to = path.join(trashDir, `${existing.uid}.${existing.ext}`);
        let suffix = 1;
        while (await fs.pathExists(to)) {
          to = path.join(trashDir, `${existing.uid}.${suffix}.${existing.ext}`);
          suffix++;
        }
        await fs.move(from, to, { overwrite: false });
      } catch (e) {
        // DBは既にコミット済み: 退避に失敗しても削除自体は成功として扱う(実体は assets/ 直下に残るのみ)
        console.warn(`[ImageAssetService] failed to move deleted asset to trash: ${from}`, e);
      }
    }
    return { ok: true };
  }

  // renderer 表示用の file:// URL (AppAssetService.fileUrlFor と同じ形)。実体が無ければ null
  async getFilePath(ref: string): Promise<string | null> {
    const record = await SqliteDataService.findAssetByRef(ref);
    if (!record) return null;
    const abs = path.join(this.assetsDir, `${record.uid}.${record.ext}`);
    if (!(await fs.pathExists(abs)) || !(await fs.stat(abs)).isFile()) return null;
    return `file://${abs.split(path.sep).join('/')}`;
  }
}

export default new ImageAssetService();
