import { computed, readonly, shallowReadonly, shallowRef } from 'vue';
import type { EdgeSet, PointSet, StrictMode, VertexMode, YaxisMode } from '@maplat/transform';

// この基点の @maplat/transform にはまだないため、採用時に扱う CRS とワールドファイルの形を宣言する。
type CrsObject = { epsg?: number; authority?: string; code?: string; proj4?: string };
type WorldFile = {
    xScale: number;
    xSkew: number;
    xOrigin: number;
    ySkew: number;
    yScale: number;
    yOrigin: number;
};

export type LayerTransformIntent =
    | { setup: 'legacyV2' }
    | { setup: 'A'; crs: CrsObject; worldFile: WorldFile }
    | { setup: 'B'; crs: CrsObject; worldFile: WorldFile }
    | { setup: 'C'; crs: CrsObject };

export interface LayerBuildOptions {
    strictMode: StrictMode;
    vertexMode: VertexMode;
    yaxisMode: YaxisMode;
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
export type LayerRankUpdate = Pick<TransformLayer, 'layerId' | 'importance' | 'priority'>;
export type NewTransformLayer = Partial<Omit<TransformLayer, 'layerId' | 'intent' | 'buildOptions'>> &
    Pick<TransformLayer, 'buildOptions'>;
export type PreparedAdoption = Pick<TransformLayer, 'intent' | 'buildOptions' | 'gcps' | 'edges'>;

interface PendingTinRequest {
    readonly layerId: string;
    readonly reqGen: number;
}

export type LayerTinRequest = { layer: TransformLayer } & (
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
}

export interface LayerTransformSave<Tin> {
    layers: LayerTransformSnapshot;
    tins: (Tin | 'worldFile')[];
}

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
        return { ...layer, importance, priority };
    });
}

