// M4-T1 スモーク: pois の受け入れ関所（acceptDocumentPois）と判定ガード（usePoisFormatGuard）が
// AppEdit / MapEdit の共通実装になっていることの検証（設計 2026-08-02-m4-t1-map-pois-format-guard-design.md v1.3）。
//
// 注意: 本タスクは Cycle 1 の m4-t1（scripts/m4-t1-revisioned-save-smoke.mjs）と ID が衝突するため、
// 設計 §7.6 の規約どおり内容語を含むファイル名にしている。
//
// Part A: acceptDocumentPois の表駆動（AC8 / 親設計 §6 の F1〜F7）
//         — 配列は同一参照で素通し / 既存の空配列は維持 / 未設定はキーを生やさない /
//           未対応形式は生値をそのまま温存 / target === incoming でも安全（冪等）
// Part B: usePoisFormatGuard の反応性（AC1 の第2層）
//         — 文書が差し替わったら判定が追随する（関所を通らない履歴復帰でも正しい）
// Part C: 実装同一性（AC1）と関所の実効性（AC2）のソース assert
//         — 両 View が同じ1本を通り、温存の独自分岐を持たない /
//           MapEdit の mapData.value 直接代入が setter と履歴復帰の2箇所のみ
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm4-t1-pois-guard-'));
const entryFile = path.join(workDir, 'm4-t1-smoke.ts');
const outDir = path.join(workDir, 'dist');
const bundledFile = path.join(outDir, 'm4-t1-smoke.mjs');

const appPoisFormatPath = path.join(projectRoot, 'src/utils/appPoisFormat.ts');
const guardPath = path.join(projectRoot, 'src/composables/usePoisFormatGuard.ts');

let failed = false;

