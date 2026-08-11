import path from 'path';
import fs from 'fs-extra';
import SettingsService from './SettingsService';

// M13-T2: originals/ 配下の原本ファイルを UUID(uid) キーで正準に読み書きするための
// 拡張子正規化 + canonical-first / legacy fallback resolver。
// タスク設計 `docs/superpowers/specs/2026-07-24-m13-t2-originals-resolver-design.md` §5.1/§5.2 準拠。

export type OriginalExt = 'jpg' | 'jpeg' | 'png';
const ALLOWED_EXTS: readonly OriginalExt[] = ['jpg', 'jpeg', 'png'];

function getOriginalFolder(): string {
    const saveFolder = SettingsService.get('saveFolder') as string;
    return path.join(saveFolder, 'originals');
}

/**
 * imageExtension → imageExtention(typo) → 'jpg' の優先順位で候補を選び、
 * trim + lower-case した上で allowed set (jpg/jpeg/png) に含まれるかを検証する。
 *
 * タスク設計レビュー v1 Minor 4: 各候補は個別に trim してから空文字判定する
 * (先頭候補が whitespace-only の場合は次候補へフォールバックする。
 * falsy 判定を trim 前に行うと whitespace-only な値が意図せず候補として採用されてしまう)。
 */
export function normalizeOriginalExt(
    imageExtension?: string | null,
    imageExtention?: string | null,
): OriginalExt | null {
    const candidates = [imageExtension, imageExtention, 'jpg'];
    let raw = '';
    for (const candidate of candidates) {
        const trimmed = typeof candidate === 'string' ? candidate.trim() : '';
        if (trimmed.length > 0) {
            raw = trimmed.toLowerCase();
            break;
        }
    }
    return (ALLOWED_EXTS as readonly string[]).includes(raw) ? (raw as OriginalExt) : null;
}

export interface RuntimeOriginalResolution {
    path: string;
    ext: OriginalExt;
    source: 'canonical' | 'legacy';
}

interface LegacyCandidate {
    file: string;
    ext: OriginalExt;
}

/**
 * resolveRuntimeOriginal 用の extHint 正規化。normalizeOriginalExt とは異なり
 * 「値が無い/空」の場合に 'jpg' へデフォルトフォールバックしない (extHint の意味論は
 * 「呼び出し元がヒントを持っているかどうか」であり、DB の imageExtension フィールドの
 * 既定値決定とは別物 — normalizeOriginalExt をそのまま流用すると、extHint 未指定
 * (undefined) が常に 'jpg' ヒントありとして扱われてしまい、§5.2 rule 4 の
 * 「extHint を渡せない呼び出し元は厳格な件数判定のみ」という契約が壊れる。
 * trim 後 empty も「ヒント無し」として扱う (allowed set 外は従来どおり null)。
 */
function normalizeExtHint(extHint?: string | null): OriginalExt | null {
    if (typeof extHint !== 'string') return null;
    const trimmed = extHint.trim();
    if (trimmed.length === 0) return null;
    const lower = trimmed.toLowerCase();
    return (ALLOWED_EXTS as readonly string[]).includes(lower) ? (lower as OriginalExt) : null;
}

// slug と basename が完全一致し、拡張子が allowed set に正規化できるファイルだけを候補とする
// (二重フィルタ)。QGIS サイドカーファイル (*.jpg.aux.xml 等) や作業用ファイル
// (*_modified.tif 等) は basename 不一致または拡張子非対応により自動的に除外される
// (タスク設計 §5.2/§6.4)。
async function scanLegacyCandidates(originalFolder: string, slug: string): Promise<LegacyCandidate[]> {
    let files: string[];
    try {
        files = await fs.readdir(originalFolder);
    } catch {
        return [];
    }
    const candidates: LegacyCandidate[] = [];
    for (const file of files) {
        const parsed = path.parse(file);
        if (parsed.name !== slug) continue;
        const ext = normalizeOriginalExt(parsed.ext.replace(/^\./, ''));
        if (ext) candidates.push({ file, ext });
    }
    return candidates;
}

