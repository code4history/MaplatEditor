// M19-T1 スモーク: 地図の名称属性を「表示ラベル(label) / タイトル(title)」へ統一する
// 移行写像と、その配置規律を検証する。
//
// タスク設計 `docs/superpowers/specs/2026-08-09-m19-t1-map-name-unification-design.md` v1.2
// 設計レビュー v2 (条件付き合格) の申し送りを含む。
//
// 検証する受け入れ条件:
//   AC-1a  移行モジュールと廃止属性処理点を除く製品コードから officialTitle が消えている
//   AC-1b  除外した SqliteDataService.ts でも officialTitle の出現は行頭コメント行のみ
//   AC-1c  store_handler の keys に label が入っている
//   AC-2   保存経路 (histMap2Store) で label が保持される (behavioral)
//   AC-4   unifyMapNameFields の写像が言語キー単位・無損失 (5 ケース)
//   AC-18a レガシー取込が写像を素通りしない（m19-t7 で不変条件を差し替え。旧: 取込だけが
//          preserveDeprecatedForMigration で写像を持たない → 新: そのオプションが存在しない）
//   AC-18b unifyMapNameFields の呼び出し点が mapNameUnification.ts の 1 箇所だけ
//          （m19-t7 で 2 箇所 → 1 箇所。marker 保護下の one-shot migration を撤去したため）
//   AC-18c adoptDeprecatedMapNames が冪等 (3 形)
//
// ★m19-t7 による不変条件の差し替えについて:
//   旧不変条件は「写像の呼び出し点は 2 箇所（one-shot migration と取込境界ゲート）。
//   レガシー取込からは呼ばない」だった。その規律の理由は「取込行は同一 migrate() 実行内の
//   後段 applyMapNameUnificationMigration が marker 保護下で写像する」ことであり、
//   m19-t7 がその後段を撤去したため前提が消滅した。差し替え後は
//   「写像の呼び出し点は 1 箇所。到達経路は書き込み側の唯一の正規化点 normalizeMapDocument だけ。
//   読み込み側からは呼ばない」であり、規律の目的（写像を 1 箇所に閉じる）は強化されている。
//   assert は消していない（消すのではなく新しい条件へ書き換える）。
//
// なぜ AC-2 が必要か: electron/utils/store_handler.ts の keys 配列と HistMapStore の
// フィールドの両方に label を足さないと、MapEditService.save (histMap2Store) で保存した
// 瞬間に data_json から消える。licenseNote (m6-t2) / pois (m10-t3) に続く 3 度目の同型欠落
// であり、同じ harness (m6-t2-map-license-note-roundtrip-smoke.mjs) を踏襲する。
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

// ---------------------------------------------------------------------------
// Part 1: 配置規律の静的検証 (AC-1a / AC-1b / AC-1c / AC-18a / AC-18b)
// ---------------------------------------------------------------------------

const DEPRECATED_ATTR = ['official', 'Title'].join(''); // 本ファイル自身が AC-1a の needle に当たらないようにする

async function readSource(rel) {
  return await readFile(path.join(projectRoot, rel), 'utf8');
}

/** rel 配下(src/electron)の全ソースを {rel, text} で列挙する */
async function listProductSources() {
  const { globSync } = await import('node:fs');
  const out = [];
  const walk = async (dir) => {
    const { readdir } = await import('node:fs/promises');
    for (const ent of await readdir(path.join(projectRoot, dir), { withFileTypes: true })) {
      const rel = `${dir}/${ent.name}`;
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === 'locales') continue;
        await walk(rel);
      } else if (/\.(ts|tsx|js|mjs|vue)$/.test(ent.name)) {
        out.push({ rel, text: await readFile(path.join(projectRoot, rel), 'utf8') });
      }
    }
  };
  void globSync;
  await walk('src');
  await walk('electron');
  return out;
}

const AC1A_EXEMPT = new Set([
  'src/utils/mapNameUnification.ts',
  'electron/services/SqliteDataService.ts',
]);

const sources = await listProductSources();
const ac1aOffenders = sources
  .filter((f) => !AC1A_EXEMPT.has(f.rel) && f.text.includes(DEPRECATED_ATTR))
  .map((f) => f.rel);
