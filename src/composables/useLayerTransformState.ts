import { computed, readonly, shallowReadonly, shallowRef } from 'vue';
import { isEqual } from 'lodash-es';
import type { CrsObject, EdgeSet, PointSet, StrictMode, VertexMode, WorldFile, YaxisMode } from '@maplat/transform';

export type LayerTransformIntent =
    // yaxisMode は crs の無い旧 V2 の層だけが持つ「保存されていた値」。crs のある層は crs から導く（設計書 §4.6）。
    // 省略は invert。採用で crs を持つ意図へ替わると、この値も一緒に消え、Undo で一緒に戻る。
    | { setup: 'legacyV2'; yaxisMode?: YaxisMode }
    | { setup: 'A'; crs: CrsObject; worldFile: WorldFile }
    | { setup: 'B'; crs: CrsObject; worldFile: WorldFile }
    | { setup: 'C'; crs: CrsObject };

export interface LayerBuildOptions {
    strictMode: StrictMode;
    vertexMode: VertexMode;
}

export interface TransformLayer {
    readonly layerId: string;
    intent: LayerTransformIntent;
    buildOptions: LayerBuildOptions;
    gcps: (PointSet | [...PointSet, number])[];
    edges: EdgeSet[];
    bounds?: number[] | number[][];
    importance?: number;
    priority?: number;
}

export type LayerTransformSnapshot = TransformLayer[];
export type LayerTinEdit = Partial<Pick<TransformLayer, 'gcps' | 'edges' | 'bounds' | 'buildOptions'>>;
export interface LayerTinEditEntry {
    layerId: string;
    edit: LayerTinEdit;
}

export type LayerRankUpdate = Pick<TransformLayer, 'layerId' | 'importance' | 'priority'>;
export type NewTransformLayer = Partial<Omit<TransformLayer, 'layerId' | 'intent' | 'buildOptions'>> &
    Pick<TransformLayer, 'buildOptions'>;
export type PreparedAdoption = Pick<TransformLayer, 'intent' | 'buildOptions' | 'gcps' | 'edges'>;

interface PendingTinRequest {
    readonly layerId: string;
    readonly reqGen: number;
}

export type LayerTinRequest = { layer: TransformLayer; isCurrent(): boolean } & (
    | (PendingTinRequest & { kind: 'edit' })
    | { kind: 'adoption'; layerId: string; adoptionId: number; signal: AbortSignal }
);

export interface TinBuildResult<Tin, Diagnostics> {
    readonly tin: Tin;
    readonly diagnostics?: Diagnostics;
}

export type LayerTinState<Tin, Diagnostics> = Readonly<
    | { status: 'empty'; tin?: undefined }
    | { status: 'stale'; tin?: Tin | 'worldFile'; diagnostics?: Diagnostics; pendingReq?: PendingTinRequest }
    | ({ status: 'ready' } & TinBuildResult<Tin | 'worldFile', Diagnostics>)
    | { status: 'failed'; tin?: undefined; error: unknown }
>;

export type AdoptionOutcome =
    | { status: 'adopted' | 'cancelled' | 'rejected' }
    | { status: 'failed'; error: unknown };

/** 清書（§9.3 の 3）の依頼。層の今の文書で、保存してよい三角網（全部組み直しの結果）を作らせる。 */
export type LayerFinalizeRequest = { layer: TransformLayer; layerId: string; isCurrent(): boolean };

export interface LayerTransformHistory {
    commit(snapshot: LayerTransformSnapshot): void;
    undo(): LayerTransformSnapshot | undefined;
    redo(): LayerTransformSnapshot | undefined;
    withoutHistoryAsync(apply: () => void): Promise<void>;
}

