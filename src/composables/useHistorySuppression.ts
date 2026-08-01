// m1-t6-hotfix-1: 履歴スナップショットの抑止スコープと provenance 管理
//
// 設計: docs/superpowers/specs/2026-08-01-m1-t6-hotfix-1-mapedit-history-derived-write-design.md v1.9
//
// 契約（設計 §5.1）:
//   MapEdit の履歴スナップショットは「文書の編集」だけを記録し、「文書の読み込み・再同期」は
//   記録しない。読み込み・再同期は withoutHistory / withoutHistoryAsync スコープ内で行う。
//
// 本 composable は次の2つを所有する。
//   (1) 抑止スコープ（タグスタック + 有効深度の2層。設計 §5.2）
//   (2) 履歴スナップショットタイマーと originTags の bookkeeping（設計 §5.6）
//
// タイマーを MapEdit ではなく本 composable が持つ理由は、provenance の lifecycle 全体を
// smoke で振る舞い検証できるようにするためと、「タイマーと origin を同時に生成・同時に破棄する」
// 不変条件（INV-1/INV-2）を1ファイルに閉じ込めるためである。
//
// なお本 composable は案B（MapEdit 履歴を参照実装と同型の明示 push へ転換。m14）の完了時に
// MapEdit から除去される想定の足場である（設計 §9.1）。

import { ref, nextTick, type Ref } from 'vue';

/** スコープ外で発生した書き込みを表す origin 標識 */
export const ORIGIN_NONE = '(none)';
/** 復元スコープ。常時有効で無効化できない（設計 §5.2） */
export const ALWAYS_ENABLED_TAG = 'W1';

/**
 * composable 内部で起きた診断事実を MapEdit へ報告するイベント（設計 §5.6.6）。
 * composable は journal を直接書かない。changedFields / pointer / phase を知り得ないため、
 * 書けば必ず不完全なエントリになる（INV-6）。
 */
export type HistorySuppressionDiagnostic =
    | { type: 'schedule'; origin: string[]; scopeStack: string[] }
    | { type: 'discard-suppressed'; origin: string[] | null; scopeStack: string[] }
    | { type: 'flush-error'; error: unknown; scopeStack: string[] };

export interface UseHistorySuppressionOptions {
    /** 初期無効タグ。setup 時点で route query から注入する（設計 §5.2・§6.3）。'W1' は無視される */
    disabledTags?: string[];
    /**
     * 有効スコープの深度を 0→1 へ上げる「直前」に呼ばれる（設計 §5.2 要件4・INV-5）。
     * 呼び出し時点で suppressed === false・有効深度 0 であることが本フックの前提である。
     * 呼び出し側（MapEdit）は例外を catch してはならない。本 composable が捕捉して
     * onDiagnostic({ type: 'flush-error' }) で返す（設計 §5.6.2a・§5.6.6）。
     */
    onBeforeFirstScope?: () => void;
    /**
     * 診断報告フック。制御フローを絶対に中断しない best-effort（設計 §5.6.6a・INV-7）。
     * 本 composable は reportDiagnostic ラッパの中からのみ呼び、例外は伝播させない。
     */
    onDiagnostic?: (event: HistorySuppressionDiagnostic) => void;
}

/**
 * 順序を保った和集合（先着順・重複排除）。prev が null なら next の複製を返す。
 *
 * デバウンス窓は複数の書き込みを1スナップショットへ畳むため、origin は「上書き」ではなく
 * 「合成」でなければならない。窓内に W 由来の書き込みが1つでも混ざった事実を失わない
 * （設計 §5.6.1）。純粋関数として単体 export し smoke で検証する（AC2(d)）。
 */
export function mergeOrigin(prev: string[] | null, next: string[]): string[] {
    if (prev === null) return [...next];
    const merged = [...prev];
    for (const tag of next) {
        if (!merged.includes(tag)) merged.push(tag);
    }
    return merged;
}

/** enter 時点の有効/無効を保持するスコープトークン。setScopeEnabled の途中変更で深度が壊れないようにする */
interface ScopeToken {
    tag: string;
    effective: boolean;
}

