import Store from 'electron-store';
import { app } from 'electron';
import fs from 'fs-extra';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type {
  PoiSourceMode,
  PoiSourceStatus,
  PoiSourceValidation,
  PoiSourceSummary,
  PoiSourceListRequest,
  PoiSourceListResponse,
  PoiFeatureCollection,
  PoiSourceDocument,
  PoiSourceCreateLocalInput,
  PoiSourceRegisterRemoteInput,
  PoiSourceValidateRemoteInput,
} from '../../src/services/registeredPoiSourceCatalog';
import { validateFeatureCollection } from './poiValidation';

// --- main process internal index (not exported to renderer) ---

interface PoiSourceIndexEntry {
  sourceId: string;
  title: string;
  mode: PoiSourceMode;
  status: PoiSourceStatus;
  url?: string;
  storageRelativePath?: string;
  featureCount: number | null;
  updatedAt?: string;
  validation: PoiSourceValidation;
}

interface PoiSourceStoreShape {
  poiSources: {
    index: PoiSourceIndexEntry[];
  };
}

// --- Constants ---

const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5 MiB
const FETCH_TIMEOUT_MS = 10_000;
const SOURCE_GEOJSON = 'source.geojson';
const SOURCE_GEOJSON_TMP = 'source.geojson.tmp';

// --- Service ---

class PoiSourceService {
  private store: Store<PoiSourceStoreShape>;
  private userDataRoot: string;
  private writeQueues = new Map<string, Promise<unknown>>();

  constructor(options?: { userDataRoot?: string }) {
    this.userDataRoot = options?.userDataRoot ?? app.getPath('userData');
    this.store = new Store<PoiSourceStoreShape>({
      defaults: { poiSources: { index: [] } },
      cwd: this.userDataRoot,
      name: 'poi-sources',
    });
    this.ensureDirectories();
    this.cleanupTmpFiles();
  }

  private ensureDirectories() {
    const poiDir = path.join(this.userDataRoot, 'poi-sources');
    fs.ensureDirSync(poiDir);
  }

  private cleanupTmpFiles() {
    const poiDir = path.join(this.userDataRoot, 'poi-sources');
    try {
      const entries = fs.readdirSync(poiDir);
      for (const entry of entries) {
        const tmpFile = path.join(poiDir, entry, SOURCE_GEOJSON_TMP);
        if (fs.existsSync(tmpFile)) {
          try {
            fs.removeSync(tmpFile);
          } catch (e) {
            console.warn(`[PoiSourceService] Failed to cleanup tmp file: ${tmpFile}`, e);
          }
        }
      }
    } catch (e) {
      console.warn('[PoiSourceService] Failed to list poi-sources directory for tmp cleanup', e);
    }
  }

  private getIndex(): PoiSourceIndexEntry[] {
    return this.store.get('poiSources.index', []) as PoiSourceIndexEntry[];
  }

  private saveIndex(index: PoiSourceIndexEntry[]) {
    this.store.set('poiSources.index', index);
  }

  private toSummary(entry: PoiSourceIndexEntry): PoiSourceSummary {
    return {
      catalogKey: `poi-source:${entry.sourceId}`,
      sourceId: entry.sourceId,
      title: entry.title,
      mode: entry.mode,
      featureCount: entry.featureCount,
      url: entry.url,
      status: entry.status,
      readOnly: entry.mode === 'remote',
      updatedAt: entry.updatedAt,
      validation: entry.validation,
    };
  }

  private sourceDir(sourceId: string): string {
    return path.join(this.userDataRoot, 'poi-sources', sourceId);
  }

  private sourceGeojsonPath(sourceId: string): string {
    return path.join(this.sourceDir(sourceId), SOURCE_GEOJSON);
  }

  private sourceGeojsonTmpPath(sourceId: string): string {
    return path.join(this.sourceDir(sourceId), SOURCE_GEOJSON_TMP);
  }

  private enqueueWrite<T>(sourceId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.writeQueues.get(sourceId) ?? Promise.resolve();
    const next = prev.then(() => fn(), () => fn());
    this.writeQueues.set(sourceId, next);
    return next;
  }

  // --- Public API ---

  async list(request: PoiSourceListRequest): Promise<PoiSourceListResponse> {
    if (!Number.isInteger(request.page) || request.page < 1) {
      throw new TypeError(`page must be >= 1; got ${request.page}`);
    }
    if (!Number.isInteger(request.pageSize) || request.pageSize < 1 || request.pageSize > 100) {
      throw new TypeError(`pageSize must be 1-100; got ${request.pageSize}`);
    }

    const index = this.getIndex();
    const q = request.query.toLowerCase();
    const filtered = q
      ? index.filter(e =>
          e.title.toLowerCase().includes(q) ||
          (e.url && e.url.toLowerCase().includes(q)) ||
          e.sourceId.toLowerCase().includes(q)
        )
      : index;

    const start = (request.page - 1) * request.pageSize;
    const items = filtered.slice(start, start + request.pageSize).map(e => this.toSummary(e));

    return {
      items,
      page: request.page,
      hasPrev: request.page > 1,
      hasNext: start + request.pageSize < filtered.length,
    };
  }

