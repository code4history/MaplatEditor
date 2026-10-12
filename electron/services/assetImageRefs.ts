// nov26-m6-t5 (#109・HR-15): 画像の内部名を UUID に統一するための共有部品。
//
// 起動時の移行（AssetUuidNamesMigrationService）と保存の入口の正規化（AppDataService.saveApp）が
// 同じ規則で「UUID の形か」「保存フォルダの中か」「複製して確かめる」を判定するため、ここに集める。
// 命名の契約はタスク設計 `2026-10-11-nov26-m6-t5-task-design.md` §2 が唯一の定義:
//   スプラッシュ        : appSettings.splash = `{uuid}.{ext}`（置き場 img/。値はファイル名だけ）
//   PWA アイコンの元画像 : manifestSettings.iconSource（または旧配置 httpSettings.iconSource）= `pwa/{uuid}.{ext}`
//   ベースマップのアイコン: thumbnail = thumb52PathFor(uid, ext)（ADR-0007。自分の uid を使う）
//
// SqliteDataService を import しない（移行は SqliteDataService.migrate() から一方向に呼ばれる）。
import { randomUUID, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'path';
import fs from 'fs-extra';

const UUID_BODY = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** スプラッシュの「UUID の形」（§2）。値はファイル名だけ */
export const UUID_SPLASH_NAME = new RegExp(`^${UUID_BODY}\\.[a-z0-9]{1,5}$`);
/** PWA アイコンの元画像の「UUID の形」（§2）。saveFolder 相対 */
export const UUID_ICON_SOURCE = new RegExp(`^pwa/${UUID_BODY}\\.[a-z0-9]{1,5}$`);
/** 移行・正規化で保つ拡張子の形（§4.2 の 5） */
const SAFE_EXT = /^[a-z0-9]{1,5}$/;

export type AppImageKey = 'splash' | 'iconSource';
/** 文書の中で値を持つ場所（読んだキーそのものを書き換える。§4.2 の 1） */
export type AppImageField = 'appSettings.splash' | 'manifestSettings.iconSource' | 'httpSettings.iconSource';

export interface AppImageRef {
  kind: AppImageKey;
  field: AppImageField;
  value: string;
}

export function isUuidSplashName(value: string): boolean {
  return UUID_SPLASH_NAME.test(value);
}

export function isUuidIconSource(value: string): boolean {
  return UUID_ICON_SOURCE.test(value);
}

/** 旧名の拡張子を小文字にしたもの。§4.2 の 5 の形に合わなければ null（= unsupported_form） */
export function lowerExtOf(name: string): string | null {
  const ext = path.posix.extname(name).slice(1).toLowerCase();
  return SAFE_EXT.test(ext) ? ext : null;
}

export function newSplashName(ext: string): string {
  return `${randomUUID()}.${ext}`;
}

export function newIconSourceRel(ext: string): string {
  return `pwa/${randomUUID()}.${ext}`;
}

/** アプリ文書から画像の参照を読む（アイコンは manifestSettings → httpSettings の順。resourceImageResolver と同じ） */
export function collectAppImageRefs(doc: any): AppImageRef[] {
  const refs: AppImageRef[] = [];
  const splash = doc?.appSettings?.splash;
  if (typeof splash === 'string' && splash.trim()) {
    refs.push({ kind: 'splash', field: 'appSettings.splash', value: splash });
  }
  const manifestIcon = doc?.manifestSettings?.iconSource;
  const httpIcon = doc?.httpSettings?.iconSource;
  if (typeof manifestIcon === 'string' && manifestIcon.trim()) {
    refs.push({ kind: 'iconSource', field: 'manifestSettings.iconSource', value: manifestIcon });
  } else if (typeof httpIcon === 'string' && httpIcon.trim()) {
    refs.push({ kind: 'iconSource', field: 'httpSettings.iconSource', value: httpIcon });
  }
  return refs;
}

export function readField(doc: any, field: AppImageField): unknown {
  const [head, key] = field.split('.') as [string, string];
  return doc?.[head]?.[key];
}

/** そのキーだけを置き換えた浅い複製を返す（他のキー・他の節は同じ参照を保つ） */
export function withField(doc: any, field: AppImageField, value: string): any {
  const [head, key] = field.split('.') as [string, string];
  return { ...doc, [head]: { ...(doc?.[head] ?? {}), [key]: value } };
}

/** 参照の値から saveFolder 相対の複製元パスを組む（スプラッシュは img/ の下） */
export function sourceRelOf(ref: Pick<AppImageRef, 'kind' | 'value'>): string {
  return ref.kind === 'splash' ? `img/${ref.value}` : ref.value;
}

export function isUuidForm(ref: Pick<AppImageRef, 'kind' | 'value'>): boolean {
  return ref.kind === 'splash' ? isUuidSplashName(ref.value) : isUuidIconSource(ref.value);
}

/** 新しい UUID 名（参照の値と、saveFolder 相対の複製先） */
export function newNameFor(kind: AppImageKey, ext: string): { value: string; rel: string } {
  if (kind === 'splash') {
    const value = newSplashName(ext);
    return { value, rel: `img/${value}` };
  }
  const value = newIconSourceRel(ext);
  return { value, rel: value };
}

export type SourceCheck =
  | { ok: true; abs: string; rel: string }
  | { ok: false; outcome: 'outside_folder' | 'source_missing'; detail: string };

/**
 * 安全の判定（§4.2 の 2）: `..`・絶対パス・`\` を含む参照は扱わない。実在するなら realpath が
 * saveFolder の realpath の下にあること（symlink で外を指すものを弾く）。
 */
export async function checkSource(saveFolder: string, rel: string): Promise<SourceCheck> {
  if (rel.includes('..') || rel.includes('\\') || path.isAbsolute(rel) || path.posix.isAbsolute(rel)) {
    return { ok: false, outcome: 'outside_folder', detail: 'unsafe path' };
  }
  const abs = path.join(saveFolder, ...rel.split('/'));
  if (!(await fs.pathExists(abs))) return { ok: false, outcome: 'source_missing', detail: rel };
  let real: string;
  let realBase: string;
  try {
    real = await fs.realpath(abs);
    realBase = await fs.realpath(saveFolder);
  } catch (e: any) {
    return { ok: false, outcome: 'source_missing', detail: String(e?.message ?? e) };
  }
  if (!real.startsWith(realBase + path.sep)) {
    return { ok: false, outcome: 'outside_folder', detail: 'symlink points outside the save folder' };
  }
  return { ok: true, abs, rel };
}

export async function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

export async function sameContent(a: string, b: string): Promise<boolean> {
  try {
    const [sa, sb] = await Promise.all([fs.stat(a), fs.stat(b)]);
    if (sa.size !== sb.size) return false;
    const [ha, hb] = await Promise.all([sha256File(a), sha256File(b)]);
    return ha === hb;
  } catch {
    return false;
  }
}

export type CopyResult =
  | { ok: true; created: boolean }
  | { ok: false; detail: string };

/**
 * 複製して確かめる（§4.2 の 5）。旧ファイルは消さない。
 * - 複製先が既にあり内容が同じ（大きさと SHA-256）なら、作ったものとみなさず済んだとして進む（created=false）
 * - 内容が違えば失敗（既にあったファイルには触れない）
 * - 複製した後、存在と大きさが複製元と同じでなければ、この呼び出しで作ったファイルだけを消して失敗
 */
export async function copyVerified(src: string, dst: string): Promise<CopyResult> {
  await fs.ensureDir(path.dirname(dst));
  try {
    await fs.copy(src, dst, { overwrite: false, errorOnExist: true });
  } catch (e: any) {
    if (await fs.pathExists(dst)) {
      // EEXIST（fs-extra は errorOnExist で Error('... already exists') を投げる）
      if (await sameContent(src, dst)) return { ok: true, created: false };
      return { ok: false, detail: `destination exists with different content: ${dst}` };
    }
    return { ok: false, detail: String(e?.message ?? e) };
  }
  try {
    const [s, d] = await Promise.all([fs.stat(src), fs.stat(dst)]);
    if (s.size !== d.size) throw new Error(`size mismatch ${s.size} != ${d.size}`);
  } catch (e: any) {
    await fs.remove(dst).catch(() => undefined);
    return { ok: false, detail: `verification failed: ${String(e?.message ?? e)}` };
  }
  return { ok: true, created: true };
}

export interface AppImageRefsNormalization {
  /** 正規化後の文書（変更が無ければ渡された文書そのもの） */
  document: any;
  /** 置き換えたキーの新しい値（無ければ undefined） */
  imageRefs?: { splash?: string; iconSource?: string };
}

/**
 * 保存の入口の正規化（§4.3）。UUID の形でない画像の参照が saveFolder の中に実在すれば、
 * 新しい UUID 名へ複製して文書の値を置き換える。複製元が無い・外を指すものは旧名のまま（警告）。
 * 他のアプリと共有している名前でも、この文書の参照だけを寄せる（他の行は変えない）。
 */
export async function normalizeAppImageRefs(document: any, saveFolder: string): Promise<AppImageRefsNormalization> {
  if (!document || typeof document !== 'object' || !saveFolder) return { document };
  let next = document;
  const imageRefs: { splash?: string; iconSource?: string } = {};
  for (const ref of collectAppImageRefs(document)) {
    if (isUuidForm(ref)) continue;
    const ext = lowerExtOf(ref.value);
    if (!ext) {
      console.warn(`[assetImageRefs] ${ref.field} is not normalized (unsupported form): ${ref.value}`);
      continue;
    }
    const source = await checkSource(saveFolder, sourceRelOf(ref));
    if (!source.ok) {
      console.warn(`[assetImageRefs] ${ref.field} is not normalized (${source.outcome}): ${ref.value}`);
      continue;
    }
    const target = newNameFor(ref.kind, ext);
    const copied = await copyVerified(source.abs, path.join(saveFolder, ...target.rel.split('/')));
    if (!copied.ok) {
      console.warn(`[assetImageRefs] ${ref.field} is not normalized (copy_failed): ${ref.value} (${copied.detail})`);
      continue;
    }
    next = withField(next, ref.field, target.value);
    imageRefs[ref.kind] = target.value;
  }
  return Object.keys(imageRefs).length > 0 ? { document: next, imageRefs } : { document };
}