export interface LayerTransformDependencies<Tin, Diagnostics, Selection> {
    history: LayerTransformHistory;
    buildTin(request: LayerTinRequest): TinBuildResult<Tin, Diagnostics> | Promise<TinBuildResult<Tin, Diagnostics>>;
    prepareAdoption(
        layer: TransformLayer,
        selection: Selection,
        signal: AbortSignal,
    ): PreparedAdoption | Promise<PreparedAdoption>;
    /**
     * 清書。三角網の更新が局所更新（全部組み直しではない手順）で済ませてある層を、保存してよい三角網にする。
     * 無ければ、清書はしない（今までどおり、保存するのは編集のたびの結果）。
     */
    finalize?(request: LayerFinalizeRequest): TinBuildResult<Tin, Diagnostics> | Promise<TinBuildResult<Tin, Diagnostics>>;
    /** 層の今の三角網が、清書を要するか。無ければ、`finalize` があるときは常に要る */
    needsFinalize?(layerId: string): boolean;
    /** 清書の結果を文書へ入れた（`needsFinalize` が偽になる） */
    onFinalized?(layerId: string): void;
    /** 層が文書から無くなった（削除・履歴の復元で）。層に付いた計算の状態を捨てるのに使う */
    onLayerRemoved?(layerId: string): void;
}

export interface LayerTransformSave<Tin> {
    layers: LayerTransformSnapshot;
    tins: (Tin | 'worldFile')[];
}

export interface LayerTransformRestore {
    restored: boolean;
    settled: Promise<boolean>;
}

export type LayerTransformSaveResult =
    | { ok: true }
    | { ok: false; reason: 'adopting' | 'saving' | 'disposed' | 'generationChanged' | 'buildFailed' | 'writeFailed' };

type TinResponse<Tin, Diagnostics> = { result: TinBuildResult<Tin | 'worldFile', Diagnostics> } | { error: unknown };

// 履歴と IPC に渡す値は、Vue のプロキシや参照を共有しないプレーンな文書データにする。
function copyDocument<T>(value: T): T {
    if (Array.isArray(value)) return value.map(copyDocument) as T;
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, copyDocument(entry)])) as T;
    }
    return value;
}

function copyLayer({
    layerId, intent, buildOptions, gcps, edges, bounds, importance, priority,
}: TransformLayer): TransformLayer {
    return copyDocument({
        layerId, intent, buildOptions, gcps, edges,
        ...(bounds !== undefined ? { bounds } : {}),
        ...(importance !== undefined ? { importance } : {}),
        ...(priority !== undefined ? { priority } : {}),
    });
}

function applyRanks(layers: TransformLayer[], updates: readonly LayerRankUpdate[]): TransformLayer[] {
    const byId = new Map(updates.map((update) => [update.layerId, update]));
    return layers.map((layer) => {
        const update = byId.get(layer.layerId);
        if (!update) return layer;
        const importance = update.importance ?? layer.importance;
        const priority = update.priority ?? layer.priority;
        if (importance === layer.importance && priority === layer.priority) return layer;
        return copyLayer({ ...layer, importance, priority });
    });
}

