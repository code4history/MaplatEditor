// M19-T1: 地図の名称属性を「表示ラベル(label) / タイトル(title)」へ統一し既存データを移行する。
// タスク設計 `docs/superpowers/specs/2026-08-09-m19-t1-map-name-unification-design.md` v1.2 §8。
//
// 検証する受け入れ条件:
//   AC-5   移行が二重適用されない（非冪等な写像を schema_migrations marker が保護している）
//   AC-6   移行が maps の全行を UPDATE し、FTS 索引が新列構成で張り直される
//   AC-7   neDB 0.7.0 取込経路でも移行される（正確名を持たない地図・共有 fixture のまま）
//   AC-7B  【最重要】非空の廃止属性を持つ neDB 入力が、取込 → 移行の end-to-end で正確名を保つ
//          （①単言語 ②多言語非対称）。設計レビュー v1 が Critical と判定した欠陥の回帰検査。
//          v1.1 型の欠陥（normalizeMapDocument への無条件 delete）を再導入すると①が必ず落ちる
//   AC-7C  移行完了後の DB へ 0.7.0 形の地図単体 ZIP を取り込むと取込境界の受容が働く（冪等）
//   AC-8   地図編集画面が「タイトル」「表示ラベル」の 2 欄になり正式名欄が無い
//   AC-9   15 文字制限が撤廃され、長い値が保存・書き出しできる
//   AC-10  書き出した map.json に廃止属性が出ず label が出る
//   AC-11  viewer の地図切替チップが表示ラベルの実値になる（外形変化）
//   AC-14  表示タイトルが新 title（正確名）になる（地図一覧 / 編集画面ヘッダ / viewer の 3 面）
//   AC-15  移行後に title が空の地図が 0 件（母数 > 0 も同時に出力し空振り緑を防ぐ）
//   AC-16  label は任意であり、空でも保存・表示・書き出しが壊れない
//
// ハーネスは tests/e2e/m13-t5-migration-pipeline-e2e.spec.ts を踏襲する
// （mkdtemp + MAPLAT_E2E_ROOT + --user-data-dir + <saveFolder>/nedb.db 配置 +
//   window.maplist.request の resolve を migrate() 完了の同期点にする）。
//
// ★共有 fixture（tests/fixtures/m13-t5-migration-pipeline/legacy-nedb-lines.ndjson）は
//   0.7.0 実データ由来であり **改変しない**。AC-7B は fixture の 2 行を読み取って
//   廃止属性を注入した ndjson をテスト実行時に一時 saveFolder へ書き出す。
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Frame,
  type Page,
} from '@playwright/test';
import { mkdir, mkdtemp, cp, readFile, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const fixturesRoot = path.join(projectRoot, 'tests/fixtures/m13-t5-migration-pipeline');

const MIGRATION_ID = '2026-08-09-m19-t1-map-name-unification';
// 廃止属性の名前をテスト側でも 1 箇所に閉じ込める
const DEPRECATED = 'officialTitle';

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${path.join(e2eRoot, 'user-data')}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  return { app, page };
}

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((nextHash: string) => { location.hash = nextHash; }, hash);
  await page.waitForLoadState('domcontentloaded');
}

/**
 * 起動時の migration 系モーダル（ProgressModal と レガシー移行レポート）を閉じる。
 * 開いたままだと `.modal.d-block` が pointer events を奪い、以降のクリックが全部落ちる。
 * ProgressModal の OK は `.modal-body` 内・レポートの OK は `.modal-footer` 内にあるため
 * 位置で絞らず、`.modal.d-block` 内の有効な OK ボタンを順に押す。
 */
