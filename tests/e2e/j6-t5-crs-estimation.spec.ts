import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import proj4 from 'proj4';
import geographiclib from 'geographiclib-geodesic';
import { recommendTransformSetup, shouldRecommendCrsSwitch } from '@c4h/teiresias';
import {
  MapTransform,
  Transform,
  WorldFileSurface,
  createProj4ProjectionEngine,
  worldFileToCrs,
  type CrsObject,
} from '@maplat/transform';
import { boundingExtent } from 'ol/extent.js';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { evalMain } from './helpers/evalMain';
import {
  launch,
  openHash,
  PNG_B64,
  rewriteZipSlug,
  saveFolderOf,
  stubMessageBoxAutoOk,
} from './helpers/mapPackage';
import {
  CrsReprojectionError,
  lonLatToCrs,
  reprojectLayerCoords,
  validateRoundtrip,
} from '../../src/utils/crsProjection';

const { Geodesic } = geographiclib;
const projectRoot = path.resolve(import.meta.dirname, '../..');
const fixtureDir = path.join(projectRoot, 'tests', 'fixtures', 'j6-crs');
const gridPngPath = path.join(fixtureDir, 'assets', 'grid-256.png');
const projectionEngine = createProj4ProjectionEngine(proj4);

interface KnownPixelExpectation {
  pixel: [number, number];
  crsCoord: [number, number];
  mercatorCoord: [number, number];
  geoLonLat: [number, number];
}

interface J6Fixture {
  id: string;
  title: string;
  wh: [number, number];
  imageAsset: string;
  strictMode: 'strict' | 'loose';
  vertexMode: 'plain' | 'birdeye';
  inputMap: {
    crs: CrsObject;
    gcps: [[number, number], [number, number]][];
    edges: unknown[];
  };
  estimation: {
    selectedId: string;
    crs: CrsObject;
    coreCompatible: boolean;
    score: number;
    rmsMeters: number;
    base3857Score: number;
    shouldRecommendCrsSwitch: boolean;
    recommendation: { setups: string[]; reason: string; score: number };
    rawWorldFile: Record<string, number>;
    worldFile: Record<string, number>;
    gcpsNew: { pixel: [number, number]; geo: [number, number] }[];
  };
  expectedAdoption: {
    setup: 'A' | 'B' | 'C';
    persistedSetupOnReopen?: 'A' | 'B' | 'C';
    crs: CrsObject;
    tinEnabled?: boolean;
    requestedOuterTransform?: string;
    outerTransform?: string;
    fallbackReason?: string;
    boundaryTriangleFlips?: number;
    margin?: number;
    knownPixels: KnownPixelExpectation[];
  };
  editToFallback?: {
    gcpIndex: number;
    editedGeo: [number, number];
    expectedRequestedOuterTransform: string;
    expectedOuterTransform: string;
    expectedFallbackReason: string;
  };
}

async function loadFixture(name: string): Promise<J6Fixture> {
  const raw = await readFile(path.join(fixtureDir, name), 'utf8');
  return JSON.parse(raw) as J6Fixture;
}

function proj4StringOf(crs: CrsObject | undefined): string {
  if (!crs || crs.epsg === 3857) return 'EPSG:3857';
  if (crs.epsg === 4326) return 'EPSG:4326';
  if (crs.proj4) return crs.proj4;
  throw new Error(`Unsupported CRS: ${JSON.stringify(crs)}`);
}

async function seedFixtureMap(
  page: Page,
  saveFolder: string,
  fixture: J6Fixture,
  slugPrefix: string,
): Promise<{ uid: string; slug: string }> {
  const slug = `${slugPrefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const saveResult = await page.evaluate(async ({ fixtureData, mapSlug }) => {
    const r = await window.mapedit.save({
      slug: mapSlug,
      mapObject: {
        mapID: mapSlug,
        title: { ja: fixtureData.title },
        officialTitle: {},
        author: {},
        era: {},
        createdAt: {},
        contributor: {},
        mapper: {},
        attr: { ja: 'J6 Test Attribution' },
        dataAttr: {},
        description: {},
        license: 'PD',
        dataLicense: 'CC BY-SA',
        reference: '',
        url: '',
        lang: 'ja',
        imageExtension: 'png',
        width: fixtureData.wh[0],
        height: fixtureData.wh[1],
        gcps: fixtureData.inputMap.gcps,
        edges: fixtureData.inputMap.edges ?? [],
        sub_maps: [],
        strictMode: fixtureData.strictMode,
        vertexMode: fixtureData.vertexMode,
        crs: fixtureData.inputMap.crs,
        status: 'New',
      },
      tins: [],
    });
    if (!r || r.result !== 'Success') {
      throw new Error(`Failed to seed fixture ${fixtureData.id}: ${JSON.stringify(r)}`);
    }
    return { uid: r.uid as string, slug: mapSlug };
  }, { fixtureData: fixture, mapSlug: slug });

  const gridBytes = await readFile(gridPngPath);
  const tmbPngBytes = Buffer.from(PNG_B64, 'base64');
  const tmbsDir = path.join(saveFolder, 'tmbs');
  await mkdir(tmbsDir, { recursive: true });
  await writeFile(path.join(tmbsDir, `${saveResult.uid}.png`), gridBytes);
  await writeFile(path.join(tmbsDir, `${saveResult.uid}_512.webp`), tmbPngBytes);
  const tileDir = path.join(saveFolder, 'tiles', saveResult.uid, '0', '0');
  await mkdir(tileDir, { recursive: true });
  await writeFile(path.join(tileDir, '0.png'), gridBytes);
  return saveResult;
}

async function openMapInGcpsTab(page: Page, uid: string): Promise<void> {
  const onMapEdit = await page.evaluate(() => location.hash.startsWith("#/mapedit"));
  if (onMapEdit) {
    await openHash(page, "#/maplist");
    await expect(page.locator("[data-resource-import]")).toBeVisible({ timeout: 30_000 });
  }
  await openHash(page, `#/mapedit?uid=${uid}`);
  await expect.poll(
    () => page.evaluate(() => Boolean((window as any).testDebug?.historyDebug()?.length)),
    { timeout: 30_000 },
  ).toBe(true);
  await expect(page.getByTestId('map-tab-gcps')).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId('map-tab-gcps').click();
  await expect(page.locator('#mercMap')).toBeVisible({ timeout: 15_000 });
  await expect.poll(
    () => page.evaluate(() => {
      const m = (window as any).testDebug?.mercMapInfo?.().map;
      const size = m?.getSize?.();
      return Array.isArray(size) && size[0] > 0 && size[1] > 0;
    }),
    { timeout: 15_000 },
  ).toBe(true);
}

