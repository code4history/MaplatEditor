// M5-T4B: 実 UI からの地図搬出／アプリ搬出と、地図 ZIP の別 slug import（AC11）。
//
// 固定する受け入れ条件:
//   AC11  **実際の UI から**地図搬出・アプリ搬出を行い、地図 ZIP は別 slug への import と
//         preview まで、アプリ ZIP は viewer での読込までを確認する
//
// smoke（サンドボックス）は electron スタブ上でサービスを直接叩くため、
// 「ボタンが押せる状態か」「ダイアログを経て実ファイルが出るか」「進捗オーバーレイが閉じるか」を
// 通らない。∴ ここは実 Electron・実 UI 経路でのみ確認できる範囲に絞る。
//
// 人間確認: MAPLAT_E2E_PAUSE=1 で最後の test がセットアップ済みの状態で一時停止する。
//   MAPLAT_E2E_PAUSE=1 PWDEBUG=1 pnpm test:e2e:m5-t4b
// harness は m12-t15-thumbnail-512 / m11-t3-editor-shell の実績文法に従う。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => window.settings.set('lang', 'ja'));
  return { app, page };
}

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await page.waitForLoadState('domcontentloaded');
}

async function saveFolderOf(page: Page): Promise<string> {
  return page.evaluate(() => window.settings.get('saveFolder'));
}

// 保存/インポート完了ダイアログを自動 OK する（ネイティブダイアログ待ちで止まらないように）
async function stubMessageBoxAutoOk(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
}

/**
 * 依存アセットを全種類持つ地図を作る。
 *  - POI 登録参照（管理下 POI ソース）
 *  - icon（asset UUID 参照文法）
 *  - properties.html 内の maplat-asset:
 *  - 通常/512px サムネイル・タイル実体
 */
async function seedFullMap(page: Page, saveFolder: string, workDir: string): Promise<{
  mapUid: string; mapSlug: string; poiUid: string; iconSlug: string; photoSlug: string;
}> {
  // imageAssets.add は **実ファイルパス** を受ける（renderer から bytes は渡せない）
  const srcPng = path.join(workDir, 'seed-source.png');
  await writeFile(srcPng, Buffer.from(PNG_B64, 'base64'));

  const seeded = await page.evaluate(async (sourcePath) => {
    const stamp = Date.now();
    const iconSlug = `t4b-icon-${stamp}`;
    const photoSlug = `t4b-photo-${stamp}`;

    // 画像 asset 2件（icon 用・html 埋め込み用）
    const mkAsset = async (slug: string) => {
      const r = await window.imageAssets.add({
        slug, title: { ja: slug }, lang: 'ja', sourceName: `${slug}.png`, sourcePath,
      });
      if (!r || r.result !== 'Success') throw new Error(`asset ${slug}: ${JSON.stringify(r)}`);
      return r.uid as string;
    };
    const iconUid = await mkAsset(iconSlug);
    const photoUid = await mkAsset(photoSlug);

    // 管理下 POI ソース（icon 参照 + html の maplat-asset: を持つ）
    const poiSlug = `t4b-poi-${stamp}`;
    const created = await window.poiSources.createLocal({
      slug: poiSlug, title: { ja: 'T4B POI' }, lang: 'ja',
    });
    if (!created || created.result !== 'Success') throw new Error(`poi: ${JSON.stringify(created)}`);
    await window.poiSources.save(created.uid, {
      slug: poiSlug, title: { ja: 'T4B POI' },
      fc: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature', id: 'spot',
          geometry: { type: 'Point', coordinates: [135.05, 35.05] },
          properties: {
            name: { ja: 'T4B スポット' },
            icon: iconUid,
            html: { ja: `<img src="maplat-asset:${photoUid}">` },
          },
        }],
      },
    });

    // 地図（POI 登録参照つき）
    const mapSlug = `t4b-map-${stamp}`;
    const mapR = await window.mapedit.save({
      slug: mapSlug,
      mapObject: {
        mapID: mapSlug, title: { ja: 'T4B 地図' },
        officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
        attr: { ja: 'attr' }, dataAttr: {}, description: {},
        license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
        imageExtension: 'jpg', width: 400, height: 300,
        gcps: [
          [[0, 0], [135.0, 35.1]],
          [[400, 0], [135.1, 35.1]],
          [[200, 300], [135.05, 35.0]],
        ],
        edges: [], sub_maps: [], strictMode: 'loose', vertexMode: 'plain', status: 'New',
        pois: [{ poiUid: created.uid, cachedTitle: 'T4B POI' }],
      },
      tins: [],
    });
    if (!mapR || mapR.result !== 'Success') throw new Error(`map: ${JSON.stringify(mapR)}`);
    return { mapUid: mapR.uid as string, mapSlug, poiUid: created.uid as string, iconSlug, photoSlug };
  }, srcPng);

  // サムネイル・タイルの実体を配置する（搬出の同梱対象）
  const bytes = Buffer.from(PNG_B64, 'base64');
  const tmbs = path.join(saveFolder, 'tmbs');
  await mkdir(tmbs, { recursive: true });
  await writeFile(path.join(tmbs, `${seeded.mapUid}.jpg`), bytes);
  await writeFile(path.join(tmbs, `${seeded.mapUid}_512.jpg`), bytes);
  const tileDir = path.join(saveFolder, 'tiles', seeded.mapUid, '0', '0');
  await mkdir(tileDir, { recursive: true });
  await writeFile(path.join(tileDir, '0.jpg'), bytes);

  return seeded;
}