async function dismissStartupModals(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const modal = page.locator('.modal.d-block');
    if (await modal.count() === 0) return;
    const ok = modal.locator('button', { hasText: 'OK' }).first();
    if (await ok.count() === 0) break;
    await ok.click({ timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  await expect(page.locator('.modal.d-block')).toHaveCount(0, { timeout: 20000 });
}

/** migrate() の全段階完了の同期点（window.maplist.request の resolve は getDb() を要求する） */
async function waitMigrated(page: Page): Promise<any[]> {
  const result: any = await page.evaluate(() => (window as any).maplist.request('', 1, 100));
  return result.docs as any[];
}

/** 共有 fixture の各行を読み、コールバックで書き換えた ndjson を返す（fixture 自体は改変しない） */
async function fixtureRows(): Promise<any[]> {
  const raw = await readFile(path.join(fixturesRoot, 'legacy-nedb-lines.ndjson'), 'utf8');
  return raw.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
}

/** レガシー入力一式（nedb.db + originals + tiles）を saveFolder へ配置する */
async function placeLegacyInputs(saveFolder: string, ndjsonLines: string): Promise<void> {
  await mkdir(saveFolder, { recursive: true });
  // legacy migration 未実行を再現するため、ライブファイル名は "nedb.db"
  await writeFile(path.join(saveFolder, 'nedb.db'), ndjsonLines);
  await mkdir(path.join(saveFolder, 'originals'), { recursive: true });
  for (const id of ['takabatake_kozu1', 'takabatake_kozu2']) {
    await cp(
      path.join(fixturesRoot, `originals/${id}.jpg`),
      path.join(saveFolder, `originals/${id}.jpg`),
    );
    await mkdir(path.join(saveFolder, `tiles/${id}/2/0`), { recursive: true });
    await cp(
      path.join(fixturesRoot, `tiles/${id}/2/0/0.jpg`),
      path.join(saveFolder, `tiles/${id}/2/0/0.jpg`),
    );
  }
}

function openDb(saveFolder: string): DatabaseSync {
  return new DatabaseSync(path.join(saveFolder, 'maplat.sqlite'));
}

/** slug -> data_json（名称 3 属性の検証に使う） */
function readMapDocs(db: DatabaseSync): Record<string, any> {
  const rows = db.prepare('SELECT slug, data_json FROM maps').all() as any[];
  return Object.fromEntries(rows.map((r) => [String(r.slug), JSON.parse(String(r.data_json))]));
}

/** 名称 3 属性だけを取り出す（AC-7C の「2 回取込で結果同一」の比較単位。設計レビュー v2 MNR-B） */
function nameTriple(doc: any): Record<string, unknown> {
  return { title: doc.title, label: doc.label, hasDeprecated: DEPRECATED in doc };
}

test.describe('M19-T1: 地図の名称属性統一と既存データ移行', () => {
  // =========================================================================
  // Test 1: 共有 fixture のままの neDB 取込 → 移行（AC-7 / AC-5 / AC-6 / AC-15）
  // =========================================================================
  test('AC-7/AC-5/AC-6/AC-15: 共有 fixture の neDB 取込が移行され、再起動で二重適用されない', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19-t1-legacy-'));
    const saveFolder = path.join(e2eRoot, 'save-folder');

    const rows = await fixtureRows();
    // 共有 fixture のまま（2 行とも廃止属性は空文字）
    await placeLegacyInputs(saveFolder, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

    let firstSnapshot: Record<string, any> = {};
    // --- 1 回目の起動: レガシー取込 → 名称統一 migration ---
    const first = await launch(e2eRoot);
    try {
      const docs = await waitMigrated(first.page);
      expect(docs.length, '共有 fixture の 2 行が取り込まれているはず').toBeGreaterThanOrEqual(2);
    } finally {
      await quitElectronApplication(first.app);
    }

    // --- AC-7: 廃止属性が消え、label = 旧 title / title = 旧 title（fixture の正確名は空） ---
    {
      const db = openDb(saveFolder);
      try {
        const docs = readMapDocs(db);
        for (const row of rows) {
          const doc = docs[String(row._id)];
          expect(doc, `${row._id} が取り込まれているはず`).toBeTruthy();
          expect(DEPRECATED in doc, 'AC-7: 廃止属性はキーごと消えるはず').toBe(false);
          expect(doc.title, 'AC-7: 正確名が空なので title は旧 title のはず').toEqual({ ja: row.title });
          expect(doc.label, 'AC-7: label は旧 title のはず').toEqual({ ja: row.title });
        }

        // --- AC-15: 移行後に title が空の地図が 0 件（母数 > 0 も出力する） ---
        const all = Object.values(docs);
        const emptyTitles = all.filter((d: any) => {
          const t = d.title;
          if (!t) return true;
          if (typeof t === 'string') return t.trim() === '';
          return Object.values(t).filter((v) => typeof v === 'string' && v.trim() !== '').length === 0;
        });
        // eslint-disable-next-line no-console
        console.log(`AC-15: 母数 ${all.length} 件 / title 空 ${emptyTitles.length} 件`);
        expect(all.length, 'AC-15: 母数が 0 の空振り緑を防ぐ').toBeGreaterThan(0);
        expect(emptyTitles.length, 'AC-15: 移行後に title が空の地図は 0 件のはず').toBe(0);

        // --- AC-5: marker がちょうど 1 行 ---
        const markers = db
          .prepare('SELECT id FROM schema_migrations WHERE id = ?')
          .all(MIGRATION_ID) as any[];
        expect(markers.length, 'AC-5: 名称統一 marker がちょうど 1 行のはず').toBe(1);

        firstSnapshot = docs;
      } finally {
        db.close();
      }
    }

    // --- AC-5: 2 回目の起動で data_json が完全一致（非冪等な写像を marker が保護している） ---
    const second = await launch(e2eRoot);
    try {
      await waitMigrated(second.page);
    } finally {
      await quitElectronApplication(second.app);
    }
    {
      const db = openDb(saveFolder);
      try {
        const docs = readMapDocs(db);
        for (const slug of Object.keys(firstSnapshot)) {
          expect(docs[slug], `AC-5: ${slug} の data_json が 2 回目起動後も完全一致するはず`)
            .toEqual(firstSnapshot[slug]);
        }
        const markers = db
          .prepare('SELECT id FROM schema_migrations WHERE id = ?')
          .all(MIGRATION_ID) as any[];
        expect(markers.length, 'AC-5: marker は 1 行のままのはず').toBe(1);
      } finally {
        db.close();
      }
    }

    // --- AC-6: FTS 索引が新列構成で張り直され、検索語の集合が保存される ---
    const third = await launch(e2eRoot);
    try {
      await waitMigrated(third.page);
      // 旧 title（= 移行後は label）にのみ存在した語で検索してヒットすること。
      // 旧索引は title/廃止属性/description、新索引は title/label/description であり、
      // 全行 UPDATE によって maps_search_au トリガが新列構成で張り直す
      const hits: any = await third.page.evaluate(
        (term: string) => (window as any).maplist.request(term, 1, 50),
        '高畑公図テスト1',
      );
      const ids = (hits.docs as any[]).map((d) => d.mapID);
      expect(ids, 'AC-6: 旧 title 由来の語（新 label 側）で検索できるはず')
        .toContain('takabatake_kozu1');
    } finally {
      await quitElectronApplication(third.app);
    }
  });

  // =========================================================================
  // Test 2【最重要】: 非空の廃止属性を持つ neDB 入力の end-to-end（AC-7B / AC-14 / AC-11）
  // =========================================================================
  test('AC-7B/AC-14/AC-11: 非空の正確名を持つ neDB 入力が取込→移行で正確名を保ち、3 面に出る', async () => {
    test.setTimeout(420_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19-t1-exactname-'));
    const saveFolder = path.join(e2eRoot, 'save-folder');

    const rows = await fixtureRows();
    expect(rows.length, '共有 fixture は 2 行のはず').toBe(2);

    // ケース①: 単言語。0.7.0 の単言語データは **プレーン文字列** である
    //   （MAP_LANG_ATTRS から廃止属性を外したため normalizeMapLangFields は正規化しない。
    //    写像側が normalizeLangResource を通していないと落ちる）
    const case1 = { ...rows[0], title: '高畑公図テスト1', [DEPRECATED]: '高畑村公図 第一号' };
    // ケース②: 多言語非対称。文書単位の写像だと英語のタイトルが消える
    const case2 = {
      ...rows[1],
      lang: 'ja',
      title: { ja: '表示A', en: 'DisplayA' },
      [DEPRECATED]: { ja: '正確A' },
    };
    await placeLegacyInputs(saveFolder, [case1, case2].map((r) => JSON.stringify(r)).join('\n') + '\n');

    const { app, page } = await launch(e2eRoot);
    try {
      const docs = await waitMigrated(page);
      const byMapID: Record<string, string> = Object.fromEntries(
        docs.map((d: any) => [d.mapID, d.uid]),
      );
      const uid1 = byMapID[String(case1._id)];
      const uid2 = byMapID[String(case2._id)];
      expect(uid1, 'ケース① が取り込まれているはず').toBeTruthy();
      expect(uid2, 'ケース② が取り込まれているはず').toBeTruthy();

      await dismissStartupModals(page);

      // --- AC-14 (2): 地図一覧カード名が新 title（正確名）になる ---
      await openHash(page, '#/maplist');
      await expect(page.getByText('高畑村公図 第一号')).toBeVisible({ timeout: 30000 });
      await expect(page.getByText('正確A').first()).toBeVisible({ timeout: 30000 });

      // --- AC-14 (1): 地図編集左上ヘッダが新 title（正確名）になる ---
      await openHash(page, `#/mapedit?uid=${uid1}`);
      await expect(page.getByTestId('map-title')).toHaveValue('高畑村公図 第一号', { timeout: 30000 });
      await expect(page.locator('.editor-action-header__identity strong').first())
        .toContainText('高畑村公図 第一号', { timeout: 30000 });
      // 表示ラベル欄には旧表示用名称が入っている
      await expect(page.getByTestId('map-label')).toHaveValue('高畑公図テスト1');

      // --- AC-14 (3): viewer の地図タイトル表示（.map-title span）が新 title（正確名）になる ---
      //   種づけした地図は移行を経ないため対象にしない。移行を経た地図でプレビューを開く。
      //   maplat 地図のソース参照は uid 正準の {sourceType:'maplat', mapUid}（ADR-0007）
      await page.evaluate(async (mapUid: string) => {
        const s = `m19-t1-app-${Date.now()}`;
        const saved = await (window as any).appedit.save({
          slug: s,
          document: {
            appID: s,
            appName: { ja: 'M19-T1 名称統一 App' },
            title: { ja: 'M19-T1 名称統一 App' },
            description: {}, keywords: '', siteUrl: '', lang: 'ja',
            sources: [{ sourceType: 'maplat', mapUid }],
            appSettings: { homeLng: 135.0, homeLat: 35.0, defaultZoom: 14 },
            pois: [], httpSettings: {}, manifestSettings: {},
          },
        });
        if (!saved || saved.result !== 'Success') throw new Error(`app: ${JSON.stringify(saved)}`);
        return s;
      }, uid1);

      await openHash(page, '#/applist');
      await expect(page.locator('[data-resource-uid]').first()).toBeVisible({ timeout: 30000 });
      await page.locator('[data-resource-uid] a').first().click();
      await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30000 });
      await page.locator('[role="tab"]').filter({ hasText: /プレビュー/ }).click();
      const frame: Frame = await previewFrame(page);
      await frame.waitForFunction(() => !!(window as any).__maplatPreview, undefined, { timeout: 120000 });
      // Maplat/src/ui_init.ts:169 が `officialTitle || title || label` を .map-title span へ入れる。
      // 移行後は廃止属性が不在なので title（= 正確名）へ落ちる
      const viewerTitle = await frame
        .locator('.map-title span')
        .first()
        .innerText({ timeout: 120000 });
      expect(viewerTitle.trim(), 'AC-14 (3): viewer の地図タイトルは正確名のはず')
        .toBe('高畑村公図 第一号');
      // eslint-disable-next-line no-console
      console.log(`AC-14(3): viewer .map-title span = ${JSON.stringify(viewerTitle)}`);
    } finally {
      await quitElectronApplication(app);
    }

    // --- AC-7B: DB を直接開いて名称 3 属性を検証する（本テストの核心） ---
    const db = openDb(saveFolder);
    try {
      const docs = readMapDocs(db);

      // ①単言語: title = 正確名 / label = 旧表示用名 / 廃止属性キー不在
      const d1 = docs[String(case1._id)];
      expect(d1, 'ケース① の行があるはず').toBeTruthy();
      expect(d1.title, 'AC-7B①: title は正確名のはず（v1.1 型の欠陥だとここが旧表示用名になる）')
        .toEqual({ ja: '高畑村公図 第一号' });
      expect(d1.label, 'AC-7B①: label は旧表示用名のはず').toEqual({ ja: '高畑公図テスト1' });
      expect(DEPRECATED in d1, 'AC-7B①: 廃止属性のキーは消えるはず').toBe(false);

      // ②多言語非対称: 英語のタイトルが消えない（言語キー単位の写像）
      const d2 = docs[String(case2._id)];
      expect(d2, 'ケース② の行があるはず').toBeTruthy();
      expect(d2.title, 'AC-7B②: 英語のタイトルが消えないはず（文書単位の写像だと消える）')
        .toEqual({ ja: '正確A', en: 'DisplayA' });
      expect(d2.label, 'AC-7B②: label は旧 title の全言語のはず')
        .toEqual({ ja: '表示A', en: 'DisplayA' });
      expect(DEPRECATED in d2, 'AC-7B②: 廃止属性のキーは消えるはず').toBe(false);

      const markers = db
        .prepare('SELECT id FROM schema_migrations WHERE id = ?')
        .all(MIGRATION_ID) as any[];
      expect(markers.length, 'AC-7B: 名称統一 marker が 1 行のはず').toBe(1);
    } finally {
      db.close();
    }
  });

  // =========================================================================
  // Test 3: UI と交換形（AC-8 / AC-9 / AC-10 / AC-16 / AC-7C）
  // =========================================================================
  test('AC-8/AC-9/AC-10/AC-16/AC-7C: 2 欄化・制限撤廃・書き出し・0.7.0 形の取込境界受容', async () => {
    test.setTimeout(420_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-m19-t1-ui-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await app.evaluate(async ({ dialog }) => {
        dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
      });
      const saveFolder: string = await page.evaluate(() => (window as any).settings.get('saveFolder'));

      // 全角 40 文字のタイトル（旧制限は全角 15 文字＝半角 30）
      const LONG_TITLE = 'あ'.repeat(40);
      expect(LONG_TITLE.length).toBe(40);

      const mapSlug = `m19t1-ui-${Date.now()}`;
      const mapUid: string = await page.evaluate(async ({ slug, longTitle }: any) => {
        const r = await (window as any).mapedit.save({
          slug,
          mapObject: {
            mapID: slug,
            title: { ja: longTitle },
            // AC-16: 表示ラベルを空のままにする（任意項目）
            label: {},
            attr: { ja: 'attr' }, dataAttr: {}, description: {},
            author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
            license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
            imageExtension: 'jpg', width: 400, height: 300,
            gcps: [
              [[0, 0], [135.0, 35.1]],
              [[400, 0], [135.1, 35.1]],
              [[200, 300], [135.05, 35.0]],
            ],
            edges: [], sub_maps: [], strictMode: 'loose', vertexMode: 'plain', status: 'New',
          },
          tins: [],
        });
        if (!r || r.result !== 'Success') throw new Error(`map: ${JSON.stringify(r)}`);
        return r.uid as string;
      }, { slug: mapSlug, longTitle: LONG_TITLE });

      // 搬出の同梱対象（サムネイル・タイル）を実体で置く
      const bytes = Buffer.from(PNG_B64, 'base64');
      await mkdir(path.join(saveFolder, 'tmbs'), { recursive: true });
      await writeFile(path.join(saveFolder, 'tmbs', `${mapUid}.jpg`), bytes);
      await writeFile(path.join(saveFolder, 'tmbs', `${mapUid}_512.jpg`), bytes);
      await mkdir(path.join(saveFolder, 'tiles', mapUid, '0', '0'), { recursive: true });
      await writeFile(path.join(saveFolder, 'tiles', mapUid, '0', '0', '0.jpg'), bytes);

      await openHash(page, `#/mapedit?uid=${mapUid}`);
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 30000 });

      // --- AC-8: 「タイトル」「表示ラベル」の 2 欄になり、正式名欄が無い ---
      await expect(page.getByTestId('map-title')).toBeVisible();
      await expect(page.getByTestId('map-label')).toBeVisible();
      const metadataText = await page.locator('form.container-fluid').first().innerText();
      expect(metadataText, 'AC-8: 「タイトル」欄が在るはず').toContain('タイトル');
      expect(metadataText, 'AC-8: 「表示ラベル」欄が在るはず').toContain('表示ラベル');
      expect(metadataText, 'AC-8: 旧「地図名称」語彙は残らないはず').not.toContain('地図名称');
      expect(metadataText, 'AC-8: 正式名欄は無いはず').not.toContain('正式名');

      // --- AC-9: 15 文字制限が撤廃され、全角 40 文字が検証エラーにならない ---
      await expect(page.getByTestId('map-title')).toHaveValue(LONG_TITLE);
      await expect(page.getByTestId('map-title')).not.toHaveClass(/is-invalid/);
      const overTitleWarn = page.locator('.invalid-feedback, [data-diagnostic]', { hasText: '15文字' });
      await expect(overTitleWarn).toHaveCount(0);

      // --- AC-16: 表示ラベルが空でも保存・表示が壊れない ---
      await expect(page.getByTestId('map-label')).toHaveValue('');
      await openHash(page, '#/maplist');
      await expect(page.getByText(LONG_TITLE).first()).toBeVisible({ timeout: 30000 });

      // --- AC-10: 書き出した map.json に廃止属性が出ず、label が出る ---
      const zipPath = path.join(e2eRoot, 'map-export.zip');
      await app.evaluate(async ({ dialog }, zip) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: zip })) as typeof dialog.showSaveDialog;
      }, zipPath);
      await openHash(page, `#/mapedit?uid=${mapUid}`);
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 30000 });
      await page.locator('[data-editor-action="export"]').click();
      await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 180000 });
      await dismissStartupModals(page);

      const { default: AdmZip } = await import('adm-zip');
      const exported = new AdmZip(zipPath);
      const mapEntry = exported.getEntries().find((e) => /^maps\/.*\.json$/.test(e.entryName));
      expect(mapEntry, 'AC-10: ZIP に maps/*.json が在るはず').toBeTruthy();
      const exportedDoc = JSON.parse(mapEntry!.getData().toString('utf8'));
      expect(DEPRECATED in exportedDoc, 'AC-10: 書き出しに廃止属性は出ないはず').toBe(false);
      // AC-16: 空の label は交換形で畳み込まれて出ない（ADR-0005 / compactMapLangFields）
      expect(exportedDoc.label, 'AC-16: 空の label は交換形に出ないはず').toBeUndefined();

      // --- AC-10（アプリ一式搬出の経路）＋ AC-11 ---
      //   AppExportService は DB 文書をそのまま畳んで maps/{slug}.json を書く。
      //   これが公開ビューアが実際に読む交換形であり、MaplatCore/src/source_ex.ts:195-196 の
      //   `options.label = options.label || resp.year` の resp そのものである。
      //   ∴ ここで label が実値であることが「切替チップが年から表示ラベル実値へ変わる」の
      //   直接の根拠になる（AC-11）。
      //   ★エディタ内プレビュー（AppPreviewService）は別経路で、maps/*.json の label を
      //     `source.label || preview.title` で上書きする（AppPreviewService.ts の maplat 分岐）。
      //     これはアプリ側上書き宣言の既存挙動であり t1 の射程外のため触らない。
      //     AC-11 は公開搬出経路で検証する（設計の検証手段からの意図的な差異。task-state に記録）。
      {
        const labeledSlug = `m19t1-labeled-${Date.now()}`;
        const labeledUid: string = await page.evaluate(async (slug: string) => {
          const r = await (window as any).mapedit.save({
            slug,
            mapObject: {
              mapID: slug,
              title: { ja: '正確名つき地図' },
              label: { ja: '短いラベル' },
              attr: { ja: 'attr' }, dataAttr: {}, description: {},
              author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
              license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
              imageExtension: 'jpg', width: 400, height: 300,
              gcps: [
                [[0, 0], [135.0, 35.1]],
                [[400, 0], [135.1, 35.1]],
                [[200, 300], [135.05, 35.0]],
              ],
              edges: [], sub_maps: [], strictMode: 'loose', vertexMode: 'plain', status: 'New',
            },
            tins: [],
          });
          if (!r || r.result !== 'Success') throw new Error(`map: ${JSON.stringify(r)}`);
          return r.uid as string;
        }, labeledSlug);
        await mkdir(path.join(saveFolder, 'tiles', labeledUid, '0', '0'), { recursive: true });
        await writeFile(path.join(saveFolder, 'tiles', labeledUid, '0', '0', '0.jpg'), bytes);
        await writeFile(path.join(saveFolder, 'tmbs', `${labeledUid}.jpg`), bytes);

        // アプリ一式搬出は ZIP を書く（AppExportService は showSaveDialog で保存先を取る）
        const appZip = path.join(e2eRoot, 'app-export.zip');
        await app.evaluate(async ({ dialog }, zip) => {
          dialog.showSaveDialog = (async () => ({ canceled: false, filePath: zip })) as typeof dialog.showSaveDialog;
        }, appZip);

        const exportResult: any = await page.evaluate(async ({ mapUid }: any) => {
          const slug = `m19t1-exportapp-${Date.now()}`;
          const saved = await (window as any).appedit.save({
            slug,
            document: {
              appID: slug,
              appName: { ja: 'M19-T1 搬出 App' }, title: { ja: 'M19-T1 搬出 App' },
              description: {}, keywords: '', siteUrl: '', lang: 'ja',
              sources: [{ sourceType: 'maplat', mapUid }],
              appSettings: { homeLng: 135.0, homeLat: 35.0, defaultZoom: 14 },
              pois: [], httpSettings: {}, manifestSettings: {},
            },
          });
          if (!saved || saved.result !== 'Success') throw new Error(`app: ${JSON.stringify(saved)}`);
          const loaded = await (window as any).appedit.request(saved.uid);
          return await (window as any).appedit.export(loaded.document ?? loaded);
        }, { mapUid: labeledUid });
        expect(exportResult?.result, `AC-10/AC-11: アプリ一式搬出が成功するはず: ${JSON.stringify(exportResult)}`)
          .toBe('Success');
        await dismissStartupModals(page);

        const appExported = new AdmZip(appZip);
        const appMapEntry = appExported.getEntry(`maps/${labeledSlug}.json`);
        expect(appMapEntry, `AC-10: アプリ一式搬出に maps/${labeledSlug}.json が在るはず`).toBeTruthy();
        const appMapJson = JSON.parse(appMapEntry!.getData().toString('utf8'));
        expect(DEPRECATED in appMapJson, 'AC-10: アプリ一式搬出の map.json にも廃止属性は出ないはず').toBe(false);
        expect(appMapJson.label, 'AC-11: 交換形の label が表示ラベルの実値になるはず（year フォールバックに落ちない）')
          .toBe('短いラベル');
        expect(appMapJson.title, 'AC-14: 交換形の title はタイトル（正確名）のはず').toBe('正確名つき地図');
        // eslint-disable-next-line no-console
        console.log(`AC-10/AC-11: app export map.json label=${JSON.stringify(appMapJson.label)} title=${JSON.stringify(appMapJson.title)}`);
      }

      // --- AC-7C: 移行 marker が既に立った DB へ 0.7.0 形の ZIP を取り込む ---
      //   （= migration ではなく取込境界の受容 adoptDeprecatedMapNames が働くことの検証）
      const db0 = openDb(saveFolder);
      try {
        const markers = db0.prepare('SELECT id FROM schema_migrations WHERE id = ?').all(MIGRATION_ID) as any[];
        expect(markers.length, 'AC-7C: 前提として名称統一 marker が既に立っているはず').toBe(1);
      } finally {
        db0.close();
      }

      // 0.7.0 形（title = 表示用名 / 廃止属性 = 正確名 / label なし）へ差し替えた ZIP を作る
      const legacyZip = path.join(e2eRoot, 'legacy-070.zip');
      {
        const input = new AdmZip(zipPath);
        const output = new AdmZip();
        const fromSlug = mapEntry!.entryName.replace(/^maps\//, '').replace(/\.json$/, '');
        const toSlug = `${fromSlug}-legacy070`;
        for (const entry of input.getEntries()) {
          if (entry.isDirectory) continue;
          const name = entry.entryName;
          if (name === `maps/${fromSlug}.json`) {
            const json = JSON.parse(entry.getData().toString('utf8'));
            json.mapID = toSlug;
            json.title = '0.7.0 表示用名';
            json[DEPRECATED] = '0.7.0 正確名';
            delete json.label;
            output.addFile(`maps/${toSlug}.json`, Buffer.from(JSON.stringify(json)));
            continue;
          }
          let renamed = name;
          if (name.startsWith(`tmbs/${fromSlug}`)) renamed = `tmbs/${toSlug}${name.slice(`tmbs/${fromSlug}`.length)}`;
          else if (name.startsWith(`tiles/${fromSlug}/`)) renamed = `tiles/${toSlug}/${name.slice(`tiles/${fromSlug}/`.length)}`;
          output.addFile(renamed, entry.getData());
        }
        output.writeZip(legacyZip);
      }

      const importOnce = async () => {
        await app.evaluate(async ({ dialog }, zip) => {
          dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [zip] })) as typeof dialog.showOpenDialog;
        }, legacyZip);
        await openHash(page, '#/maplist');
        // 直前の搬出/取込が残した ProgressModal を閉じる（開いたままだとクリックが奪われる）
        await dismissStartupModals(page);
        const importButton = page.locator('[data-resource-import]');
        await expect(importButton).toBeVisible({ timeout: 30000 });
        await importButton.click();
        await expect(page.getByText('正常に地図データが登録できました。')).toBeVisible({ timeout: 180000 });
        await dismissStartupModals(page);
      };

      await importOnce();
      const afterFirst = (() => {
        const db = openDb(saveFolder);
        try {
          return readMapDocs(db);
        } finally {
          db.close();
        }
      })();
      const imported1Slug = Object.keys(afterFirst).find((s) => s.includes('legacy070'));
      expect(imported1Slug, 'AC-7C: 0.7.0 形 ZIP が取り込まれているはず').toBeTruthy();
      const imported1 = afterFirst[imported1Slug!];
      expect(imported1.title, 'AC-7C: 取込境界の受容で title は正確名になるはず')
        .toEqual({ ja: '0.7.0 正確名' });
      expect(imported1.label, 'AC-7C: label は旧 title のはず').toEqual({ ja: '0.7.0 表示用名' });
      expect(DEPRECATED in imported1, 'AC-7C: 廃止属性のキーは DB へ再流入しないはず').toBe(false);
      // eslint-disable-next-line no-console
      console.log(`AC-7C(1回目): slug=${imported1Slug} ${JSON.stringify(nameTriple(imported1))}`);

      // 2 回目の取込: slug 自動解決で **行は増える**（ADR-0007 / m5-t5）ため「DB 不変」では
      // 成立しない。期待値は「各取込が生んだ地図文書の名称 3 属性が同一」である
      // （設計レビュー v2 MNR-B）
      await importOnce();
      const afterSecond = (() => {
        const db = openDb(saveFolder);
        try {
          return readMapDocs(db);
        } finally {
          db.close();
        }
      })();
      const imported2Slug = Object.keys(afterSecond).find(
        (s) => s.includes('legacy070') && s !== imported1Slug,
      );
      expect(imported2Slug, 'AC-7C: 2 回目の取込は別 slug の行を新設するはず').toBeTruthy();
      // eslint-disable-next-line no-console
      console.log(`AC-7C(2回目): slug=${imported2Slug} ${JSON.stringify(nameTriple(afterSecond[imported2Slug!]))}`);
      expect(nameTriple(afterSecond[imported2Slug!]), 'AC-7C: 2 回の取込で名称 3 属性が同一のはず')
        .toEqual(nameTriple(imported1));
    } finally {
      await quitElectronApplication(app);
    }
  });
});

async function previewFrame(page: Page): Promise<Frame> {
  await expect(page.locator('iframe.preview-map')).toBeVisible({ timeout: 60000 });
  const handle = await page.locator('iframe.preview-map').elementHandle();
  const frame = await handle!.contentFrame();
  if (!frame) throw new Error('preview iframe の contentFrame を取得できません');
  return frame;
}
