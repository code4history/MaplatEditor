// 地図パッケージ（搬出／取込）E2E の共通ハーネス。
//
// M5-T5 で新設。m5-t4b の spec に inline で書かれていたものを、m5-t5 が同じ準備を
// 必要としたため **複製せず**ここへ移した（恒久指示「同一扱い処理は共通実装へ徹底」）。
// 依存アセットを全種類持つ地図の seed、ダイアログの退避と復元、ZIP の slug 書き換えは
// 「似た処理」ではなく **同じ処理** であり、2箇所で育てると片方だけが直る。
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const projectRoot = path.resolve(import.meta.dirname, '../../..');

export const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

export async function launch(e2eRoot: string): Promise<{ app: ElectronApplication; page: Page }> {
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

export async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
  await page.waitForLoadState('domcontentloaded');
}

export async function saveFolderOf(page: Page): Promise<string> {
  return page.evaluate(() => window.settings.get('saveFolder'));
}

/** 保存/インポート完了ダイアログを自動 OK する（ネイティブダイアログ待ちで止まらないように） */
export async function stubMessageBoxAutoOk(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
}

/**
 * ネイティブダイアログの原本を退避する。**人間確認の前に必ず戻す**ためのもの。
 * 差し替えたまま人間へ渡すと、搬出ボタンが保存先を尋ねずに事前指定のパスへ書き、
 * 成功モーダルだけが出る — 自由操作のための引き渡しなのにダイアログを潰してしまう。
 */
export async function snapshotDialogs(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ dialog }) => {
    const g = globalThis as unknown as Record<string, unknown>;
    if (!g.__mapPackageDialogOriginals) {
      g.__mapPackageDialogOriginals = {
        showSaveDialog: dialog.showSaveDialog,
        showOpenDialog: dialog.showOpenDialog,
        showMessageBox: dialog.showMessageBox,
      };
    }
  });
}

export async function restoreDialogs(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ dialog }) => {
    const g = globalThis as unknown as Record<string, unknown>;
    const originals = g.__mapPackageDialogOriginals as Record<string, unknown> | undefined;
    if (!originals) throw new Error('snapshotDialogs を先に呼んでいない');
    dialog.showSaveDialog = originals.showSaveDialog as typeof dialog.showSaveDialog;
    dialog.showOpenDialog = originals.showOpenDialog as typeof dialog.showOpenDialog;
    dialog.showMessageBox = originals.showMessageBox as typeof dialog.showMessageBox;
  });
}

/** 退避した原本と現在の関数が一致するか（人間確認前の前提テスト用） */
export async function dialogsAreOriginal(app: ElectronApplication): Promise<{
  save: boolean; open: boolean; message: boolean;
}> {
  return app.evaluate(async ({ dialog }) => {
    const g = globalThis as unknown as Record<string, unknown>;
    const o = g.__mapPackageDialogOriginals as Record<string, unknown>;
    return {
      save: dialog.showSaveDialog === o.showSaveDialog,
      open: dialog.showOpenDialog === o.showOpenDialog,
      message: dialog.showMessageBox === o.showMessageBox,
    };
  });
}

export interface SeededMap {
  mapUid: string;
  mapSlug: string;
  poiUid: string;
  iconSlug: string;
  photoSlug: string;
  mapTitle: string;
}

/**
 * 依存アセットを全種類持つ地図を作る。
 *  - POI 登録参照（管理下 POI ソース）
 *  - icon（asset UUID 参照文法）
 *  - properties.html 内の maplat-asset:
 *  - 通常/512px サムネイル・タイル実体
 */
export async function seedFullMap(page: Page, saveFolder: string, workDir: string, options: {
  visibleImages?: boolean;
  /** slug の接頭辞。spec ごとに分けて、同一 root に複数 seed しても衝突しないようにする */
  prefix?: string;
  /** 地図のタイトル（一覧・編集画面の assert に使う） */
  title?: string;
} = {}): Promise<SeededMap> {
  const prefix = options.prefix ?? 't4b';
  const title = options.title ?? 'T4B 地図';

  // imageAssets.add は **実ファイルパス** を受ける（renderer から bytes は渡せない）
  const srcPng = path.join(workDir, `${prefix}-seed-source.png`);
  if (options.visibleImages) {
    // 人間確認では **目で見える画像**でなければ意味がない。
    // 1×1 PNG では「アセットは登録されたが画像は見えない」状態になり確認にならない
    // （2026-08-03 の検証で人間が指摘）
    const { Jimp } = await import('jimp');
    await new Jimp({ width: 96, height: 96, color: 0xe8453cff }).write(srcPng as `${string}.png`);
  } else {
    await writeFile(srcPng, Buffer.from(PNG_B64, 'base64'));
  }

  const seeded = await page.evaluate(async ({ sourcePath, slugPrefix, mapTitle }) => {
    const stamp = Date.now();
    const iconSlug = `${slugPrefix}-icon-${stamp}`;
    const photoSlug = `${slugPrefix}-photo-${stamp}`;

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
    const poiSlug = `${slugPrefix}-poi-${stamp}`;
    const created = await window.poiSources.createLocal({
      slug: poiSlug, title: { ja: `${slugPrefix} POI` }, lang: 'ja',
    });
    if (!created || created.result !== 'Success') throw new Error(`poi: ${JSON.stringify(created)}`);
    await window.poiSources.save(created.uid, {
      slug: poiSlug, title: { ja: `${slugPrefix} POI` },
      fc: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature', id: 'spot',
          geometry: { type: 'Point', coordinates: [135.05, 35.05] },
          properties: {
            name: { ja: `${slugPrefix} スポット` },
            icon: iconUid,
            html: { ja: `<img src="maplat-asset:${photoUid}">` },
          },
        }],
      },
    });

    // 地図（POI 登録参照つき）
    const mapSlug = `${slugPrefix}-map-${stamp}`;
    const mapR = await window.mapedit.save({
      slug: mapSlug,
      mapObject: {
        mapID: mapSlug, title: { ja: mapTitle },
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
        pois: [{ poiUid: created.uid, cachedTitle: `${slugPrefix} POI` }],
      },
      tins: [],
    });
    if (!mapR || mapR.result !== 'Success') throw new Error(`map: ${JSON.stringify(mapR)}`);
    return { mapUid: mapR.uid as string, mapSlug, poiUid: created.uid as string, iconSlug, photoSlug };
  }, { sourcePath: srcPng, slugPrefix: prefix, mapTitle: title });

  // サムネイル・タイルの実体を配置する（搬出の同梱対象）
  const bytes = Buffer.from(PNG_B64, 'base64');
  const tmbs = path.join(saveFolder, 'tmbs');
  await mkdir(tmbs, { recursive: true });
  await writeFile(path.join(tmbs, `${seeded.mapUid}.jpg`), bytes);
  await writeFile(path.join(tmbs, `${seeded.mapUid}_512.webp`), bytes);
  const tileDir = path.join(saveFolder, 'tiles', seeded.mapUid, '0', '0');
  await mkdir(tileDir, { recursive: true });
  await writeFile(path.join(tileDir, '0.jpg'), bytes);

  return { ...seeded, mapTitle: title };
}

/** 地図 ZIP の slug を書き換えて別 slug の ZIP を作る（元の地図を残したまま複製を取り込む形） */
export async function rewriteZipSlug(src: string, dest: string, from: string, to: string): Promise<void> {
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
