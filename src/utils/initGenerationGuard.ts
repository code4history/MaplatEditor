// M12-T2: POI 未作成初期化の generation guard 完結（T10b 残課題）。
// 世代 token（isCurrent）を非同期境界の前後で確認し、stale な初期化・import が
// 新しい session を上書きするのを防ぐ。PoiEdit.vue の duplicateFrom 元消失経路と
// importAutoRun が使う、UI/Vue 非依存の純粋関数群。

import { resolveEditorLanguage } from "./editorLanguages";
import { suggestSlug } from "./poiSourceSlug";

// 世代 guard 付きの「解放 → フォールバック適用」列。
// release の await 前後の両方で isCurrent を確認し、stale ならフォールバックを適用しない
// （release await 中の世代切替で initializeEmptySession + 診断が新 session を上書きするのを防ぐ本体）。
export async function guardedReleaseThenFallback(opts: {
  isCurrent: () => boolean;
  release: () => Promise<void>;
  onFallback: () => void;
}): Promise<void> {
  if (!opts.isCurrent()) return;
  await opts.release();
  if (!opts.isCurrent()) return; // release の await 中の遷移も破棄
  opts.onFallback();
}

export type GuardedImportOutcome =
  | { outcome: "current-saved" } // current のまま import → load → replace まで完了
  | { outcome: "cancelled" } // picker キャンセル（何も作られない）
  | { outcome: "stale" } // 途中で世代切替（cleanup ポリシー適用済み）
  | { outcome: "failed"; failure: unknown }; // current のまま importFile が failure を返した

// 世代 guard 付き import フロー（PoiEdit importAutoRun の本体）。
// 各ステップ間で isCurrent を確認し、stale なら以降の副作用（load/replace/診断）を行わない。
// 残留物ポリシー（Min2）: importFile 成功・失敗に関わらず世代切替済みなら、
// 「自世代 uid の draft cleanup（removeDraft）」は新 session を上書きしないため実行する。
// 作成済み source は一覧へ残す（許容。削除はユーザー判断）。
export async function runGuardedPoiImport(opts: {
  isCurrent: () => boolean;
  newUid: () => string;
  pickImportFile: () => Promise<{ filePath: string; fileName: string } | null>;
  detectImportLanguage: (filePath: string, fallback: string) => Promise<string>;
  importFile: (input: { slug: string; title: Record<string, string>; filePath: string; uid: string }) => Promise<unknown>;
  removeDraft: (uid: string) => Promise<void>;
  loadSaved: (uid: string) => Promise<void>;
  replaceRoute: (uid: string) => Promise<void>;
}): Promise<GuardedImportOutcome> {
  if (!opts.isCurrent()) return { outcome: "stale" };
  const picked = await opts.pickImportFile();
  if (!picked) return { outcome: "cancelled" };
  if (!opts.isCurrent()) return { outcome: "stale" }; // picker 待ちの間の遷移も破棄
  const lang = resolveEditorLanguage(await opts.detectImportLanguage(picked.filePath, "ja"));
  if (!opts.isCurrent()) return { outcome: "stale" };
  const result: any = await opts.importFile({
    slug: suggestSlug(picked.fileName),
    title: { [lang]: picked.fileName.replace(/\.[^.]+$/, "") },
    filePath: picked.filePath,
    uid: opts.newUid(),
  });
  if (!opts.isCurrent()) {
    // import 完了後の世代切替。作成済み source は一覧へ残し、
    // 自世代 uid の draft cleanup のみ実行して復元競合の余波を防ぐ（load/replace/診断は行わない）
    await opts.removeDraft(opts.newUid());
    return { outcome: "stale" };
  }
  if (!("result" in result) || result.result !== "Success") {
    return { outcome: "failed", failure: result };
  }
  await opts.removeDraft(opts.newUid());
  await opts.loadSaved(result.uid);
  if (!opts.isCurrent()) return { outcome: "stale" }; // load 後の遷移は replace を行わない
  await opts.replaceRoute(result.uid);
  return { outcome: "current-saved" };
}
