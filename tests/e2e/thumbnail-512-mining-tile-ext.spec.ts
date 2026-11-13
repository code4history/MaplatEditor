// 起動時の 512px 補完（v2）の e2e: jpg・png 以外の拡張子のタイルを持つ地図にも 512px を作る。
//
// タイルの拡張子は取り込んだ画像の形式に従う（tif の画像なら {ty}.tif）。v2 の対象選びと
// 壊れた 512px の判定が jpg・jpeg・png だけを見ていたため、tif の地図には 512px が作られなかった。
// タイルのファイルかどうかの判定は、縫い合わせ（thumbnail512Stitch）と同じ 1 つの実装を使う。
//
// 実データ不使用（mkdtemp + MAPLAT_E2E_ROOT）。画像はこの試験が作る架空のもの。
// 次の 3 つの地図を置き、v2 の印を消した状態で起動する。
//   T: 900x300・z0〜z2 が tif・512px なし・.DS_Store などが混ざる → 512x171 の 512px が作られる
//   R: 900x300・z0〜z2 が tif・壊れた 512px（グリッド全体を縮めた 512x256）あり → 512x171 に作り直される
//   S: tiles/{uid}/2/0 に .DS_Store・._0.jpg・Thumbs.db だけ → タイルとみなさず、作られず、警告にも出ない
import { expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Jimp } from 'jimp';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch } from './helpers/launchIsolated';
import { expectCornerColors, writeCornerImage } from './helpers/cornerImage';
import { readImageMeta, writeImageByExt } from '../../electron/utils/thumbnail512Codec';

const V2_ID = '2026-07-21-thumbnail-512-mining-v2';

async function seedMap(page: Page, name: string, width: number, height: number): Promise<string> {
  return page.evaluate(async ({ name, width, height }) => {
    const mapSlug = `ext-mining-${name}-${Date.now()}`;
    const mapR = await window.mapedit.save({
      slug: mapSlug,
      mapObject: {
        mapID: mapSlug, title: { ja: `ext mining ${name}` },
        officialTitle: {}, author: {}, era: {}, createdAt: {}, contributor: {}, mapper: {},
        attr: {}, dataAttr: {}, description: {},
        license: 'PD', dataLicense: 'CC BY-SA', reference: '', url: '', lang: 'ja',
        imageExtension: 'tif', width, height,
        gcps: [[[0, 0], [15550000, 4160000]], [[width, 0], [15560000, 4160000]], [[width, height], [15560000, 4150000]]],
        edges: [], sub_maps: [], strictMode: 'strict', vertexMode: 'plain', status: 'New',
      },
      tins: [],
    });
    if (!mapR || mapR.result !== 'Success') throw new Error(JSON.stringify(mapR));
    return mapR.uid as string;
  }, { name, width, height });
}

// 画像を 256px のタイルへ切って tiles/{uid}/{level}/{tx}/{ty}.{ext} に置く（端タイルは実寸）
async function placeLevel(saveFolder: string, uid: string, level: number, image: InstanceType<typeof Jimp>, ext: string): Promise<void> {
  const { width, height } = image.bitmap;
  for (let tx = 0; tx * 256 < width; tx++) {
    const dir = path.join(saveFolder, 'tiles', uid, String(level), String(tx));
    await mkdir(dir, { recursive: true });
    for (let ty = 0; ty * 256 < height; ty++) {
      const w = Math.min(256, width - tx * 256);
      const h = Math.min(256, height - ty * 256);
      const tile = image.clone().crop({ x: tx * 256, y: ty * 256, w, h });
      await tile.write(path.join(dir, `${ty}.${ext}`) as `${string}.${string}`);
    }
  }
}

// 原寸を最大ズームとし、それより下の段は半分ずつ縮めて置く
async function placePyramid(saveFolder: string, uid: string, source: string, maxZoom: number, ext: string): Promise<void> {
  const original = await Jimp.read(source);
  for (let z = maxZoom; z >= 0; z--) {
    const scale = Math.pow(2, z - maxZoom);
    const level = original.clone();
    if (scale < 1) {
      level.resize({ w: Math.max(1, Math.round(original.width * scale)), h: Math.max(1, Math.round(original.height * scale)) });
    }
    await placeLevel(saveFolder, uid, z, level, ext);
  }
}

