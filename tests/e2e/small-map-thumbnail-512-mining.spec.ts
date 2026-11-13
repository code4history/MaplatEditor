// 起動時の 512px 補完（v3）の e2e: 既に保存されている小さい地図に 512px を作る。
//
// 長辺 512px 以下の画像はズーム2のタイルを持たないため、以前の補完（v2）は飛ばしていた。
// 既存の利用者のフォルダには v2 の印が付いているので、v2 の条件を変えても補完は走らない。
// v3 は別の印で 1 回だけ走り、「512px が無く、かつ tiles/{uid}/2 が無い地図」だけに、
// 最大ズームの段（原寸）から 512px を作る。
//
// 実データ不使用（mkdtemp + MAPLAT_E2E_ROOT）。画像はこの試験が作る架空のもの。
// 次の 4 つの地図を置き、v2 の印だけが付いた状態で起動する。
//   A: 200x150・z0 だけ・512px なし → 200x150 の 512px が作られる
//   B: 400x300・z0 と z1・512px なし → z1（原寸）から 400x300 の 512px が作られる
//   C: 300x200・z0 と z1・利用者が置き換えた 512px あり → 触れない（中身が変わらない）
//   D: z2 を持つ地図・512px なし → v3 の対象外（v2 の印があるので作られない）
import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Jimp } from 'jimp';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch } from './helpers/launchIsolated';
import { expectCornerColors, writeCornerImage } from './helpers/cornerImage';
import { readImageMeta, writeImageByExt } from '../../electron/utils/thumbnail512Codec';

const V2_ID = '2026-07-21-thumbnail-512-mining-v2';
const V3_ID = '2026-11-14-thumbnail-512-mining-v3';

async function seedMap(page: Page, name: string, width: number, height: number): Promise<string> {
  return page.evaluate(async ({ name, width, height }) => {
    const mapSlug = `small-mining-${name}-${Date.now()}`;
    const mapR = await window.mapedit.save({
      slug: mapSlug,
      mapObject: {
        mapID: mapSlug, title: { ja: `small mining ${name}` },
        officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
        attr: {}, dataAttr: {}, description: {},
        license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
        imageExtension: 'png', width, height,
        gcps: [[[0, 0], [15550000, 4160000]], [[width, 0], [15560000, 4160000]], [[width, height], [15560000, 4150000]]],
        edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
      },
      tins: [],
    });
    if (!mapR || mapR.result !== 'Success') throw new Error(JSON.stringify(mapR));
    return mapR.uid as string;
  }, { name, width, height });
}

// 画像を 256px のタイルへ切って tiles/{uid}/{level}/{tx}/{ty}.png に置く（端タイルは実寸）
async function placeLevel(saveFolder: string, uid: string, level: number, image: InstanceType<typeof Jimp>): Promise<void> {
  const { width, height } = image.bitmap;
  for (let tx = 0; tx * 256 < width; tx++) {
    const dir = path.join(saveFolder, 'tiles', uid, String(level), String(tx));
    await mkdir(dir, { recursive: true });
    for (let ty = 0; ty * 256 < height; ty++) {
      const w = Math.min(256, width - tx * 256);
      const h = Math.min(256, height - ty * 256);
      const tile = image.clone().crop({ x: tx * 256, y: ty * 256, w, h });
      await tile.write(path.join(dir, `${ty}.png`) as `${string}.${string}`);
    }
  }
}

// 原寸を最大ズームとし、それより下の段は半分ずつ縮めて置く
async function placePyramid(saveFolder: string, uid: string, source: string, maxZoom: number): Promise<void> {
  const original = await Jimp.read(source);
  for (let z = maxZoom; z >= 0; z--) {
    const scale = Math.pow(2, z - maxZoom);
    const level = original.clone();
    if (scale < 1) {
      level.resize({ w: Math.max(1, Math.round(original.width * scale)), h: Math.max(1, Math.round(original.height * scale)) });
    }
    await placeLevel(saveFolder, uid, z, level);
  }
}