export function useLayerTransformState<Tin, Diagnostics, Selection>(
    initialLayers: readonly TransformLayer[],
    dependencies: LayerTransformDependencies<Tin, Diagnostics, Selection>,
    initialTins: ReadonlyMap<string, TinBuildResult<Tin | 'worldFile', Diagnostics>> = new Map(),
) {
    type Volatile = LayerTinState<Tin, Diagnostics>;
    interface State {
        layers: LayerTransformSnapshot;
        editGeneration: number;
        volatile: ReadonlyMap<string, Volatile>;
    }
    const issuedIds = new Set<string>();
    function registerIds(layers: LayerTransformSnapshot) {
        const ids = new Set(layers.map(({ layerId }) => layerId));
        if (layers[0]?.layerId !== 'main' || ids.size !== layers.length || ids.has('')) {
            throw new Error('先頭の主図と重複のない層 ID が必要です');
        }
        for (const id of ids) issuedIds.add(id);
    }

    const initial = initialLayers.map(copyLayer);
    registerIds(initial);
    const state = shallowRef<State>({
        layers: initial,
        editGeneration: 0,
        volatile: new Map(initial.map(({ layerId }) => {
            const seed = initialTins.get(layerId);
            return [layerId, seed ? { status: 'ready', ...seed } : { status: 'empty' }];
        })),
    });
    const layers = computed(() => readonly(state.value.layers));
    const editGeneration = computed(() => state.value.editGeneration);
    const getTinState = (layerId: string) => {
        const tin = state.value.volatile.get(layerId);
        return tin && shallowReadonly(tin);
    };
    const capture = () => copyDocument(state.value.layers);

    interface Adoption {
        id: number;
        controller: AbortController;
        applied: boolean;
    }
    const activeAdoption = shallowRef<Adoption>();
    const adoptionInProgress = computed(() => activeAdoption.value !== undefined);
    let nextAdoptionId = 0;
    let nextLayerNumber = 0;
    let saving = false;
    const writing = shallowRef(false);
    const saveWriting = computed(() => writing.value);
    let disposed = false;
    const jobs = new Map<string, { reqGen: number; done: Promise<boolean> }>();
    const deferredRetries = new Map<string, PendingTinRequest>();
    const editsBlocked = () => disposed || adoptionInProgress.value || writing.value;

    function replaceDocument(next: LayerTransformSnapshot, volatile = state.value.volatile) {
        const before = state.value.layers;
        state.value = { layers: next, editGeneration: state.value.editGeneration + 1, volatile };
        const remaining = new Set(next.map(({ layerId }) => layerId));
        for (const { layerId } of before) {
            if (!remaining.has(layerId)) dependencies.onLayerRemoved?.(layerId);
        }
    }

    function setTin(layerId: string, tin: Volatile) {
        const volatile = new Map(state.value.volatile);
        volatile.set(layerId, tin);
        state.value = { ...state.value, volatile };
    }

    function build(request: LayerTinRequest): TinBuildResult<Tin | 'worldFile', Diagnostics> | Promise<TinBuildResult<Tin, Diagnostics>> {
        if (request.layer.intent.setup === 'A') return { tin: 'worldFile' };
        return dependencies.buildTin(request);
    }

    function isCurrent(request: PendingTinRequest) {
        return !disposed && request.reqGen === state.value.editGeneration && state.value.volatile.has(request.layerId);
    }

    function discardTinRequest(request: PendingTinRequest): false {
        const { layerId } = request;
        const tin = state.value.volatile.get(layerId);
        // 待ち印の照合で、削除・別の要求・採用で置き換わった層を除く。
        if (!disposed && tin?.status === 'stale' && tin.pendingReq === request) {
            if (adoptionInProgress.value) deferredRetries.set(layerId, request);
            else void requestTin(layerId);
        }
        return false;
    }

    function endAdoption(adoption: Adoption) {
        if (activeAdoption.value !== adoption) return;
        activeAdoption.value = undefined;
        const retries = [...deferredRetries.values()];
        deferredRetries.clear();
        for (const request of retries) discardTinRequest(request);
    }

    function requestTin(layerId: string): Promise<boolean> {
        if (editsBlocked()) return Promise.resolve(false);
        const target = state.value.layers.find((layer) => layer.layerId === layerId);
        if (!target) return Promise.resolve(false);
        const reqGen = state.value.editGeneration;
        const pending = jobs.get(layerId);
        if (pending?.reqGen === reqGen) return pending.done;
        const request: PendingTinRequest = Object.freeze({ layerId, reqGen });
        const layer = copyDocument(target);
        const current = () => isCurrent(request);
        const job = {
            reqGen,
            done: Promise.resolve().then(async () => {
                if (!current()) return discardTinRequest(request);
                let response: TinResponse<Tin, Diagnostics>;
                try {
                    response = { result: await build({ ...request, kind: 'edit', layer, isCurrent: current }) };
                } catch (error) {
                    response = { error };
                }
                // 成功・失敗のどちらでも旧世代の結果を捨て、必要な層だけを要求し直す。
                if (!current()) return discardTinRequest(request);
                setTin(layerId, 'result' in response
                    ? { status: 'ready', ...response.result }
                    : { status: 'failed', error: response.error });
                return true;
            }).finally(() => {
                if (jobs.get(layerId) === job) jobs.delete(layerId);
            }),
        };
        jobs.set(layerId, job);
        const previous = getTinState(layerId);
        const diagnostics = previous && 'diagnostics' in previous ? previous.diagnostics : undefined;
        setTin(layerId, { status: 'stale', tin: previous?.tin, diagnostics, pendingReq: request });
        return job.done;
    }

    function editLayer(layerId: string, edit: LayerTinEdit) {
        return editLayers([{ layerId, edit }]);
    }

    function editLayers(edits: readonly LayerTinEditEntry[]) {
        if (editsBlocked()) return false;
        const volatile = new Map(state.value.volatile);
        const byId = new Map(edits.map(({ layerId, edit }) => [layerId, edit]));
        if (byId.size !== edits.length || edits.some(({ layerId }) => !volatile.has(layerId))) return false;

        const changed: string[] = [];
        const next = state.value.layers.map((target) => {
            const { layerId } = target;
            const edit = byId.get(layerId);
            if (!edit) return target;
            const { gcps = target.gcps, edges = target.edges, buildOptions = target.buildOptions } = edit;
            const bounds = 'bounds' in edit ? edit.bounds : target.bounds;
            const updated = copyLayer({ ...target, gcps, edges, buildOptions, bounds });
            if (isEqual(updated, target)) return target;

            const previous = volatile.get(layerId);
            volatile.set(layerId, {
                status: 'stale', tin: previous?.tin,
                diagnostics: previous && 'diagnostics' in previous ? previous.diagnostics : undefined,
            });
            changed.push(layerId);
            return updated;
        });
        if (changed.length === 0) return false;
        replaceDocument(next, volatile);
        dependencies.history.commit(capture());
        for (const layerId of changed) void requestTin(layerId);
        return true;
    }

    /**
     * 清書（§9.3 の 3）。層の三角網が局所更新で済ませたものなら、全部組み直した結果へ置き換える。
     * 編集が入った（世代が変わった）・編集中・採用中なら何もしない（結果は捨てる）。置き換えたら true。
     */
    async function finalizeLayer(layerId: string): Promise<boolean> {
        const finalize = dependencies.finalize;
        if (!finalize || editsBlocked() || jobs.has(layerId)) return false;
        if (dependencies.needsFinalize && !dependencies.needsFinalize(layerId)) return false;
        const target = state.value.layers.find((layer) => layer.layerId === layerId);
        const tin = state.value.volatile.get(layerId);
        if (!target || tin?.status !== 'ready' || tin.tin === 'worldFile' || typeof tin.tin === 'string') return false;
        const reqGen = state.value.editGeneration;
        const layer = copyDocument(target);
        const current = () => !disposed && state.value.editGeneration === reqGen
            && state.value.volatile.get(layerId)?.status === 'ready';
        let result: TinBuildResult<Tin, Diagnostics>;
        try {
            result = await finalize({ layer, layerId, isCurrent: current });
        } catch {
            return false;
        }
        if (!current() || adoptionInProgress.value) return false;
        // 世代は変えない（文書は変わっていない。同じ入力の、保存してよい三角網へ替えただけ）
        setTin(layerId, { status: 'ready', ...result });
        dependencies.onFinalized?.(layerId);
        return true;
    }

    /** 全部の層を清書する（編集が止まったとき・保存の前）。 */
    async function finalizeAll(): Promise<void> {
        for (const { layerId } of [...state.value.layers]) await finalizeLayer(layerId);
    }

    function changeLayerRanks(updates: readonly LayerRankUpdate[]) {
        if (editsBlocked()) return false;
        const current = state.value.layers;
        const next = applyRanks(current, updates);
        if (next.every((layer, index) => layer === current[index])) return false;
        replaceDocument(next);
        dependencies.history.commit(capture());
        return true;
    }

    function addLayer(input: NewTransformLayer, ranks: readonly LayerRankUpdate[] = []) {
        if (editsBlocked()) return undefined;
        let layerId: string;
        do {
            layerId = `sub:${++nextLayerNumber}`;
        } while (issuedIds.has(layerId));
        issuedIds.add(layerId);
        const { gcps = [], edges = [] } = input;
        // 旧 V2 の副層は、主図が旧 V2 で follow ならそれを継ぐ（副層の保存形式に yaxisMode は無く、地図最上位の値を使う）。
        const mainIntent = state.value.layers[0]?.intent;
        const intent: LayerTransformIntent = mainIntent?.setup === 'legacyV2' && mainIntent.yaxisMode
            ? { setup: 'legacyV2', yaxisMode: mainIntent.yaxisMode } : { setup: 'legacyV2' };
        const layer = copyLayer({ ...input, gcps, edges, layerId, intent });
        const next = [...applyRanks(state.value.layers, ranks), layer];
        const volatile = new Map(state.value.volatile);
        volatile.set(layerId, { status: 'empty' });
        replaceDocument(next, volatile);
        dependencies.history.commit(capture());
        void requestTin(layerId);
        return layerId;
    }

    function removeLayer(layerId: string, ranks: readonly LayerRankUpdate[] = []) {
        if (editsBlocked() || layerId === 'main' || !state.value.volatile.has(layerId)) return false;
        const next = applyRanks(state.value.layers.filter((layer) => layer.layerId !== layerId), ranks);
        const volatile = new Map(state.value.volatile);
        volatile.delete(layerId);
        jobs.delete(layerId);
        replaceDocument(next, volatile);
        dependencies.history.commit(capture());
        return true;
    }

    async function startAdoption(layerId: string, selection: Selection | null | undefined): Promise<AdoptionOutcome> {
        if (editsBlocked() || saving || selection == null) return { status: 'rejected' };
        const before = state.value;
        const target = before.layers.find((layer) => layer.layerId === layerId);
        if (!target) return { status: 'rejected' };

        const adoption: Adoption = { id: ++nextAdoptionId, controller: new AbortController(), applied: false };
        const { signal } = adoption.controller;
        activeAdoption.value = adoption;
        const stillActive = () => !disposed && activeAdoption.value === adoption;
        const cancelled = new Promise<undefined>((resolve) => {
            if (signal.aborted) resolve(undefined);
            else signal.addEventListener('abort', () => resolve(undefined), { once: true });
        });
        const stage = async () => {
            const prepared = await dependencies.prepareAdoption(copyDocument(target), selection, signal);
            if (!stillActive()) return undefined;
            const { intent, buildOptions, gcps, edges } = prepared;
            const layer = copyDocument({ ...target, intent, buildOptions, gcps, edges });
            const result = await build({
                kind: 'adoption', layerId, adoptionId: adoption.id, signal, layer: copyDocument(layer),
                isCurrent: stillActive,
            });
            return { layer, result };
        };

        try {
            let staged: Awaited<ReturnType<typeof stage>>;
            try {
                staged = await Promise.race([cancelled, stage()]);
            } catch (error) {
                return stillActive() ? { status: 'failed', error } : { status: 'cancelled' };
            }
            if (!staged || !stillActive()) return { status: 'cancelled' };
            const { layer, result } = staged;
            // 反映を監視する側の抑止が nextTick 後に解けてから、履歴を明示的に一度記録する。
            await dependencies.history.withoutHistoryAsync(() => {
                if (!stillActive() || adoption.applied) return;
                adoption.applied = true;
                const next = before.layers.map((entry) => entry.layerId === layerId ? layer : entry);
                const volatile = new Map(state.value.volatile);
                volatile.set(layerId, { status: 'ready', ...result });
                replaceDocument(next, volatile);
            });
            if (!stillActive()) return { status: 'cancelled' };
            if (!adoption.applied) return { status: 'failed', error: new Error('採用結果が反映されませんでした') };
            dependencies.history.commit(capture());
            return { status: 'adopted' };
        } finally {
            endAdoption(adoption);
        }
    }

    function cancelAdoption() {
        const adoption = activeAdoption.value;
        if (!adoption || adoption.applied) return false;
        endAdoption(adoption);
        adoption.controller.abort();
        return true;
    }

    function restore(snapshot: LayerTransformSnapshot): LayerTransformRestore {
        const restored = snapshot.map(copyLayer);
        registerIds(restored);
        const generation = state.value.editGeneration + 1;
        const volatile = new Map<string, Volatile>(restored.map(({ layerId }): [string, Volatile] => {
            const previous = state.value.volatile.get(layerId);
            return [layerId, {
                status: 'stale' as const,
                tin: previous?.tin,
                diagnostics: previous && 'diagnostics' in previous ? previous.diagnostics : undefined,
            }];
        }));
        replaceDocument(restored, volatile);
        const settled = Promise.all(restored.map(({ layerId }) => requestTin(layerId))).then((accepted) =>
            !disposed && state.value.editGeneration === generation && accepted.every(Boolean) &&
            restored.every(({ layerId }) => getTinState(layerId)?.status === 'ready'));
        return { restored: true, settled };
    }

    const notRestored = (): LayerTransformRestore => ({ restored: false, settled: Promise.resolve(false) });

    function navigate(direction: 'undo' | 'redo'): LayerTransformRestore {
        if (editsBlocked()) return notRestored();
        const snapshot = dependencies.history[direction]();
        return snapshot ? restore(snapshot) : notRestored();
    }

    function restoreDraft(snapshot: LayerTransformSnapshot): LayerTransformRestore {
        return editsBlocked() ? notRestored() : restore(snapshot);
    }

    async function save(persist: (payload: LayerTransformSave<Tin>) => void | boolean | Promise<void | boolean>):
        Promise<LayerTransformSaveResult> {
        if (disposed) return { ok: false, reason: 'disposed' };
        if (adoptionInProgress.value) return { ok: false, reason: 'adopting' };
        if (saving) return { ok: false, reason: 'saving' };
        saving = true;
        try {
            const { layers: current, editGeneration: reqGen } = state.value;
            const stale = current.filter(({ layerId }) => getTinState(layerId)?.status !== 'ready');
            await Promise.all(stale.map(({ layerId }) => requestTin(layerId)));
            if (disposed) return { ok: false, reason: 'disposed' };
            if (state.value.editGeneration !== reqGen) return { ok: false, reason: 'generationChanged' };
            // 保存するのは、全部組み直した三角網（局所更新で済ませた層は、保存の前に清書する。§9.3）
            if (dependencies.finalize) {
                for (const { layerId } of current) {
                    const built = getTinState(layerId)?.tin;
                    // ワールドファイルだけの層・エラーの層に、清書する三角網は無い
                    if (built === 'worldFile' || typeof built === 'string') continue;
                    if (dependencies.needsFinalize && !dependencies.needsFinalize(layerId)) continue;
                    const done = await finalizeLayer(layerId);
                    if (disposed) return { ok: false, reason: 'disposed' };
                    if (state.value.editGeneration !== reqGen) return { ok: false, reason: 'generationChanged' };
                    if (!done) return { ok: false, reason: 'buildFailed' };
                }
            }
            const tins: (Tin | 'worldFile')[] = [];
            for (const { layerId } of current) {
                const tin = getTinState(layerId);
                if (tin?.status !== 'ready') return { ok: false, reason: 'buildFailed' };
                tins.push(tin.tin);
            }
            try {
                writing.value = true;
                if (await persist({ layers: capture(), tins }) !== false) return { ok: true };
            } catch {
                return { ok: false, reason: 'writeFailed' };
            }
            return { ok: false, reason: 'writeFailed' };
        } finally {
            saving = false;
            writing.value = false;
        }
    }

    function dispose() {
        disposed = true;
        cancelAdoption();
        jobs.clear();
        deferredRetries.clear();
    }

    return {
        layers, editGeneration, adoptionInProgress, saveWriting, getTinState, capture,
        editLayer, editLayers, changeLayerRanks, addLayer, removeLayer, requestTin, finalizeLayer, finalizeAll,
        startAdoption, cancelAdoption, undo: () => navigate('undo'), redo: () => navigate('redo'),
        restoreDraft, save, dispose,
    };
}