/**
 * runtime read (WMTS 生成等) 用の canonical-first / legacy fallback resolver。
 *
 * タスク設計 §5.2 (レビュー v1 Minor 2 で精緻化済み。実装レビュー v1 Major 1 の指摘を受け、
 * canonical 探索を extHint 優先化した — マイルストーン §4.3 point 1-2「canonical 探索は
 * extHint 優先、その後 jpg -> jpeg -> png」に準拠):
 * 1. normalizeExtHint(extHint) で extHint を正規化する。
 * 2. canonical `originals/<uid>.<ext>` を探す。extHint が正規化できた場合は
 *    `[extHint, ...ALLOWED_EXTS の残り]` の順、できなかった場合は allowed set 固定順
 *    (jpg -> jpeg -> png) で探し、1件でも見つかれば即座に成功する。
 *    (実装レビュー v1 Major 1: 既存地図の画像を形式変更して再アップロードすると
 *    uid.<旧ext> が残置され canonical variant が複数になり得る。固定順のままだと
 *    extHint を無視して stale な旧ファイルを返してしまうため、この優先順位が必須)
 * 3. canonical 不在時のみ legacy を探す。basename が slug と一致し allowed ext に正規化できる
 *    ファイルだけを候補集合とする
 * 4. 2 で正規化した extHint が非 null で、候補集合中に該当拡張子のファイルが
 *    ちょうど 1 件あればその1件を確定する。該当拡張子が 2 件以上 (case variant 等) なら、
 *    この時点で ambiguous として null を返す (Minor 2: extHint も曖昧性解消の万能薬ではない)
 * 5. 4 が確定しなかった場合 (該当拡張子 0 件、または extHint 自体が使えない)、候補集合全体の
 *    件数で判定する: 0件は null (missing)、1件は成功、2件以上は null (ambiguous)
 */
export async function resolveRuntimeOriginal(
    uid: string,
    slug: string,
    extHint?: string | null,
): Promise<RuntimeOriginalResolution | null> {
    const originalFolder = getOriginalFolder();
    const normalizedHint = normalizeExtHint(extHint);

    const canonicalSearchOrder: readonly OriginalExt[] = normalizedHint
        ? [normalizedHint, ...ALLOWED_EXTS.filter((ext) => ext !== normalizedHint)]
        : ALLOWED_EXTS;
    for (const ext of canonicalSearchOrder) {
        const canonicalPath = path.join(originalFolder, `${uid}.${ext}`);
        if (await fs.pathExists(canonicalPath)) {
            return { path: canonicalPath, ext, source: 'canonical' };
        }
    }

    const candidates = await scanLegacyCandidates(originalFolder, slug);

    if (normalizedHint) {
        const hintMatches = candidates.filter((c) => c.ext === normalizedHint);
        if (hintMatches.length === 1) {
            return { path: path.join(originalFolder, hintMatches[0].file), ext: hintMatches[0].ext, source: 'legacy' };
        }
        if (hintMatches.length >= 2) {
            // Minor 2: 同一拡張子の複数物理ファイル (case variant 等) は extHint があっても ambiguous
            return null;
        }
        // hintMatches.length === 0: extHint は候補集合中に無かった。厳格な件数判定へフォールバックする
    }

    if (candidates.length === 1) {
        return { path: path.join(originalFolder, candidates[0].file), ext: candidates[0].ext, source: 'legacy' };
    }
    return null; // 0件 = missing、2件以上 = ambiguous
}

export type MigrationCandidateKind =
    | 'copyable'
    | 'already_migrated'
    | 'skip_ambiguous_legacy'
    | 'skip_target_conflict'
    | 'skip_canonical_variant_exists'
    | 'skip_unsupported_extension'
    | 'skip_source_missing';

export interface MigrationCandidate {
    kind: MigrationCandidateKind;
    sourcePath?: string;
    targetPath?: string;
    ext?: OriginalExt;
    reason?: string;
}

async function filesHaveSameContent(a: string, b: string): Promise<boolean> {
    try {
        const [bufA, bufB] = await Promise.all([fs.readFile(a), fs.readFile(b)]);
        return bufA.equals(bufB);
    } catch {
        return false;
    }
}

/**
 * copy-only migration (T3) 用の厳格な collision 判定。マイルストーン設計 §4.3/§4.5.4 の
 * 判定表をそのまま実装する。read 経路 (resolveRuntimeOriginal) と異なり extHint 優先の
 * 緩和は適用しない — 複数の legacy 候補があれば常に skip_ambiguous_legacy とする
 * (タスク設計 §5.2: migration は物理ファイルを新規作成する操作であり、read より慎重な基準を保つ)。
 * 本関数は分類のみを行い、実際の temp copy / fsync / atomic rename (T3 の責務) は行わない。
 */