  async get(sourceId: string): Promise<PoiSourceDocument> {
    const index = this.getIndex();
    const entry = index.find(e => e.sourceId === sourceId);
    if (!entry) {
      throw new TypeError(`Source not found: ${sourceId}`);
    }

    const summary = this.toSummary(entry);
    const doc: PoiSourceDocument = { summary };

    if (entry.mode === 'local' && entry.storageRelativePath) {
      const geojsonPath = path.join(this.userDataRoot, entry.storageRelativePath);
      if (fs.existsSync(geojsonPath)) {
        doc.geojson = await fs.readJson(geojsonPath) as PoiFeatureCollection;
      }
    }

    if (entry.mode === 'remote' && entry.url) {
      doc.remote = { url: entry.url };
    }

    return doc;
  }

  async createLocal(input: PoiSourceCreateLocalInput): Promise<PoiSourceDocument> {
    const title = input.title?.trim();
    if (!title) {
      throw new TypeError('title must not be empty');
    }

    const sourceId = randomUUID();
    const storageRelativePath = path.join('poi-sources', sourceId, SOURCE_GEOJSON);

    let geojson: PoiFeatureCollection;
    if (!input.geojson || (input.geojson as any).kind === 'empty') {
      geojson = { type: 'FeatureCollection', features: [] };
    } else {
      const validation = validateFeatureCollection(input.geojson);
      if (!validation.valid) {
        throw new TypeError(`Invalid GeoJSON: ${validation.message}`);
      }
      geojson = { type: 'FeatureCollection', features: validation.features as any };
    }

    const entry: PoiSourceIndexEntry = {
      sourceId,
      title,
      mode: 'local',
      status: 'ready',
      storageRelativePath,
      featureCount: geojson.features.length,
      updatedAt: new Date().toISOString(),
      validation: { status: 'ready', checkedAt: new Date().toISOString() },
    };

    // Write geojson file first, then commit index
    const dir = this.sourceDir(sourceId);
    fs.ensureDirSync(dir);
    const tmpPath = this.sourceGeojsonTmpPath(sourceId);
    const finalPath = this.sourceGeojsonPath(sourceId);
    await fs.writeJson(tmpPath, geojson);
    fs.renameSync(tmpPath, finalPath);

    const index = this.getIndex();
    index.push(entry);
    this.saveIndex(index);

    return { summary: this.toSummary(entry), geojson };
  }

  async saveLocal(sourceId: string, geojson: PoiFeatureCollection): Promise<PoiSourceDocument> {
    const index = this.getIndex();
    const entry = index.find(e => e.sourceId === sourceId);
    if (!entry) {
      throw new TypeError(`Source not found: ${sourceId}`);
    }
    if (entry.mode !== 'local') {
      throw new TypeError(`Cannot saveLocal on remote source: ${sourceId}`);
    }

    return this.enqueueWrite(sourceId, async () => {
      const validation = validateFeatureCollection(geojson);
      if (!validation.valid) {
        throw new TypeError(`Invalid GeoJSON: ${validation.message}`);
      }

      const normalized: PoiFeatureCollection = {
        type: 'FeatureCollection',
        features: validation.features as any,
      };

      const dir = this.sourceDir(sourceId);
      fs.ensureDirSync(dir);
      const tmpPath = this.sourceGeojsonTmpPath(sourceId);
      const finalPath = this.sourceGeojsonPath(sourceId);
      await fs.writeJson(tmpPath, normalized);
      fs.renameSync(tmpPath, finalPath);

      entry.featureCount = normalized.features.length;
      entry.updatedAt = new Date().toISOString();
      entry.status = 'ready';
      entry.validation = { status: 'ready', checkedAt: new Date().toISOString() };
      this.saveIndex(index);

      return { summary: this.toSummary(entry), geojson: normalized };
    });
  }

  async registerRemote(input: PoiSourceRegisterRemoteInput): Promise<PoiSourceDocument> {
    const title = input.title?.trim();
    if (!title) {
      throw new TypeError('title must not be empty');
    }

    // Pre-check: scheme
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(input.url);
    } catch {
      throw new TypeError(`Invalid URL: ${input.url}`);
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new TypeError(`Unsupported scheme: ${parsedUrl.protocol}`);
    }

    const sourceId = randomUUID();