// 地図 ZIP の slug を書き換えて別 slug の ZIP を作る（元の地図を残したまま複製を取り込む形）
async function rewriteZipSlug(src: string, dest: string, from: string, to: string): Promise<void> {
  const { default: AdmZip } = await import('adm-zip');
  const input = new AdmZip(src);
  const output = new AdmZip();
  for (const entry of input.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;
    if (name === `maps/${from}.json`) {
      const json = JSON.parse(entry.getData().toString('utf8'));
      json.mapID = to;
      output.addFile(`maps/${to}.json`, Buffer.from(JSON.stringify(json)));
      continue;
    }
    let renamed = name;
    if (name.startsWith(`tmbs/${from}`)) renamed = `tmbs/${to}${name.slice(`tmbs/${from}`.length)}`;
    else if (name.startsWith(`tiles/${from}/`)) renamed = `tiles/${to}/${name.slice(`tiles/${from}/`.length)}`;
    output.addFile(renamed, entry.getData());
  }
  output.writeZip(dest);
}

test.describe('M5-T4B: 実 UI からの地図搬出・別 slug import・アプリ搬出（AC11）', () => {
  test('AC11-a: MapEdit の搬出ボタンから出た ZIP に POI 実体・依存画像・通常/512px サムネイルが入る', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t4b-export-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubMessageBoxAutoOk(app);
      const seeded = await seedFullMap(page, await saveFolderOf(page), e2eRoot);

      const zipPath = path.join(e2eRoot, 'map-export.zip');
      await app.evaluate(async ({ dialog }, outZip) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: outZip })) as typeof dialog.showSaveDialog;
      }, zipPath);

      await openHash(page, `#/mapedit?uid=${seeded.mapUid}`);
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 30000 });

      // 実 UI のヘッダ搬出ボタンを押す
      await page.locator('[data-editor-action="export"]').click();
      await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 120000 });

      const { default: AdmZip } = await import('adm-zip');
      const zip = new AdmZip(zipPath);
      const names = zip.getEntries().map((e) => e.entryName);

      // AC2: POI はインライン化されず外部参照になり、実体が同梱される
      const mapJson = JSON.parse(zip.getEntry(`maps/${seeded.mapSlug}.json`)!.getData().toString('utf8'));
      expect(Array.isArray(mapJson.pois)).toBe(true);
      expect(mapJson.pois[0].layer).toMatch(/^pois\/.+\.geojson$/);
      expect(names).toContain(mapJson.pois[0].layer);

      // 依存画像（icon / html 内 maplat-asset:）の実体
      expect(names).toContain(`imgs/${seeded.iconSlug}.png`);
      expect(names).toContain(`imgs/${seeded.photoSlug}.png`);

      // AC3: 通常・512px の両サムネイルが slug 名で入る
      expect(names).toContain(`tmbs/${seeded.mapSlug}.jpg`);
      expect(names).toContain(`tmbs/${seeded.mapSlug}_512.jpg`);
      expect(names.some((n) => n.startsWith(`tiles/${seeded.mapSlug}/`))).toBe(true);

      console.log('  AC11-a: PASS（実 UI の地図搬出）');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC11-b: 別 slug へ import すると POI が管理下ソースへ復元され preview まで通る（取込ボタンは UI 未到達）', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t4b-import-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubMessageBoxAutoOk(app);
      const seeded = await seedFullMap(page, await saveFolderOf(page), e2eRoot);

      const zipPath = path.join(e2eRoot, 'map-export.zip');
      await app.evaluate(async ({ dialog }, outZip) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: outZip })) as typeof dialog.showSaveDialog;
      }, zipPath);
      await openHash(page, `#/mapedit?uid=${seeded.mapUid}`);
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 30000 });
      await page.locator('[data-editor-action="export"]').click();
      await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 120000 });

      // 別 slug の ZIP を作り、取込ダイアログがそれを返すようにする
      const copySlug = `${seeded.mapSlug}-copy`;
      const copyZip = path.join(e2eRoot, 'map-copy.zip');
      await rewriteZipSlug(zipPath, copyZip, seeded.mapSlug, copySlug);
      await app.evaluate(async ({ dialog }, inZip) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [inZip] })) as typeof dialog.showOpenDialog;
      }, copyZip);

      // 【実測 2026-08-03】地図 ZIP の取込ボタンは **UI から到達できない**。
      // MapEdit.vue:4171 の Data I/O ブロック（importMap を持つ）は activeTab === 'inout'
      // でしか表示されず、EditorTabs の tabs 配列（:3777-3782）に 'inout' が無い。
      // 同ブロックのコメント（:4162-4168）が「本ブロックへのUI導線はM11-T3で意図的に撤去済み。
      // ロジックは削除禁止 — M12-T23 で再編復帰予定」と記録している。
      // ∴ ボタン押下は再現できないため、そのボタンが呼ぶ **renderer の実 IPC 境界**を叩く。
      // これはサービスを直接呼ぶのとは違い、preload・IPC・main のサービスを実際に通る
      // （テスト内で importMap のロジックを再現しているわけではない）。
      await openHash(page, '#/mapedit');
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 30000 });
      const importResult = await page.evaluate(
        () => (window as any).dataupload.showDataSelectDialog());
      expect(importResult.err, `取込が失敗した: ${JSON.stringify(importResult).slice(0, 300)}`)
        .toBeUndefined();
      expect(importResult.mapData.mapID).toBe(copySlug);

      // POI が **管理下 POI ソースとして復元**されていること（ZIP 相対参照のままにしない）
      const restored = await page.evaluate(async (slug) => {
        const doc = await window.mapedit.request(slug);
        return { pois: doc.pois };
      }, copySlug);
      expect(Array.isArray(restored.pois)).toBe(true);
      expect(restored.pois[0].poiUid).toBeTruthy();
      expect(JSON.stringify(restored.pois)).not.toContain('pois/');

      // preview 用の読み出しが通る（プレビューボタンが叩く経路と同じ）
      const previewSource = await page.evaluate(
        (slug) => window.mapedit.previewSource(slug), copySlug);
      expect(previewSource).toBeTruthy();
      expect(JSON.stringify(previewSource)).not.toContain('pois/');

      console.log('  AC11-b: PASS（別 slug 取込 → POI 復元 → preview。取込ボタンは UI 未到達のため IPC 境界から）');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC11-c: AppEdit の搬出ボタンから出た ZIP が地図由来の POI 実体と依存画像を含む', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t4b-appexport-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubMessageBoxAutoOk(app);
      const seeded = await seedFullMap(page, await saveFolderOf(page), e2eRoot);

      const zipPath = path.join(e2eRoot, 'app-export.zip');
      await app.evaluate(async ({ dialog }, outZip) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: outZip })) as typeof dialog.showSaveDialog;
      }, zipPath);

      const appUid = await page.evaluate(async ({ mapSlug, mapUid }) => {
        const slug = `t4b-app-${Date.now()}`;
        const uid = crypto.randomUUID();
        const r = await window.appedit.save({
          uid, slug, create: true,
          document: {
            appID: slug, appName: { ja: 'T4B App' }, title: { ja: 'T4B App' },
            description: {}, keywords: '', siteUrl: '', lang: 'ja',
            sources: [{ sourceType: 'maplat', mapUid, mapSlug }],
            startFrom: mapSlug, pois: [], httpSettings: {}, appSettings: {}, manifestSettings: {},
          },
        });
        if (!r || r.result !== 'Success') throw new Error(JSON.stringify(r));
        return uid;
      }, { mapSlug: seeded.mapSlug, mapUid: seeded.mapUid });

      await openHash(page, `#/appedit?uid=${appUid}`);
      await expect(page.getByTestId('app-id')).toBeVisible({ timeout: 30000 });
      await page.locator('[data-editor-action="export"]').click();
      await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 120000 });

      const { default: AdmZip } = await import('adm-zip');
      const names = new AdmZip(zipPath).getEntries().map((e) => e.entryName);

      // AC1: 地図由来の POI 実体と依存画像がアプリ ZIP にも入る（共通化の前後で不変）
      expect(names.some((n) => /^pois\/.+\.geojson$/.test(n))).toBe(true);
      expect(names).toContain(`imgs/${seeded.iconSlug}.png`);
      expect(names).toContain(`imgs/${seeded.photoSlug}.png`);
      // viewer の読込対象（アプリ ZIP は静的配信一式を含む）
      expect(names).toContain('index.html');

      console.log('  AC11-c: PASS（実 UI のアプリ搬出）');
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('AC11 人間確認: 搬出済み地図・取込済み複製・アプリを揃えた状態で一時停止する', async () => {
    test.skip(process.env.MAPLAT_E2E_PAUSE !== '1',
      '人間確認用。MAPLAT_E2E_PAUSE=1 PWDEBUG=1 pnpm test:e2e:m5-t4b で実行する');
    test.setTimeout(0);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t4b-human-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubMessageBoxAutoOk(app);
      const seeded = await seedFullMap(page, await saveFolderOf(page), e2eRoot);

      // 地図を搬出しておく
      const zipPath = path.join(e2eRoot, 'map-export.zip');
      await app.evaluate(async ({ dialog }, outZip) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: outZip })) as typeof dialog.showSaveDialog;
      }, zipPath);
      await openHash(page, `#/mapedit?uid=${seeded.mapUid}`);
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 30000 });
      await page.locator('[data-editor-action="export"]').click();
      await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 120000 });

      // 別 slug の ZIP を用意し、取込ダイアログが返すようにしておく
      const copySlug = `${seeded.mapSlug}-copy`;
      const copyZip = path.join(e2eRoot, 'map-copy.zip');
      await rewriteZipSlug(zipPath, copyZip, seeded.mapSlug, copySlug);
      await app.evaluate(async ({ dialog }, inZip) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [inZip] })) as typeof dialog.showOpenDialog;
      }, copyZip);

      console.log('');
      console.log('=== M5-T4B 人間確認 ===');
      console.log(`  搬出済み地図 ZIP : ${zipPath}`);
      console.log(`  取込用 ZIP（別slug）: ${copyZip}  → slug: ${copySlug}`);
      console.log(`  元地図           : ${seeded.mapSlug} (uid=${seeded.mapUid})`);
      console.log(`  依存画像         : imgs/${seeded.iconSlug}.png / imgs/${seeded.photoSlug}.png`);
      console.log('');
      console.log('  【要判断】地図 ZIP の取込は現在 UI から到達できません。');
      console.log('    MapEdit.vue:4171 の Data I/O ブロック（地図データ入力ボタン）は');
      console.log("    activeTab === 'inout' でしか表示されず、タブ定義（:3777-3782）に 'inout' が");
      console.log('    無いためです。M11-T3 で意図的に撤去され M12-T23 で再編復帰予定、と');
      console.log('    同ファイルのコメントに記録されています。本タスクは導線を新設していません。');
      console.log('    取込の確認は下の DevTools コンソールから次を実行してください:');
      console.log('      await window.dataupload.showDataSelectDialog()');
      console.log(`    （選択ダイアログは ${copyZip} を返すよう差し替え済みです）`);
      console.log('');
      console.log('  確認していただきたいこと:');
      console.log('   1. 上記コマンドで複製が取り込め、slug が ' + copySlug + ' になること');
      console.log('   2. 取り込んだ地図の POI が管理下 POI ソースとして復元され、表示されること');
      console.log('   3. プレビューで POI（アイコン画像・吹き出しの埋め込み画像）が出ること');
      console.log('   4. 取り込んだ地図を再搬出しても同じ資源構成の ZIP になること');
      console.log('   5. アプリ搬出 → viewer 読込で POI が表示されること');
      console.log('');

      await openHash(page, '#/mapedit');
      await expect(page.getByTestId('map-title')).toBeVisible({ timeout: 30000 });
      await page.pause();
    } finally {
      await quitElectronApplication(app);
    }
  });
});