try {
  // ================= Part A / Part B（実コードを bundle して実行）=================
  await writeFile(
    entryFile,
    `
      import assert from 'node:assert/strict';
      import { ref, nextTick } from 'vue';

      const { acceptDocumentPois, readAppDocumentPois } = await import(${JSON.stringify(appPoisFormatPath)});
      const { usePoisFormatGuard } = await import(${JSON.stringify(guardPath)});

      // ---- Part A: acceptDocumentPois の表駆動（F1〜F7 + 未設定/null）----
      const refArray = [{ poiUid: '11111111-1111-4111-8111-111111111111', cachedTitle: '参照POI' }];
      const inlineArray = [{ name: '若松城', lat: 37.487717, lng: 139.929786 }];
      const urlArray = ['morioka_one_poi.json'];
      const urlString = 'morioka_one_poi.json';
      const jsonString = JSON.stringify(refArray);
      const layerKeyObject = { main: [], shrines: [] };
      const wrapperWhole = { layer: 'morioka_one_poi.json', hide: true };
      const bareWrapper = { layer: 'morioka_one_poi.json' };

      const cases = [
        { id: 'F1', label: '参照配列（poiUid）', incoming: refArray, expect: 'same-ref', supported: true },
        { id: 'F2', label: '空配列', incoming: [], expect: 'same-ref', supported: true },
        { id: 'F3', label: '素の POI 配列', incoming: inlineArray, expect: 'same-ref', supported: true },
        { id: 'F4', label: '配列[URL 文字列]', incoming: urlArray, expect: 'same-ref', supported: true },
        // M4-T4: 単独形（レイヤ1つを配列に包まず直接置く形）は viewer 正本が受容するので supported へ
        // 変わった。**受け入れ側の挙動は不変**（生値を温存する）で、変わったのは supported 判定だけ
        // である — この分離こそ sp-0006 の要求（読み込み側で保存形を書き換えない）である
        { id: 'F5', label: 'URL 文字列（単体 = 単独形）', incoming: urlString, expect: 'preserved', supported: true },
        { id: 'F6', label: 'JSON 文字列化された配列', incoming: jsonString, expect: 'preserved', supported: false },
        { id: 'F7', label: 'レイヤ名キー object', incoming: layerKeyObject, expect: 'preserved', supported: false },
        { id: 'F8', label: '上書き付きラッパー（単独形）', incoming: wrapperWhole, expect: 'preserved', supported: true },
        { id: 'F9', label: '素ラッパー（単独形。viewer が受容しない）', incoming: bareWrapper, expect: 'preserved', supported: false },
      ];

      for (const c of cases) {
        // 別オブジェクトへ受け入れる形（AppEdit の normalizeAppDocument 相当）
        const target = {};
        const returned = acceptDocumentPois(target, { pois: c.incoming });
        assert.equal(returned, target, \`\${c.id} \${c.label}: target を返す\`);
        if (c.expect === 'same-ref') {
          assert.equal(target.pois, c.incoming, \`\${c.id} \${c.label}: 配列は同一参照で素通しする\`);
        } else {
          assert.equal(target.pois, c.incoming, \`\${c.id} \${c.label}: 未対応形式は生値をそのまま温存する\`);
        }
        // 判定は readAppDocumentPois と一致していること（同じ純関数を通る証明）
        assert.equal(
          readAppDocumentPois({ pois: c.incoming }).unsupported,
          !c.supported,
          \`\${c.id} \${c.label}: supported 判定が readAppDocumentPois と一致する\`,
        );

        // target === incoming の形（MapEdit の setMapDocument 相当）でも壊れない（冪等）
        const doc = { pois: c.incoming, title: 'そのまま' };
        const self = acceptDocumentPois(doc, doc);
        assert.equal(self, doc, \`\${c.id} \${c.label}: target === incoming でも target を返す\`);
        assert.equal(self.pois, c.incoming, \`\${c.id} \${c.label}: target === incoming で値が保たれる\`);
        assert.equal(self.title, 'そのまま', \`\${c.id} \${c.label}: 他のフィールドを壊さない\`);
        // 二度通しても変わらない
        acceptDocumentPois(self, self);
        assert.equal(self.pois, c.incoming, \`\${c.id} \${c.label}: 二度通しても変わらない\`);
      }
      console.log('ok: Part A-1 acceptDocumentPois F1〜F7（配列は素通し・未対応形式は生値温存・冪等）');

      // 未設定入力はキーを生やさない（AppEdit の defaultApp() が pois: [] を持っていても削除する）
      for (const [label, incoming] of [['undefined', {}], ['null', { pois: null }]]) {
        const fromDefaultApp = { pois: [] };            // defaultApp() 相当
        acceptDocumentPois(fromDefaultApp, incoming);
        assert.equal(
          Object.prototype.hasOwnProperty.call(fromDefaultApp, 'pois'),
          false,
          \`未設定入力(\${label}): target に pois キーを生やさない\`,
        );
        const fromDefaultMap = {};                       // defaultMapData() 相当
        acceptDocumentPois(fromDefaultMap, incoming);
        assert.equal(
          Object.prototype.hasOwnProperty.call(fromDefaultMap, 'pois'),
          false,
          \`未設定入力(\${label}): キーの無い target にも生やさない\`,
        );
      }
      console.log('ok: Part A-2 未設定入力は pois キーを生やさない（App / Map 同一）');

      // 既存の空配列は維持する（実データ App 19件を壊さない — 設計 §4.4 / §5.1）
      const existingEmpty = [];
      const keepTarget = {};
      acceptDocumentPois(keepTarget, { pois: existingEmpty });
      assert.equal(keepTarget.pois, existingEmpty, '既存の空配列は配列のまま維持する（削除しない）');
      console.log('ok: Part A-3 既存の pois: [] は維持される');

      // ---- Part B: usePoisFormatGuard の反応性 ----
      // 注: ref(obj) は中身を reactive proxy 化するため、生配列そのものとの参照一致にはならない。
      // 検証すべきは「置き換え前のテンプレート式 (Array.isArray(doc.pois) ? doc.pois : []) が
      // 返していたものと同じ値を返す」ことなので、docRef.value.pois との同一性で assert する。
      const templateExpr = (doc) => (doc && Array.isArray(doc.pois) ? doc.pois : []);

      const docRef = ref({ pois: refArray });
      const guard = usePoisFormatGuard(() => docRef.value);
      assert.equal(guard.unsupported.value, false, 'B: 配列は supported');
      assert.equal(guard.pois.value, templateExpr(docRef.value), 'B: 表示用配列は旧テンプレート式と同一値');
      assert.deepEqual(guard.pois.value, refArray, 'B: 表示用配列の内容が一致する');
      assert.equal(guard.acceptsWrite(), true, 'B: supported なら書き込みを受け付ける');

      // 文書丸ごと差し替え（履歴復帰 = 関所を通らない経路の模擬）でも判定が追随する。
      // M4-T4: 未対応形式の代表を URL 文字列（単独形として supported になった）から
      // レイヤ名キー object へ差し替える。検査意図＝判定の追随は不変
      docRef.value = { pois: layerKeyObject };
      await nextTick();
      assert.equal(guard.unsupported.value, true, 'B: 未対応形式へ差し替えたら unsupported へ追随する');
      assert.deepEqual(guard.pois.value, [], 'B: 未対応形式の表示用配列は空');
      assert.equal(guard.acceptsWrite(), false, 'B: unsupported なら書き込みを拒否する');

      // M4-T4: 単独形は supported になり、表示用には1要素配列へ写像される（文書は書き換えない）
      docRef.value = { pois: urlString };
      await nextTick();
      assert.equal(guard.unsupported.value, false, 'B: 単独形 URL は supported');
      assert.deepEqual(guard.pois.value, [urlString], 'B: 単独形は表示用に1要素配列へ写像される');
      assert.equal(guard.acceptsWrite(), true, 'B: 単独形は書き込みを受け付ける');
      assert.equal(docRef.value.pois, urlString, 'B: 文書側の保存形は単独形のまま（sp-0006）');

      docRef.value = { pois: inlineArray };
      await nextTick();
      assert.equal(guard.unsupported.value, false, 'B: supported へ戻る');
      assert.equal(guard.pois.value, templateExpr(docRef.value), 'B: 表示用配列も旧テンプレート式と一致する');
      assert.deepEqual(guard.pois.value, inlineArray, 'B: 表示用配列の内容も戻る');

      // 文書が null / pois 未設定でも落ちない
      docRef.value = null;
      await nextTick();
      assert.equal(guard.unsupported.value, false, 'B: 文書 null は unsupported ではない');
      assert.deepEqual(guard.pois.value, [], 'B: 文書 null の表示用配列は空');
      console.log('ok: Part B usePoisFormatGuard が文書差し替えへ反応的に追随する');
    `,
  );

  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      emptyOutDir: true,
      outDir,
      ssr: entryFile,
      target: 'node22',
      rollupOptions: {
        external: ['vue'],
        output: { entryFileNames: 'm4-t1-smoke.mjs', format: 'es' },
      },
    },
  });

  const { stdout } = await execFileAsync(process.execPath, [bundledFile], { cwd: projectRoot });
  process.stdout.write(stdout);

  // ================= Part C: 実装同一性（AC1）と関所の実効性（AC2）=================
  const appEdit = await readFile(path.join(projectRoot, 'src/views/AppEdit.vue'), 'utf8');
  const mapEdit = await readFile(path.join(projectRoot, 'src/views/MapEdit.vue'), 'utf8');
  const appPoisFormat = await readFile(appPoisFormatPath, 'utf8');

  // C1: 受け入れ関所は appPoisFormat.ts の1本のみ（判定関数と同居）
  assert.match(
    appPoisFormat,
    /export function acceptDocumentPois</,
    'AC1: appPoisFormat.ts に受け入れ関所 acceptDocumentPois が無い',
  );
  assert.doesNotMatch(appPoisFormat, /JSON\.parse/, 'appPoisFormat.ts に JSON.parse が混入している（sp-0006）');

  // C2: 両 View が同じ関所関数を通る
  for (const [name, src] of [['AppEdit.vue', appEdit], ['MapEdit.vue', mapEdit]]) {
    assert.match(
      src,
      /import \{[^}]*acceptDocumentPois[^}]*\} from ['"]\.\.\/utils\/appPoisFormat['"]/,
      `AC1: ${name} が acceptDocumentPois を import していない`,
    );
    assert.match(src, /acceptDocumentPois\(/, `AC1: ${name} が受け入れ関所を呼んでいない`);
    assert.match(
      src,
      /import \{[^}]*usePoisFormatGuard[^}]*\} from ['"]\.\.\/composables\/usePoisFormatGuard['"]/,
      `AC1: ${name} が usePoisFormatGuard を import していない`,
    );
    assert.match(src, /usePoisFormatGuard\(/, `AC1: ${name} が判定ガードを使っていない`);
    // 温存・判定の独自実装が View 側に残っていないこと（実装同一性の核心）
    assert.doesNotMatch(
      src,
      /readAppDocumentPois\(/,
      `AC1: ${name} が判定関数を直接呼んでいる（受け入れは acceptDocumentPois、判定表示は usePoisFormatGuard へ一本化する）`,
    );
    assert.doesNotMatch(
      src,
      /poisUnsupported\.value\s*=/,
      `AC1: ${name} が poisUnsupported へ命令的に代入している（computed ガードへ移行済みのはず）`,
    );
  }

  // C3: ローカル名が両 View で揃っている（設計 §4.6）
  for (const [name, src] of [['AppEdit.vue', appEdit], ['MapEdit.vue', mapEdit]]) {
    assert.match(
      src,
      /unsupported:\s*poisUnsupported/,
      `AC1: ${name} が composable の unsupported を poisUnsupported として受けていない`,
    );
    assert.match(src, /:read-only="poisUnsupported"/, `AC1: ${name} が PoiReferenceEditor へ read-only を渡していない`);
  }

  // C4: 警告表示の機構が同一（文言キーだけ画面別 — 設計 §4.7・人間判断 2026-08-02）
  assert.match(
    appEdit,
    /v-if="poisUnsupported"[\s\S]{0,160}?appedit\.poi_format_unsupported/,
    'AC1: AppEdit.vue の未対応形式警告が無い',
  );
  assert.match(
    mapEdit,
    /v-if="poisUnsupported"[\s\S]{0,160}?mapedit\.poi_format_unsupported/,
    'AC1: MapEdit.vue の未対応形式警告（mapedit 名前空間）が無い',
  );

  // C5: 書き込みガードが両 View に同一形で入っている（設計 §4.5）
  for (const [name, src] of [['AppEdit.vue', appEdit], ['MapEdit.vue', mapEdit]]) {
    const idx = src.indexOf('function onPoisChange');
    assert.ok(idx > 0, `${name} に onPoisChange が無い`);
    const body = src.slice(idx, idx + 420);
    assert.match(body, /acceptsWrite\(\)/, `AC1: ${name} の onPoisChange に書き込みガードが無い`);
    // M4-T4: 空時のキー削除を含む保存形の決定は共通の書き込み関所 writeDocumentPois へ移した
    // （両画面で完全に同一の写像だったため — 恒久指示「同一扱い処理は共通実装へ徹底」）。
    // 「永続形は両画面同一」という検査意図は、両画面が同じ関所を通ることで従来より強く担保される。
    // 空配列でキーが消えることそのものは m4-t4 smoke Part D が表駆動で検証する
    assert.match(
      body,
      /writeDocumentPois\(/,
      `AC1: ${name} の onPoisChange が書き込み関所 writeDocumentPois を通っていない（永続形は両画面同一 — 設計 §4.4）`,
    );
  }

  // C6【AC2】: MapEdit の文書代入が setter と履歴復帰の2箇所のみ
  assert.match(mapEdit, /function setMapDocument\(/, 'AC2: MapEdit.vue に関所 setMapDocument が無い');
  const assignments = mapEdit.match(/mapData\.value\s*=[^=]/g) ?? [];
  assert.equal(
    assignments.length,
    2,
    `AC2: mapData.value への直接代入が ${assignments.length} 箇所ある（setMapDocument 内と履歴復帰の2箇所のみが許可）`,
  );
  assert.match(
    mapEdit,
    /function setMapDocument\([\s\S]{0,400}?mapData\.value\s*=\s*acceptDocumentPois\(/,
    'AC2: setMapDocument が acceptDocumentPois を通して代入していない',
  );
  assert.match(
    mapEdit,
    /mapData\.value\s*=\s*cloneDeep\(state\.mapData\)/,
    'AC2: 履歴復帰の代入（許可された例外）が見つからない',
  );
  // 収斂の実効性: 旧来の代入パターンが残っていないこと
  assert.doesNotMatch(
    mapEdit,
    /mapData\.value\s*=\s*(fresh|data|histMap)\b/,
    'AC2: setMapDocument を経由しない旧来の文書代入が残っている',
  );
  console.log('ok: Part C 実装同一性（AC1）と関所の実効性（AC2）');

  // C7: 警告文言が 11 locale すべてに存在する（AC11 の先出し検査）
  const LOCALES = ['de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'th', 'vi', 'zh', 'zh-TW'];
  for (const locale of LOCALES) {
    const dict = JSON.parse(await readFile(path.join(projectRoot, `public/locales/${locale}/translation.json`), 'utf8'));
    const value = dict?.mapedit?.poi_format_unsupported;
    assert.equal(typeof value, 'string', `AC11: ${locale} に mapedit.poi_format_unsupported が無い`);
    assert.ok(value.length > 0, `AC11: ${locale} の mapedit.poi_format_unsupported が空`);
  }
  console.log('ok: Part C-7 mapedit.poi_format_unsupported が 11 locale すべてに存在する');

  console.log('M4-T1 pois format guard smoke: PASS');
} catch (error) {
  failed = true;
  console.error(error?.stdout ?? '');
  console.error(error?.stderr ?? '');
  console.error(error);
} finally {
  await rm(workDir, { recursive: true, force: true });
}

if (failed) process.exit(1);
