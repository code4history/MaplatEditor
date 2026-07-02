export interface TinUpdateRequest {
  gcps: any[];
  edges: any[];
  index: number;
  bounds: any;
  strict: any;
  vertex: any;
}

export type TinUpdateResult = [number, any];

export interface EditorComputeBackend {
  updateTin(request: TinUpdateRequest): Promise<TinUpdateResult>;
  dispose(): void;
}

type PendingRequest = {
  resolve: (value: TinUpdateResult) => void;
  reject: (reason?: any) => void;
};

class WorkerEditorComputeBackend implements EditorComputeBackend {
  private worker: Worker | null = null;
  private nextID = 1;
  private readonly pending = new Map<number, PendingRequest>();

  async updateTin(request: TinUpdateRequest): Promise<TinUpdateResult> {
    const worker = this.getWorker();
    const id = this.nextID++;
    return await new Promise<TinUpdateResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, type: 'updateTin', payload: request });
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) {
      pending.reject(new Error('Editor compute worker was disposed'));
    }
    this.pending.clear();
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('../workers/tinComputeWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<{ id: number; result?: TinUpdateResult; error?: string }>) => {
      const { id, result, error } = event.data;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (error) {
        pending.reject(new Error(error));
      } else {
        pending.resolve(result as TinUpdateResult);
      }
    };
    this.worker.onerror = (event) => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error(event.message || 'Editor compute worker error'));
      }
      this.pending.clear();
    };
    return this.worker;
  }
}

export const editorComputeBackend: EditorComputeBackend = new WorkerEditorComputeBackend();