export function useHistorySuppression(options: UseHistorySuppressionOptions = {}) {
    const disabled = new Set(
        (options.disabledTags ?? []).filter((tag) => tag !== ALWAYS_ENABLED_TAG),
    );

    const scopeTokens: ScopeToken[] = [];
    let effectiveDepth = 0;

    const suppressed = ref(false);
    const currentTag = ref<string | null>(null);

    let timer: ReturnType<typeof setTimeout> | undefined;
    // INV-1/INV-2: timer と対で生き、同時に生成し同時に破棄する
    let timerOrigin: string[] | null = null;
    let diagnosticErrors = 0;

    const syncRefs = () => {
        suppressed.value = effectiveDepth > 0;
        currentTag.value = scopeTokens.length > 0 ? scopeTokens[scopeTokens.length - 1].tag : null;
    };

    /** 生のタグスタック（診断イベント用。空なら空配列） */
    const rawScopeStack = (): string[] => scopeTokens.map((t) => t.tag);

    /**
     * 非中断ラッパ（設計 §5.6.6a）。onDiagnostic はここからのみ呼ぶ。
     * フック例外は console.warn のみとし journal へは書かない
     * （onDiagnostic が失敗している状況では journal 経路自体が壊れている可能性が高く、
     *   そこへ書きに行けば再帰的に失敗するため）。黙殺を避けるためカウンタで観測可能にする。
     */
    const reportDiagnostic = (event: HistorySuppressionDiagnostic): void => {
        try {
            options.onDiagnostic?.(event);
        } catch (err) {
            diagnosticErrors++;
            console.warn('[useHistorySuppression] onDiagnostic が例外を投げました（無害化して継続）:', err);
        }
    };

    const isScopeEnabled = (tag: string): boolean =>
        tag === ALWAYS_ENABLED_TAG || !disabled.has(tag);

    const setScopeEnabled = (tag: string, enabled: boolean): void => {
        if (tag === ALWAYS_ENABLED_TAG) return; // W1 は常時 ON
        if (enabled) disabled.delete(tag);
        else disabled.add(tag);
    };

    /** タグスタック全体を外側→内側で返す。スコープ外は ['(none)']（設計 §5.6.1） */
    const snapshotScope = (): string[] => {
        if (scopeTokens.length === 0) return [ORIGIN_NONE];
        return rawScopeStack();
    };

    /** 保留タイマーを clear し origin を取り出す（clear と take は不可分）。C1/C4/C6/C7 の土台 */
    const cancelPendingSnapshot = (): string[] | null => {
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
        const taken = timerOrigin;
        timerOrigin = null;
        return taken;
    };

    const hasPendingSnapshot = (): boolean => timer !== undefined;

    const diagnosticErrorCount = (): number => diagnosticErrors;

    /**
     * スナップショットタイマーを張る／張り直す（設計 §5.6.3 の「タイマー発火」モード）。
     * 抑止中は C4（終端廃棄）として fn を呼ばずタイマーと origin を捨てる。
     */
    const scheduleWithOrigin = (fn: (origin: string[]) => void): void => {
        if (suppressed.value) {
            // C4: 判定 → take（clear と不可分）→ 報告 → return（設計 §5.6.6）
            const discarded = cancelPendingSnapshot();
            reportDiagnostic({
                type: 'discard-suppressed',
                origin: discarded,
                scopeStack: rawScopeStack(),
            });
            return;
        }
        // C5: 再スケジュールは廃棄ではなく合成
        const merged = mergeOrigin(timerOrigin, snapshotScope());
        timerOrigin = merged;
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = undefined;
            // 発火直前に take-and-clear（同期・不可分）
            const origin = timerOrigin ?? [ORIGIN_NONE];
            timerOrigin = null;
            fn(origin);
        }, 0);
        // 報告が例外を投げてもタイマーは既に張られており、この呼び出し自体は完了する（AC2(h)4）
        reportDiagnostic({ type: 'schedule', origin: merged, scopeStack: rawScopeStack() });
    };

    /**
     * スコープ進入。有効深度を 0→1 へ上げる「直前」に onBeforeFirstScope を呼ぶ（INV-5）。
     * push 後に呼ぶと suppressed === true になり、flush 自身が抑止されて
     * 本来防ぐはずの喪失をそのまま起こす（設計 §5.2 要件4）。
     */
    const enterScope = (tag: string): ScopeToken => {
        const effective = isScopeEnabled(tag);
        if (effective && effectiveDepth === 0 && options.onBeforeFirstScope) {
            try {
                options.onBeforeFirstScope();
            } catch (error) {
                // catch 節の中も非中断ラッパ経由（素の onDiagnostic を置くと再送出して push を中断する）
                reportDiagnostic({ type: 'flush-error', error, scopeStack: rawScopeStack() });
            }
        }
        const token: ScopeToken = { tag, effective };
        scopeTokens.push(token);
        if (effective) effectiveDepth++;
        syncRefs();
        return token;
    };

    const exitScope = (token: ScopeToken): void => {
        const index = scopeTokens.lastIndexOf(token);
        if (index < 0) return; // 二重解除の防御
        scopeTokens.splice(index, 1);
        if (token.effective) effectiveDepth = Math.max(0, effectiveDepth - 1);
        syncRefs();
    };

    /**
     * 同期スコープ。await を一切導入しない（同期の書き込み断片を包む用途に限る）。
     *
     * 解除は nextTick のコールバックまで遅延させる。fn の書き込みが起こす watcher は
     * 同一 flush の後段で走るため、即座に解除すると抑止下で消化されない（設計 §5.2 要件3）。
     *
     * 利用境界: 呼び出し後、同一 tick 内に無関係な監視9項目の書き込みを置かないこと。
     */
    const withoutHistory = <T>(tag: string, fn: () => T): T => {
        const token = enterScope(tag);
        try {
            return fn();
        } finally {
            void nextTick(() => exitScope(token));
        }
    };

    /** 非同期スコープ。fn の await 完了後に nextTick してから解除する（設計 §5.2 要件2） */
    const withoutHistoryAsync = async <T>(tag: string, fn: () => Promise<T> | T): Promise<T> => {
        const token = enterScope(tag);
        try {
            return await fn();
        } finally {
            await nextTick();
            exitScope(token);
        }
    };

    return {
        suppressed: suppressed as Ref<boolean>,
        currentTag: currentTag as Ref<string | null>,
        withoutHistory,
        withoutHistoryAsync,
        setScopeEnabled,
        isScopeEnabled,
        snapshotScope,
        mergeOrigin,
        scheduleWithOrigin,
        cancelPendingSnapshot,
        hasPendingSnapshot,
        diagnosticErrorCount,
    };
}