assert.deepEqual(
  ac1aOffenders,
  [],
  `AC-1a: 除外 2 ファイル以外の製品コードに廃止属性の言及が残っている: ${ac1aOffenders.join(', ')}`
);
console.log('ok: AC-1a 除外 2 ファイル以外の src/electron に廃止属性の言及なし');

// AC-1b: SqliteDataService.ts 側は「行頭コメント行」を除けば 0 行。
// (設計レビュー v2 Info-3: AC-1b の正規表現は行末コメントを除外しないため、
//  説明コメントは行頭コメント行にのみ置く)
const sqliteText = await readSource('electron/services/SqliteDataService.ts');
const ac1bOffenders = sqliteText
  .split('\n')
  .map((line, i) => ({ no: i + 1, line }))
  .filter(({ line }) => line.includes(DEPRECATED_ATTR))
  .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line));
assert.deepEqual(
  ac1bOffenders.map((o) => `${o.no}: ${o.line.trim()}`),
  [],
  'AC-1b: SqliteDataService.ts のコード行に廃止属性が残っている (受容は adoptDeprecatedMapNames の呼び出しに閉じるはず)'
);
console.log('ok: AC-1b SqliteDataService.ts のコード行に廃止属性なし (行頭コメントのみ)');

// AC-1c: store_handler の keys に label が在る / 廃止属性が無い
const storeHandlerText = await readSource('electron/utils/store_handler.ts');
const keysBlock = storeHandlerText.match(/const keys[\s\S]*?\];/)?.[0];
assert.ok(keysBlock, 'AC-1c: store_handler.ts の keys 配列を抽出できるはず');
assert.ok(/"label"/.test(keysBlock), 'AC-1c: keys 配列に "label" が入っているはず');
assert.ok(!keysBlock.includes(DEPRECATED_ATTR), 'AC-1c: keys 配列から廃止属性が消えているはず');
const histMapStoreBlock = storeHandlerText.match(/export interface HistMapStore \{[\s\S]*?\n\}/)?.[0];
assert.ok(histMapStoreBlock, 'AC-1c: HistMapStore の型定義を抽出できるはず');
assert.ok(
  /^\s{2}label\??:/m.test(histMapStoreBlock),
  'AC-1c: HistMapStore に label フィールドが新設されているはず (器が無いと keys だけでは保存されない)'
);
console.log('ok: AC-1c store_handler の HistMapStore/keys に label の器がある');

// AC-18a (m19-t7 で差し替え): レガシー取込は写像を素通りしない。
//   旧条件「preserveDeprecatedForMigration のコード行が 3 行あり、呼び出しは importLegacyMaps
//   本体の 1 行だけ」は、当該オプションを撤去したことで維持不能になった。
//   新条件: (1) 当該オプションはコード行に 1 件も無い、
//           (2) importLegacyMaps 本体が normalizeMapDocument を **オプション無しで** 呼ぶ。
const sqliteLines = sqliteText.split('\n');
const preserveHits = sqliteLines
  .map((line, i) => ({ no: i + 1, line }))
  .filter(({ line }) => line.includes('preserveDeprecatedForMigration'))
  .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line));
assert.deepEqual(
  preserveHits.map((h) => `${h.no}: ${h.line.trim()}`),
  [],
  'AC-18a: 取込だけ写像を素通りさせるオプションはコード行に残っていないはず (m19-t7 で撤去)'
);
// 呼び出し行が importLegacyMaps の本体行レンジにあることを行番号で assert する (目視ではない)
function bodyRangeOf(lines, signatureNeedle) {
  const startIdx = lines.findIndex((l) => l.includes(signatureNeedle));
  assert.ok(startIdx >= 0, `関数 ${signatureNeedle} が見つかるはず`);
  const indent = lines[startIdx].match(/^\s*/)[0].length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') continue;
    const curIndent = l.match(/^\s*/)[0].length;
    if (curIndent === indent && l.trim().startsWith('}')) return [startIdx + 1, i + 1];
  }
  throw new Error(`関数 ${signatureNeedle} の終端が見つからない`);
}
const importLegacyRange = bodyRangeOf(sqliteLines, 'private importLegacyMaps(');
const normalizeCallsInImport = sqliteLines
  .map((line, i) => ({ no: i + 1, line }))
  .filter(({ no, line }) =>
    no >= importLegacyRange[0] &&
    no <= importLegacyRange[1] &&
    line.includes('normalizeMapDocument(') &&
    !/^\s*(\/\/|\*|\/\*)/.test(line)
  );