async function fitMercViewToCoords(
  page: Page,
  coords: [number, number][],
  padding: [number, number, number, number] = [40, 40, 40, 40],
): Promise<void> {
  const extent = boundingExtent(coords);
  await page.evaluate(async ({ targetExtent, fitPadding }) => {
    const mercMap = (window as any).testDebug.mercMapInfo().map;
    mercMap.updateSize();
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      mercMap.once('rendercomplete', finish);
      mercMap.getView().fit(targetExtent, {
        size: mercMap.getSize(),
        padding: fitPadding,
        duration: 0,
      });
      mercMap.renderSync();
      setTimeout(finish, 300);
    });
  }, { targetExtent: extent, fitPadding: padding });
}

async function waitForMercRasterReady(page: Page, mode: 'A' | 'B' | 'C'): Promise<{
  rasterSourceClass: string;
  rasterOpacity: number;
  vectorOpacity: number;
  vectorFeatures: number;
  tilesLoaded: number;
}> {
  await expect.poll(
    () => page.evaluate(() => {
      const mercMap = (window as any).testDebug?.mercMapInfo?.().map;
      const layer = mercMap?.getLayers?.().getArray?.().find((l: any) => l.get('name') === 'crsPreviewRaster');
      return Boolean(layer?.getSource?.());
    }),
    { timeout: 15_000 },
  ).toBe(true);

  if (mode !== 'A') {
    await expect.poll(
      () => page.evaluate(() => {
        const mercMap = (window as any).testDebug?.mercMapInfo?.().map;
        const vectorLayer = mercMap?.getLayers?.().getArray?.().find((l: any) => l.get('name') === 'crsPreviewVector');
        return vectorLayer?.getSource?.()?.getFeatures?.().length ?? 0;
      }),
      { timeout: 15_000 },
    ).toBeGreaterThan(0);
  }

  return page.evaluate(async () => {
    const mercMap = (window as any).testDebug.mercMapInfo().map;
    const layers = mercMap.getLayers().getArray();
    const rasterLayer = layers.find((l: any) => l.get('name') === 'crsPreviewRaster');
    const vectorLayer = layers.find((l: any) => l.get('name') === 'crsPreviewVector');
    const source = rasterLayer.getSource();
    const grid = source.getTileGrid();
    const extent = mercMap.getView().calculateExtent(mercMap.getSize());

    // Wait for tile 0/0/0 to finish loading (TileImage reprojection fetches underlying source tile 0/0/0)
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      const onEnd = () => {
        setTimeout(finish, 80);
      };
      source.once?.('tileloadend', onEnd);
      source.once?.('tileloaderror', onEnd);
      mercMap.once('rendercomplete', () => setTimeout(finish, 80));
      mercMap.renderSync();
      setTimeout(finish, 1200);
    });

    await new Promise<void>((resolve) => {
      mercMap.once('rendercomplete', () => resolve());
      mercMap.renderSync();
      setTimeout(resolve, 250);
    });

    const tile = source.getTile(0, 0, 0, window.devicePixelRatio || 1, mercMap.getView().getProjection());
    const tileState = tile?.getState?.() ?? -1;
    // Also count loaded reprojection/source tiles in tile cache if available
    const loadedCount = grid && extent ? Math.max(1, tileState === 2 ? 1 : 0) : 1;

    return {
      rasterSourceClass: String(source?.constructor?.name ?? ''),
      rasterOpacity: Number(rasterLayer.getOpacity()),
      vectorOpacity: Number(vectorLayer.getOpacity()),
      vectorFeatures: Number(vectorLayer?.getSource?.()?.getFeatures?.().length ?? 0),
      tilesLoaded: loadedCount,
    };
  });
}

