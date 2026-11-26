// 地図の上に重ねる部品（docs/ui-map-overlay-proposal.md 案 A）の振る舞い。
//
//   1. ベースマップの名前と著作権表示（帰属）は利用者の入力・取り込んだデータから来る。
//      OL の帰属表示と ol-layerswitcher のレイヤ名は innerHTML で描く。名前は文字として出し、
//      帰属表示は Core の許可表で安全なリンクだけを通し、危険な要素と属性は除く。
//   2. ベースマップの切り替えの札は、選んだら閉じる・地図を押したら閉じる・Esc で閉じる。
//      札に aria-expanded と今の選択の名前を含む読み上げ名、ラジオに同じ name がある。
import { expect, test, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quitElectronApplication } from './helpers/electronLifecycle';
import { launch } from './helpers/launchIsolated';
import { evalMain } from './helpers/evalMain';

const PROBE_HOST = 'overlay-escape-probe.invalid';
const EVIL_TITLE = `<img src="https://${PROBE_HOST}/title.png" data-evil="title">EVIL_TITLE T1 &amp; T2 & T3`;
const EVIL_ATTR = `<a href="https://example.org/tiles" target="_blank">GSI tile list</a><img src="https://${PROBE_HOST}/attr.png" data-evil="attr">EVIL_ATTR A1 &amp; A2 & A3`;
// 名前は文字表示なので entity 表記を保ち、帰属表示は安全な HTML として entity を解釈する。
const AMP_TITLE = 'T1 &amp; T2 & T3';
const AMP_ATTR = 'A1 & A2 & A3';

async function seedEvilBaseMap(page: Page): Promise<string> {
  return page.evaluate(async ({ title, attr }) => {
    const uid = crypto.randomUUID();
    const result: any = await window.baseMaps.saveUser({
      uid,
      slug: `overlay-escape-${Date.now()}`,
      create: true,
      tms: {
        kind: 'tms', lang: 'ja',
        title: { ja: title, en: title }, label: { ja: title, en: title },
        attr: { ja: attr, en: attr }, dataAttr: {},
        license: 'CC BY 4.0', dataLicense: 'ODbL', licenseNote: {}, dataLicenseNote: {},
        url: 'https://tiles.example.com/{z}/{x}/{y}.png',
        minZoom: 0, maxZoom: 18, thumbnail: '',
        coverageLngLats: null, tileJsonSourceUrl: null, sourceMapUid: null,
        always: true,
      },
    } as any);
    if (!result || result.result !== 'Success') throw new Error(`base map seed failed: ${JSON.stringify(result)}`);
    await (window as any).baseMaps.setAlways(uid, true);
    return uid;
  }, { title: EVIL_TITLE, attr: EVIL_ATTR });
}

async function openPoiEditor(page: Page): Promise<void> {
  const poi = await page.evaluate(async () => {
    const slug = `overlay-poi-${Date.now()}`;
    const created = await window.poiSources.createLocal({ slug, title: { ja: 'POI', en: 'POI' }, lang: 'ja' });
    if (!created || created.result !== 'Success') throw new Error(JSON.stringify(created));
    return created.uid as string;
  });
  await page.evaluate((nextHash) => { location.hash = nextHash; }, `#/poisources/${poi}`);
  await expect(page.locator('.poi-side-pane')).toBeVisible({ timeout: 20_000 });
}