assert.equal(
  normalizeCallsInImport.length,
  1,
  `AC-18a: importLegacyMaps 本体 (${importLegacyRange[0]}-${importLegacyRange[1]}) は書き込み側の唯一の正規化点 normalizeMapDocument をちょうど 1 回通るはず`
);
assert.match(
  normalizeCallsInImport[0].line,
  /normalizeMapDocument\(doc\)/,
  'AC-18a: 取込は normalizeMapDocument を **オプション無しで** 呼ぶはず (写像を素通りさせない)'
);
console.log(
  `ok: AC-18a レガシー取込は唯一の正規化点を素通りしない (行 ${normalizeCallsInImport[0].no})`
);

// AC-18b (m19-t7 で差し替え): unifyMapNameFields の呼び出し点は 1 ファイルだけ。
//   旧条件は 2 ファイル (SqliteDataService.ts の one-shot migration + mapNameUnification.ts)。
//   m19-t7 が前者を撤去したので、写像に触れるのは写像モジュール自身だけになった。
const unifyHits = [];
for (const f of sources) {
  f.text.split('\n').forEach((line, i) => {
    if (line.includes('unifyMapNameFields') && !/^\s*(\/\/|\*|\/\*)/.test(line)) {
      unifyHits.push({ rel: f.rel, no: i + 1, line: line.trim() });
    }
  });
}
const unifyFiles = [...new Set(unifyHits.map((h) => h.rel))].sort();
assert.deepEqual(
  unifyFiles,
  ['src/utils/mapNameUnification.ts'],
  `AC-18b: unifyMapNameFields に触れるファイルは 1 つのみのはず。実際: ${unifyFiles.join(', ')}`
);
// 唯一の到達経路 adoptDeprecatedMapNames は書き込み側の正規化点からのみ呼ばれ、
// 読み込み側 (mapRowToDocument) からも取込 (importLegacyMaps) からも直接は呼ばれない
const adoptHits = sqliteLines
  .map((line, i) => ({ no: i + 1, line }))
  .filter(({ line }) => line.includes('adoptDeprecatedMapNames') && !/^\s*(\/\/|\*|\/\*)/.test(line))
  .filter(({ line }) => !/^\s*import\b/.test(line));
assert.equal(
  adoptHits.length,
  1,
  `AC-18b: adoptDeprecatedMapNames の呼び出しは 1 箇所のみのはず。実際: ${adoptHits.map((h) => h.no).join(',')}`
);
const normalizeMapDocumentRange = bodyRangeOf(sqliteLines, 'function normalizeMapDocument(');
assert.ok(
  adoptHits[0].no >= normalizeMapDocumentRange[0] && adoptHits[0].no <= normalizeMapDocumentRange[1],
  `AC-18b: 唯一の呼び出しは normalizeMapDocument 本体 (${normalizeMapDocumentRange[0]}-${normalizeMapDocumentRange[1]}) の中にあるはず。実際: ${adoptHits[0].no}`
);
const mapRowRange = bodyRangeOf(sqliteLines, 'export function mapRowToDocument(');
for (const [name, range] of [
  ['mapRowToDocument', mapRowRange],
  ['importLegacyMaps', importLegacyRange],
]) {
  assert.ok(
    !(adoptHits[0].no >= range[0] && adoptHits[0].no <= range[1]),
    `AC-18b: ${name} の本体 (${range[0]}-${range[1]}) から写像を直接呼んではならない`
  );
}
console.log('ok: AC-18b 写像に触れるのは mapNameUnification.ts のみ / 到達点は normalizeMapDocument の 1 箇所');

// ---------------------------------------------------------------------------
// Part 2: 写像の単体検証 + 保存経路の behavioral 検証 (AC-4 / AC-18c / AC-2)
// ---------------------------------------------------------------------------