async function sampleMercCanvasSignature(page: Page): Promise<{
  canvasCount: number;
  width: number;
  height: number;
  nonTransparentPixels: number;
  vividRasterPixels: number;
  alphaSum: number;
  rgbHash: number;
}> {
  return page.evaluate(() => {
    const container = document.getElementById('mercMap');
    if (!container) throw new Error('#mercMap not found');
    const canvases = Array.from(container.querySelectorAll('.ol-layers canvas')) as HTMLCanvasElement[];
    const rect = container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const composite = document.createElement('canvas');
    composite.width = w;
    composite.height = h;
    const ctx = composite.getContext('2d');
    if (!ctx) throw new Error('2d context missing');

    for (const canvas of canvases) {
      if (canvas.width === 0 || canvas.height === 0) continue;
      const canvasAlpha = Number.parseFloat(getComputedStyle(canvas).opacity || '1');
      const parentAlpha = canvas.parentElement
        ? Number.parseFloat(getComputedStyle(canvas.parentElement).opacity || '1')
        : 1;
      const alpha = (Number.isFinite(canvasAlpha) ? canvasAlpha : 1)
        * (Number.isFinite(parentAlpha) ? parentAlpha : 1);
      if (alpha <= 0) continue;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(canvas, 0, 0, w, h);
      ctx.restore();
    }

    const data = ctx.getImageData(0, 0, w, h).data;
    let nonTransparentPixels = 0;
    let vividRasterPixels = 0;
    let alphaSum = 0;
    let rgbHash = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a > 0) {
        nonTransparentPixels += 1;
        alphaSum += a;
        // Checkerboard reds/greens/ambers in grid-256.png stand apart from vector blue (#0d6efd) & crimson (#dc3545)
        if ((g > b + 20 && g > 80) || (r > 180 && g > 130 && b < 110)) {
          vividRasterPixels += 1;
        }
        rgbHash = (rgbHash * 31 + r * 3 + g * 5 + b * 7 + a) >>> 0;
      }
    }

    return {
      canvasCount: canvases.length,
      width: w,
      height: h,
      nonTransparentPixels,
      vividRasterPixels,
      alphaSum,
      rgbHash,
    };
  });
}

async function verifySavedKnownPixels(stored: any, fixture: J6Fixture): Promise<void> {
  const crs = stored.crs as CrsObject;
  const crsProj = proj4StringOf(crs);
  if (fixture.expectedAdoption.setup === 'A') {
    expect(stored.tinEnabled).toBe(false);
    const surface = new WorldFileSurface({
      crs,
      worldFile: stored.worldFile,
      wh: fixture.wh,
      projectionEngine,
    });
    for (const kp of fixture.expectedAdoption.knownPixels) {
      const crsPt = worldFileToCrs(stored.worldFile, kp.pixel);
      const mercPt = surface.transform(kp.pixel, false) as [number, number];
      expect(Math.hypot(crsPt[0] - kp.crsCoord[0], crsPt[1] - kp.crsCoord[1])).toBeLessThan(1e-4);
      expect(Math.hypot(mercPt[0] - kp.mercatorCoord[0], mercPt[1] - kp.mercatorCoord[1])).toBeLessThan(1e-3);
      const geo = proj4('EPSG:3857', 'EPSG:4326', mercPt);
      expect(Math.abs(geo[0] - kp.geoLonLat[0])).toBeLessThan(1e-7);
      expect(Math.abs(geo[1] - kp.geoLonLat[1])).toBeLessThan(1e-7);
    }
    return;
  }

  expect(stored.compiled).toBeTruthy();
  const mapTransform = new MapTransform();
  await mapTransform.setLayeredMapData({
    main: {
      kind: 'tin',
      compiled: stored.compiled,
      crs,
      projectionEngine,
    },
    subMaps: [],
  });
  const localTransform = new Transform();
  localTransform.setCompiled(stored.compiled);
  for (const kp of fixture.expectedAdoption.knownPixels) {
    const crsPt = localTransform.transform(kp.pixel, false) as [number, number];
    const mercRes = mapTransform.xy2MercWithLayer(kp.pixel);
    expect(Array.isArray(mercRes)).toBe(true);
    const mercPt = mercRes![1] as [number, number];
    expect(Math.hypot(crsPt[0] - kp.crsCoord[0], crsPt[1] - kp.crsCoord[1])).toBeLessThan(1e-4);
    expect(Math.hypot(mercPt[0] - kp.mercatorCoord[0], mercPt[1] - kp.mercatorCoord[1])).toBeLessThan(1e-3);
    const geo = proj4(crsProj, 'EPSG:4326', crsPt);
    expect(Math.abs(geo[0] - kp.geoLonLat[0])).toBeLessThan(1e-7);
    expect(Math.abs(geo[1] - kp.geoLonLat[1])).toBeLessThan(1e-7);
  }
}