    // Attempt fetch (may fail, but we still register)
    let validation: PoiSourceValidation;
    try {
      validation = await this.fetchAndValidate(input.url);
    } catch (e) {
      validation = { status: 'unreachable', checkedAt: new Date().toISOString(), message: String(e) };
    }

    const entry: PoiSourceIndexEntry = {
      sourceId,
      title,
      mode: 'remote',
      status: validation.status,
      url: input.url,
      featureCount: null,
      updatedAt: new Date().toISOString(),
      validation,
    };
    entry.status = validation.status;

    const index = this.getIndex();
    index.push(entry);
    this.saveIndex(index);

    return { summary: this.toSummary(entry), remote: { url: input.url } };
  }

  async validateRemote(input: PoiSourceValidateRemoteInput): Promise<PoiSourceValidation> {
    if (input.kind === 'source') {
      const index = this.getIndex();
      const entry = index.find(e => e.sourceId === input.sourceId);
      if (!entry) {
        throw new TypeError(`Source not found: ${input.sourceId}`);
      }
      if (entry.mode !== 'remote') {
        throw new TypeError(`Source is not remote: ${input.sourceId}`);
      }
      if (!entry.url) {
        throw new TypeError(`Remote source has no url: ${input.sourceId}`);
      }

      const validation = await this.fetchAndValidate(entry.url);
      entry.status = validation.status;
      entry.validation = validation;
      entry.updatedAt = new Date().toISOString();
      this.saveIndex(index);
      return validation;
    }

    // input.kind === 'url'
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(input.url);
    } catch {
      return { status: 'invalid', errorCode: 'unsupported_scheme', checkedAt: new Date().toISOString(), message: `Invalid URL: ${input.url}` };
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return { status: 'invalid', errorCode: 'unsupported_scheme', checkedAt: new Date().toISOString(), message: `Unsupported scheme: ${parsedUrl.protocol}` };
    }

    return this.fetchAndValidate(input.url);
  }

  async delete(sourceId: string): Promise<{ ok: true }> {
    const index = this.getIndex();
    const idx = index.findIndex(e => e.sourceId === sourceId);
    if (idx === -1) {
      throw new TypeError(`Source not found: ${sourceId}`);
    }

    // Remove geojson file if local
    const entry = index[idx];
    if (entry.mode === 'local') {
      const dir = this.sourceDir(sourceId);
      if (fs.existsSync(dir)) {
        await fs.remove(dir);
      }
    }

    index.splice(idx, 1);
    this.saveIndex(index);
    return { ok: true };
  }

  // --- Remote fetch helper ---

  private async fetchAndValidate(url: string): Promise<PoiSourceValidation> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        return {
          status: 'unreachable',
          checkedAt: new Date().toISOString(),
          message: `HTTP ${response.status} ${response.statusText}`,
        };
      }

      // Check content-length if available
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
        return {
          status: 'unreachable',
          errorCode: 'payload_too_large',
          checkedAt: new Date().toISOString(),
          message: `Payload too large: ${contentLength} bytes`,
        };
      }

      const text = await response.text();
      if (text.length > MAX_PAYLOAD_BYTES) {
        return {
          status: 'unreachable',
          errorCode: 'payload_too_large',
          checkedAt: new Date().toISOString(),
          message: `Payload too large: ${text.length} bytes`,
        };
      }

      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        return {
          status: 'invalid',
          errorCode: 'invalid_json',
          checkedAt: new Date().toISOString(),
          message: 'Response is not valid JSON',
        };
      }

      const validation = validateFeatureCollection(data);
      if (!validation.valid) {
        return {
          status: 'invalid',
          errorCode: validation.errorCode,
          checkedAt: new Date().toISOString(),
          message: validation.message,
        };
      }

      return {
        status: 'ready',
        checkedAt: new Date().toISOString(),
      };
    } catch (e: any) {
      if (e.name === 'AbortError') {
        return {
          status: 'unreachable',
          errorCode: 'timeout',
          checkedAt: new Date().toISOString(),
          message: 'Fetch timed out',
        };
      }
      if (e.cause?.code === 'ENOTFOUND' || e.cause?.code === 'ECONNREFUSED') {
        return {
          status: 'unreachable',
          errorCode: 'network_error',
          checkedAt: new Date().toISOString(),
          message: String(e),
        };
      }
      if (e.cause?.code === 'ERR_TLS_CERT_ALTNAME_INVALID' || e.message?.includes('TLS')) {
        return {
          status: 'unreachable',
          errorCode: 'tls_error',
          checkedAt: new Date().toISOString(),
          message: String(e),
        };
      }
      return {
        status: 'unreachable',
        errorCode: 'network_error',
        checkedAt: new Date().toISOString(),
        message: String(e),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export default PoiSourceService;