export async function classifyMigrationCandidate(
    uid: string,
    slug: string,
    extHint?: string | null,
): Promise<MigrationCandidate> {
    const targetExt = normalizeOriginalExt(extHint ?? undefined);
    if (!targetExt) {
        return { kind: 'skip_unsupported_extension', reason: 'imageExtension does not normalize to an allowed ext (jpg/jpeg/png)' };
    }

    const originalFolder = getOriginalFolder();
    const targetPath = path.join(originalFolder, `${uid}.${targetExt}`);

    const canonicalVariants: { ext: OriginalExt; path: string }[] = [];
    for (const ext of ALLOWED_EXTS) {
        const p = path.join(originalFolder, `${uid}.${ext}`);
        if (await fs.pathExists(p)) canonicalVariants.push({ ext, path: p });
    }
    const exactTarget = canonicalVariants.find((v) => v.ext === targetExt);
    const otherVariant = canonicalVariants.find((v) => v.ext !== targetExt);

    const legacyCandidates = await scanLegacyCandidates(originalFolder, slug);
    const singleSourcePath =
        legacyCandidates.length === 1 ? path.join(originalFolder, legacyCandidates[0].file) : undefined;

    if (exactTarget) {
        // exact target が既にある場合、単一の legacy source と内容一致するかで
        // already_migrated / skip_target_conflict を分ける。legacy source が
        // 存在しない、または複数で一意に比較できない場合は「既に migration 済みで
        // 安全」とみなし already_migrated とする (§4.5.5: idempotent 再走の精神)
        const sameContent = singleSourcePath ? await filesHaveSameContent(singleSourcePath, exactTarget.path) : true;
        return sameContent
            ? { kind: 'already_migrated', sourcePath: singleSourcePath, targetPath: exactTarget.path, ext: targetExt }
            : {
                  kind: 'skip_target_conflict',
                  sourcePath: singleSourcePath,
                  targetPath: exactTarget.path,
                  ext: targetExt,
                  reason: 'legacy source and existing canonical target have different content',
              };
    }

    if (otherVariant) {
        return {
            kind: 'skip_canonical_variant_exists',
            sourcePath: singleSourcePath,
            targetPath,
            ext: targetExt,
            reason: `canonical file already exists with a different extension: ${otherVariant.path}`,
        };
    }

    if (legacyCandidates.length === 0) {
        return { kind: 'skip_source_missing', targetPath, ext: targetExt };
    }
    if (legacyCandidates.length >= 2) {
        return {
            kind: 'skip_ambiguous_legacy',
            targetPath,
            ext: targetExt,
            reason: `${legacyCandidates.length} legacy candidates found for slug "${slug}"`,
        };
    }

    return { kind: 'copyable', sourcePath: singleSourcePath, targetPath, ext: targetExt };
}

export interface DeletionTargets {
    canonicalPaths: { ext: OriginalExt; path: string }[];
    legacyPath: { ext: OriginalExt; path: string } | null;
    /**
     * v1.1 (AC-T4-3(c), レビュー v1 Major 2): legacy 候補の総数。呼び出し側 (MapDeleteTrashService)
     * が「legacyPath が null」を 0件 (何もない) と 2件以上 (ambiguous) で区別できるようにするための
     * フィールド。legacyPath !== null のとき legacyCandidateCount は必ず 1。
     */
    legacyCandidateCount: number;
}

/**
 * delete (T4) 専用: trash へ move してよい対象だけを返す。
 * - canonical: uid は永続的に一意なので、originals/<uid>.<ext> に該当する全 ext variant を返す
 *   (ambiguity 判定不要、§5.5 参照)
 * - legacy: scanLegacyCandidates() の候補が「ちょうど1件」の場合だけそれを legacyPath として返す
 *   (classifyMigrationCandidate と同じ厳格判定。extHint による緩和は行わない —
 *   delete は migration と同様に「誤った方を消してしまう」リスクを避けるため慎重な基準を保つ)。
 *   候補が2件以上 (ambiguous) の場合も legacyCandidateCount で件数を呼び出し側へ伝える
 *   (v1.1: milestone §4.7.3 手順3・AC-T4-3(c) の warning 契約に必要)
 */
export async function resolveDeletionTargets(uid: string, slug: string): Promise<DeletionTargets> {
    const originalFolder = getOriginalFolder();

    const canonicalPaths: { ext: OriginalExt; path: string }[] = [];
    for (const ext of ALLOWED_EXTS) {
        const p = path.join(originalFolder, `${uid}.${ext}`);
        if (await fs.pathExists(p)) canonicalPaths.push({ ext, path: p });
    }

    const legacyCandidates = await scanLegacyCandidates(originalFolder, slug);
    const legacyPath =
        legacyCandidates.length === 1
            ? { ext: legacyCandidates[0].ext, path: path.join(originalFolder, legacyCandidates[0].file) }
            : null;

    return { canonicalPaths, legacyPath, legacyCandidateCount: legacyCandidates.length };
}
