// m6-t10 スモーク: マスタ由来ソースの差分保持ストレージモデルと出力文法の刷新。
// タスク設計 `docs/superpowers/specs/2026-08-07-m6-t10-app-source-diff-model-design.md` §6 準拠。
//
// 対象 AC: AC1(出力形) / AC2(設定ファイル) / AC3(マージ順) / AC4(マスタ欠落) / AC5(旧形移行)
//          AC6(overlay 保全) / AC19(builtin の url) / AC21(commonOptions 禁止キー)
//          AC23(merc の url 導出) / AC24(言語別の上書き粒度)
// AC7（操作子と定数の一致）は AppSourceEditor.vue のソーステキストを読むため本 smoke の末尾で扱う。
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm6-t10-diff-model-'));
const outDir = path.join(workDir, 'dist');

try {
  await build({
    root: projectRoot,
    logLevel: 'error',
    configFile: false,
    build: {
      outDir,
      emptyOutDir: true,
      lib: {
        entry: path.join(projectRoot, 'src/utils/appSourceModel.ts'),
        formats: ['es'],
        fileName: () => 'appSourceModel.mjs',
      },
      rollupOptions: { external: [] },
    },
  });

  const mod = await import(pathToFileURL(path.join(outDir, 'appSourceModel.mjs')).href);
  const {
    normalizeAppSource,
    composeViewerSource,
    composeBaseMapSettingFile,
    resolveAppSource,
    createAppSourceFromBaseMap,
    extractMercSourceRefs,
    APP_SOURCE_OVERRIDABLE_KEYS,
    APP_SOURCE_OWNED_KEYS,
    COMMON_OPTION_KEYS,
  } = mod;

  // ---- テスト用マスタ（base_maps.data_json 相当の生データ）----
  const MASTERS = [
    {
      uid: 'uid-osm', mapID: 'osm', scope: 'builtin',
      data: {
        mapID: 'osm', builtinId: 'osm', always: true, lang: 'en',
        title: { en: 'OpenStreetMap', ja: 'オープンストリートマップ' },
        label: { en: 'OSM(Now)', ja: 'OSM(現在)' },
        attr: '©︎ OpenStreetMap contributors',
        license: 'Custom', dataLicense: 'ODbL',
        licenseNote: { en: 'OSM copyright', ja: 'OSM 著作権' },
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        minZoom: 0, maxZoom: 19,
        thumbnail: 'basemap_icons/osm.jpg', thumbnail512: 'basemap_icons/osm_512.jpg',
      },
    },
    {
      uid: 'uid-tms', mapID: 'user-tms', scope: 'user',
      data: {
        mapID: 'user-tms', lang: 'ja', kind: 'tms',
        title: { ja: 'ユーザ地図', en: 'User Map' },
        label: { ja: 'ユーザ' },
        attr: { ja: '作者' },
        dataAttr: { ja: 'データ作者' },
        license: 'CC BY', dataLicense: 'ODbL',
        licenseNote: { ja: '補足' }, dataLicenseNote: { ja: 'データ補足' },
        url: 'https://tiles.example.test/{z}/{x}/{y}.png',
        minZoom: 5, maxZoom: 18,
        thumbnail: 'tmbs/uid-tms.png',
        coverageLngLats: [[130, 32], [131, 32], [131, 33], [130, 33]],
        tileJsonSourceUrl: 'https://f.test/tiles.json',
        tileSize: 512,
      },
    },
    {
      uid: 'uid-merc', mapID: 'merc-nobeoka', scope: 'user',
      data: {
        mapID: 'merc-nobeoka', lang: 'ja', kind: 'merc',
        title: { ja: 'メルカトル延岡' }, label: { ja: '延岡' }, attr: { ja: '作者' },
        license: '', dataLicense: '', licenseNote: {}, dataLicenseNote: {},
        url: '', // ← merc マスタは url を空文字で保存する（実データ実測）
        minZoom: 10, maxZoom: 17, thumbnail: 'tmbs/uid-merc.png',
        sourceMapUid: 'uid-source-map',
      },
    },
    {
      uid: 'uid-google', mapID: 'google-sat', scope: 'user',
      data: {
        mapID: 'google-sat', lang: 'ja', kind: 'google', maptype: 'google_satellite',
        title: { ja: 'Google 衛星' }, label: { ja: 'Google' }, attr: { ja: 'Google' },
        license: '', dataLicense: '', url: '', minZoom: 0, maxZoom: 20,
        thumbnail: 'basemap_icons/google.png',
      },
    },
    {
      uid: 'uid-overlay', mapID: 'legacy-overlay', scope: 'user',
      data: {
        mapID: 'legacy-overlay', lang: 'ja', maptype: 'overlay',
        title: { ja: '重ね地図' }, label: { ja: '重ね' }, attr: { ja: '作者' },
        url: 'https://ov.example.test/{z}/{x}/{y}.png', minZoom: 8, maxZoom: 16,
        thumbnail: 'tmbs/uid-overlay.png',
      },
    },
  ];

  const lookup = {
    byUid: (uid) => MASTERS.find((m) => m.uid === uid),
    bySlug: (slug) => MASTERS.find((m) => m.mapID === slug),
  };

  // ============ AC1: composeViewerSource の出力形 ============
  {
    const source = {
      sourceType: 'tms', mapUid: 'user-tms', baseMapUid: 'uid-tms', role: 'base',
      overrides: { maxZoom: 17 },
    };
    const out = composeViewerSource(source, { lang: 'ja', lookup });
    assert.equal(out.mapID, 'user-tms', 'AC1: mapID は slug');
    assert.equal(out.settingFile, 'maps/user-tms.json', 'AC1: settingFile を出す');
    assert.equal(out.maxZoom, 17, 'AC1: 上書きを出す');
    assert.equal('maptype' in out, false, 'AC1: maptype を出してはならない（source_ex.ts:126 が先に成立してしまう）');
    assert.equal('url' in out, false, 'AC1: マスタ由来値はアプリ JSON に出さない');
    assert.equal('license' in out, false, 'AC1: マスタ由来値はアプリ JSON に出さない');
    console.log('ok: AC1 tms の出力形');
  }
  {
    // builtin も同じ形（文字列出力の廃止 = ADR-0017）
    const source = { sourceType: 'builtin', mapUid: 'osm', baseMapUid: 'uid-osm', role: 'base' };
    const out = composeViewerSource(source, { lang: 'ja', lookup });
    assert.equal(typeof out, 'object', 'AC1: builtin も文字列ではなくオブジェクト');
    assert.equal(out.mapID, 'osm');
    assert.equal(out.settingFile, 'maps/osm.json');
    assert.equal('maptype' in out, false);
    console.log('ok: AC1 builtin の出力形（文字列出力の廃止）');
  }
  {
    // maplat ソースは従来どおり（本タスクの対象外）
    const source = { sourceType: 'maplat', mapUid: 'map-uid', role: 'maplat', label: { ja: '古地図' } };
    const out = composeViewerSource(source, { lang: 'ja', settingFilePrefix: 'maps/', maplatMapID: 'furuchizu' });
    assert.equal(out.mapID, 'furuchizu');
    assert.equal(out.maptype, 'maplat', 'maplat だけは maptype を出す（WMTS 判定に該当せず settingFile 経路へ落ちる）');
    assert.equal(out.settingFile, 'maps/furuchizu.json');
    console.log('ok: AC1 maplat は従来どおり');
  }

  // ============ AC2 / AC21: composeBaseMapSettingFile ============
  {
    const master = lookup.bySlug('user-tms');
    const settingFile = composeBaseMapSettingFile(master, 'base', { lang: 'ja' });
    assert.equal(settingFile.mapID, 'user-tms');
    assert.equal(settingFile.maptype, 'base', 'AC2: tms は base');
    assert.equal(settingFile.url, 'https://tiles.example.test/{z}/{x}/{y}.png');
    assert.equal(settingFile.minZoom, 5);
    assert.equal(settingFile.maxZoom, 18);
    // ADR-0005 の交換形: 既定言語（マスタの lang='ja'）のみの言語オブジェクトは平文へ畳む
    assert.equal(settingFile.label, 'ユーザ', 'AC2: label を設定ファイル側に出す（§3.5.2・交換形）');
    assert.deepEqual(settingFile.title, { ja: 'ユーザ地図', en: 'User Map' },
      'AC2: 複数言語を持つフィールドは言語オブジェクトのまま（viewer 側 ui.translate が解決する）');
    assert.equal(settingFile.lang, 'ja', 'AC2: 交換形を解釈するための既定言語を同梱する');
    assert.equal(settingFile.license, 'CC BY');
    assert.equal(settingFile.dataLicense, 'ODbL');
    // EDITOR_ONLY / エディタ専用メタデータは出さない
    for (const key of ['kind', 'coverageLngLats', 'tileJsonSourceUrl', 'sourceMapUid', 'always', 'builtinId', 'baseMapUid']) {
      assert.equal(key in settingFile, false, `AC2: ${key} を設定ファイルへ出してはならない`);
    }
    // マスタが持つ未知キーは温存する（BaseMapEditDocument の型より広い実データ）
    assert.equal(settingFile.tileSize, 512, 'AC2: 型に無いマスタキー（tileSize）も運ぶ');
    // AC21: commonOptions の9キーは1つも出さない
    for (const key of COMMON_OPTION_KEYS) {
      assert.equal(key in settingFile, false, `AC21: commonOptions のキー ${key} を出してはならない`);
    }
    console.log('ok: AC2 / AC21 設定ファイルの中身と禁止キー');
  }

  // ============ AC6: role=overlay の保全 ============
  {
    const master = lookup.bySlug('legacy-overlay');
    const settingFile = composeBaseMapSettingFile(master, 'overlay', { lang: 'ja' });
    assert.equal(settingFile.maptype, 'overlay', 'AC6: role=overlay は設定ファイル側 maptype=overlay で保全する');
    console.log('ok: AC6 overlay の保全');
  }

  // ============ AC2(続き): provider の maptype 優先 ============
  {
    const master = lookup.bySlug('google-sat');
    const settingFile = composeBaseMapSettingFile(master, 'overlay', { lang: 'ja' });
    assert.equal(settingFile.maptype, 'google_satellite', '§3.5.1: provider は role より優先する');
    assert.equal('url' in settingFile, false, '§3.5.4: provider は url を出さない');
    console.log('ok: §3.5.1 provider の maptype 優先');
  }

  // ============ AC23: merc の url 導出 ============
  {
    const master = lookup.bySlug('merc-nobeoka');
    const settingFile = composeBaseMapSettingFile(master, 'base', { lang: 'ja' });
    assert.equal(settingFile.url, 'merc/merc-nobeoka/{z}/{x}/{y}.png',
      'AC23: merc はマスタの現在 slug から url を導出する（マスタは url を空文字で持つ）');
    assert.equal(settingFile.maptype, 'base');
    console.log('ok: AC23 merc の url 導出');
  }
  {
    // extractMercSourceRefs はマスタ lookup 依存の新シグネチャ（§4.2）
    const sources = [
      { sourceType: 'tms', mapUid: 'merc-nobeoka', baseMapUid: 'uid-merc', role: 'base', overrides: {} },
      { sourceType: 'tms', mapUid: 'user-tms', baseMapUid: 'uid-tms', role: 'base', overrides: {} },
    ];
    const refs = extractMercSourceRefs(sources, lookup);
    assert.equal(refs.length, 1, 'AC23: merc ソースだけを抽出する');
    assert.equal(refs[0].baseMapUid, 'uid-merc');
    assert.equal(refs[0].dirName, 'merc-nobeoka', 'AC23: dirName はマスタの現在 slug');
    console.log('ok: AC23 extractMercSourceRefs の新シグネチャ');
  }

  // ============ AC19: builtin の url はエディタ側マスタの値 ============
  {
    const master = lookup.bySlug('osm');
    const settingFile = composeBaseMapSettingFile(master, 'base', { lang: 'ja' });
    assert.equal(settingFile.url, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      'AC19: OSM は単一ホスト（OSMF ポリシー準拠形）');
    assert.equal('urls' in settingFile, false, 'AC19: 3ホストローテーションは持たない');
    assert.equal(settingFile.maxZoom, 19);
    console.log('ok: AC19 builtin の url');
  }

  // ============ AC3: resolveAppSource のマージ順 ============
  {
    const source = {
      sourceType: 'tms', mapUid: 'user-tms', baseMapUid: 'uid-tms', role: 'base',
      overrides: { maxZoom: 17, envelopeLngLats: [[130.1, 32.1]] },
    };
    const resolved = resolveAppSource(source, lookup);
    assert.equal(resolved.ok, true);
    assert.equal(resolved.master.uid, 'uid-tms');
    assert.equal(resolved.merged.maxZoom, 17, 'AC3: 上書きが勝つ');
    assert.equal(resolved.merged.minZoom, 5, 'AC3: 未上書きはマスタ値');
    assert.equal(resolved.merged.url, 'https://tiles.example.test/{z}/{x}/{y}.png', 'AC3: マスタが土台');
    assert.deepEqual(resolved.merged.envelopeLngLats, [[130.1, 32.1]], 'AC3: アプリ所有キーも merged に出る');
    // 設計逸脱1の固定: merged は「実効値」であり、label を除外しない。
    // 上書きが無ければマスタの label が残る（MaplatCore 修正後の Object.assign(resp, options) と同型）
    assert.deepEqual(resolved.merged.label, { ja: 'ユーザ' },
      '逸脱1: 未上書きの label は merged にマスタ値として残る（§3.4 の「label を除く」からの意図的逸脱）');
    console.log('ok: AC3 マージ順（マスタ土台 + アプリ上書き）');
  }
  {
    // 設計逸脱1の固定（上書きあり側）: 上書きがあれば上書き値が勝つ
    const source = {
      sourceType: 'tms', mapUid: 'user-tms', baseMapUid: 'uid-tms', role: 'base',
      overrides: {}, label: { ja: 'アプリのラベル' },
    };
    const resolved = resolveAppSource(source, lookup);
    assert.deepEqual(resolved.merged.label, { ja: 'アプリのラベル' },
      '逸脱1: 上書きがあれば merged.label は上書き値');
    console.log('ok: 逸脱1 merged.label のセマンティクス');
  }
  {
    // 解決順: baseMapUid → 無ければ mapUid(slug)。旧形は baseMapUid を持たない
    const legacy = { sourceType: 'tms', mapUid: 'user-tms', role: 'base', overrides: {} };
    const resolved = resolveAppSource(legacy, lookup);
    assert.equal(resolved.ok, true, 'AC3: baseMapUid が無くても slug で解決する');
    assert.equal(resolved.master.uid, 'uid-tms');
    assert.equal(resolved.source.baseMapUid, 'uid-tms', 'AC3: 解決できた時点で baseMapUid を補う');
    console.log('ok: AC3 解決順と baseMapUid の補完');
  }

  // ============ AC4: マスタ欠落 ============
  {
    const orphan = { sourceType: 'tms', mapUid: 'gone', baseMapUid: 'uid-gone', role: 'base', overrides: {} };
    const resolved = resolveAppSource(orphan, lookup);
    assert.equal(resolved.ok, false);
    assert.equal(resolved.reason, 'master-missing');
    console.log('ok: AC4 マスタ欠落');
  }
  {
    // 旧形（baseMapUid 無し）でマスタも引けない場合も同じ結果になる（r2-M-2）
    const orphanLegacy = { sourceType: 'tms', mapUid: 'gone-slug', role: 'base', overrides: {} };
    const resolved = resolveAppSource(orphanLegacy, lookup);
    assert.equal(resolved.ok, false, 'AC4: 旧形でも undefined 照合にならない');
    assert.equal(resolved.reason, 'master-missing');
    console.log('ok: AC4 旧形のマスタ欠落');
  }

  // ============ AC5: 旧形（data 全コピー）の移行 ============
  {
    // 旧保存形: data にマスタ全コピー。title は手で直してあり、maxZoom はマスタと同値
    const legacyRaw = {
      sourceType: 'tms', mapUid: 'user-tms', role: 'base', startFrom: true,
      label: { ja: 'ユーザ' }, // ← マスタと同値なので上書きにしない
      data: {
        mapID: 'user-tms', lang: 'ja', kind: 'tms',
        title: { ja: '手で直したタイトル', en: 'User Map' }, // ← マスタと異なる
        attr: { ja: '作者' },                                // ← マスタと同値
        url: 'https://tiles.example.test/{z}/{x}/{y}.png',   // ← 操作子なし。捨てる
        coverageLngLats: [[130, 32]],                        // ← 操作子なし。捨てる
        // v1.4 §3.7.1: 帰属・ライセンス系5キー。**マスタと異なる値**を入れてある
        // （マスタは license 'CC BY' / dataLicense 'ODbL' / dataAttr {ja:'データ作者'}
        //   / licenseNote {ja:'補足'} / dataLicenseNote {ja:'データ補足'}）。
        // これらは v1.4 で上書き可になったが、**移行時だけは無条件に捨てる**。
        // 操作子が無かった時代のコピーはユーザーの選択を含まないため（設計 §3.7.1）
        license: 'PD',
        dataLicense: 'CC0',
        dataAttr: { ja: '古いデータ作者' },
        licenseNote: { ja: '古い補足' },
        dataLicenseNote: { ja: '古いデータ補足' },
        minZoom: 5, maxZoom: 18,                             // ← マスタと同値
        thumbnail: 'tmbs/uid-tms.png',                       // ← マスタと同値
        envelopeLngLats: [[130.5, 32.5]],                    // ← アプリ所有。無条件に温存
      },
    };
    const normalized = normalizeAppSource(legacyRaw, 'ja');
    const migrated = resolveAppSource(normalized, lookup);
    assert.equal(migrated.ok, true);
    const ov = migrated.source.overrides || {};
    assert.deepEqual(ov.title, { ja: '手で直したタイトル', en: 'User Map' }, 'AC5: マスタと異なる値は上書きとして温存');
    assert.equal('attr' in ov, false, 'AC5: マスタと同値なら上書きにしない');
    assert.equal('maxZoom' in ov, false, 'AC5: マスタと同値なら上書きにしない');
    assert.equal('minZoom' in ov, false, 'AC5: マスタと同値なら上書きにしない');
    assert.equal('thumbnail' in ov, false, 'AC5: マスタと同値なら上書きにしない');
    assert.deepEqual(ov.envelopeLngLats, [[130.5, 32.5]], 'AC5: アプリ所有キーは無条件に温存');
    for (const key of ['url', 'coverageLngLats', 'kind', 'mapID', 'lang']) {
      assert.equal(key in ov, false, `AC5: 操作子の無いキー（${key}）は捨てる`);
    }
    // v1.4 §3.7.1: 上書き可になった5キーも、移行時は**マスタと異なっていても**捨てる
    for (const key of ['license', 'dataLicense', 'dataAttr', 'licenseNote', 'dataLicenseNote']) {
      assert.equal(
        key in ov, false,
        `AC5(v1.4 §3.7.1): 帰属・ライセンス系（${key}）は移行時は無条件に捨てる。` +
          `温存すると、操作子が無かった時代の古いコピーが上書きとして固定され、` +
          `マスタ側でライセンス表記を直しても既存アプリへ届かなくなる`,
      );
    }
    assert.equal(migrated.source.label, undefined, 'AC5: label もマスタと同値なら上書きにしない');
    assert.equal(migrated.source.baseMapUid, 'uid-tms', 'AC5: baseMapUid を補う');
    console.log('ok: AC5 旧形の移行（編集UIの有無で二分）');
  }
  {
    // 言語別フィールドの表記ゆれ（プレーン文字列 ⇄ 言語オブジェクト）を吸収して比較する
    const legacyRaw = {
      sourceType: 'builtin', mapUid: 'osm', role: 'base',
      data: {
        mapID: 'osm', builtinId: 'osm', lang: 'en',
        attr: '©︎ OpenStreetMap contributors', // マスタもプレーン文字列。同値
        minZoom: 0, maxZoom: 19,
      },
    };
    const migrated = resolveAppSource(normalizeAppSource(legacyRaw, 'ja'), lookup);
    assert.equal('attr' in (migrated.source.overrides || {}), false,
      'AC5: 交換形のゆれを吸収して同値判定する');
    console.log('ok: AC5 交換形のゆれ吸収');
  }
  {
    // m6-t8 が data.baseMapUid に置いた merc の参照はトップレベルへ昇格する
    const legacyMerc = {
      sourceType: 'tms', mapUid: 'merc-nobeoka', role: 'base',
      data: { mapID: 'merc-nobeoka', kind: 'merc', baseMapUid: 'uid-merc', url: 'merc/merc-nobeoka/{z}/{x}/{y}.png' },
    };
    const normalized = normalizeAppSource(legacyMerc, 'ja');
    assert.equal(normalized.baseMapUid, 'uid-merc', 'AC5: data.baseMapUid をトップレベルへ昇格');
    console.log('ok: AC5 baseMapUid の昇格');
  }

  // ============ AC24: 言語別フィールドの上書き粒度 ============
  {
    // 保存は編集した言語のみ / 出力はマスタとマージした完全な言語オブジェクト
    const source = {
      sourceType: 'tms', mapUid: 'user-tms', baseMapUid: 'uid-tms', role: 'base',
      overrides: { title: { ja: 'アプリ固有タイトル' } }, // ja だけ編集
    };
    const out = composeViewerSource(source, { lang: 'ja', lookup });
    assert.deepEqual(out.title, { ja: 'アプリ固有タイトル', en: 'User Map' },
      'AC24: 出力はマスタの未上書き言語(en)とマージした完全な言語オブジェクト');
    console.log('ok: AC24 言語別の上書き粒度');
  }
  {
    // マスタ側で未上書き言語を修正すると、次回出力に反映される（保存側に持たないため）
    const source = {
      sourceType: 'tms', mapUid: 'user-tms', baseMapUid: 'uid-tms', role: 'base',
      overrides: { title: { ja: 'アプリ固有タイトル' } },
    };
    const patched = {
      byUid: (uid) => {
        const m = lookup.byUid(uid);
        if (!m) return undefined;
        return { ...m, data: { ...m.data, title: { ja: 'ユーザ地図', en: 'Master Renamed' } } };
      },
      bySlug: (slug) => patched.byUid(MASTERS.find((m) => m.mapID === slug)?.uid),
    };
    const out = composeViewerSource(source, { lang: 'ja', lookup: patched });
    assert.equal(out.title.en, 'Master Renamed', 'AC24: マスタの未上書き言語の修正が反映される');
    assert.equal(out.title.ja, 'アプリ固有タイトル', 'AC24: 上書き済み言語はアプリ側が勝つ');
    console.log('ok: AC24 マスタ追随性');
  }
  {
    // 設計逸脱2の固定: 設定ファイルの交換形の畳み込み基準は「その文書の既定言語」＝マスタの lang。
    // アプリの表示言語ではない（別言語のアプリから同じマスタを参照しても設定ファイルの意味が変わらない）。
    const master = lookup.bySlug('osm'); // マスタの lang は 'en'
    const asJa = composeBaseMapSettingFile(master, 'base', { lang: 'ja' });
    const asEn = composeBaseMapSettingFile(master, 'base', { lang: 'en' });
    assert.deepEqual(asJa, asEn,
      '逸脱2: 設定ファイルの内容はアプリの表示言語に依存しない（畳み込み基準はマスタの lang）');
    // 単一エントリでもマスタの lang と一致しなければ畳まない
    const jaOnlyMaster = {
      uid: 'uid-ja-only', mapID: 'ja-only',
      data: { mapID: 'ja-only', lang: 'en', title: { ja: '日本語だけ' }, attr: 'x', url: 'https://e.test/{z}/{x}/{y}.png' },
    };
    const out = composeBaseMapSettingFile(jaOnlyMaster, 'base', { lang: 'ja' });
    assert.deepEqual(out.title, { ja: '日本語だけ' },
      '逸脱2: 既定言語(en)以外の単一エントリは平文へ畳まない（畳むと既定言語の値だと誤読される）');
    console.log('ok: 逸脱2 交換形の畳み込み基準はマスタの lang');
  }
  {
    // 実装中に自己発見した回帰の固定: **アプリ JSON 側**の畳み込み基準は
    // 「アプリ文書の既定言語」（options.lang）であり、マスタの lang ではない。
    // 設定ファイル側（マスタの lang 基準）と混同すると、lang 未指定時に勝手に平文へ畳まれる。
    const source = {
      sourceType: 'tms', mapUid: 'user-tms', baseMapUid: 'uid-tms', role: 'base',
      overrides: {}, label: { ja: '迅速測図' },
    };
    const noLang = composeViewerSource(source, { lookup });
    assert.deepEqual(noLang.label, { ja: '迅速測図' },
      'lang 未指定なら畳まない（マスタの lang=ja へフォールバックして平文化してはならない）');
    const withJa = composeViewerSource(source, { lang: 'ja', lookup });
    assert.equal(withJa.label, '迅速測図', 'アプリ文書の既定言語と一致するときだけ平文へ畳む');
    console.log('ok: アプリ JSON の畳み込み基準はアプリ文書の言語');
  }

  // ============ createAppSourceFromBaseMap: 全コピーの廃止 ============
  {
    const master = lookup.bySlug('user-tms');
    const source = createAppSourceFromBaseMap(master, 'ja');
    assert.equal(source.baseMapUid, 'uid-tms', '参照を持つ');
    assert.equal(source.mapUid, 'user-tms');
    assert.deepEqual(source.overrides ?? {}, {}, '新規追加時の上書きは空');
    assert.equal('data' in source, false, 'data（マスタ全コピー）は廃止');
    console.log('ok: createAppSourceFromBaseMap が参照＋空 overrides を返す');
  }

  // ============ AC27（v1.4・IR-H-2）: 帰属・ライセンス系5キーの上書きが往復する ============
  {
    assert.deepEqual(
      [...APP_SOURCE_OVERRIDABLE_KEYS].sort(),
      ['attr', 'dataAttr', 'dataLicense', 'dataLicenseNote', 'label', 'license', 'licenseNote', 'maxZoom', 'minZoom', 'thumbnail', 'title'],
      'AC27: 宣言テーブルが v1.4 の11キーになる（§3.2）',
    );

    const source = {
      sourceType: 'tms', mapUid: 'user-tms', baseMapUid: 'uid-tms', role: 'base',
      overrides: {
        // 言語別3キー: 編集した言語のみ保存（§3.5.5 の保存側）
        dataAttr: { ja: 'アプリ側のデータ帰属' },
        licenseNote: { ja: 'アプリ側の補足' },
        dataLicenseNote: { ja: 'アプリ側のデータ補足' },
        // スカラー2キー
        license: 'CC BY-SA',
        dataLicense: 'PD',
      },
    };
    const out = composeViewerSource(source, { lang: 'ja', lookup });

    // スカラーはそのまま出る
    assert.equal(out.license, 'CC BY-SA', 'AC27: license の上書きがアプリ JSON 要素へ出る');
    assert.equal(out.dataLicense, 'PD', 'AC27: dataLicense の上書きがアプリ JSON 要素へ出る');

    // 言語別はマスタとマージした完全な言語オブジェクト（§3.5.5 の出力側）。
    // マスタの dataAttr は {ja:'データ作者'} で ja のみ ∴ 上書き後も ja のみ → 交換形で平文へ畳まれる
    assert.equal(out.dataAttr, 'アプリ側のデータ帰属', 'AC27: dataAttr の上書きが出る（ja のみなので交換形の平文）');
    assert.equal(out.licenseNote, 'アプリ側の補足', 'AC27: licenseNote の上書きが出る');
    assert.equal(out.dataLicenseNote, 'アプリ側のデータ補足', 'AC27: dataLicenseNote の上書きが出る');

    // 未上書きなら**アプリ JSON 要素に出ない**（設定ファイル側のマスタ値が効く）
    const bare = composeViewerSource(
      { sourceType: 'tms', mapUid: 'user-tms', baseMapUid: 'uid-tms', role: 'base', overrides: {} },
      { lang: 'ja', lookup },
    );
    for (const key of ['dataAttr', 'license', 'dataLicense', 'licenseNote', 'dataLicenseNote']) {
      assert.equal(key in bare, false, `AC27: 未上書きの ${key} はアプリ JSON 要素に出ない`);
    }
    // 設定ファイル側にはマスタ値が出ている（消費側が引ける先が必ずある）
    const setting = composeBaseMapSettingFile(lookup.byUid('uid-tms'), 'base');
    assert.equal(setting.license, 'CC BY', 'AC27: 未上書き時に効くのは設定ファイル側のマスタ値');
    assert.equal(setting.dataLicense, 'ODbL');
    assert.equal(setting.dataAttr, 'データ作者');

    // 多言語マスタでは未編集言語がマスタ値のまま残る（キー単位全置換への対処・§3.5.5）
    const osmOverride = composeViewerSource(
      { sourceType: 'builtin', mapUid: 'osm', baseMapUid: 'uid-osm', role: 'base', overrides: { licenseNote: { ja: 'アプリ補足' } } },
      { lang: 'ja', lookup },
    );
    assert.deepEqual(
      osmOverride.licenseNote, { en: 'OSM copyright', ja: 'アプリ補足' },
      'AC27: 言語別の上書きは編集言語だけ差し替わり、未編集言語はマスタ値が残る',
    );
    console.log('ok: AC27 帰属・ライセンス系5キーの往復');
  }

  // ============ AC7: 操作子と定数の一致（明示アンカーで機械照合）============
  {
    const editorSrc = await readFile(path.join(projectRoot, 'src/components/AppSourceEditor.vue'), 'utf8');
    const anchors = new Set(
      [...editorSrc.matchAll(/data-testid="app-source-override-([a-zA-Z]+)"/g)].map((m) => m[1]),
    );
    const declared = new Set([...APP_SOURCE_OVERRIDABLE_KEYS, ...APP_SOURCE_OWNED_KEYS]);
    assert.deepEqual(
      [...anchors].sort(), [...declared].sort(),
      'AC7: 操作子の明示アンカー集合と、宣言テーブル（OVERRIDABLE ∪ OWNED）が一致すること',
    );
    // 操作子は AppSourceEditor.vue に集約する（AppEdit.vue には残さない）
    const appEditSrc = await readFile(path.join(projectRoot, 'src/views/AppEdit.vue'), 'utf8');
    assert.equal(
      /data-testid="app-source-override-/.test(appEditSrc), false,
      'AC7: 上書き操作子は AppSourceEditor.vue に集約する（§3.8-6）',
    );
    console.log('ok: AC7 操作子と宣言テーブルの一致');
  }

  console.log('\nm6-t10 app-source-diff-model smoke: すべて成功');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
