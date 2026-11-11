import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';
import { listIiifCanvases, proposeIiifBindings } from '@maplat/core/src/iiif/manifest';
import { verdictOf } from '../src/utils/iiifImportVerdict';
import {
  applyIiifValues, applyIiifRecopy, copyIiifMetadata, copyIiifForMap,
  fetchIiifCopyReply, planIiifRecopy,
} from '../src/utils/iiifMetadataCopy';

const directory = path.resolve('tests/fixtures/iiif/real');
const read = (file) => JSON.parse(readFileSync(path.join(directory, file), 'utf8'));
const cases = read('cases.json');
const options = { sanitize: (html) => html, now: () => new Date('2026-11-11T00:00:00Z') };

for (const { id, expected: e } of cases) {
  const manifest = read(id + '.manifest.json');
  const info = read(id + '.info.json');
  const source = read(id + '.source.json');
  const reply = { ok: true, json: manifest };
  const facts = {
    requestedUrl: source.infoUrl,
    finalUrl: source.infoFinalUrl,
    accessControlAllowOrigin: source.infoResponseHeaders['access-control-allow-origin'],
    infoJson: info,
  };
  const copiedMap = () => {
    const copy = copyIiifMetadata(manifest, e.canvasId, e.lang, options);
    assert.equal(copy.ok, true);
    return {
      ...applyIiifValues({}, copy.values, e.lang),
      lang: e.lang,
      ...e.imageSize,
      iiif: { manifest: source.manifestUrl, canvas: e.canvasId, bindings: copy.bindings, copiedValues: copy.copiedValues },
    };
  };

  test(id + ': 出典と原文のバイト列', () => {
    for (const suffix of ['manifest', 'info']) {
      assert.equal(createHash('sha256').update(readFileSync(path.join(directory, id + '.' + suffix + '.json'))).digest('hex'), source.sha256[suffix]);
    }
    assert.equal(source.retrievedOn, '2026-11-11');
    assert.ok(source.terms && source.termsUrl);
  });

  test(id + ': canvas 数と Manifest の題名を初回の書誌へ写す', () => {
    const listed = listIiifCanvases(manifest);
    assert.equal(listed.ok, true);
    assert.equal(listed.version, e.version);
    assert.equal(listed.canvases.length, e.canvasCount);
    const canvas = listed.canvases[e.canvasIndex];
    assert.equal(canvas.id, e.canvasId);
    assert.deepEqual({ width: canvas.width, height: canvas.height }, e.canvasSize);
    // TODO(core): 固定 Core 8ed4d85 は v3 内の @id を読めない。合流後にこの分岐を外す。
    assert.equal(canvas.imageService, e.requiresCoreServiceFix ? undefined : e.imageService);
    assert.deepEqual(proposeIiifBindings(manifest, canvas.id).title, { from: 'manifest', property: 'label' });
    const copy = copyIiifMetadata(manifest, canvas.id, e.lang, options);
    assert.equal(copy.ok, true);
    assert.deepEqual(copy.values.title, e.titleValue);
    assert.deepEqual(copy.copiedValues.title, { [e.lang]: e.title });
    assert.deepEqual(Object.keys(copy.bindings).sort(), [...e.bindingKeys].sort());
    assert.equal(copy.values.license, e.license ?? undefined);
    assert.equal(copy.copiedMetadata.length, e.metadataCount);
    if (e.firstMetadata) assert.deepEqual(copy.copiedMetadata[0], e.firstMetadata);
    assert.equal(copy.copiedAt, '2026-11-11T00:00:00.000Z');
    assert.equal(copiedMap().title, e.title);
  });

  test(id + ': 保存した info.json と CORS による取り込み判定', () => {
    assert.deepEqual({ width: info.width, height: info.height }, e.imageSize);
    // 初回取り込みは canvas の寸法を expected に渡さない（ダイアログと同じ入口）。
    const verdict = verdictOf({ facts });
    assert.equal(verdict.kind, e.verdict.kind);
    if (e.verdict.kind === 'metadata-only') {
      assert.deepEqual(verdict, { ...e.verdict, message: 'iiif_import.reason.' + e.verdict.reason });
    } else {
      assert.equal(verdict.info.version, e.imageVersion);
      assert.equal(verdict.info.level, e.level);
      assert.equal(verdict.info.tiling, 'arbitrary');
      assert.deepEqual({ width: verdict.info.width, height: verdict.info.height }, e.imageSize);
    }
    assert.deepEqual(verdictOf({ facts, expected: { ...e.imageSize, width: e.imageSize.width + 1 } }), {
      kind: 'metadata-only', reason: 'size-mismatch', message: 'iiif_import.reason.size-mismatch',
    });
  });

  test(id + ': 書誌だけの地図はサービス解決に依存せず写し直せる', async () => {
    const map = copiedMap();
    assert.equal(await fetchIiifCopyReply(reply, map, () => { throw new Error('書誌だけなら inspect しない'); }), reply);
    const copied = copyIiifForMap(reply, map, options);
    assert.equal(copied.ok, true);
    assert.deepEqual(copied.values.title, e.titleValue);
    const plan = planIiifRecopy(reply, map, options);
    assert.equal(plan.ok, true);
    assert.ok(plan.rows.length > 0);
    assert.ok(plan.rows.every(row => row.reason === 'unchanged'));
    assert.deepEqual(plan.rows.find(row => row.key === 'title'), {
      key: 'title', lang: e.lang, reason: 'unchanged', current: e.title, copied: e.title, next: e.title,
    });
  });

  test(id + ': 題名の写し直しの 4 理由と選択反映', () => {
    for (const [human, changed, reason] of [[false, false, 'unchanged'], [true, false, 'human-edited'], [false, true, 'iiif-changed'], [true, true, 'both']]) {
      const map = copiedMap();
      if (human) map.title = '人が編集した題名';
      const incoming = structuredClone(manifest);
      if (changed) incoming.label = e.version === '2' ? '改訂された題名' : { [e.lang]: ['改訂された題名'] };
      const original = structuredClone(map);
      const plan = planIiifRecopy({ ok: true, json: incoming }, map, options);
      assert.equal(plan.ok, true);
      assert.deepEqual(plan.rows.find(row => row.key === 'title'), {
        key: 'title', lang: e.lang, reason,
        current: human ? '人が編集した題名' : e.title,
        copied: e.title, next: changed ? '改訂された題名' : e.title,
      });
      assert.deepEqual(applyIiifRecopy(map, plan, [], options), map);
      assert.equal(applyIiifRecopy(map, plan, [{ key: 'title', lang: e.lang }], options).title, changed ? '改訂された題名' : e.title);
      assert.deepEqual(map, original);
    }
  });

  test(id + ': 配信画像の大きさを取得して書誌と写し直しに渡す', async () => {
    const map = { ...copiedMap(), delivery: { kind: 'iiif' } };
    const calls = [];
    const result = await fetchIiifCopyReply(reply, map, async args => {
      calls.push(args.serviceUrl);
      return { ok: true, json: info };
    });
    if (e.requiresCoreServiceFix) {
      // TODO(core): 本番の固定 Core で起きる失敗を明示。予期しない失敗を成功扱いしない。
      assert.deepEqual(result, { ok: false, reason: 'image-service-unavailable' });
      assert.deepEqual(calls, []);
      return;
    }
    assert.deepEqual(calls, [e.imageService]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.imageSize, e.imageSize);
    assert.equal(copyIiifForMap(result, map, options).ok, true);
    const plan = planIiifRecopy(result, map, options);
    assert.equal(plan.ok, true);
    assert.ok(plan.rows.every(row => row.reason === 'unchanged'));
  });

  test(id + ': 仮の canvas 寸法が実画素数の照合に混入しない', async () => {
    const placeholder = structuredClone(manifest);
    const canvas = e.version === '2' ? placeholder.sequences[0].canvases[e.canvasIndex] : placeholder.items[e.canvasIndex];
    canvas.width = 6000;
    canvas.height = 6000;
    const map = { ...copiedMap(), delivery: { kind: 'iiif' } };
    // 取得済み info.json が渡されたあとの経路は、固定 Core でも全件検査する。
    const measured = { ok: true, json: placeholder, imageSize: e.imageSize };
    assert.equal(copyIiifForMap(measured, map, options).ok, true);
    assert.equal(planIiifRecopy(measured, map, options).ok, true);
    const wrongMap = { ...map, width: 6000, height: 6000 };
    assert.deepEqual(copyIiifForMap(measured, wrongMap, options), { ok: false, reason: 'size-mismatch', warnings: [] });
    assert.deepEqual(planIiifRecopy(measured, wrongMap, options), { ok: false, reason: 'size-mismatch' });
    assert.deepEqual(planIiifRecopy(reply, map, options), { ok: false, reason: 'image-service-unavailable' });
    assert.deepEqual(copyIiifForMap(reply, map, options), { ok: false, reason: 'image-service-unavailable', warnings: [] });
  });

  test(id + ': 画像サービスの取得失敗で写しを止める', async () => {
    const map = { ...copiedMap(), delivery: { kind: 'iiif' } };
    const failed = await fetchIiifCopyReply(reply, map, async () => { throw new Error('取得に失敗'); });
    assert.deepEqual(failed, { ok: false, reason: 'image-service-unavailable' });
    assert.deepEqual(copyIiifForMap(failed, map, options), { ok: false, reason: 'image-service-unavailable', warnings: [] });
    assert.deepEqual(planIiifRecopy(failed, map, options), { ok: false, reason: 'image-service-unavailable' });
  });
}

// TODO(core): Core 合流・固定更新後に skip と上の互換分岐を同時に外す。
test('Wellcome: 修正後の Core は @id のサービスから実画素数を取得する', { skip: 'TODO(core): Core の修正合流と Editor の固定更新を待つ' }, async () => {
  const e = cases.find(item => item.id === 'wellcome').expected;
  const result = await fetchIiifCopyReply(
    { ok: true, json: read('wellcome.manifest.json') },
    { delivery: { kind: 'iiif' }, iiif: { canvas: e.canvasId } },
    async ({ serviceUrl }) => {
      assert.equal(serviceUrl, e.imageService);
      return { ok: true, json: read('wellcome.info.json') };
    },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.imageSize, e.imageSize);
});
