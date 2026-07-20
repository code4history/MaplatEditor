// M12-T15 (Fix-1/Test-1): 起動時 512px マイニングの一気通貫検証。
// 実データ不使用（mkdtemp + MAPLAT_E2E_ROOT）。ズーム2タイルはあるが tmbs/{uid}_512.jpg がない地図を用意し、
// 再起動で 512px マイニングが走り、白帯なし（アスペクト比が元画像通り）で tmbs/{uid}_512.jpg が生成されることを検証する。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Jimp } from 'jimp';
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

// 非正方形（900x300、アスペクト 3:1）の地図を seed する
async function seedNonSquareMap(page: Page): Promise<{ uid: string; slug: string; saveFolder: string }> {
  return page.evaluate(async () => {
    const mapSlug = `t15-mining-${Date.now()}`;
    const mapR = await window.mapedit.save({
      slug: mapSlug,
      mapObject: {
        mapID: mapSlug, title: { ja: 't15 mining' },
        officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
        attr: {}, dataAttr: {}, description: {},
        license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
        imageExtension: 'jpg', width: 900, height: 300,
        gcps: [[[0, 0], [15550000, 4160000]], [[900, 0], [15560000, 4160000]], [[900, 300], [15560000, 4150000]]],
        edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
      },
      tins: [],
    });
    if (!mapR || mapR.result !== 'Success') throw new Error(JSON.stringify(mapR));
    return { uid: mapR.uid, slug: mapSlug, saveFolder: await window.settings.get('saveFolder') };
  });
}

// saveFolder/tiles/{uid}/2/{tx}/{ty}.png に zoom2 タイル（4x2 の赤タイル）を配置する
async function placeZoom2Tiles(saveFolder: string, uid: string): Promise<void> {
  // 900x300 @ maxZoom=2 → tilesX=ceil(900/256)=4, tilesY=ceil(300/256)=2
  for (let tx = 0; tx < 4; tx++) {
    const dir = path.join(saveFolder, 'tiles', uid, '2', String(tx));
    await mkdir(dir, { recursive: true });
    for (let ty = 0; ty < 2; ty++) {
      const tile = new Jimp({ width: 256, height: 256, color: 0xff0000ff }); // 赤
      await tile.write(path.join(dir, `${ty}.png`) as `${string}.${string}`);
    }
  }
}

test.describe('M12-T15 Fix-1: 起動時 512px マイニング', () => {
  test('Test-1: ズーム2タイルはあるが 512px がない地図で、再起動時に 512px が正しいアスペクト比で生成される', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-t15-mining-'));
    // 1回目起動: 地図 seed + zoom2 タイル配置
    let app1: ElectronApplication | null = null;
    try {
      const { app, page } = await launch(e2eRoot);
      app1 = app;
      const { uid, saveFolder } = await seedNonSquareMap(page);

      // zoom2 タイルを配置（512px マイニング対象条件を満たす）
      await placeZoom2Tiles(saveFolder, uid);

      // tmbs/{uid}_512.jpg はまだない（seed では生成されない）
      // マイニング marker を削除して、次回起動で 512px マイニングが走る状態にする
      const db = new DatabaseSync(path.join(saveFolder, 'maplat.sqlite'));
      try {
        db.prepare("DELETE FROM schema_migrations WHERE id = '2026-07-20-thumbnail-512-mining'").run();
      } finally {
        db.close();
      }

      await quitElectronApplication(app);
      app1 = null;

      // 2回目起動: 512px マイニングが走る
      const { app: app2 } = await launch(e2eRoot);
      try {
        // マイニング完了を待つ（tmbs/{uid}_512.jpg が生成されるまで）
        const thumb512Path = path.join(saveFolder, 'tmbs', `${uid}_512.jpg`);
        await expect.poll(async () => {
          const { pathExists } = await import('fs-extra');
          return await pathExists(thumb512Path);
        }, { timeout: 30_000 }).toBe(true);

        // Test-1 の核心: 生成された 512px が正しいアスペクト比（900:300 = 3:1、白帯なし）
        const image = await Jimp.read(thumb512Path);
        const aspect = image.width / image.height;
        // Fix-1 前は crop なしで 1024x512（aspect 2）に白帯。Fix-1 後は 900x300（aspect 3）へ crop。
        // 長辺512px なので 512 x 171 付近（aspect ≈ 3）になることを検証
        expect(aspect).toBeGreaterThan(2.5); // 3:1 に近い（白帯があれば ~2:1 になる）
        expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(512);

        console.log(`  Test-1: PASS (512px generated with aspect ${aspect.toFixed(2)} = 非白帯)`);
      } finally {
        await quitElectronApplication(app2);
      }
    } finally {
      if (app1) await quitElectronApplication(app1);
    }
  });
});