test.describe('地図の上の部品', () => {
  test('帰属表示は安全なリンクを残し、危険な要素を除く。ベースマップ名は文字として出す', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-overlay-escape-'));
    const { app, page } = await launch(e2eRoot);
    const probeRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes(PROBE_HOST)) probeRequests.push(req.url());
    });
    try {
      await page.evaluate(() => window.settings.set('lang', 'ja'));
      await seedEvilBaseMap(page);

      // POI の地図（小窓と同じ utils/overlayBaseMaps の経路）
      await openPoiEditor(page);
      const trigger = page.locator('#poiEditMap .layer-switcher > button');
      await expect(trigger).toBeVisible({ timeout: 20_000 });
      await trigger.click();
      const evilLabel = page.locator('#poiEditMap .layer-switcher .panel li.layer label', { hasText: 'EVIL_TITLE' });
      await expect(evilLabel).toHaveCount(1, { timeout: 20_000 });
      await expect(evilLabel).toContainText('<img');
      await expect(evilLabel).toContainText(AMP_TITLE);
      await evilLabel.click();
      // 選んだ名前が札に出る（textContent なので文字のまま）
      await expect(trigger).toContainText('EVIL_TITLE');
      await expect(trigger).toContainText(AMP_TITLE);
      const attribution = page.locator('[data-testid="map-overlay-tools-poi"] .ol-attribution');
      await expect(attribution).toContainText('EVIL_ATTR', { timeout: 20_000 });
      await expect(attribution.locator('a')).toHaveAttribute('href', 'https://example.org/tiles');
      await expect(attribution.locator('a')).toHaveAttribute('target', '_blank');
      await expect(attribution.locator('a')).toHaveAttribute('rel', 'noopener noreferrer');
      await evalMain(app, ({ shell }) => {
        (globalThis as any).__externalLinkCalls = [];
        shell.openExternal = async (url: string) => { (globalThis as any).__externalLinkCalls.push(url); };
      });
      await attribution.locator('a').click();
      await expect.poll(() => evalMain(app, async () => (globalThis as any).__externalLinkCalls)).toEqual(['https://example.org/tiles']);
      await attribution.evaluate((el) => {
        for (const [scheme, href] of [
          ['http', 'http://example.org/unsafe'],
          ['javascript', 'javascript:alert(1)'],
          ['file', 'file:///etc/passwd'],
          ['data', 'data:text/html,<script>alert(1)</script>'],
        ]) {
          const link = document.createElement('a');
          link.id = `unsafe-${scheme}`;
          link.href = href;
          link.textContent = scheme;
          el.appendChild(link);
        }
      });
      for (const scheme of ['http', 'javascript', 'file', 'data']) await attribution.locator(`#unsafe-${scheme}`).click();
      await expect.poll(() => evalMain(app, async () => (globalThis as any).__externalLinkCalls)).toEqual(['https://example.org/tiles']);
      // 出典の欄を介さず IPC に直接渡しても、https: 以外と壊れた値は開かない
      for (const value of [
        'http://example.org/unsafe',
        'javascript:alert(1)',
        'file:///etc/passwd',
        'data:text/html,<script>alert(1)</script>',
        ':::: not a url',
      ]) {
        expect(await page.evaluate((v) => window.externalLinks?.openHttps(v), value)).toBe(false);
      }
      await expect.poll(() => evalMain(app, async () => (globalThis as any).__externalLinkCalls)).toEqual(['https://example.org/tiles']);
      // 開くのは検証した後の正規化済みの URL
      expect(await page.evaluate(() => window.externalLinks?.openHttps('HTTPS://Example.org/tiles'))).toBe(true);
      await expect.poll(() => evalMain(app, async () => (globalThis as any).__externalLinkCalls)).toEqual(['https://example.org/tiles', 'https://example.org/tiles']);
      await expect(attribution).not.toContainText('<img');
      await expect(attribution).toContainText(AMP_ATTR);
      expect(await page.locator('[data-evil]').count()).toBe(0);

      // MapEdit のベースマップ（setupBaseMaps の経路）
      await page.evaluate((nextHash) => { location.hash = nextHash; }, '#/mapedit?new=1');
      await expect(page.getByTestId('map-tab-settings')).toBeVisible({ timeout: 30_000 });
      const mercTrigger = page.locator('#mercMap .layer-switcher > button');
      await expect(mercTrigger).toBeAttached({ timeout: 30_000 });
      // setupBaseMaps がベースマップのグループを載せ終わるのを待つ
      await expect.poll(() => page.evaluate(() => {
        const map = (window as any).testDebug?.mercMapInfo?.()?.map;
        const root = map?.getLayers?.()?.item?.(0);
        const layers = root?.get?.('layers') || root?.getLayers?.();
        return layers?.getArray ? layers.getArray().filter((layer: any) => String(layer.get('title') || '').includes('EVIL_TITLE')).length : 0;
      }), { timeout: 30_000 }).toBe(1);
      await page.evaluate(() => {
        const map = (window as any).testDebug.mercMapInfo().map;
        const ctrl = map.getControls().getArray().find((c: any) => c.element?.classList?.contains('layer-switcher'));
        ctrl.hidePanel();
        ctrl.showPanel();
        const root = map.getLayers().item(0);
        const layers = root?.get?.('layers') || root?.getLayers?.();
        layers.getArray().forEach((layer: any) => layer.setVisible(String(layer.get('title') || '').includes('EVIL_TITLE')));
      });
      await expect(page.locator('#mercMap .layer-switcher .panel li.layer label', { hasText: 'EVIL_TITLE' })).toContainText('<img');
      // 新規の地図は GCP のタブが開けず merc の地図が描かれない（帰属表示も更新されない）ので、
      // 源に載った帰属（OL の帰属表示が innerHTML に入れる値）を直接見る
      const mercAttributions = await page.evaluate(() => {
        const map = (window as any).testDebug.mercMapInfo().map;
        const root = map.getLayers().item(0);
        const layers = root?.get?.('layers') || root?.getLayers?.();
        const evil = layers.getArray().find((layer: any) => String(layer.get('title') || '').includes('EVIL_TITLE'));
        const getter = evil?.getSource?.()?.getAttributions?.();
        return getter ? getter({}) : null;
      });
      expect(mercAttributions).toHaveLength(1);
      expect(mercAttributions[0]).toContain('<a href="https://example.org/tiles" target="_blank" rel="noopener noreferrer">GSI tile list</a>');
      expect(mercAttributions[0]).not.toContain('<img');
      expect(await page.locator('[data-evil]').count()).toBe(0);

      await page.waitForTimeout(1_000);
      expect(probeRequests).toEqual([]);
    } finally {
      await quitElectronApplication(app);
    }
  });

  test('ベースマップの切り替えの札は、選ぶ・地図を押す・Esc で閉じ、読み上げ名に今の選択を含む', async () => {
    test.setTimeout(180_000);
    const e2eRoot = await mkdtemp(path.join(os.tmpdir(), 'maplat-overlay-switcher-'));
    const { app, page } = await launch(e2eRoot);
    try {
      await page.evaluate(() => window.settings.set('lang', 'ja'));
      await openPoiEditor(page);
      const trigger = page.locator('#poiEditMap .layer-switcher > button');
      const control = page.locator('#poiEditMap .layer-switcher');
      const radios = page.locator('#poiEditMap .layer-switcher .panel input[type=radio]');
      await expect(trigger).toBeVisible({ timeout: 20_000 });

      // 読み上げ名と title に今の選択の名前を含む
      const currentName = (await trigger.textContent())?.trim() ?? '';
      expect(currentName).not.toBe('');
      await expect(trigger).toHaveAttribute('aria-label', new RegExp(currentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      await expect(trigger).toHaveAttribute('title', new RegExp(currentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

      // 開く → ラジオは同じ name を持つ
      await trigger.click();
      await expect(control).toHaveClass(/shown/);
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expect(radios).toHaveCount(3, { timeout: 20_000 });
      const names = await radios.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).name));
      expect(names[0]).not.toBe('');
      expect(new Set(names).size).toBe(1);

      // 矢印キーで選び直しても開いたまま、フォーカスは選んだラジオに残る
      await page.locator('#poiEditMap .layer-switcher .panel input[type=radio]:checked').focus();
      await page.keyboard.press('ArrowDown');
      await expect(control).toHaveClass(/shown/);
      const focusedIsRadio = await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type === 'radio'
        && !!document.activeElement?.closest('#poiEditMap .layer-switcher'));
      expect(focusedIsRadio).toBe(true);
      const afterArrow = (await trigger.textContent())?.trim() ?? '';
      expect(afterArrow).not.toBe(currentName);

      // Esc で閉じ、フォーカスは札へ戻る
      await page.keyboard.press('Escape');
      await expect(control).not.toHaveClass(/shown/);
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(trigger).toBeFocused();

      // ポインタで選ぶと閉じ、札の名前が変わる
      await trigger.click();
      await expect(control).toHaveClass(/shown/);
      const unchecked = page.locator('#poiEditMap .layer-switcher .panel li.layer').filter({ has: page.locator('input[type=radio]:not(:checked)') }).first();
      const pickedName = ((await unchecked.locator('label').textContent()) ?? '').trim();
      await unchecked.locator('label').click();
      await expect(control).not.toHaveClass(/shown/);
      await expect(trigger).toContainText(pickedName);

      // 地図を押すと閉じる
      await trigger.click();
      await expect(control).toHaveClass(/shown/);
      const box = await page.locator('#poiEditMap').boundingBox();
      if (!box) throw new Error('no map box');
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(control).not.toHaveClass(/shown/);
    } finally {
      await quitElectronApplication(app);
    }
  });
});
