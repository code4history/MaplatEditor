// M13-T2: 同一 map(uid) への save/rename/clone/delete/migration mutation を直列化する薄いキュー。
// マイルストーン設計 §4.4 契約: run()/runMany() は exclusive queue だけを提供する
// (read/export/WMTS はキューに入れない)。
//
// タスク設計レビュー v1 Minor 1: run()/runMany() は呼び出し元の戻り値型
// (例: MapEditService.save() の Promise<MapSaveResult>) を型安全に伝播できるよう
// <T> でジェネリック化する (マイルストーン §4.4 契約の additive 精緻化。呼び出し側の
// 直列化保証はそのまま)。
//
// レビュー v6 Minor 1: dev の HMR で本モジュールが再評価されると module-local な
// Map インスタンスは再生成され、直列化保証が HMR 境界をまたいで破れる。globalThis に
// 保持することで dev の HMR 再評価をまたいで同一 Map を共有する。
class MapMutationQueue {
    private tails = MapMutationQueue.getGlobalTails();

    /**
     * mapUid の直列化キューに fn を積む。キュー上の前段の mutation が成功していても
     * 失敗していても、fn は前段の完了を待ってから実行される (前段の失敗が後続を
     * ブロックしないよう、キューの tail 自体は reject させない)。
     */
    async run<T>(mapUid: string, _purpose: string, fn: () => Promise<T>): Promise<T> {
        const tail = this.tails.get(mapUid) ?? Promise.resolve();
        const gate = tail.then(
            () => undefined,
            () => undefined,
        );
        const result = gate.then(fn);
        this.tails.set(
            mapUid,
            result.then(
                () => undefined,
                () => undefined,
            ),
        );
        return result;
    }

    /**
     * 複数 uid (clone の source/dest 等) にまたがる mutation を、関与する全 uid の
     * 既存キューが完了してから実行し、完了後は関与した全 uid のキューを同じ完了 promise
     * に更新する。これにより「どの uid の観点から見ても、他の同時実行中 mutation と
     * 矛盾なく直列化される」という契約 (AC-T2-4) を、呼び出し順序に依らず満たす。
     */
    async runMany<T>(mapUids: string[], _purpose: string, fn: () => Promise<T>): Promise<T> {
        // stable sorted order (マイルストーン §4.4): 呼び出し順に依らず同じ uid 集合なら
        // 同じ順序でキューの現在の tail を捕捉する (デッドロック回避には無関係だが、
        // ログ・診断上の再現性のために固定する)
        const sorted = [...new Set(mapUids)].sort();
        if (sorted.length === 0) return fn();

        const priorTails = sorted.map((uid) => this.tails.get(uid) ?? Promise.resolve());
        const gate = Promise.all(priorTails.map((p) => p.then(() => undefined, () => undefined)));
        const result = gate.then(fn);
        const settled = result.then(
            () => undefined,
            () => undefined,
        );
        for (const uid of sorted) {
            this.tails.set(uid, settled);
        }
        return result;
    }

    private static getGlobalTails(): Map<string, Promise<unknown>> {
        const g = globalThis as any;
        g.__maplatM13MutationQueueTails ??= new Map<string, Promise<unknown>>();
        return g.__maplatM13MutationQueueTails;
    }
}

export default new MapMutationQueue();
