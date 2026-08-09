// m6-t10 スモーク: マスタ由来ソースの差分保持ストレージモデルと出力文法の刷新。
// タスク設計 `docs/superpowers/specs/2026-08-07-m6-t10-app-source-diff-model-design.md` §6 準拠。
//
// 対象 AC: AC1(出力形) / AC2(設定ファイル) / AC3(マージ順) / AC4(マスタ欠落) / AC5(旧形移行)
//          AC6(overlay 保全) / AC19(builtin の url) / AC21(commonOptions 禁止キー)
//          AC23(merc の url 導出) / AC24(言語別の上書き粒度)
// AC7（操作子と定数の一致）は AppSourceEditor.vue のソーステキストを読むため本 smoke の末尾で扱う。
import { mkdir, mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const scratchRoot = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratchRoot, { recursive: true });
const workDir = await mkdtemp(path.join(scratchRoot, 'm6-t10-diff-model-'));
const outDir = path.join(workDir, 'dist');
const read = async (rel) => await readFile(path.join(projectRoot, rel), 'utf8');

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
        // m19-t3: 帰属・ライセンス系5キー。**マスタと異なる値**を入れてあるが、
        // 上書き可能キーではなくなったため移行時に捨てられる
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
    // m19-t3 AC8: 旧「data 全コピー」形からは **OWNED 3 キー以外すべて捨てる**。
    // title はマスタと異なる値だが、上書き可能キーではなくなったため温存しない
    assert.deepEqual(
      ov, { envelopeLngLats: [[130.5, 32.5]] },
      'm19-t3 AC8: 旧形移行で温存するのはアプリ所有キーだけ（title などは値が異なっても捨てる）',
    );
    for (const key of [
      'title', 'attr', 'maxZoom', 'minZoom', 'thumbnail',
      'url', 'coverageLngLats', 'kind', 'mapID', 'lang',
      'license', 'dataLicense', 'dataAttr', 'licenseNote', 'dataLicenseNote',
    ]) {
      assert.equal(key in ov, false, `m19-t3 AC8: 廃止・非上書きキー（${key}）は捨てる`);
    }
    assert.equal(migrated.source.label, undefined, 'AC5: label もマスタと同値なら上書きにしない');
    assert.equal(migrated.source.baseMapUid, 'uid-tms', 'AC5: baseMapUid を補う');
    console.log('ok: AC5/m19-t3 AC8 旧形の移行（OWNED のみ温存）');
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

  // ============ m19-t3 AC1: 宣言テーブルが凍結契約（m19 §4.4）と一致する ============
  // v1.4 の 11 キーは m19-t3 で `label` 1 個へ縮んだ。アプリ文書がベースマップマスタに対して
  // 持てる上書きは表示ラベルだけであり、帰属・ライセンス・ズーム・サムネイルはマスタが正本。
  {
    assert.deepEqual(
      [...APP_SOURCE_OVERRIDABLE_KEYS].sort(),
      ['label'],
      'm19-t3 AC1: 上書き可能キーは label のみ（m19 §4.4 で 1.0.0 まで凍結）',
    );
    assert.deepEqual(
      [...APP_SOURCE_OWNED_KEYS].sort(),
      ['envelopeLngLats', 'mercatorXShift', 'mercatorYShift'],
      'm19-t3 AC1: アプリ所有キーは 3 個のまま（H-2 で存置が確定）',
    );

    // 未上書きなら**アプリ JSON 要素に出ない**（設定ファイル側のマスタ値が効く）。
    // m19-t3 以後は「未上書き」ではなく「そもそも上書きできない」が、消費側が引ける先が
    // 必ず設定ファイルにあることの保証は変わらないため assert を残す。
    const bare = composeViewerSource(
      { sourceType: 'tms', mapUid: 'user-tms', baseMapUid: 'uid-tms', role: 'base', overrides: {} },
      { lang: 'ja', lookup },
    );
    for (const key of ['dataAttr', 'license', 'dataLicense', 'licenseNote', 'dataLicenseNote', 'title', 'minZoom', 'maxZoom', 'thumbnail']) {
      assert.equal(key in bare, false, `m19-t3 AC1: 上書きを持たない ${key} はアプリ JSON 要素に出ない`);
    }
    // 設定ファイル側にはマスタ値が出ている（消費側が引ける先が必ずある）
    const setting = composeBaseMapSettingFile(lookup.byUid('uid-tms'), 'base');
    assert.equal(setting.license, 'CC BY', 'm19-t3 AC1: 効くのは設定ファイル側のマスタ値');
    assert.equal(setting.dataLicense, 'ODbL');
    assert.equal(setting.dataAttr, 'データ作者');

    // 多言語マスタでは未編集言語がマスタ値のまま残る（キー単位全置換への対処・§3.5.5）。
    // 唯一残った言語別上書き（label）で固定する
    const osmOverride = composeViewerSource(
      { sourceType: 'builtin', mapUid: 'osm', baseMapUid: 'uid-osm', role: 'base', overrides: {}, label: { ja: 'アプリラベル' } },
      { lang: 'ja', lookup },
    );
    assert.deepEqual(
      osmOverride.label, { en: 'OSM(Now)', ja: 'アプリラベル' },
      'm19-t3 AC1: 言語別の上書き（label）は編集言語だけ差し替わり、未編集言語はマスタ値が残る',
    );
    console.log('ok: m19-t3 AC1 宣言テーブルの凍結');
  }

  // ============ m19-t3 AC9: 差分保持形で保存済みの廃止キーは読み込み時に落ちる ============
  // sp-0007: overrides は m6-t10（未公開）で導入された保存形であり、廃止キーの残存値は捨てる。
  // 救う分岐（別キーへの移送・既定値合成・マスタ値での穴埋め）は 1 つも足さない。
  {
    const normalized = normalizeAppSource({
      sourceType: 'tms', mapUid: 'user-tms', baseMapUid: 'uid-tms', role: 'base',
      overrides: {
        title: { ja: '旧上書きタイトル' },
        maxZoom: 9,
        minZoom: 2,
        thumbnail: 'tmbs/old.png',
        attr: { ja: '旧帰属' },
        dataAttr: { ja: '旧データ帰属' },
        license: 'PD',
        dataLicense: 'CC0',
        licenseNote: { ja: '旧補足' },
        dataLicenseNote: { ja: '旧データ補足' },
        envelopeLngLats: [[1, 2]],
        mercatorXShift: 0.5,
        mercatorYShift: -0.25,
      },
    }, 'ja');
    assert.deepEqual(
      normalized.overrides,
      { envelopeLngLats: [[1, 2]], mercatorXShift: 0.5, mercatorYShift: -0.25 },
      'm19-t3 AC9: 廃止した上書きキーは読み込み時に落ち、アプリ所有キーだけが残る',
    );
    // 救っていないこと（別キーへ移していない・既定値を合成していない）の直接確認
    for (const key of ['title', 'maxZoom', 'minZoom', 'thumbnail', 'attr', 'dataAttr', 'license', 'dataLicense', 'licenseNote', 'dataLicenseNote']) {
      assert.equal(key in normalized, false, `m19-t3 AC9: ${key} をトップレベルへ移送していない`);
    }
    // label（唯一の上書き可能キー）はトップレベルに保存されるため従来どおり残る
    const withLabel = normalizeAppSource({
      sourceType: 'tms', mapUid: 'user-tms', role: 'base', overrides: {}, label: { ja: 'ラベル' },
    }, 'ja');
    assert.deepEqual(withLabel.label, { ja: 'ラベル' }, 'm19-t3 AC9: label は従来どおりトップレベルで保持する');
    console.log('ok: m19-t3 AC9 差分保持形の廃止キー濾過');
  }

  // ============ AC28（v1.4・IR-H-2）: 操作子種別がマスタ編集フォームと一致し、共通部品の既定値が変わらない ============
  {
    const appSourceEditor = await read('src/components/AppSourceEditor.vue');
    const baseMapEdit = await read('src/components/basemap/BaseMapEdit.vue');
    const langInput = await read('src/components/LangResourceInput.vue');
    const licenseSelect = await read('src/components/editor-ui/LicenseSelect.vue');

    // (a) 言語別6欄は LangResourceInput（マスタ編集フォームと同じ部品）で描く
    assert.match(
      appSourceEditor, /import LangResourceInput from/,
      'AC28: 言語別欄はマスタ編集フォームと同じ LangResourceInput を使う（§3.8-8）',
    );
    // 手書き input + LangValueChips の組が残っていないこと（共通実装へ寄せた証明）
    assert.doesNotMatch(
      appSourceEditor, /<LangValueChips/,
      'AC28: LangValueChips の直接使用は LangResourceInput の内部へ移る',
    );

    // (b) m19-t3: ライセンス2欄（LicenseSelect）は AppSourceEditor から撤去した。
    //     マスタ編集フォーム（BaseMapEdit）側の LicenseSelect は無改修で生き続ける
    assert.match(baseMapEdit, /import LicenseSelect from/, 'AC28(前提): マスタ編集フォームは LicenseSelect を使い続ける');

    // (c) 共通部品の追加 prop は**既定値が現行挙動と同一**（BaseMapEdit を無改修に保つ前提）
    assert.match(langInput, /clearable\?: boolean/, 'AC28: LangResourceInput に clearable prop');
    assert.match(langInput, /placeholder\?: string/, 'AC28: LangResourceInput に placeholder prop');
    assert.match(langInput, /clearable: false/, 'AC28: clearable の既定は false（BaseMapEdit は type=text のまま）');
    assert.match(licenseSelect, /unsetLabelKey\?: string/, 'AC28: LicenseSelect に unsetLabelKey prop');
    assert.match(
      licenseSelect, /unsetLabelKey: "mapedit\.license_unset"/,
      'AC28: unsetLabelKey の既定は現行のハードコード値と同一（MapEdit/BaseMapEdit の表示を変えない）',
    );
    // BaseMapEdit は無改修＝新 prop を1つも渡していない
    for (const prop of ['clearable', 'unset-label-key', 'unsetLabelKey']) {
      assert.equal(
        baseMapEdit.includes(prop), false,
        `AC28: BaseMapEdit は無改修（${prop} を渡していない）`,
      );
    }
    console.log('ok: AC28 操作子種別の一致と共通部品の既定値互換');
  }

  // ============ AC7: 操作子と定数の一致（明示アンカーで機械照合）============
  {
    const editorSrc = await readFile(path.join(projectRoot, 'src/components/AppSourceEditor.vue'), 'utf8');
    // アンカーは**ソーステキストのリテラル**を要求する（動的バインドだと照合から漏れる。
    // 設計レビュー round4 Info 1）。LangResourceInput へは input-testid prop で素通しするため、
    // v1.4 で input-testid も同じリテラル形として受け付ける。
    const anchors = new Set(
      [...editorSrc.matchAll(/(?:data|input)-testid="app-source-override-([a-zA-Z]+)"/g)].map((m) => m[1]),
    );
    // v1.4 §3.8-7: 解除の×は別接頭辞。override 側の抽出へ 'clear' が混入していないこと
    assert.equal(anchors.has('clear'), false, 'AC7: 解除の×は app-source-clear- 接頭辞で分離する');
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

  // ============ hotfix 回帰ガード（2026-08-07 人間報告の2バグ）============
  {
    const appEditSrc = await readFile(path.join(projectRoot, 'src/views/AppEdit.vue'), 'utf8');
    // バグA: normalizeSource の label←title 強制補完（設計 P2 の廃止対象）が残っていると、
    // ロードのたびに title 由来の label が上書きとして実体化する（保存→再読込で復活）。
    // AppEdit.vue は label へ代入してはならない（label の操作子と保存は AppSourceEditor 側の責務）
    assert.equal(
      /source\.label\s*=/.test(appEditSrc), false,
      'hotfix: AppEdit.vue に label への代入（強制補完の残骸）が無いこと',
    );
    // バグB: maplat ソースの label 操作子（§3.8-6 の移設時に消えた退行の復旧）
    const editorSrc = await readFile(path.join(projectRoot, 'src/components/AppSourceEditor.vue'), 'utf8');
    assert.match(
      editorSrc, /input-testid="app-source-maplat-label"/,
      'hotfix: maplat ソースに label 操作子があること（override- 接頭辞ではない = AC7 集合に混入しない）',
    );
    console.log('ok: hotfix 回帰ガード（label 強制補完の廃止・maplat label 操作子の復旧）');
  }

  // ============ m19-t3 AC3: 解除の × は利用範囲 1 個だけになる ============
  {
    const editorSrc = await readFile(path.join(projectRoot, 'src/components/AppSourceEditor.vue'), 'utf8');
    const clearAnchors = new Set(
      [...editorSrc.matchAll(/data-testid="app-source-clear-([a-zA-Z]+)"/g)].map((m) => m[1]),
    );
    assert.deepEqual(
      [...clearAnchors].sort(), ['envelopeLngLats'],
      'm19-t3 AC3: 解除の × は利用範囲の 1 個だけ（minZoom / maxZoom / thumbnail は廃止）',
    );
    // 新設「存在範囲からコピー」は override- でも clear- でもない第3の接頭辞（AC7 の集合に混入しない）
    assert.match(
      editorSrc, /data-testid="app-source-copy-coverage-envelopeLngLats"/,
      'm19-t3 AC7: 「存在範囲からコピー」のアンカーが在る',
    );
    console.log('ok: m19-t3 AC3 解除アンカーの縮小と copy アンカーの新設');
  }

  // ============ m19-t3 AC6: 廃止した操作子の記号と i18n キーが残っていない ============
  {
    const editorSrcRaw = await readFile(path.join(projectRoot, 'src/components/AppSourceEditor.vue'), 'utf8');
    // 判定対象は**コードだけ**である。行コメント（// …）と HTML コメント（<!-- … -->）は
    // 「なぜ廃止したか」を記すために廃止記号名を書くことがあり、それを検出すると偽陽性になる
    const editorSrc = editorSrcRaw
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    // 唯一の使用点が廃止された script 記号（設計 §4.4 の「凍結後の全数」を機械照合する）
    for (const symbol of [
      'isOverridden', 'setScalar', 'scalarValue', 'masterNumber', 'masterLicenseLabel',
      'uploadThumbnail', 'uploadError', 'LicenseSelect', 'LICENSE_VOCABULARY',
    ]) {
      assert.doesNotMatch(
        editorSrc, new RegExp(symbol),
        `m19-t3 AC6: 使用点が廃止された ${symbol} が AppSourceEditor.vue に残っていない`,
      );
    }
    // 廃止した i18n キー（11 言語すべてから消えていること）
    const ABOLISHED_I18N_KEYS = [
      'source_title', 'source_attr', 'min_zoom', 'max_zoom',
      'thumbnail', 'thumbnail_note', 'override_reset', 'license_inherit',
    ];
    const locales = (await readdir(path.join(projectRoot, 'public/locales'))).sort();
    assert.equal(locales.length, 11, 'm19-t3: locale は 11 言語');
    for (const lang of locales) {
      const dict = JSON.parse(await read(`public/locales/${lang}/translation.json`));
      for (const key of ABOLISHED_I18N_KEYS) {
        assert.equal(
          key in dict.appedit, false,
          `m19-t3 AC6: ${lang} の appedit.${key} が削除されている`,
        );
      }
      // ---- AC4: 「表示ラベル」は 3 面共通の語（basemap.master_detail.label と同値）----
      assert.equal(
        dict.appedit.source_label, dict.basemap.master_detail.label,
        `m19-t3 AC4: ${lang} の appedit.source_label がベースマップ側の「表示ラベル」と同値`,
      );
      // ---- AC5: DB 属性名の露出（"start_from"）をやめる ----
      assert.notEqual(
        dict.appedit.start_from, 'start_from',
        `m19-t3 AC5: ${lang} の appedit.start_from が DB 属性名のままになっていない`,
      );
      assert.ok(
        String(dict.appedit.start_from || '').trim().length > 0,
        `m19-t3 AC5: ${lang} の appedit.start_from が非空`,
      );
      // ---- 新設キー（存在範囲からコピー）----
      assert.ok(
        String(dict.appedit.envelope_copy_coverage || '').trim().length > 0,
        `m19-t3: ${lang} の appedit.envelope_copy_coverage が非空`,
      );
    }
    // 製品コード・スクリプトに廃止キーの参照が残っていない
    for (const rel of ['src/components/AppSourceEditor.vue', 'src/views/AppEdit.vue']) {
      const src = await read(rel);
      for (const key of ABOLISHED_I18N_KEYS) {
        assert.doesNotMatch(
          src, new RegExp(`appedit\\.${key}\\b`),
          `m19-t3 AC6: ${rel} に appedit.${key} の参照が残っていない`,
        );
      }
    }
    // 廃止した上書きキーを読む分岐が AppEdit.vue に残っていない（sp-0007）
    const appEditSrc = await read('src/views/AppEdit.vue');
    assert.doesNotMatch(
      appEditSrc, /overrides\?\.(thumbnail|title|attr|minZoom|maxZoom|license)/,
      'm19-t3 AC6: AppEdit.vue に廃止した上書きキーを読む分岐が残っていない',
    );
    console.log('ok: m19-t3 AC4/AC5/AC6 廃止記号・廃止 i18n キー・新設語彙');
  }

  // ============ m19-t3 AC15（人間検証由来）: translationMode の適用範囲 ============
  // 翻訳モードで無効化してよいのは**言語に依存しない構造的な値だけ**である。言語別テキスト
  // （表示ラベル）を無効化すると、チップは出るのに翻訳を入力できない＝多言語要素として機能しない。
  // リポジトリ共通の規律であり、BaseMapEdit が構造的な欄（structuralDisabled）と言語別欄
  // （translationMode を外した式）で書き分けているのが原型。E2E（AC15）は builtin/tms 分岐を
  // 実操作で検証するが、maplat 分岐は登録地図の seed が要るため本 smoke が機械照合で受け持つ。
  {
    const editorSrc = await read('src/components/AppSourceEditor.vue');

    // (a) 表示ラベルの 2 操作子（maplat 分岐 / builtin・tms 分岐）が translationMode で無効化されない。
    //     LangResourceInput の呼び出しブロックを取り出して、その中に :disabled が無いことを見る
    const langInputBlocks = [...editorSrc.matchAll(/<LangResourceInput\b[\s\S]*?\/>/g)].map((m) => m[0]);
    assert.equal(langInputBlocks.length, 2, 'm19-t3 AC15: 言語別欄は表示ラベルの 2 箇所だけ');
    for (const testid of ['app-source-maplat-label', 'app-source-override-label']) {
      const block = langInputBlocks.find((b) => b.includes(`input-testid="${testid}"`));
      assert.ok(block, `m19-t3 AC15: ${testid} の LangResourceInput が在る`);
      assert.doesNotMatch(
        block, /:disabled=/,
        `m19-t3 AC15: ${testid}（言語別テキスト）は翻訳モードで無効化してはならない。` +
          'チップは出るのに翻訳を入力できない状態になり、多言語要素として機能しなくなる',
      );
    }

    // (b) 言語に依存しない構造的な操作子は translationMode で無効のまま（既存の意図を壊していない）
    for (const anchor of [
      'data-testid="app-source-override-mercatorXShift"',
      'data-testid="app-source-override-mercatorYShift"',
      'data-testid="app-source-copy-coverage-envelopeLngLats"',
      'data-testid="app-source-clear-envelopeLngLats"',
    ]) {
      const line = editorSrc.split('\n').find((l) => l.includes(anchor));
      assert.ok(line, `m19-t3 AC15: ${anchor} が在る`);
    }
    // 上の 4 つのうち、単一行で書かれている 3 つは同じ行に :disabled="translationMode…" を持つ
    for (const anchor of [
      'data-testid="app-source-override-mercatorXShift"',
      'data-testid="app-source-override-mercatorYShift"',
      'data-testid="app-source-clear-envelopeLngLats"',
    ]) {
      const line = editorSrc.split('\n').find((l) => l.includes(anchor));
      assert.match(
        line, /:disabled="translationMode/,
        `m19-t3 AC15: ${anchor}（構造的な値）は翻訳モードで無効のままであること`,
      );
    }
    // 複数行で書かれた「存在範囲からコピー」も translationMode を含む
    const copyBlock = editorSrc.match(/<button[^>]*[\s\S]*?data-testid="app-source-copy-coverage-envelopeLngLats"[\s\S]*?>/)[0];
    assert.match(
      copyBlock, /:disabled="translationMode \|\| !coverageAvailable"/,
      'm19-t3 AC15: 「存在範囲からコピー」は翻訳モードで無効のままであること',
    );

    // (c) 欠陥B: url 注記が表示ラベルの直後に取り残されていない（ラベルの説明と誤読されない）。
    //     注記はソース設定の末尾に置き、ホバー不要の地の文として出す
    const noteIndex = editorSrc.indexOf('data-testid="app-source-url-note"');
    const labelIndex = editorSrc.indexOf('input-testid="app-source-override-label"');
    const envelopeIndex = editorSrc.indexOf('data-testid="app-source-override-envelopeLngLats"');
    assert.ok(noteIndex > 0 && labelIndex > 0 && envelopeIndex > 0, 'm19-t3 AC15: 3 つのアンカーが在る');
    assert.ok(
      noteIndex > envelopeIndex,
      'm19-t3 欠陥B: url 注記は利用範囲より後（ソース設定の末尾）に置く。' +
        '表示ラベルの直後に残るとラベルの説明と誤読される',
    );
    assert.match(
      editorSrc, /data-testid="app-source-url-note"[\s\S]{0,120}t\("appedit\.source_url_master_note"\)/,
      'm19-t3 欠陥B: 注記文は地の文として出す（ホバーしないと読めない ContextHelp では出さない）',
    );
    console.log('ok: m19-t3 AC15 translationMode の適用範囲と url 注記の配置');
  }

  // ============ m19-t3 AC12（弱照合）: ADR-0018 の列挙が凍結後の集合になっている ============
  {
    const adr = await readFile(
      path.join(projectRoot, '../docs/adr/0018-base-map-master-is-authoritative-for-app-sources.md'),
      'utf8',
    );
    // 「上書き可能」と述べる文（Today that is …）に廃止キーが並んでいないこと。
    // 主判定は手動レビューであり、ここは陳腐化の再発を機械で拾うための弱い網である
    const overridableSentence = adr.match(/Today,? that is[^.]*\./)?.[0] ?? '';
    assert.ok(overridableSentence.length > 0, 'm19-t3 AC12: ADR-0018 に上書き可能キーの列挙文がある');
    for (const key of ['licenseNote', 'minZoom', 'maxZoom', 'thumbnail', 'title']) {
      assert.equal(
        overridableSentence.includes(key), false,
        `m19-t3 AC12: ADR-0018 の上書き可能列挙から ${key} が外れている`,
      );
    }
    assert.match(adr, /m19/, 'm19-t3 AC12: m19 §4.4 で凍結した旨が記されている');
    console.log('ok: m19-t3 AC12 ADR-0018 の列挙更新（弱照合）');
  }

  console.log('\nm6-t10 app-source-diff-model smoke: すべて成功');
} finally {
  await rm(workDir, { recursive: true, force: true });
}