// タイルではないファイル（OS やツールが置くもの）
async function placeStrayFiles(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, '.DS_Store'), 'not a tile');
  await writeFile(path.join(dir, '._0.jpg'), 'not a tile');
  await writeFile(path.join(dir, 'Thumbs.db'), 'not a tile');
}

test.describe('起動時の 512px 補完（v2）: タイルの拡張子', () => {
  test('tif のタイルの地図に 512px が作られ、タイル以外のファイルは拾わない', async () => {
    test.setTimeout(300_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-ext-mining-'));
    const workDir = path.join(e2eRoot, 'work');
    await mkdir(workDir, { recursive: true });

    const first = await launch(e2eRoot);
    let saveFolder = '';
    const uids: Record<'T' | 'R' | 'S', string> = { T: '', R: '', S: '' };
    try {
      const page = first.page;
      saveFolder = await page.evaluate(() => window.settings.get('saveFolder'));
      uids.T = await seedMap(page, 't', 900, 300);
      uids.R = await seedMap(page, 'r', 900, 300);
      uids.S = await seedMap(page, 's', 900, 300);
    } finally {
      await quitElectronApplication(first.app);
    }

    const src = path.join(workDir, 'src.png');
    await writeCornerImage(src, 900, 300);
    await placePyramid(saveFolder, uids.T, src, 2, 'tif');
    await placePyramid(saveFolder, uids.R, src, 2, 'tif');
    // T: 段のフォルダと列のフォルダにタイル以外のファイルを混ぜる
    await placeStrayFiles(path.join(saveFolder, 'tiles', uids.T, '2'));
    await placeStrayFiles(path.join(saveFolder, 'tiles', uids.T, '2', '0'));
    // S: タイル以外のファイルだけ
    await placeStrayFiles(path.join(saveFolder, 'tiles', uids.S, '2', '0'));

    const tmbs = path.join(saveFolder, 'tmbs');
    await mkdir(tmbs, { recursive: true });
    const thumbOf = (uid: string) => path.join(tmbs, `${uid}_512.webp`);
    // R: 壊れた 512px（4x2 のグリッド 1024x512 を長辺 512 へ縮めた寸法）
    await writeImageByExt(new Jimp({ width: 512, height: 256, color: 0xffffffff }), thumbOf(uids.R));
    expect(await readImageMeta(thumbOf(uids.T)), 'T は起動前に 512px を持たない').toBeNull();
    expect(await readImageMeta(thumbOf(uids.S)), 'S は起動前に 512px を持たない').toBeNull();

    // v2 の印を消し、次の起動で v2 を走らせる
    const db = new DatabaseSync(path.join(saveFolder, 'maplat.sqlite'));
    try {
      db.prepare('DELETE FROM schema_migrations WHERE id = ?').run(V2_ID);
    } finally {
      db.close();
    }

    const second = await launch(e2eRoot);
    try {
      await expect.poll(async () => (await readImageMeta(thumbOf(uids.T))) !== null, { timeout: 60_000 }).toBe(true);
      await expect.poll(async () => {
        const m = await readImageMeta(thumbOf(uids.R));
        return m ? `${m.width}x${m.height}` : null;
      }, { timeout: 60_000 }).toBe('512x171');

      const metaT = (await readImageMeta(thumbOf(uids.T)))!;
      console.log(`  T -> ${metaT.width}x${metaT.height}`);
      expect(metaT).toEqual({ width: 512, height: 171 });
      await expectCornerColors(thumbOf(uids.T), workDir);
      await expectCornerColors(thumbOf(uids.R), workDir);
    } finally {
      await quitElectronApplication(second.app);
    }

    // S: タイル以外のファイルだけの地図には作られない
    expect(await readImageMeta(thumbOf(uids.S)), 'S には作られない').toBeNull();

    const after = new DatabaseSync(path.join(saveFolder, 'maplat.sqlite'));
    try {
      expect(after.prepare('SELECT 1 AS ok FROM schema_migrations WHERE id = ?').get(V2_ID), 'v2 の印が付く').toBeTruthy();
    } finally {
      after.close();
    }

    const report = await readFile(path.join(saveFolder, 'migration-report-v2.json'), 'utf8').catch(() => '{}');
    const warnings = JSON.stringify((JSON.parse(report) as { warnings?: unknown }).warnings ?? []);
    for (const key of ['T', 'R', 'S'] as const) {
      expect(warnings.includes(uids[key]), `${key} は補完の警告に出ない`).toBe(false);
    }
  });
});