const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm19-t1-map-name-unification-'));
const entryFile = path.join(workDir, 'map-name-unification-smoke.ts');
const electronStubFile = path.join(workDir, 'electron-stub.ts');
const electronStoreStubFile = path.join(workDir, 'electron-store-stub.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'map-name-unification-smoke.mjs');

try {
  const dataDir = path.join(workDir, 'data');
  await mkdir(dataDir, { recursive: true });

  const settingsPath = path.join(projectRoot, 'electron/services/SettingsService.ts');
  const sqlitePath = path.join(projectRoot, 'electron/services/SqliteDataService.ts');
  const mapEditServicePath = path.join(projectRoot, 'electron/services/MapEditService.ts');
  const unificationPath = path.join(projectRoot, 'src/utils/mapNameUnification.ts');

  await writeFile(
    electronStubFile,
    `
      export const app = {
        getPath(name: string) {
          if (name === 'documents') return ${JSON.stringify(path.join(workDir, 'documents'))};
          if (name === 'temp') return ${JSON.stringify(path.join(workDir, 'temp'))};
          if (name === 'appData') return ${JSON.stringify(path.join(workDir, 'appData'))};
          return ${JSON.stringify(workDir)};
        },
        getName() { return 'MaplatEditor'; },
        whenReady() { return Promise.resolve(); },
        exit(code?: number) { if (code && code !== 0) process.exitCode = code; },
      };
      export const dialog = {
        showOpenDialog() { return Promise.resolve({ canceled: true, filePaths: [] }); },
        showMessageBox() { return Promise.resolve({ response: 0 }); },
      };
      export const ipcMain = { handle() {} };
      export const BrowserWindow = class {
        static getAllWindows() { return []; }
        static fromWebContents() { return null; }
      };
      export const session = {
        defaultSession: {
          clearStorageData() { return Promise.resolve(); },
        },
      };
      export const shell = {
        trashItem(_path: string) { return Promise.resolve(); },
      };
    `
  );
  await writeFile(
    electronStoreStubFile,
    `
      export default class Store<T extends Record<string, any>> {
        store: T;
        constructor(options: { defaults?: T } = {}) {
          this.store = { ...(options.defaults || {}) } as T;
        }
        get(key: string) { return this.store[key]; }
        set(key: string, value: any) { this.store[key as keyof T] = value; }
        has(key: string) { return Object.prototype.hasOwnProperty.call(this.store, key); }
      }
    `
  );

  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';

      const DEPRECATED = ['official', 'Title'].join('');

      const { unifyMapNameFields, adoptDeprecatedMapNames } =
        await import(${JSON.stringify(unificationPath)});

      // ================= AC-4: 写像は言語キー単位・無損失 (5 ケース) =================

      // ケース①: 正式名あり(単言語)
      {
        const out = unifyMapNameFields({ lang: 'ja', title: { ja: '表示A' }, [DEPRECATED]: { ja: '正確A' } });
        assert.deepEqual(out.title, { ja: '正確A' }, 'AC-4①: title は旧正確名になるはず');
        assert.deepEqual(out.label, { ja: '表示A' }, 'AC-4①: label は旧表示用名になるはず');
        assert.ok(!(DEPRECATED in out), 'AC-4①: 廃止属性のキーが消えるはず');
      }

      // ケース②: 正式名なし → title は旧 title で必須制約を満たす(移行時の一時措置)
      {
        const out = unifyMapNameFields({ lang: 'ja', title: { ja: '表示B' } });
        assert.deepEqual(out.title, { ja: '表示B' }, 'AC-4②: 正確名が無ければ title は旧 title のはず');
        assert.deepEqual(out.label, { ja: '表示B' }, 'AC-4②: label も旧 title のはず');
      }

      // ケース③: 旧 title 空 / 旧 label 実在 → label は上書きされず維持される
      {
        const out = unifyMapNameFields({ lang: 'ja', title: {}, label: { ja: '既存ラベル' }, [DEPRECATED]: { ja: '正確C' } });
        assert.deepEqual(out.label, { ja: '既存ラベル' }, 'AC-4③: 既存 label は捨てられないはず');
        assert.deepEqual(out.title, { ja: '正確C' }, 'AC-4③: title は正確名になるはず');
      }

      // ケース④: 多言語で正確名が一部言語のみ → 他言語の title が残る(文書単位写像だと消える)
      {
        const out = unifyMapNameFields({
          lang: 'ja',
          title: { ja: '表示D', en: 'DisplayD' },
          [DEPRECATED]: { ja: '正確D' },
        });
        assert.deepEqual(
          out.title,
          { ja: '正確D', en: 'DisplayD' },
          'AC-4④: 英語のタイトルが消えないはず(言語キー単位の写像)'
        );
        assert.deepEqual(out.label, { ja: '表示D', en: 'DisplayD' }, 'AC-4④: label は旧 title 全言語のはず');
      }

      // ケース⑤: 副の守りの限界 — 2 回適用で既存言語キーの値は 1 つも変わらない。
      //   label の欠損言語キーの補充だけは起こりうる (marker が主の守りである理由)
      {
        const input = { lang: 'ja', title: { ja: '表示E' }, [DEPRECATED]: { ja: '正確E', en: 'OfficialE' } };
        const once = unifyMapNameFields(input);
        assert.deepEqual(once.title, { ja: '正確E', en: 'OfficialE' }, 'AC-4⑤: 1 回目の title');
        assert.deepEqual(once.label, { ja: '表示E' }, 'AC-4⑤: 1 回目の label は ja のみ');
        const twice = unifyMapNameFields(once);
        assert.deepEqual(twice.title, once.title, 'AC-4⑤: 2 回目で title は変わらないはず');
        assert.equal(twice.label.ja, '表示E', 'AC-4⑤: 2 回目で既存言語キー label.ja の値は変わらないはず');
        assert.equal(
          twice.label.en,
          'OfficialE',
          'AC-4⑤: 欠損言語キー label.en の補充は起こりうる (no-op ではない)'
        );
      }
      console.log('ok: AC-4 unifyMapNameFields の写像 5 ケース');

      // ================= AC-18c: adoptDeprecatedMapNames は冪等 (3 形) =================
      {
        // ①廃止属性が非空
        const a = { lang: 'ja', title: { ja: '表示F' }, [DEPRECATED]: { ja: '正確F' } };
        const a1 = adoptDeprecatedMapNames(a);
        const a2 = adoptDeprecatedMapNames(a1);
        assert.deepEqual(a2, a1, 'AC-18c①: 非空でも 1 回適用 = 2 回適用のはず');
        assert.deepEqual(a1.title, { ja: '正確F' }, 'AC-18c①: 写像が働くはず');
        assert.ok(!(DEPRECATED in a1), 'AC-18c①: キーが消えるはず');

        // ②廃止属性が空文字(キー在) → キー在時ゲートなので発火する
        const b = { lang: 'ja', title: { ja: '表示G' }, [DEPRECATED]: '' };
        const b1 = adoptDeprecatedMapNames(b);
        const b2 = adoptDeprecatedMapNames(b1);
        assert.deepEqual(b2, b1, 'AC-18c②: 空文字でも 1 回適用 = 2 回適用のはず');
        assert.ok(!(DEPRECATED in b1), 'AC-18c②: 空文字でもキーが消えるはず');
        assert.deepEqual(b1.label, { ja: '表示G' }, 'AC-18c②: 空文字キー在時も migration 経路と同じ結果のはず');

        // ③廃止属性のキーが無い → 完全な no-op (label の自動補完が起きない)
        const c = { lang: 'ja', title: { ja: '表示H' } };
        const c1 = adoptDeprecatedMapNames(c);
        assert.deepEqual(c1, c, 'AC-18c③: キー無しなら入力と完全一致のはず (label 自動補完が起きない)');
        assert.equal(c1.label, undefined, 'AC-18c③: label が勝手に生えないはず');
      }
      console.log('ok: AC-18c adoptDeprecatedMapNames の冪等性 3 形');

      // ================= AC-2: 保存経路 (histMap2Store) で label が保持される =================
      const { default: SettingsService } = await import(${JSON.stringify(settingsPath)});
      SettingsService.set('saveFolder', ${JSON.stringify(dataDir)});

      const { default: SqliteDataService } = await import(${JSON.stringify(sqlitePath)});
      const { default: MapEditService } = await import(${JSON.stringify(mapEditServicePath)});
      await SqliteDataService.getDb();

      const LABEL_FIXTURE = { ja: '高畑', en: 'Takabatake' };
      const mapObject: any = {
        mapID: 'label-roundtrip-map',
        title: '高畑村公図 第一号',
        label: LABEL_FIXTURE,
        attr: '',
        dataAttr: '',
        author: '',
        createdAt: '',
        era: '',
        license: 'All right reserved',
        dataLicense: 'CC BY-SA',
        licenseNote: '',
        dataLicenseNote: '',
        contributor: '',
        mapper: '',
        reference: '',
        description: '',
        url: '',
        lang: 'ja',
        imageExtension: 'jpg',
        width: 400,
        height: 300,
        gcps: [],
        edges: [],
        sub_maps: [],
        strictMode: 'strict',
        vertexMode: 'plain',
        homePosition: [135.0, 35.0],
        mercZoom: 15,
      };

      const saveResult = await MapEditService.save({
        mapObject,
        tins: [],
        slug: 'label-roundtrip-map',
      });
      assert.equal(saveResult.result, 'Success', 'AC-2: save は Success のはず: ' + JSON.stringify(saveResult));
      const stored = await SqliteDataService.findMapByRef('label-roundtrip-map');
      assert.ok(stored, 'AC-2: 保存した地図が見つかるはず');
      assert.deepEqual(
        stored.label,
        LABEL_FIXTURE,
        'AC-2: 保存経路 (histMap2Store) で data_json の label が保持されるはず (keys/HistMapStore に無いと落ちる)'
      );
      const loaded = await MapEditService.request(saveResult.uid);
      assert.deepEqual(
        loaded.label,
        LABEL_FIXTURE,
        'AC-2: 読込経路 (store2HistMap) でも label が保持されるはず'
      );
      console.log('ok: AC-2 保存/読込の両方向で label が保持される');

      // 保存経路では受容ゲートが発火しない (廃止属性は keys 射影で normalizeMapDocument 到達前に消える)
      const saveWithDeprecated = await MapEditService.save({
        mapObject: { ...mapObject, mapID: 'gate-no-fire-map', label: undefined, [DEPRECATED]: { ja: '正確I' } },
        tins: [],
        slug: 'gate-no-fire-map',
      });
      assert.equal(saveWithDeprecated.result, 'Success', 'AC-2: ゲート検証用の save も Success のはず');
      const gateStored = await SqliteDataService.findMapByRef('gate-no-fire-map');
      assert.ok(!(DEPRECATED in gateStored), 'AC-2: 保存経路では廃止属性が DB に入らないはず');
      const gateLabel = gateStored.label === undefined ? {} : gateStored.label;
      assert.deepEqual(
        gateLabel, {},
        'AC-2: v2 の保存経路でゲートは発火せず label の自動補完は起きないはず。実際: ' + JSON.stringify(gateStored.label)
      );
      console.log('ok: AC-2 v2 保存経路でゲートが誤発火しない (label 自動補完なし)');

      console.log('M19-T1 map name unification smoke passed');
      process.exit(0);
    `,
  );

  await build({
    root: projectRoot,
    configFile: false,
    logLevel: 'error',
    resolve: {
      alias: [
        { find: 'electron', replacement: electronStubFile },
        { find: 'electron-store', replacement: electronStoreStubFile },
      ],
    },
    build: {
      emptyOutDir: true,
      outDir,
      ssr: entryFile,
      target: 'node22',
      rollupOptions: {
        external: [
          '@duckdb/node-api',
          '@duckdb/node-bindings',
          /^@duckdb\/node-bindings-.*/,
          'jimp',
          'pwa-asset-generator',
          '@maplat/tin',
          '@maplat/transform',
        ],
        output: {
          entryFileNames: 'map-name-unification-smoke.mjs',
          format: 'es',
        },
      },
    },
  });

  const { stdout } = await execFileAsync(process.execPath, [bundledFile], {
    cwd: projectRoot,
    timeout: 180000,
    maxBuffer: 1024 * 1024 * 8,
  });
  process.stdout.write(stdout);
  console.log('M19-T1 map name unification smoke passed');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