async function setRangeValue(slider: Locator, value: number): Promise<void> {
  await slider.evaluate((el, val) => {
    const input = el as HTMLInputElement;
    input.value = String(val);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function dragMercGcpMarker(
  page: Page,
  gcpIndex: number,
  targetMerc: [number, number],
): Promise<void> {
  const coords = await page.evaluate((idx) => {
    const mercMap = (window as any).testDebug.mercMapInfo().map;
    const markerSource = mercMap.getSource?.('marker');
    const feat = markerSource?.getFeatures()?.find((f: any) => Number(f.get('gcpIndex')) === idx);
    if (!feat) throw new Error(`GCP marker ${idx} not found on mercMap`);
    const origMerc = feat.getGeometry().getCoordinates() as [number, number];
    return origMerc;
  }, gcpIndex);

  // 右・下の地図オーバーレイボタン（map-overlay-tools / attribution）と重ならないよう内側に余白を取る
  await fitMercViewToCoords(page, [coords, targetMerc], [80, 140, 100, 80]);

  const points = await page.evaluate(({ orig, target }) => {
    const mercMap = (window as any).testDebug.mercMapInfo().map;
    const rect = document.getElementById('mercMap')!.getBoundingClientRect();
    const fromPx = mercMap.getPixelFromCoordinate(orig);
    const toPx = mercMap.getPixelFromCoordinate(target);
    return {
      fromX: rect.left + fromPx[0],
      fromY: rect.top + fromPx[1] - 10,
      toX: rect.left + toPx[0],
      toY: rect.top + toPx[1] - 10,
    };
  }, { orig: coords, target: targetMerc });

  await page.mouse.move(points.fromX, points.fromY);
  await page.mouse.down();
  await page.mouse.move(points.toX, points.toY, { steps: 6 });
  await page.mouse.up();
}

test.describe('J6-T5b CRS 推定・比較オーバーレイ・固定 fixture・E2E', () => {
  test('1. 閾値境界（GCP 数 UI 制御・Teiresias 判定・比較切替・Karney 1.0m 往復）', async () => {
    test.setTimeout(180_000);

    // 1a. Teiresias recommendTransformSetup 閾値 [lo, hi)
    const boundaries: Array<{
      score: number;
      reason: string;
      setups: string[];
    }> = [
      { score: 0, reason: 'clear', setups: ['worldFileOnly'] },
      { score: 0.002999, reason: 'clear', setups: ['worldFileOnly'] },
      { score: 0.003, reason: 'borderline', setups: ['worldFileOnly', 'tinGlobal'] },
      { score: 0.007999, reason: 'borderline', setups: ['tinGlobal', 'worldFileOnly'] },
      { score: 0.008, reason: 'clear', setups: ['tinGlobal'] },
      { score: 0.029999, reason: 'clear', setups: ['tinGlobal'] },
      { score: 0.030, reason: 'borderline', setups: ['tinGlobal', 'tinFan'] },
      { score: 0.039999, reason: 'borderline', setups: ['tinFan', 'tinGlobal'] },
      { score: 0.040, reason: 'clear', setups: ['tinFan'] },
      { score: 0.1, reason: 'clear', setups: ['tinFan'] },
    ];
    for (const b of boundaries) {
      const rec = recommendTransformSetup({ status: 'ok', selected: { score: b.score, qualityGate: 'adoptable' } } as any);
      expect(rec.reason, `score=${b.score}`).toBe(b.reason);
      expect(rec.setups, `score=${b.score}`).toEqual(b.setups);
    }

    // 1b. shouldRecommendCrsSwitch 境界 (0.95 vs 0.951)
    expect(shouldRecommendCrsSwitch(0.95, 1.0)).toBe(true);
    expect(shouldRecommendCrsSwitch(0.951, 1.0)).toBe(false);
    expect(shouldRecommendCrsSwitch(0.0095, 0.01)).toBe(true);
    expect(shouldRecommendCrsSwitch(0.00951, 0.01)).toBe(false);

    // 1c. Karney 往復ゲート境界 (<= 1.0m 許可 / 1.01m 拒否 + reprojectLayerCoords 拒否)
    const planeVi: CrsObject = {
      epsg: 6674,
      authority: 'EPSG',
      code: '6674',
      proj4: '+proj=tmerc +lat_0=36 +lon_0=136 +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs',
    };
    const origin: [number, number] = [135.75, 34.93];
    const atOneMeter = Geodesic.WGS84.Direct(origin[1], origin[0], 90, 0.999);
    const overOneMeter = Geodesic.WGS84.Direct(origin[1], origin[0], 90, 1.01);
    const projectedOk = lonLatToCrs([atOneMeter.lon2!, atOneMeter.lat2!], planeVi);
    const projectedOver = lonLatToCrs([overOneMeter.lon2!, overOneMeter.lat2!], planeVi);
    expect(projectedOk).not.toBe(false);
    expect(projectedOver).not.toBe(false);
    const distOk = validateRoundtrip(origin, projectedOk as [number, number], planeVi, { kind: 'gcp', index: 0 });
    expect(distOk).toBeLessThanOrEqual(1.0);
    expect(() => validateRoundtrip(origin, projectedOver as [number, number], planeVi, { kind: 'gcp', index: 0 }))
      .toThrow(CrsReprojectionError);
    // reprojectLayerCoords も近似式で帯域を外れた点で roundtrip_exceeded を返すこと
    const approxTm: CrsObject = {
      authority: 'TEST',
      code: 'APPROX_TM',
      proj4: '+proj=tmerc +lat_0=36 +lon_0=136 +approx +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs',
    };
    expect(() => reprojectLayerCoords([[[0, 0], [155, 35]]], [], { epsg: 4326 }, approxTm))
      .toThrow(CrsReprojectionError);

    // 1d. Live UI 2 GCP vs 3 GCP 制御
    const scratch = path.join(projectRoot, '.tmp-smoke');
    await mkdir(scratch, { recursive: true });
    const e2eRoot = await mkdtemp(path.join(scratch, 'j6-t5-gate-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await page.route(/^https?:/, (route) => route.abort());
      await stubMessageBoxAutoOk(app);
      const fixtureA = await loadFixture('fixture-a.json');
      const saveFolder = await saveFolderOf(page);
      const seeded = await seedFixtureMap(page, saveFolder, {
        ...fixtureA,
        inputMap: { ...fixtureA.inputMap, gcps: fixtureA.inputMap.gcps.slice(0, 2) },
      }, 'j6-gate');

      await openMapInGcpsTab(page, seeded.uid);
      const estimateBtn = page.getByTestId('map-edit-estimate-crs');
      const helpBtn = page.getByTestId('map-edit-estimate-crs-help');
      await expect(estimateBtn).toBeDisabled();
      await expect(helpBtn).toBeVisible();

      // 3 点目を追加すると押下可能になりヘルプが消える
      await page.evaluate((thirdGcp) => {
        const debug = (window as any).testDebug;
        debug.gcps.value.push(thirdGcp);
      }, fixtureA.inputMap.gcps[2]);

      await expect(estimateBtn).toBeEnabled({ timeout: 10_000 });
      await expect(helpBtn).toBeHidden();
    } finally {
      await quitElectronApplication(app);
      await rm(e2eRoot, { recursive: true, force: true });
    }
  });

  test('2. 比較オーバーレイ（ベクタ＋ワープ済みラスター）・不透明度・非破壊保証・Fixture A/B 変換＋Undo/Redo', async () => {
    test.setTimeout(300_000);
    const scratch = path.join(projectRoot, '.tmp-smoke');
    await mkdir(scratch, { recursive: true });
    const e2eRoot = await mkdtemp(path.join(scratch, 'j6-t5-ab-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await page.route(/^https?:/, (route) => route.abort());
      await stubMessageBoxAutoOk(app);
      const saveFolder = await saveFolderOf(page);
      const fixtureA = await loadFixture('fixture-a.json');
      const fixtureB = await loadFixture('fixture-b.json');
      const seededA = await seedFixtureMap(page, saveFolder, fixtureA, 'j6-fixa');
      const seededB = await seedFixtureMap(page, saveFolder, fixtureB, 'j6-fixb');

      // --- Fixture A ---
      await openMapInGcpsTab(page, seededA.uid);
      await fitMercViewToCoords(page, fixtureA.expectedAdoption.knownPixels.slice(0, 4).map((k) => k.mercatorCoord));

      // 比較中の非破壊比較のためベースラインを取得
      const baselineA = await page.evaluate(async () => {
        const debug = (window as any).testDebug;
        const drafts = await window.assetDrafts.list('map');
        return {
          draftCount: drafts.length,
          isDirty: debug.isDirty.value,
          history: debug.historySnapshot(),
          doc: JSON.parse(JSON.stringify({
            mapData: debug.mapData.value,
            sub_maps: debug.sub_maps.value,
            gcps: debug.gcps.value,
            edges: debug.edges.value,
            layerIds: debug.layerIds.value,
            layerTransformIntents: debug.layerTransformIntents.value,
            editGeneration: debug.editGeneration.value,
            tinObjects: debug.tinObjects.value,
          })),
        };
      });
      expect(baselineA.isDirty).toBe(false);
      expect(baselineA.draftCount).toBe(0);

      await page.getByTestId('map-edit-estimate-crs').click();
      await expect(page.getByTestId('crs-panel-candidates')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId(`crs-panel-candidate-row-${fixtureA.estimation.selectedId}`)).toBeVisible();
      await expect(page.getByTestId('crs-setup-card-A')).toContainText('推奨');
      await expect(page.getByTestId('crs-setup-card-B')).not.toContainText('推奨');

      // 元の状態: ラスター・ベクタ共に空
      await page.getByTestId('crs-preview-mode-original').click();
      await expect.poll(() => page.evaluate(() => {
        const mercMap = (window as any).testDebug.mercMapInfo().map;
        const layers = mercMap.getLayers().getArray();
        const raster = layers.find((l: any) => l.get('name') === 'crsPreviewRaster');
        const vec = layers.find((l: any) => l.get('name') === 'crsPreviewVector');
        return { hasRaster: Boolean(raster.getSource()), vecCount: vec.getSource().getFeatures().length };
      })).toEqual({ hasRaster: false, vecCount: 0 });
      const sigOriginal = await sampleMercCanvasSignature(page);

      // Setup A プレビュー: ベクタ 1 ポリゴン ＋ ワープ済み grid-256.png ラスター
      await page.getByTestId('crs-preview-mode-A').click();
      const stateA70 = await waitForMercRasterReady(page, 'A');
      expect(stateA70.vectorFeatures).toBe(1);
      expect(stateA70.rasterOpacity).toBeCloseTo(0.7, 2);
      expect(stateA70.vectorOpacity).toBeCloseTo(0.7, 2);
      const sourceIdA = await page.evaluate(() => {
        const mercMap = (window as any).testDebug.mercMapInfo().map;
        const raster = mercMap.getLayers().getArray().find((l: any) => l.get('name') === 'crsPreviewRaster');
        (window as any).__prevRasterSrcA = raster.getSource();
        return Boolean(raster.getSource());
      });
      expect(sourceIdA).toBe(true);
      const sigA70 = await sampleMercCanvasSignature(page);
      expect(sigA70.nonTransparentPixels).toBeGreaterThan(200);
      expect(sigA70.vividRasterPixels).toBeGreaterThan(50);
      expect(sigA70.rgbHash).not.toBe(sigOriginal.rgbHash);

      // 不透明度スライダ 70 -> 35 で TileImage ソースを再生成せず描画値のみ変える
      await setRangeValue(page.getByTestId('crs-preview-opacity'), 35);
      await expect.poll(() => page.evaluate(() => {
        const mercMap = (window as any).testDebug.mercMapInfo().map;
        const raster = mercMap.getLayers().getArray().find((l: any) => l.get('name') === 'crsPreviewRaster');
        return Number(raster.getOpacity());
      })).toBeCloseTo(0.35, 2);
      const sameSourceOnOpacity = await page.evaluate(async () => {
        const mercMap = (window as any).testDebug.mercMapInfo().map;
        const raster = mercMap.getLayers().getArray().find((l: any) => l.get('name') === 'crsPreviewRaster');
        await new Promise<void>((resolve) => {
          mercMap.once('rendercomplete', () => resolve());
          mercMap.renderSync();
          setTimeout(resolve, 200);
        });
        return raster.getSource() === (window as any).__prevRasterSrcA;
      });
      expect(sameSourceOnOpacity).toBe(true);
      const sigA35 = await sampleMercCanvasSignature(page);
      expect(sigA35.alphaSum).toBeLessThan(sigA70.alphaSum);
      expect(sigA35.rgbHash).not.toBe(sigA70.rgbHash);

      // 不透明度を 70 へ戻して Setup B プレビューへ切替（メッシュベクタ＋TIN ワープ済みラスター）
      await setRangeValue(page.getByTestId('crs-preview-opacity'), 70);
      await page.getByTestId('crs-preview-mode-B').click();
      const stateB70 = await waitForMercRasterReady(page, 'B');
      expect(stateB70.vectorFeatures).toBeGreaterThan(1);
      const sigB70 = await sampleMercCanvasSignature(page);
      expect(sigB70.nonTransparentPixels).toBeGreaterThan(200);
      expect(sigB70.vividRasterPixels).toBeGreaterThan(50);

      // 非破壊保証: 比較切替・不透明度調整後も文書・履歴・dirty・下書き書込は一切変化しない
      const afterPreviewA = await page.evaluate(async () => {
        const debug = (window as any).testDebug;
        const drafts = await window.assetDrafts.list('map');
        return {
          draftCount: drafts.length,
          isDirty: debug.isDirty.value,
          history: debug.historySnapshot(),
          doc: JSON.parse(JSON.stringify({
            mapData: debug.mapData.value,
            sub_maps: debug.sub_maps.value,
            gcps: debug.gcps.value,
            edges: debug.edges.value,
            layerIds: debug.layerIds.value,
            layerTransformIntents: debug.layerTransformIntents.value,
            editGeneration: debug.editGeneration.value,
            tinObjects: debug.tinObjects.value,
          })),
        };
      });
      expect(afterPreviewA.isDirty).toBe(false);
      expect(afterPreviewA.draftCount).toBe(0);
      expect(afterPreviewA.history).toEqual(baselineA.history);
      expect(afterPreviewA.doc).toEqual(baselineA.doc);

      // 副層（layerIndex: 1）でも createCrsPreviewRasterSource が有効な TileImage を生成できることを実確認
      const sublayerProbe = await page.evaluate(async (fa) => {
        const debug = (window as any).testDebug;
        const url = String(debug.mapData.value.url_);
        const res = await debug.createCrsPreviewRasterSource({
          spec: {
            mode: 'A',
            layerIndex: 1,
            crs: fa.estimation.crs,
            worldFile: fa.estimation.worldFile,
            bounds: [[10, 10], [240, 10], [240, 240], [10, 240]],
          },
          width: fa.wh[0],
          height: fa.wh[1],
          url,
          imageExtension: 'png',
        });
        return {
          ok: Boolean(res?.source),
          illstProj: res?.illstProjectionCode ?? null,
          hasExtent: Array.isArray(res?.extent) && res!.extent.length === 4,
        };
      }, fixtureA);
      expect(sublayerProbe).toEqual({
        ok: true,
        illstProj: 'Illst:__crs_preview_1__#1',
        hasExtent: true,
      });

      // Fixture A 採用 -> 保存 -> 既知点変換一致
      await page.getByTestId('crs-adopt-recommended').click();
      await expect.poll(() => page.evaluate(() => (window as any).testDebug.layerTransformIntents.value.main?.setup)).toBe('A');
      await expect.poll(() => page.evaluate(() => (window as any).testDebug.saveMapAfterConfirm())).toBe(true);
      const storedA = await page.evaluate((id) => window.mapedit.request(id), seededA.uid);
      await verifySavedKnownPixels(storedA, fixtureA);

      // --- Fixture B + editToFallback + Undo / Redo ---
      await openMapInGcpsTab(page, seededB.uid);
      await fitMercViewToCoords(page, fixtureB.expectedAdoption.knownPixels.slice(0, 4).map((k) => k.mercatorCoord));
      await page.getByTestId('map-edit-estimate-crs').click();
      await expect(page.getByTestId('crs-panel-candidates')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('crs-setup-card-B')).toContainText('推奨');
      await page.getByTestId('crs-adopt-recommended').click();
      await expect.poll(() => page.evaluate(() => ({
        setup: (window as any).testDebug.layerTransformIntents.value.main?.setup,
        outer: (window as any).testDebug.tinDiagnostics.value.main?.outerTransform,
      })), { timeout: 20_000 }).toEqual({ setup: 'B', outer: 'worldFile' });
      await expect.poll(() => page.evaluate(() => (window as any).testDebug.saveMapAfterConfirm())).toBe(true);
      const storedB = await page.evaluate((id) => window.mapedit.request(id), seededB.uid);
      expect(storedB.compiled.outerTransform).toBe('worldFile');
      await verifySavedKnownPixels(storedB, fixtureB);

      // 実 UI の GCP ドラッグ編集で境界反転を誘発し B -> C 降格を確認する
      const editFallback = fixtureB.editToFallback!;
      const editedMerc = proj4(proj4StringOf(fixtureB.expectedAdoption.crs), 'EPSG:3857', editFallback.editedGeo) as [number, number];
      await page.getByTestId('crs-panel-close').click();
      const historyCountBeforeDrag = await page.evaluate(() => (window as any).testDebug.historyDebug().length);
      await dragMercGcpMarker(page, editFallback.gcpIndex, editedMerc);

      await expect.poll(() => page.evaluate(() => (window as any).testDebug.historyDebug().length), { timeout: 15_000 })
        .toBe(historyCountBeforeDrag + 1);
      await expect.poll(() => page.evaluate(() => {
        const d = (window as any).testDebug.tinDiagnostics.value.main;
        return d ? {
          requestedOuterTransform: d.requestedOuterTransform,
          outerTransform: d.outerTransform,
          fallbackReason: d.fallbackReason,
        } : null;
      }), { timeout: 20_000 }).toEqual({
        requestedOuterTransform: editFallback.expectedRequestedOuterTransform,
        outerTransform: editFallback.expectedOuterTransform,
        fallbackReason: editFallback.expectedFallbackReason,
      });

      // Undo で B / worldFile に戻り、Redo で C 降格状態へ戻る
      await evalMain(app, ({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('main-process-message', 'menu:undo');
      });
      await expect.poll(() => page.evaluate(() => {
        const d = (window as any).testDebug.tinDiagnostics.value.main;
        return {
          setup: (window as any).testDebug.layerTransformIntents.value.main?.setup,
          outer: d?.outerTransform,
        };
      }), { timeout: 15_000 }).toEqual({ setup: 'B', outer: 'worldFile' });

      await evalMain(app, ({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('main-process-message', 'menu:redo');
      });
      await expect.poll(() => page.evaluate(() => (window as any).testDebug.tinDiagnostics.value.main?.outerTransform), { timeout: 15_000 })
        .toBe('extrapolate');
    } finally {
      await quitElectronApplication(app);
      await rm(e2eRoot, { recursive: true, force: true });
    }
  });

  test('3. Fixture BC-Fallback（境界 B→C 自動降格・通知・保存後リロードで C 確定）', async () => {
    test.setTimeout(240_000);
    const scratch = path.join(projectRoot, '.tmp-smoke');
    await mkdir(scratch, { recursive: true });
    const e2eRoot = await mkdtemp(path.join(scratch, 'j6-t5-bc-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await page.route(/^https?:/, (route) => route.abort());
      await stubMessageBoxAutoOk(app);
      const fixtureBc = await loadFixture('fixture-bc-fallback.json');
      const seeded = await seedFixtureMap(page, await saveFolderOf(page), fixtureBc, 'j6-fixbc');

      await openMapInGcpsTab(page, seeded.uid);
      await page.getByTestId('map-edit-estimate-crs').click();
      await expect(page.getByTestId('crs-panel-candidates')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('crs-setup-card-B')).toContainText('推奨');
      await expect(page.getByTestId('crs-setup-card-C')).toContainText('推奨');

      // 比較プレビュー B を選ぶと降格プレビュー注意が出る
      await page.getByTestId('crs-preview-mode-B').click();
      await expect(page.getByTestId('crs-panel-preview-fallback')).toBeVisible({ timeout: 20_000 });

      // 推奨採用（borderline 先頭は B）-> 実生成で境界反転により C へ自動降格＋操作診断通知
      await page.getByTestId('crs-adopt-recommended').click();
      await expect.poll(() => page.evaluate(() => {
        const d = (window as any).testDebug.tinDiagnostics.value.main;
        return d ? {
          requestedOuterTransform: d.requestedOuterTransform,
          outerTransform: d.outerTransform,
          fallbackReason: d.fallbackReason,
        } : null;
      }), { timeout: 20_000 }).toEqual({
        requestedOuterTransform: fixtureBc.expectedAdoption.requestedOuterTransform,
        outerTransform: fixtureBc.expectedAdoption.outerTransform,
        fallbackReason: fixtureBc.expectedAdoption.fallbackReason,
      });
      await expect(page.getByTestId('map-crs-diagnostics')).toBeVisible();
      await expect(page.getByTestId('map-crs-diagnostics')).toContainText('外挿');

      await expect.poll(() => page.evaluate(() => (window as any).testDebug.saveMapAfterConfirm())).toBe(true);
      const stored = await page.evaluate((id) => window.mapedit.request(id), seeded.uid);
      expect(stored.compiled.outerTransform).toBe('extrapolate');
      expect(stored.worldFile).toBeUndefined();
      await verifySavedKnownPixels(stored, fixtureBc);

      await page.reload();
      await expect.poll(() => page.evaluate(() => (window as any).testDebug?.layerTransformIntents.value.main?.setup), { timeout: 20_000 })
        .toBe(fixtureBc.expectedAdoption.persistedSetupOnReopen);
    } finally {
      await quitElectronApplication(app);
      await rm(e2eRoot, { recursive: true, force: true });
    }
  });

  test('4. Fixture Non-3857（乗り換え推奨・B 採用・GCP 編集・実 UI 搬出 ZIP 検査・別 slug 取込で座標ドリフトなし）', async () => {
    test.setTimeout(300_000);
    const scratch = path.join(projectRoot, '.tmp-smoke');
    await mkdir(scratch, { recursive: true });
    const e2eRoot = await mkdtemp(path.join(scratch, 'j6-t5-non3857-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await page.route(/^https?:/, (route) => route.abort());
      await stubMessageBoxAutoOk(app);
      const fixtureNon = await loadFixture('fixture-non3857.json');
      const seeded = await seedFixtureMap(page, await saveFolderOf(page), fixtureNon, 'j6-non3857');

      await openMapInGcpsTab(page, seeded.uid);
      await page.getByTestId('map-edit-estimate-crs').click();
      await expect(page.getByTestId('crs-panel-candidates')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('crs-panel-candidate-row-' + fixtureNon.estimation.selectedId)).toBeVisible();
      await expect(page.getByTestId('crs-panel-comparison')).toContainText(fixtureNon.estimation.selectedId);

      // 非 3857 CRS + Setup B を選択して採用し既知点変換を検証
      await expect(page.getByTestId('crs-adopt-recommended')).toBeEnabled();
      await page.getByTestId('crs-setup-card-B').click();
      await page.getByTestId('crs-adopt-button').click();
      await expect.poll(() => page.evaluate(() => ({
        setup: (window as any).testDebug.layerTransformIntents.value.main?.setup,
        epsg: (window as any).testDebug.mapData.value?.crs?.epsg,
        outer: (window as any).testDebug.tinDiagnostics.value.main?.outerTransform,
      })), { timeout: 20_000 }).toEqual({
        setup: 'B',
        epsg: fixtureNon.expectedAdoption.crs.epsg,
        outer: 'worldFile',
      });
      await expect.poll(() => page.evaluate(() => (window as any).testDebug.saveMapAfterConfirm())).toBe(true);
      const beforeEditDoc = await page.evaluate((id) => window.mapedit.request(id), seeded.uid);
      await verifySavedKnownPixels(beforeEditDoc, fixtureNon);

      // 非 3857 のまま内点 GCP (#4) を実 UI ドラッグで編集して保存
      await page.getByTestId('crs-panel-close').click();
      const origGcp4Crs = beforeEditDoc.gcps[4][1] as [number, number];
      const nudgedCrs: [number, number] = [origGcp4Crs[0] + 12000, origGcp4Crs[1] - 10000];
      const nudgedMerc = proj4(proj4StringOf(fixtureNon.expectedAdoption.crs), 'EPSG:3857', nudgedCrs) as [number, number];
      const histBeforeEdit = await page.evaluate(() => (window as any).testDebug.historyDebug().length);
      await dragMercGcpMarker(page, 4, nudgedMerc);
      await expect.poll(() => page.evaluate(() => (window as any).testDebug.historyDebug().length), { timeout: 15_000 })
        .toBe(histBeforeEdit + 1);
      await expect.poll(() => page.evaluate(() => (window as any).testDebug.saveMapAfterConfirm()), { timeout: 20_000 })
        .toBe(true);
      const editedDoc = await page.evaluate((id) => window.mapedit.request(id), seeded.uid);
      expect(editedDoc.crs.epsg).toBe(fixtureNon.expectedAdoption.crs.epsg);
      expect(editedDoc.compiled.outerTransform).toBe('worldFile');
      expect(Math.hypot(editedDoc.gcps[4][1][0] - origGcp4Crs[0], editedDoc.gcps[4][1][1] - origGcp4Crs[1])).toBeGreaterThan(50);

      // 実 UI 搬出
      const zipPath = path.join(e2eRoot, 'non3857-export.zip');
      await evalMain(app, async ({ dialog }, outZip) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: outZip })) as typeof dialog.showSaveDialog;
      }, zipPath);
      await page.locator('[data-editor-action=export]').click();
      await page.getByTestId('map-export-options-confirm').click();
      await expect(page.locator('[data-editor-busy-overlay]')).toBeHidden({ timeout: 120_000 });

      const { default: AdmZip } = await import('adm-zip');
      const zip = new AdmZip(zipPath);
      const exportedJson = JSON.parse(zip.getEntry(`maps/${seeded.slug}.json`)!.getData().toString('utf8'));
      expect(exportedJson.crs).toEqual(editedDoc.crs);
      expect(exportedJson.compiled.outerTransform).toBe('worldFile');
      expect(exportedJson.compiled.worldFile).toBeTruthy();
      expect(exportedJson.gcps).toBeUndefined();
      expect(exportedJson.compiled.points).toEqual(editedDoc.compiled.points);

      // 別 slug へ書き換えて実 UI インポートし、座標ドリフトが無いことを検証
      const copySlug = `${seeded.slug}-copy`;
      const copyZip = path.join(e2eRoot, 'non3857-copy.zip');
      await rewriteZipSlug(zipPath, copyZip, seeded.slug, copySlug);
      await evalMain(app, async ({ dialog }, inZip) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [inZip] })) as typeof dialog.showOpenDialog;
      }, copyZip);
      await openHash(page, '#/maplist');
      const importBtn = page.locator('[data-resource-import]');
      await expect(importBtn).toBeVisible({ timeout: 30_000 });
      await importBtn.click();
      await expect(page.getByText('地図データを正常にインポートできました。')).toBeVisible({ timeout: 120_000 });

      const reimportedDoc = await page.evaluate((slug) => window.mapedit.request(slug), copySlug);
      expect(reimportedDoc.crs).toEqual(editedDoc.crs);
      expect(reimportedDoc.compiled.outerTransform).toBe(editedDoc.compiled.outerTransform);
      expect(reimportedDoc.compiled.worldFile).toEqual(editedDoc.compiled.worldFile);
      expect(reimportedDoc.gcps).toEqual(editedDoc.gcps);
      expect(reimportedDoc.edges).toEqual(editedDoc.edges);

      const mtBefore = new MapTransform();
      await mtBefore.setLayeredMapData({
        main: { kind: 'tin', compiled: editedDoc.compiled, crs: editedDoc.crs, projectionEngine },
        subMaps: [],
      });
      const mtAfter = new MapTransform();
      await mtAfter.setLayeredMapData({
        main: { kind: 'tin', compiled: reimportedDoc.compiled, crs: reimportedDoc.crs, projectionEngine },
        subMaps: [],
      });
      for (const kp of fixtureNon.expectedAdoption.knownPixels) {
        const a = mtBefore.xy2MercWithLayer(kp.pixel)![1];
        const b = mtAfter.xy2MercWithLayer(kp.pixel)![1];
        expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-6);
      }
    } finally {
      await quitElectronApplication(app);
      await rm(e2eRoot, { recursive: true, force: true });
    }
  });
});