test.describe('起動時の 512px 補完（v3）: 小さい地図', () => {
  test('v2 の印だけが付いたフォルダで、小さい地図に 512px が作られ、512px を持つ地図には触れない', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-small-mining-'));
    const workDir = path.join(e2eRoot, 'work');
    await mkdir(workDir, { recursive: true });

    const first = await launch(e2eRoot);
    let saveFolder = '';
    const uids: Record<'A' | 'B' | 'C' | 'D', string> = { A: '', B: '', C: '', D: '' };
    let userThumbBytes: Buffer;
    try {
      const page = first.page;
      saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
      uids.A = await seedMap(page, 'a', 200, 150);
      uids.B = await seedMap(page, 'b', 400, 300);
      uids.C = await seedMap(page, 'c', 300, 200);
      uids.D = await seedMap(page, 'd', 900, 300);
    } finally {
      await quitElectronApplication(first.app);
    }

    const srcA = path.join(workDir, 'a.png');
    const srcB = path.join(workDir, 'b.png');
    const srcC = path.join(workDir, 'c.png');
    const srcD = path.join(workDir, 'd.png');
    await writeCornerImage(srcA, 200, 150);
    await writeCornerImage(srcB, 400, 300);
    await writeCornerImage(srcC, 300, 200);
    await writeCornerImage(srcD, 900, 300);
    await placePyramid(saveFolder, uids.A, srcA, 0);
    await placePyramid(saveFolder, uids.B, srcB, 1);
    await placePyramid(saveFolder, uids.C, srcC, 1);
    await placePyramid(saveFolder, uids.D, srcD, 2);

    // C: 利用者が置き換えた 512px（緑一色の 100x100）
    const tmbs = path.join(saveFolder, 'tmbs');
    await mkdir(tmbs, { recursive: true });
    const thumbOf = (uid: string) => path.join(tmbs, `${uid}_512.webp`);
    await writeImageByExt(new Jimp({ width: 100, height: 100, color: 0x00ff00ff }), thumbOf(uids.C));
    userThumbBytes = await readFile(thumbOf(uids.C));
    for (const key of ['A', 'B', 'D'] as const) {
      expect(await readImageMeta(thumbOf(uids[key])), `${key} は起動前に 512px を持たない`).toBeNull();
    }

    // 既存の利用者のフォルダの状態: v2 の印はあり、v3 の印は無い
    const db = new DatabaseSync(path.join(saveFolder, 'maplat.sqlite'));
    try {
      db.prepare('INSERT OR REPLACE INTO schema_migrations (id) VALUES (?)').run(V2_ID);
      db.prepare('DELETE FROM schema_migrations WHERE id = ?').run(V3_ID);
    } finally {
      db.close();
    }

    const second = await launch(e2eRoot);
    try {
      await expect.poll(async () => (await readImageMeta(thumbOf(uids.A))) !== null, { timeout: 60_000 }).toBe(true);
      await expect.poll(async () => (await readImageMeta(thumbOf(uids.B))) !== null, { timeout: 60_000 }).toBe(true);

      const metaA = (await readImageMeta(thumbOf(uids.A)))!;
      const metaB = (await readImageMeta(thumbOf(uids.B)))!;
      console.log(`  A -> ${metaA.width}x${metaA.height}, B -> ${metaB.width}x${metaB.height}`);
      expect(metaA).toEqual({ width: 200, height: 150 });
      expect(metaB).toEqual({ width: 400, height: 300 });
      await expectCornerColors(thumbOf(uids.A), workDir);
      await expectCornerColors(thumbOf(uids.B), workDir);

      // C: 置き換えた 512px はそのまま
      expect((await readFile(thumbOf(uids.C))).equals(userThumbBytes), 'C の 512px は変わらない').toBe(true);
      // D: z2 を持つ地図は v3 の対象外（v2 は印があるので走らない）
      expect(await readImageMeta(thumbOf(uids.D)), 'D には作られない').toBeNull();
    } finally {
      await quitElectronApplication(second.app);
    }

    const after = new DatabaseSync(path.join(saveFolder, 'maplat.sqlite'));
    try {
      expect(after.prepare('SELECT 1 AS ok FROM schema_migrations WHERE id = ?').get(V3_ID), 'v3 の印が付く').toBeTruthy();
    } finally {
      after.close();
    }
  });
});
