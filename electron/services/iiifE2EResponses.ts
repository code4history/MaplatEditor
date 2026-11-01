// IIIF の取得を、試験用の応答の表に差し替える口。
//
// e2e は本物のネットワークへ出さない。開発時（`!app.isPackaged`）かつ
// `MAPLAT_E2E_ROOT` があるときだけ、`<MAPLAT_E2E_ROOT>/iiif-responses.json` を読み、
// 取得の 3 つの口（名前解決・分類・要求）を、その表から応答を作る偽物に置き換える。
// 製品（packaged）では決して読まない。表に無い URL は取得の失敗として返す。
//
// 表の形: `{ "<要求する URL>": { "status": 200, "headers": { ... }, "file": "相対のパス" } }`

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import type { IiifFetchDeps } from './iiifFetch';

/** 応答の 1 行。`file` は表の JSON からの相対のパス。 */
export type IiifResponseFixture = {
  status?: number;
  headers?: Record<string, string>;
  file?: string;
};

export type IiifResponseTable = Record<string, IiifResponseFixture>;

/** 表のファイル名（試験が置く）。 */
const RESPONSES_FILE = 'iiif-responses.json';

/** 表のファイルの場所。e2e の根が無ければ null。 */
export function iiifResponseTablePath(
  root: string | undefined = process.env['MAPLAT_E2E_ROOT'],
): string | null {
  if (!root) return null;
  return path.join(root, RESPONSES_FILE);
}

/** 表を読む。無い・読めない・形が違うときは null。 */
export function readIiifResponseTable(
  root?: string,
): { table: IiifResponseTable; baseDir: string } | null {
  const file = iiifResponseTablePath(root);
  if (!file) return null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return { table: parsed as IiifResponseTable, baseDir: path.dirname(file) };
  } catch {
    return null;
  }
}

/** 要求の options から、表を引くための URL を組み立てる（既定の 443 は書かない）。 */
function requestUrlOf(options: RequestOptions): string {
  const host = String(options.hostname ?? options.host ?? '');
  const port = typeof options.port === 'number' ? options.port : Number(options.port ?? 0);
  const suffix = port && port !== 443 ? ':' + port : '';
  const target = String(options.path ?? '/');
  return 'https://' + host + suffix + target;
}

/** 表に無い・読めない URL は、取得の失敗として返す（例外は投げない）。 */
function fixtureError(message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = 'ENOENT';
  return error;
}

/** 表から 1 行引く。完全一致を先に探し、無ければ末尾が `*` の行のうち最も長い前置きに合うもの。 */
function findFixture(table: IiifResponseTable, url: string): IiifResponseFixture | undefined {
  const exact = table[url];
  if (exact) return exact;
  let bestKey: string | null = null;
  let bestPrefix = -1;
  for (const key of Object.keys(table)) {
    if (!key.endsWith('*')) continue;
    const prefix = key.slice(0, -1);
    if (!url.startsWith(prefix)) continue;
    if (prefix.length > bestPrefix) {
      bestKey = key;
      bestPrefix = prefix.length;
    }
  }
  return bestKey === null ? undefined : table[bestKey];
}

type FixtureRequest = EventEmitter & {
  destroyed: boolean;
  destroy: (error?: Error) => void;
  end: () => void;
};

/**
 * 表から応答を作る偽の要求。本物の接続はしない（ポートを開かない・外へ出ない）。
 * 名前解決は固定の公開アドレスを返し、分類は通す（表が宛先を決める）。
 */
function createFixtureDeps(table: IiifResponseTable, baseDir: string): IiifFetchDeps {
  const request: IiifFetchDeps['request'] = (options, onResponse) => {
    const req = new EventEmitter() as FixtureRequest;
    req.destroyed = false;
    req.destroy = (error?: Error) => {
      if (req.destroyed) return;
      req.destroyed = true;
      if (error) req.emit('error', error);
    };
    req.end = () => {
      const url = requestUrlOf(options);
      const fixture = findFixture(table, url);
      if (!fixture) {
        req.emit('error', fixtureError('no fixture for ' + url));
        return;
      }
      let body = Buffer.alloc(0);
      if (typeof fixture.file === 'string' && fixture.file.length > 0) {
        try {
          body = fs.readFileSync(path.resolve(baseDir, fixture.file));
        } catch {
          req.emit('error', fixtureError('the fixture file is missing: ' + fixture.file));
          return;
        }
      }
      const message = new Readable({ read() {} }) as Readable & {
        statusCode?: number;
        headers?: Record<string, string>;
      };
      message.statusCode = typeof fixture.status === 'number' ? fixture.status : 200;
      message.headers = fixture.headers ?? {};
      process.nextTick(() => {
        if (body.length > 0) message.push(body);
        message.push(null);
      });
      onResponse(message as unknown as IncomingMessage);
    };
    return req as unknown as ClientRequest;
  };

  const lookup: IiifFetchDeps['lookup'] = (_hostname, options, callback) => {
    const address = '203.0.113.10';
    if (options.all) {
      callback(null, [{ address, family: 4 }]);
      return;
    }
    callback(null, address, 4);
  };

  const classify: IiifFetchDeps['classify'] = () => ({ blocked: false });

  return { request, lookup, classify };
}

/**
 * 取得の口の差し替え。e2e の根が無い・製品版・表が無いときは空（本物の口を使う）。
 * 返すのは `fetchIiifResource` の `deps` にそのまま渡せる部分だけ。
 */
export function resolveIiifResponseDeps(): Partial<IiifFetchDeps> {
  if (app.isPackaged) return {};
  if (!process.env['MAPLAT_E2E_ROOT']) return {};
  const loaded = readIiifResponseTable();
  if (!loaded) return {};
  return createFixtureDeps(loaded.table, loaded.baseDir);
}