export function useLayerTransformState<Tin, Diagnostics, Selection>(
    initialLayers: readonly TransformLayer[],
    dependencies: LayerTransformDependencies<Tin, Diagnostics, Selection>,
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
        volatile: new Map(initial.map(({ layerId }) => [layerId, { status: 'empty' }])),
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
    let disposed = false;
    const jobs = new Map<string, { reqGen: number; done: Promise<boolean> }>();
    const editsBlocked = () => disposed || adoptionInProgress.value;

    function replaceDocument(next: LayerTransformSnapshot, volatile = state.value.volatile) {
        state.value = { layers: next, editGeneration: state.value.editGeneration + 1, volatile };
    }

    // editGeneration は全層で共通なので、世代を進める操作は対象外の層の未完の要求も古くする。
    // 世代を進める前に要求が飛んでいる層を控え、操作の後も残っている層を新しい reqGen で要求し直す。
    // §4.2 の「順位の変更は要求なし」は「最新（ready）の層には新しく要求しないが、生成中の要求は
    // 新しい世代へ付け替える」と読む。対象の層と重なる要求は requestTin 内の
    // 「同じ層・同じ世代の要求の共有」で一本に抑えられる。
    function carryOverInFlight(inFlight: readonly string[]) {
        for (const layerId of inFlight) {
            if (state.value.volatile.has(layerId)) void requestTin(layerId);
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

    // 成功と失敗を同じ入口で照合し、次の編集や削除より古い応答を破棄する。
    function applyTinResponse(request: PendingTinRequest, response: TinResponse<Tin, Diagnostics>) {
        if (!isCurrent(request)) return false;
        setTin(request.layerId, 'result' in response
            ? { status: 'ready', ...response.result }
            : { status: 'failed', error: response.error });
        return true;
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
        const job = {
            reqGen,
            done: Promise.resolve().then(async () => {
                if (!isCurrent(request)) return false;
                let response: TinResponse<Tin, Diagnostics>;
                try {
                    response = { result: await build({ ...request, kind: 'edit', layer }) };
                } catch (error) {
                    response = { error };
                }
                return applyTinResponse(request, response);
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
        if (editsBlocked() || Object.keys(edit).length === 0) return false;
        const target = state.value.layers.find((layer) => layer.layerId === layerId);
        if (!target) return false;
        const {
            gcps = target.gcps, edges = target.edges, buildOptions = target.buildOptions,
        } = edit;
        const bounds = 'bounds' in edit ? edit.bounds : target.bounds;
        const updated = copyLayer({ ...target, gcps, edges, buildOptions, bounds });
        const next = state.value.layers.map((layer) => layer === target ? updated : layer);
        const volatile = new Map(state.value.volatile);
        const previous = getTinState(layerId);
        volatile.set(layerId, {
            status: 'stale', tin: previous?.tin,
            diagnostics: previous && 'diagnostics' in previous ? previous.diagnostics : undefined,
        });
        const inFlight = [...jobs.keys()];
        replaceDocument(next, volatile);
        dependencies.history.commit(capture());
        void requestTin(layerId);
        carryOverInFlight(inFlight);
        return true;
    }

    function changeLayerRanks(updates: readonly LayerRankUpdate[]) {
        if (editsBlocked()) return false;
        const current = state.value.layers;
        const next = applyRanks(current, updates);
        if (next.every((layer, index) => layer === current[index])) return false;
        const inFlight = [...jobs.keys()];
        replaceDocument(next);
        dependencies.history.commit(capture());
        carryOverInFlight(inFlight);
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
        const layer = copyLayer({ ...input, gcps, edges, layerId, intent: { setup: 'legacyV2' } });
        const next = [...applyRanks(state.value.layers, ranks), layer];
        const volatile = new Map(state.value.volatile);
        volatile.set(layerId, { status: 'empty' });
        const inFlight = [...jobs.keys()];
        replaceDocument(next, volatile);
        dependencies.history.commit(capture());
        void requestTin(layerId);
        carryOverInFlight(inFlight);
        return layerId;
    }

    function removeLayer(layerId: string, ranks: readonly LayerRankUpdate[] = []) {
        if (editsBlocked() || layerId === 'main' || !state.value.volatile.has(layerId)) return false;
        const next = applyRanks(state.value.layers.filter((layer) => layer.layerId !== layerId), ranks);
        const volatile = new Map(state.value.volatile);
        volatile.delete(layerId);
        jobs.delete(layerId);
        const inFlight = [...jobs.keys()];
        replaceDocument(next, volatile);
        dependencies.history.commit(capture());
        carryOverInFlight(inFlight);
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
                if (!stillActive()) return;
                adoption.applied = true;
                const next = before.layers.map((entry) => entry.layerId === layerId ? layer : entry);
                const volatile = new Map(state.value.volatile);
                volatile.set(layerId, { status: 'ready', ...result });
                replaceDocument(next, volatile);
            });
            if (!stillActive()) return { status: 'cancelled' };
            dependencies.history.commit(capture());
            return { status: 'adopted' };
        } finally {
            if (activeAdoption.value === adoption) activeAdoption.value = undefined;
        }
    }

    function cancelAdoption() {
        const adoption = activeAdoption.value;
        if (!adoption || adoption.applied) return false;
        activeAdoption.value = undefined;
        adoption.controller.abort();
        return true;
    }

    async function restore(snapshot: LayerTransformSnapshot) {
        const restored = snapshot.map(copyLayer);
        registerIds(restored);
        replaceDocument(restored, new Map(restored.map(({ layerId }) => [layerId, { status: 'stale' }])));
        await Promise.all(restored.map(({ layerId }) => requestTin(layerId)));
        return true;
    }

    async function navigate(direction: 'undo' | 'redo') {
        if (editsBlocked()) return false;
        const snapshot = dependencies.history[direction]();
        return snapshot ? restore(snapshot) : false;
    }

    async function restoreDraft(snapshot: LayerTransformSnapshot) {
        return editsBlocked() ? false : restore(snapshot);
    }

    async function save(persist: (payload: LayerTransformSave<Tin>) => void | boolean | Promise<void | boolean>) {
        if (editsBlocked() || saving) return false;
        saving = true;
        try {
            const { layers: current, editGeneration: reqGen } = state.value;
            const stale = current.filter(({ layerId }) => getTinState(layerId)?.status !== 'ready');
            await Promise.all(stale.map(({ layerId }) => requestTin(layerId)));
            if (disposed || state.value.editGeneration !== reqGen) return false;
            const tins: (Tin | 'worldFile')[] = [];
            for (const { layerId } of current) {
                const tin = getTinState(layerId);
                if (tin?.status !== 'ready') return false;
                tins.push(tin.tin);
            }
            return (await persist({ layers: capture(), tins })) !== false;
        } finally {
            saving = false;
        }
    }

    function dispose() {
        disposed = true;
        cancelAdoption();
        jobs.clear();
    }

    return {
        layers, editGeneration, adoptionInProgress, getTinState, capture,
        editLayer, changeLayerRanks, addLayer, removeLayer, requestTin,
        startAdoption, cancelAdoption, undo: () => navigate('undo'), redo: () => navigate('redo'),
        restoreDraft, save, dispose,
    };
}
