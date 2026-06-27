import type { M2StorageRecord } from '../shared/rpc';

export class M2MockStorageAdapter {
  private readonly records = new Map<string, M2StorageRecord>();

  async save(record: M2StorageRecord): Promise<{ ok: true; mapID: string }> {
    if (!record.mapID.trim()) {
      throw new Error('mapID is required');
    }
    this.records.set(record.mapID, structuredClone(record));
    return { ok: true, mapID: record.mapID };
  }

  async read(mapID: string): Promise<M2StorageRecord | null> {
    const record = this.records.get(mapID);
    return record ? structuredClone(record) : null;
  }

  async list(): Promise<M2StorageRecord[]> {
    return [...this.records.values()].map((record) => structuredClone(record));
  }
}
