// M12-T30: pois の多重 stringify 復元撤去 + 書き込み側回帰テスト（設計 §5.2）。
// sp-0006（絶対遵守）に基づき、健全な pois 配列（poiUid 参照 + URL 生要素）が
// 保存⇄読込を「実 Electron で2往復」しても深さが増えず deep-equal を維持することを検証する。
// 旧バグ形（normalize のたびに JSON.stringify し直す）なら往復1で文字列化し、
// 往復2で二重化するため、いずれの assert も落ちる（M-1 変異実証で確認）。
// harness は m3-t6-inline-poi-preserve-convert.spec.ts の実績文法（electron.launch +
// MAPLAT_E2E_ROOT + window.appedit.save/request seed + openHash）に従う。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';

const projectRoot = path.resolve(import.meta.dirname, '../..');

async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${e2eRoot}`],
    cwd: projectRoot, env: { ...process.env, VITE_DEV_SERVER_URL: '', MAPLAT_E2E_ROOT: e2eRoot },
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

// 保存成功ダイアログ (appedit.success_save) を自動 OK する stub（m3-t6 stubMessageBoxRecording と
// 同文法）。未 stub のままだとネイティブダイアログ待ちで saveHandle.applySuccess が返らず、
// 保存状態が「保存中…」のまま止まる（saveHandle は showMessageBox の resolve を await する）
async function stubMessageBoxAutoOk(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
}

// m3-t6 seedPoiSource と同文法: 実在 POI ソースを1件作成する
async function seedPoiSource(page: Page): Promise<{ uid: string; slug: string }> {
  return page.evaluate(async () => {
    const slug = `t30-src-${Date.now()}`;
    const r = await window.poiSources.createLocal({ slug, title: { ja: 'T30 参照用' }, lang: 'ja' });
    if (!r || r.result !== 'Success') throw new Error(`createLocal: ${JSON.stringify(r)}`);
    await window.poiSources.save(r.uid, {
      slug, title: { ja: 'T30 参照用' },
      fc: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'p1', geometry: { type: 'Point', coordinates: [139.72, 34.95] }, properties: { name: { ja: 'T30F' } } }] },
    });
    return { uid: r.uid, slug };
  });
}

test.describe('M12-T30: pois 多重 stringify 復元撤去（実往復2回で深さが増えないこと）', () => {
  test('pois 配列が保存⇄読込を2往復しても deep-equal を維持し、poiSources キーが載らない（AC30-1）', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t30-roundtrip-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await stubMessageBoxAutoOk(app);
      // seed: 実在 POI ソースを1件作成する（参照要素の cachedTitle をソース実 title と一致させ、
      // PoiReferenceEditor の hydration（表示専用・pois を書き換えない）による差分を排除する）
      const source = await seedPoiSource(page);
      const fixture = [
        { poiUid: source.uid, cachedTitle: 'T30 参照用' },
        'https://example.com/pois.geojson',
      ];

      // seed: 上記 pois を持つ app を作成する（参照要素 + 生 URL 要素 — 歴史的にエスケープ
      // 破損を起こした2形状）
      const seeded = await page.evaluate(async (poisFixture) => {
        const slug = `t30-roundtrip-${Date.now()}`;
        const uid = crypto.randomUUID();
        const r = await window.appedit.save({
          uid, slug, create: true,
          document: {
            appID: slug, appName: { ja: 'T30 Roundtrip' }, title: { ja: 'T30 Roundtrip' },
            description: {}, keywords: '', siteUrl: '', lang: 'ja', sources: [],
            pois: poisFixture, httpSettings: {}, appSettings: {}, manifestSettings: {},
          },
        });
        if (!r || r.result !== 'Success') throw new Error(`create: ${JSON.stringify(r)}`);
        return { uid, slug };
      }, fixture);

      // ---- 往復1 ----
      await openHash(page, `#/appedit?uid=${seeded.uid}`);
      await expect(page.getByTestId('app-id')).toHaveValue(seeded.slug, { timeout: 30000 });
      await page.getByTestId('app-title').fill('T30 Roundtrip 編集1');
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 10000 });
      await page.getByTestId('editor-save').click();
      await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 30000 });
      const storedAfterFirst = await page.evaluate((uid) => (window as any).appedit.request(uid), seeded.uid);
      assertRoundtripShape(storedAfterFirst, fixture, '往復1');

      // UI 面: 正常配列では POI タブに警告が出ておらず read-only にもなっていない
      // (poisUnsupported が立たない)。左ペインの poi-selector-disabled は fixture の URL
      // 生要素 (非参照要素) による相互排他制約 (m3-t6 §5.3) でも立つため readOnly の判定には
      // 使えない。選択済みカードの削除ボタン (readOnly のみに依存、非参照要素制約の影響を受けない)
      // が有効であることで read-only でないことを確認する
      await page.locator('[role="tab"]', { hasText: 'POI選択' }).click();
      const appPoisPane = page.getByTestId('app-pois-tab-pane');
      await expect(appPoisPane.locator('.editor-diagnostic__message')).toHaveCount(0);
      await expect(appPoisPane.locator('.btn-outline-danger').first()).toBeEnabled();

      // ---- 往復2 ----
      // 旧バグ形（normalize のたびに再 stringify）なら往復ごとに深さが1増えるため、
      // 2往復目の deep-equal 成立が「深さが増えない」ことの直接否定になる
      await openHash(page, `#/appedit?uid=${seeded.uid}`);
      await expect(page.getByTestId('app-id')).toHaveValue(seeded.slug, { timeout: 30000 });
      await page.locator('[role="tab"]', { hasText: 'メタデータ編集' }).click();
      await page.getByTestId('app-title').fill('T30 Roundtrip 編集2');
      await expect(page.getByTestId('editor-save')).toBeEnabled({ timeout: 10000 });
      await page.getByTestId('editor-save').click();
      await expect(page.getByTestId('editor-save-state')).toHaveText(/保存済み|saved/i, { timeout: 30000 });
      const storedAfterSecond = await page.evaluate((uid) => (window as any).appedit.request(uid), seeded.uid);
      assertRoundtripShape(storedAfterSecond, fixture, '往復2');

      console.log('  M12-T30 pois roundtrip: PASS');
    } finally {
      await quitElectronApplication(app);
    }
  });
});

function assertRoundtripShape(stored: any, fixture: unknown[], label: string): void {
  if (!Array.isArray(stored?.pois)) {
    throw new Error(`${label}: stored.pois が配列でない (typeof=${typeof stored?.pois}): ${JSON.stringify(stored?.pois)}`);
  }
  const actual = JSON.stringify(stored.pois);
  const expected = JSON.stringify(fixture);
  if (actual !== expected) {
    throw new Error(`${label}: stored.pois が fixture と deep-equal でない\n  actual:   ${actual}\n  expected: ${expected}`);
  }
  if ('poiSources' in stored) {
    throw new Error(`${label}: stored に poiSources キーが載っている（送信 document に載らないはずの旧内部表現）`);
  }
}
