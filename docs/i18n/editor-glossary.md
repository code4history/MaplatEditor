# エディタ UI 用語集（生成物）

<!-- 生成物: 手で編集しない。`node scripts/editor-glossary-check.mjs --write` で作り直す。正本は docs/i18n/editor-glossary.json -->

正本は `editor-glossary.json`（概念・言語別の代表語・許容形・統一前の形・禁止形）と `editor-glossary.exceptions.json`（例外）。
検査は `node scripts/editor-glossary-check.mjs`（`pnpm smoke:editor-glossary`）。文言を設計する前に、ここで概念を探す。
正本と locale は同じ PR で変えられない（初版を除く）。新しい語・例外は、先に正本だけの PR を合流させてから locale の PR を出す。
新しい概念が後の locale の PR で足す根拠キー・additionalBindings は、その概念の pendingKeys に先行登録する。登録したキーだけが警告（pending-key）になり、どれか 1 言語へ足した時点で 11 言語すべてへの追加を検査する。先行登録した根拠キーが既に locale にあって文言が旧いときは、その旧文言の全文を pendingTexts に記録する。11 言語すべてが記録どおりのあいだだけ警告（pending-key）にとどめ、1 言語でも変わったら 11 言語で代表語を検査する。まだ無いキーへの例外も、従来どおり正本だけの PR の時点では警告になる。手順は AGENTS.md の「UI Wording & Glossary」。

概念 48・結び付いたキー 534・例外 293（anchorExclusion 12・omission 100・untranslated 181）

| 概念 | 説明 | 根拠キー | 結び付け |
|---|---|---|---:|
| [asset](#asset) | 管理対象の画像・アイコン等。財務資産ではない | `navbar.assets` | 18 |
| [canvas](#canvas) | IIIF Manifest 内の canvas（コマ）。HTML canvas とは別 | `iiif_metadata.from_canvas` | 6 |
| [manifest](#manifest) | IIIF Presentation の Manifest。PWA の Web App Manifest は除外語で外す | `iiif_metadata.from_manifest` | 13 |
| [import](#import) | 外部データを取り込む操作 | `resource_list.import_map` | 52 |
| [export](#export) | 配布・交換用データを出す操作 | `editor_ui.export_button` | 40 |
| [configure](#configure) | 振る舞いを指定する画面・項目。データ主体の名詞にはしない（2026-10-21）。役割 screen（strict）と item（weak）に分ける | `navbar.settings` | 35 |
| [settings-file](#settings-file) | 地図・アプリ等の定義データを保持する主体（設定ファイル） | `appedit.source_advanced` | 7 |
| [map](#map) | 編集・公開する地図。ベースマップは別概念 | `navbar.edit_map` | 155 |
| [basemap](#basemap) | 古地図の下に敷く地図（ベースマップ） | `navbar.add_basemap` | 65 |
| [app](#app) | 地図と POI をまとめて公開するアプリ | `navbar.edit_app` | 54 |
| [poi](#poi) | 地図上の地点情報 | `navbar.edit_poi` | 63 |
| [source](#source) | POI ソース | `resource_list.kind_poi_source` | 34 |
| [citation](#citation) | 地図・ベースマップの出所（書誌的な典拠） | `mapedit.map_source` | 4 |
| [attribution](#attribution) | 地図画像・データの帰属（著作権表示） | `mapedit.map_copyright_pf` | 19 |
| [gcp](#gcp) | 地図画像と地理座標の対応点 | `editor_ui.tabs.gcps` | 15 |
| [bibliography](#bibliography) | IIIF 等から写す書誌情報。Maplat の地図メタデータ（editor_ui.tabs.metadata）とは別。代表語は ja・en だけ | `iiif_metadata.heading` | 9 |
| [tile](#tile) | 地図画像を分割した配信用画像。スタイル・TileJSON の tiles 配列・ベクタータイルセットは除外 | `editor_ui.tabs.merc` | 39 |
| [save](#save) | 編集内容を永続化する操作。エクスポート・端末キャッシュとは区別 | `common.save` | 57 |
| [overwrite](#overwrite) | 既存値の置換。POI import では同一 ID を更新し、無ければ追加 | `common.overwrite` | 9 |
| [override](#override) | 参照先を変えずに表示属性（タイトル・アイコン・非表示）だけを差し替える | `poiref.add_override` | 6 |
| [append](#append) | 既存 POI を置換せず全行を新規 POI として足す | `poiio.import_mode_append` | 1 |
| [viewer](#viewer) | エクスポートしたアプリの表示部（Maplat UI） | `appedit.border_ui_note` | 16 |
| [layer](#layer) | 地図のレイヤー・POI のレイヤー | `mapedit.edit_layer` | 13 |
| [preview](#preview) | エクスポートする前の確認表示 | `editor_ui.tabs.preview` | 20 |
| [publish-key](#publish-key) | エクスポートしたアプリが使う API キー（公開用キー） | `settings.default_publish_api_key_heading` | 5 |
| [server](#server) | MCP サーバー・タイルサーバー等 | `settings.mcp_tab` | 4 |
| [crs](#crs) | 座標参照系（CRS）。定義データを指して「設定」とは呼ばない | `mapedit.crs_estimate_button` | 0 |
| [crs-estimation](#crs-estimation) | GCP から CRS を推定する明示的な操作。GCP 編集に追随する自動推定ではない | `mapedit.crs_estimate_button` | 0 |
| [crs-candidate](#crs-candidate) | 推定結果として比較する候補の CRS。採用済みの CRS とは区別する | `mapedit.crs_candidates_heading` | 0 |
| [crs-score](#crs-score) | 相似の当てはめの残差 RMS を GCP の bbox の対角で割った、小さいほど良い当てはまりの指標（score） | `mapedit.crs_setup_borderline_note` | 0 |
| [transform-setup](#transform-setup) | CRS・world file・三角網・外側の変換を組み合わせた変換の形（CRS／三角網＋大域外挿／三角網＋扇形外挿。画面には A〜C の記号を出さない）。定義データを指して「設定」とは呼ばない | `mapedit.crs_adopt_button` | 0 |
| [transform-setup-a](#transform-setup-a) | 変換の形「CRS」: CRS と world file だけを使い、三角網を持たない形。画面には A〜C の記号を出さない。定義データを指して「設定」とは呼ばない | `mapedit.crs_setup_a` | 0 |
| [transform-setup-b](#transform-setup-b) | 変換の形「三角網＋大域外挿」: CRS と三角網を使い、四辺形の外を大域外挿（world file が表す大域モデル）で変換する形。画面には A〜C の記号を出さない | `mapedit.crs_setup_b` | 0 |
| [transform-setup-c](#transform-setup-c) | 変換の形「三角網＋扇形外挿」: CRS と三角網を使い、四辺形の外を扇形に外挿する形。画面には A〜C の記号を出さない | `mapedit.crs_setup_c` | 0 |
| [transform-setup-legacy](#transform-setup-legacy) | CRS を持たない V2 の地図の変換の形（従来型）。V2 の地図は今も使えるので、廃止予定のような響きにしない | `mapedit.crs_setup_legacy` | 0 |
| [world-file](#world-file) | 画像の画素座標と CRS の座標を対応付ける 6 係数の world file。定義データを指して「設定」とは呼ばない | `mapedit.crs_gcp_edited_after_adopt` | 0 |
| [tin](#tin) | GCP と補助頂点で構成する三角網（TIN）。CRS だけの形では持たない | `appedit.preview.compiled_required` | 1 |
| [corresponding-line](#corresponding-line) | 2 つの GCP を結ぶ線（技術文書では制約エッジ）。三角網は必ずこの線を辺に含む。人間が打つ | `mapedit.edge_error_not_found` | 10 |
| [bend-point](#bend-point) | 対応線を折れ線にするための点。紙の面と地理の面で、別々に打てる。人間が打つ。GCP のマーカーとは別 | `mapedit.context_marker_on_line` | 0 |
| [proportional-point](#proportional-point) | 折れ点の、相手の面での位置。相手の面の折れ線の上で、始点から同じ長さの比になる点。Tin が求める（システムが置く） | `mapedit.tin_proportional_point` | 0 |
| [supplement-point](#supplement-point) | strict を保つために制約から外した凸包の辺や、向きが食い違う所に、システムが足す対応の組。補助頂点とは別（システムが置く） | `mapedit.tin_supplement_point` | 0 |
| [extrapolation-quadrilateral](#extrapolation-quadrilateral) | GCP の外側を受け持つ範囲の枠。内側は三角網、外側は大域外挿か扇形外挿で変換する（システムが置く） | `mapedit.tin_extrapolation_quadrilateral` | 0 |
| [auxiliary-vertex](#auxiliary-vertex) | 外挿四辺形の四隅と辺の上に置く頂点（隅の補助頂点・辺の補助頂点）。補完点とは別（システムが置く） | `mapedit.tin_auxiliary_vertex` | 0 |
| [residual](#residual) | 変換後の位置と GCP の地理座標の GCP ごとのずれ（残差）。変換失敗や往復検査の誤差とは区別する | `mapedit.crs_residuals_heading` | 0 |
| [global-model](#global-model) | 三角網＋大域外挿で四辺形の外に使う、world file が表す大域的なアフィン変換（大域モデル） | `mapedit.crs_setup_fallback_notice` | 0 |
| [recommendation](#recommendation) | score と閾値から示す推奨。採用を強制するものではない | `mapedit.crs_setup_recommended_badge` | 0 |
| [adoption](#adoption) | 推定で選んだ CRS と変換の形を地図へ書き込む明示的な採用操作。比較・保存・自動更新とは区別する | `mapedit.crs_adopt_button` | 0 |
| [fan-fallback](#fan-fallback) | 大域外挿を組めないときに四辺形の外を扇形外挿へ切り替えたことを知らせる通知。扇形外挿の形全般や内部の strict_error とは区別する | `mapedit.crs_setup_fallback_notice` | 0 |

## asset

管理対象の画像・アイコン等。財務資産ではない

根拠キー `navbar.assets`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | asset | asset | — | — | — |
| en | asset | asset、assets | This asset | — | — |
| es | recurso | recurso、recursos | — | — | — |
| fr | ressource | ressource、ressources | — | d’actifs、d'actifs、des actifs、les actifs | — |
| id | aset | aset | — | — | — |
| ja | アセット | アセット | 素材 | 資産（全キー） | — |
| ko | 에셋 | 에셋 | — | 자산（全キー） | — |
| th | ทรัพยากร | ทรัพยากร | แอสเซ็ต | — | — |
| vi | tài nguyên | tài nguyên | — | — | — |
| zh | 素材 | 素材 | 资源 | — | — |
| zh-TW | 素材 | 素材 | 資產、資源 | — | — |

## canvas

IIIF Manifest 内の canvas（コマ）。HTML canvas とは別

根拠キー `iiif_metadata.from_canvas`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | canvas | canvas | — | — | — |
| en | canvas | canvas | — | — | — |
| es | canvas | canvas | — | — | — |
| fr | canvas | canvas | — | — | — |
| id | canvas | canvas | — | — | — |
| ja | コマ | コマ | — | — | コマンド |
| ko | canvas | canvas | — | — | — |
| th | canvas | canvas | — | — | — |
| vi | canvas | canvas | — | — | — |
| zh | canvas | canvas | — | — | — |
| zh-TW | canvas | canvas | — | — | — |

## manifest

IIIF Presentation の Manifest。PWA の Web App Manifest は除外語で外す

根拠キー `iiif_metadata.from_manifest`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | Manifest | Manifest | — | — | Web App Manifest、Manifest Settings、canonical/manifest、マニフェスト |
| en | Manifest | Manifest | — | — | Web App Manifest、Manifest Settings、canonical/manifest、マニフェスト |
| es | Manifest | Manifest | — | — | Web App Manifest、Manifest Settings、canonical/manifest、マニフェスト |
| fr | Manifest | Manifest | — | — | Web App Manifest、Manifest Settings、canonical/manifest、マニフェスト |
| id | Manifest | Manifest | — | — | Web App Manifest、Manifest Settings、canonical/manifest、マニフェスト |
| ja | Manifest | Manifest | — | — | Web App Manifest、Manifest Settings、canonical/manifest、マニフェスト |
| ko | Manifest | Manifest | — | — | Web App Manifest、Manifest Settings、canonical/manifest、マニフェスト |
| th | Manifest | Manifest | — | — | Web App Manifest、Manifest Settings、canonical/manifest、マニフェスト |
| vi | Manifest | Manifest | — | — | Web App Manifest、Manifest Settings、canonical/manifest、マニフェスト |
| zh | Manifest | Manifest | — | — | Web App Manifest、Manifest Settings、canonical/manifest、マニフェスト |
| zh-TW | Manifest | Manifest | — | — | Web App Manifest、Manifest Settings、canonical/manifest、マニフェスト |

## import

外部データを取り込む操作

根拠キー `resource_list.import_map`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | import | import | — | — | import map |
| en | import | import、imports、imported、importing | — | — | import map |
| es | importar | importar、importación、importa、importe、importará、importado、importados、importada、importan、importando、importarla、importarlo、importarlos | — | — | import map |
| fr | importer | importer、import、importation、importé、importée、importés、importées、importez、importera | — | — | import map |
| id | impor | impor | — | — | import map |
| ja | インポート | インポート | 取り込、CSV入力、ファイル入力、データ入力、データセット入力、入力設定 | — | import map |
| ko | 가져오 | 가져오、가져올、가져와 | CSV 입력、파일 입력、데이터 입력、데이터셋 입력、입력 설정 | — | import map |
| th | นำเข้า | นำเข้า | — | — | import map |
| vi | nhập | nhập | — | — | import map |
| zh | 导入 | 导入 | — | — | import map |
| zh-TW | 匯入 | 匯入 | 導入 | — | import map |

## export

配布・交換用データを出す操作

根拠キー `editor_ui.export_button`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | export | export | — | — | — |
| en | export | export、exports、exported、exporting | — | — | — |
| es | exportar | exportar、exportación、exporta、exporte、exportado、exportada、exportados、exportadas、exportará、exportando、exportarla、exportarlo、exportó | — | — | — |
| fr | exporter | exporter、export、exportation、exporté、exportée、exportés、exportées、exportez、exportera | — | — | — |
| id | ekspor | ekspor | — | — | — |
| ja | エクスポート | エクスポート | 書き出、データ出力、データセット出力、出力成功、出力用、出力方法 | — | — |
| ko | 내보내 | 내보내、내보낸、내보낼、내보냅、내보냈 | 데이터 출력、데이터셋 출력、출력에 성공、출력용 | — | — |
| th | ส่งออก | ส่งออก | — | — | — |
| vi | xuất | xuất | — | xuất bản | khóa xuất bản、khóa API xuất bản |
| zh | 导出 | 导出 | — | — | — |
| zh-TW | 匯出 | 匯出 | — | — | — |

## configure

振る舞いを指定する画面・項目。データ主体の名詞にはしない（2026-10-21）。役割 screen（strict）と item（weak）に分ける

根拠キー `navbar.settings`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW。役割: screen（strict）・item（weak）

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | einstellung | einstellung、konfigur | — | — | — |
| en | settings | settings、setting、configure、configured、configuration | — | — | settings file、not set、is set、are set |
| es | configuración | configuración、configurar、configurado、configurada、configure、configurados、configuraciones | — | — | archivo de configuración |
| fr | paramètres | paramètres、paramètre、configurer、configuré、configurée、configuration、paramétrer、paramétré | page Réglages | — | fichier de paramètres |
| id | pengaturan | pengaturan、atur、konfigurasi | — | — | file pengaturan、berkas pengaturan、teratur |
| ja | 設定 | 設定 | — | — | 設定ファイル、未設定、設定不要、に設定、を設定、設定して、設定する、設定した、設定され、手動設定、設定でき |
| ko | 설정 | 설정 | — | — | 설정 파일 |
| th | ตั้งค่า | ตั้งค่า | — | — | ไฟล์การตั้งค่า |
| vi | cài đặt | cài đặt、thiết lập | — | — | tệp cài đặt |
| zh | 设置 | 设置、设定 | — | — | 设置文件 |
| zh-TW | 設定 | 設定 | — | — | 設定檔 |

## settings-file

地図・アプリ等の定義データを保持する主体（設定ファイル）

根拠キー `appedit.source_advanced`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | einstellungsdatei | einstellungsdatei | — | — | — |
| en | settings file | settings file、settings files | — | — | — |
| es | archivo de configuración | archivo de configuración、archivos de configuración | — | — | — |
| fr | fichier de paramètres | fichier de paramètres、fichiers de paramètres | — | — | — |
| id | file pengaturan | file pengaturan | berkas pengaturan | — | — |
| ja | 設定ファイル | 設定ファイル | — | — | — |
| ko | 설정 파일 | 설정 파일 | — | — | — |
| th | ไฟล์การตั้งค่า | ไฟล์การตั้งค่า | — | — | — |
| vi | tệp cài đặt | tệp cài đặt | — | — | — |
| zh | 设置文件 | 设置文件 | — | — | — |
| zh-TW | 設定檔 | 設定檔 | — | — | — |

## map

編集・公開する地図。ベースマップは別概念

根拠キー `navbar.edit_map`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | karte | karte | — | — | Google Maps、Google マップ、import map、basiskarte、Hintergrundkarte |
| en | map | map、maps | — | — | Google Maps、Google マップ、import map、base map、base maps、background map、background maps、basemap、basemaps、Google Maps |
| es | mapa | mapa、mapas | — | — | Google Maps、Google マップ、import map、mapa base、mapas base、mapa de fondo |
| fr | carte | carte、cartes、cartographique、cartographiques | — | — | Google Maps、Google マップ、import map、fond de carte、fonds de carte、carte de fond、carte de base |
| id | peta | peta | — | — | Google Maps、Google マップ、import map、peta dasar、peta latar |
| ja | 地図 | 地図 | — | — | Google Maps、Google マップ、import map、背景地図、Google マップ |
| ko | 지도 | 지도 | — | — | Google Maps、Google マップ、import map、배경 지도 |
| th | แผนที่ | แผนที่ | — | — | Google Maps、Google マップ、import map、แผนที่พื้นฐาน、แผนที่พื้นหลัง、แผนที่ฐาน |
| vi | bản đồ | bản đồ | — | — | Google Maps、Google マップ、import map、bản đồ nền |
| zh | 地图 | 地图 | — | — | Google Maps、Google マップ、import map、底图、背景地图 |
| zh-TW | 地圖 | 地圖 | — | — | Google Maps、Google マップ、import map、底圖、背景地圖 |

## basemap

古地図の下に敷く地図（ベースマップ）

根拠キー `navbar.add_basemap`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | basiskarte | basiskarte | hintergrundkarte | — | — |
| en | base map | base map、base maps、basemap、basemaps | background map、background maps | — | — |
| es | mapa base | mapa base、mapas base | mapa de fondo、mapas de fondo | — | — |
| fr | fond de carte | fond de carte、fonds de carte | carte de fond、carte de base、cartes de fond | — | — |
| id | peta dasar | peta dasar | peta latar | — | — |
| ja | ベースマップ | ベースマップ | 背景地図 | — | — |
| ko | 베이스맵 | 베이스맵 | 배경 지도 | — | — |
| th | แผนที่พื้นฐาน | แผนที่พื้นฐาน | แผนที่พื้นหลัง、แผนที่ฐาน | — | — |
| vi | bản đồ nền | bản đồ nền | — | — | — |
| zh | 底图 | 底图 | 背景地图 | — | — |
| zh-TW | 底圖 | 底圖 | 背景地圖 | — | — |

## app

地図と POI をまとめて公開するアプリ

根拠キー `navbar.edit_app`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | app | app | — | — | Web App Manifest |
| en | app | app、apps | — | — | Web App Manifest |
| es | aplicación | aplicación、aplicaciones、app、apps | — | — | Web App Manifest |
| fr | application | application、applications、app、apps | — | — | Web App Manifest |
| id | aplikasi | aplikasi、app | — | — | Web App Manifest |
| ja | アプリ | アプリ | — | — | Web App Manifest |
| ko | 앱 | 앱 | — | — | Web App Manifest |
| th | แอปพลิเคชัน | แอปพลิเคชัน | แอป | — | Web App Manifest |
| vi | ứng dụng | ứng dụng | — | — | Web App Manifest |
| zh | 应用 | 应用 | — | — | Web App Manifest |
| zh-TW | 應用程式 | 應用程式 | 應用 | — | Web App Manifest |

## poi

地図上の地点情報

根拠キー `navbar.edit_poi`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | POI | POI、POIs | — | — | — |
| en | POI | POI、POIs | — | — | — |
| es | POI | POI、POIs | — | — | — |
| fr | POI | POI、POIs | — | — | — |
| id | POI | POI、POIs | — | — | — |
| ja | POI | POI、POIs | — | — | — |
| ko | POI | POI、POIs | — | — | — |
| th | POI | POI、POIs | — | — | — |
| vi | POI | POI、POIs | — | — | — |
| zh | POI | POI、POIs | — | — | — |
| zh-TW | POI | POI、POIs | — | — | — |

## source

POI ソース

根拠キー `resource_list.kind_poi_source`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | quelle | quelle | — | — | Quellenangabe、Quellbild |
| en | source | source、sources | — | — | open source、source image、source switcher |
| es | fuente | fuente、fuentes | — | — | — |
| fr | source | source、sources | — | — | — |
| id | sumber | sumber | — | — | — |
| ja | ソース | ソース | — | — | リソース、オープンソース |
| ko | 소스 | 소스 | — | — | — |
| th | แหล่งข้อมูล | แหล่งข้อมูล、แหล่งที่มา | — | — | แหล่งอ้างอิง |
| vi | nguồn | nguồn | — | — | — |
| zh | 源 | 源 | — | — | — |
| zh-TW | 來源 | 來源 | — | — | — |

## citation

地図・ベースマップの出所（書誌的な典拠）

根拠キー `mapedit.map_source`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | quelle | quelle | — | — | — |
| en | source | source | — | — | — |
| es | fuente | fuente | — | — | — |
| fr | source | source | — | — | — |
| id | sumber | sumber | — | — | — |
| ja | 典拠 | 典拠 | 出典 | — | — |
| ko | 출처 | 출처 | — | — | — |
| th | แหล่งอ้างอิง | แหล่งอ้างอิง | แหล่งที่มา | — | — |
| vi | nguồn | nguồn | — | — | — |
| zh | 来源 | 来源、出处 | — | — | — |
| zh-TW | 來源 | 來源、出處 | — | — | — |

## attribution

地図画像・データの帰属（著作権表示）

根拠キー `mapedit.map_copyright_pf`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | quellenangabe | quellenangabe | attribution、datenattribution | — | — |
| en | attribution | attribution、attributions | — | — | Creative Commons Attribution、クリエイティブ・コモンズ 表示 |
| es | atribución | atribución、atribuciones | — | — | — |
| fr | attribution | attribution、attributions | — | — | — |
| id | atribusi | atribusi | — | — | — |
| ja | 帰属表記 | 帰属表記、地図画像帰属、データ帰属 | 帰属表示 | — | Creative Commons Attribution、クリエイティブ・コモンズ 表示 |
| ko | 저작자 표시 | 저작자 표시、출처 표시 | — | — | — |
| th | การระบุที่มา | การระบุที่มา、ระบุที่มา | การระบุแหล่งที่มา | — | Creative Commons Attribution、クリエイティブ・コモンズ 表示 |
| vi | ghi công | ghi công、ghi nguồn | — | — | — |
| zh | 署名 | 署名、归属 | 版权信息 | — | — |
| zh-TW | 署名 | 署名、歸屬 | 版權標示 | — | — |

## gcp

地図画像と地理座標の対応点

根拠キー `editor_ui.tabs.gcps`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | GCP | GCP、GCPs、passpunkt | — | — | — |
| en | GCP | GCP、GCPs、control point、control points | — | — | — |
| es | GCP | GCP、puntos de control、punto de control | — | — | — |
| fr | GCP | GCP、points de contrôle、point de contrôle | — | — | — |
| id | GCP | GCP、titik korespondensi | titik kontrol | — | — |
| ja | GCP | GCP、対応点 | — | — | — |
| ko | GCP | GCP、대응점 | — | — | — |
| th | GCP | GCP、จุดควบคุมภาคพื้นดิน | จุดควบคุม | — | — |
| vi | GCP | GCP、điểm tương ứng | điểm khống chế | — | — |
| zh | GCP | GCP、控制点、对应点 | — | — | — |
| zh-TW | GCP | GCP、GCPs、控制點、對應點 | — | — | — |

## bibliography

IIIF 等から写す書誌情報。Maplat の地図メタデータ（editor_ui.tabs.metadata）とは別。代表語は ja・en だけ

根拠キー `iiif_metadata.heading`。必須形を求める言語: ja, en

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| en | bibliographic | bibliographic | metadata | — | — |
| ja | 書誌 | 書誌 | — | — | — |

## tile

地図画像を分割した配信用画像。スタイル・TileJSON の tiles 配列・ベクタータイルセットは除外

根拠キー `editor_ui.tabs.merc`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | kachel | kachel | — | — | TileJSON、tiles 配列、tiles-Array、tiles array、mảng tiles、tiles 陣列、tiles 数组、tileset |
| en | tile | tile、tiles、tiled | — | — | TileJSON、tiles 配列、tiles-Array、tiles array、mảng tiles、tiles 陣列、tiles 数组、tileset、level 0 tiling |
| es | tesela | tesela、teselas | mosaico | — | TileJSON、tiles 配列、tiles-Array、tiles array、mảng tiles、tiles 陣列、tiles 数组、tileset |
| fr | tuile | tuile、tuiles | — | — | TileJSON、tiles 配列、tiles-Array、tiles array、mảng tiles、tiles 陣列、tiles 数组、tileset |
| id | tile | tile、ubin | — | — | TileJSON、tiles 配列、tiles-Array、tiles array、mảng tiles、tiles 陣列、tiles 数组、tileset |
| ja | タイル | タイル | — | — | TileJSON、tiles 配列、tiles-Array、tiles array、mảng tiles、tiles 陣列、tiles 数组、tileset、スタイル |
| ko | 타일 | 타일 | — | — | TileJSON、tiles 配列、tiles-Array、tiles array、mảng tiles、tiles 陣列、tiles 数组、tileset |
| th | ไทล์ | ไทล์ | — | — | TileJSON、tiles 配列、tiles-Array、tiles array、mảng tiles、tiles 陣列、tiles 数组、tileset |
| vi | tile | tile | ô bản đồ | — | TileJSON、tiles 配列、tiles-Array、tiles array、mảng tiles、tiles 陣列、tiles 数组、tileset |
| zh | 瓦片 | 瓦片 | 图砖 | — | TileJSON、tiles 配列、tiles-Array、tiles array、mảng tiles、tiles 陣列、tiles 数组、tileset |
| zh-TW | 圖磚 | 圖磚 | 瓦片 | — | TileJSON、tiles 配列、tiles-Array、tiles array、mảng tiles、tiles 陣列、tiles 数组、tileset |

## save

編集内容を永続化する操作。エクスポート・端末キャッシュとは区別

根拠キー `common.save`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | speicher | speicher、gespeichert | — | — | arbeitsspeicher |
| en | save | save、saved、saves、saving、unsaved | — | — | — |
| es | guardar | guardar、guardado、guardada、guardados、guardadas、guarda、guarde、guardará、guardan、guardando、guardarlo、guardarla、guardó、guardarán、guárdelo、guardarse | — | — | — |
| fr | enregistrer | enregistrer、enregistré、enregistrée、enregistrés、enregistrées、enregistrement、enregistre、enregistrez、enregistrera、enregistrant、réenregistrer | — | — | — |
| id | simpan | simpan、menyimpan、penyimpanan、tersimpan | — | — | — |
| ja | 保存 | 保存 | — | — | — |
| ko | 저장 | 저장 | — | — | — |
| th | บันทึก | บันทึก | — | — | — |
| vi | lưu | lưu | — | — | — |
| zh | 保存 | 保存、另存为 | — | — | — |
| zh-TW | 儲存 | 儲存、另存為、存成 | — | — | — |

## overwrite

既存値の置換。POI import では同一 ID を更新し、無ければ追加

根拠キー `common.overwrite`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | überschreib | überschreib、überschrieben | — | — | — |
| en | overwrite | overwrite、overwrites、overwritten、overwriting | — | override、overrides | — |
| es | sobrescribir | sobrescribir、sobrescribirá、sobrescribe、sobrescritura、sobrescribiendo | — | — | — |
| fr | écraser | écraser、écrasera、écrase、écrasement、écrasé | — | — | — |
| id | timpa | timpa、menimpa、penimpaan | — | — | — |
| ja | 上書き | 上書き | — | — | — |
| ko | 덮어쓰 | 덮어쓰、덮어쓸、덮어씁 | — | — | — |
| th | เขียนทับ | เขียนทับ | — | แทนที่ | — |
| vi | ghi đè | ghi đè | — | — | — |
| zh | 覆盖 | 覆盖 | — | — | — |
| zh-TW | 覆寫 | 覆寫、覆蓋 | — | — | — |

## override

参照先を変えずに表示属性（タイトル・アイコン・非表示）だけを差し替える

根拠キー `poiref.add_override`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | überschreib | überschreib | — | — | — |
| en | override | override、overrides、overridden | — | overwrite、overwrites | — |
| es | sobrescritura | sobrescritura、sobrescrituras、sobrescribe、sobrescrito、sobrescrita | reemplazo | — | — |
| fr | remplacement | remplacement、remplacements、remplace | — | écraser、écrase | — |
| id | timpa | timpa、menimpa、penimpaan | pengganti | — | — |
| ja | 上書き | 上書き | — | — | — |
| ko | 덮어쓰 | 덮어쓰、덮어쓸、덮어씁 | — | — | — |
| th | แทนที่ | แทนที่ | — | เขียนทับ | — |
| vi | ghi đè | ghi đè | — | — | — |
| zh | 覆盖 | 覆盖 | — | — | — |
| zh-TW | 覆寫 | 覆寫 | — | — | — |

## append

既存 POI を置換せず全行を新規 POI として足す

根拠キー `poiio.import_mode_append`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | anhängen | anhängen | — | — | — |
| en | append | append | — | — | — |
| es | añadir (cada fila | añadir (cada fila | — | — | — |
| fr | ajouter (chaque ligne | ajouter (chaque ligne | — | — | — |
| id | tambahkan (setiap baris | tambahkan (setiap baris | — | — | — |
| ja | 追記 | 追記 | — | — | — |
| ko | 추가 (모든 행 | 추가 (모든 행 | — | — | — |
| th | เพิ่มต่อท้าย | เพิ่มต่อท้าย | — | — | — |
| vi | thêm vào (mỗi dòng | thêm vào (mỗi dòng | — | — | — |
| zh | 追加 | 追加 | — | — | — |
| zh-TW | 追加 | 追加 | — | — | — |

## viewer

エクスポートしたアプリの表示部（Maplat UI）

根拠キー `appedit.border_ui_note`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | viewer | viewer | — | — | — |
| en | viewer | viewer | — | — | — |
| es | visor | visor | — | — | — |
| fr | visionneuse | visionneuse | visualiseur | — | — |
| id | penampil | penampil | viewer | — | — |
| ja | ビューア | ビューア | — | — | — |
| ko | 뷰어 | 뷰어 | — | — | — |
| th | โปรแกรมดู | โปรแกรมดู | ตัวแสดงผล、วิวเวอร์ | — | — |
| vi | trình xem | trình xem | — | — | — |
| zh | 查看器 | 查看器 | — | — | — |
| zh-TW | 檢視器 | 檢視器 | — | — | — |

## layer

地図のレイヤー・POI のレイヤー

根拠キー `mapedit.edit_layer`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | ebene | ebene | layer | — | angegeben |
| en | layer | layer、layers、sublayer | — | — | line-layer-opacity |
| es | capa | capa、capas、subcapa | — | — | — |
| fr | calque | calque、calques、couche、couches | — | — | — |
| id | lapisan | lapisan、sublapisan | layer | — | — |
| ja | レイヤ | レイヤ | — | — | line-layer-opacity |
| ko | 레이어 | 레이어 | — | — | — |
| th | เลเยอร์ | เลเยอร์ | ชั้น | — | — |
| vi | lớp | lớp | — | — | — |
| zh | 图层 | 图层 | — | — | — |
| zh-TW | 圖層 | 圖層 | — | — | — |

## preview

エクスポートする前の確認表示

根拠キー `editor_ui.tabs.preview`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | vorschau | vorschau | — | — | — |
| en | preview | preview、previews | — | — | — |
| es | vista previa | vista previa、vistas previas | — | — | — |
| fr | aperçu | aperçu、aperçus | — | — | — |
| id | pratinjau | pratinjau | — | — | — |
| ja | プレビュー | プレビュー | — | — | — |
| ko | 미리보기 | 미리보기、미리 보기、미리볼、미리 볼 | — | — | — |
| th | ดูตัวอย่าง | ดูตัวอย่าง、ตัวอย่าง | พรีวิว | — | — |
| vi | xem trước | xem trước | — | — | — |
| zh | 预览 | 预览 | — | — | — |
| zh-TW | 預覽 | 預覽 | — | — | — |

## publish-key

エクスポートしたアプリが使う API キー（公開用キー）

根拠キー `settings.default_publish_api_key_heading`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | veröffentlichung | veröffentlichung | — | — | — |
| en | publish key | publish key、publish keys、publish api key | — | — | — |
| es | clave de publicación | clave de publicación、claves de publicación、clave API de publicación | — | — | — |
| fr | clé de publication | clé de publication、clés de publication、clé API de publication | — | — | — |
| id | kunci publikasi | kunci publikasi、kunci API publikasi | — | — | — |
| ja | 公開用 | 公開用 | — | — | — |
| ko | 공개용 | 공개용 | — | — | — |
| th | คีย์เผยแพร่ | คีย์เผยแพร่、สำหรับเผยแพร่ | — | — | — |
| vi | khóa xuất bản | khóa xuất bản、khóa API xuất bản | — | — | — |
| zh | 发布密钥 | 发布密钥、发布用 | — | — | — |
| zh-TW | 發布金鑰 | 發布金鑰、發布用 | — | — | — |

## server

MCP サーバー・タイルサーバー等

根拠キー `settings.mcp_tab`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | server | server | — | — | — |
| en | server | server、servers | — | — | — |
| es | servidor | servidor | — | — | — |
| fr | serveur | serveur | — | — | — |
| id | server | server | — | — | — |
| ja | サーバー | サーバー | サーバ | — | — |
| ko | 서버 | 서버 | — | — | — |
| th | เซิร์ฟเวอร์ | เซิร์ฟเวอร์ | — | — | — |
| vi | máy chủ | máy chủ | — | — | — |
| zh | 服务器 | 服务器 | — | — | — |
| zh-TW | 伺服器 | 伺服器 | — | — | — |

## crs

座標参照系（CRS）。定義データを指して「設定」とは呼ばない

根拠キー `mapedit.crs_estimate_button`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW。先行登録キー: `mapedit.crs_estimate_button`

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | CRS | CRS、Koordinatenreferenzsystem | — | — | — |
| en | CRS | CRS、coordinate reference system、coordinate reference systems | — | CRS settings | — |
| es | CRS | CRS、sistema de referencia de coordenadas | — | — | — |
| fr | CRS | CRS、système de référence de coordonnées | — | — | — |
| id | CRS | CRS、sistem referensi koordinat | — | — | — |
| ja | CRS | CRS、座標参照系 | — | CRS 設定 | — |
| ko | CRS | CRS、좌표 참조 시스템 | — | — | — |
| th | CRS | CRS、ระบบพิกัดอ้างอิง | — | — | — |
| vi | CRS | CRS、hệ quy chiếu tọa độ | — | — | — |
| zh | CRS | CRS、坐标参照系 | — | — | — |
| zh-TW | CRS | CRS、座標參照系 | — | — | — |

## crs-estimation

GCP から CRS を推定する明示的な操作。GCP 編集に追随する自動推定ではない

根拠キー `mapedit.crs_estimate_button`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW。先行登録キー: `mapedit.crs_estimate_button`

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | CRS schätzen | CRS schätzen、CRS schätz、CRS-Schätzung、neu schätzen | — | — | — |
| en | estimate CRS | estimate CRS、estimating CRS、CRS estimation、re-estimate、re-estimation | — | automatic estimation | — |
| es | estimar CRS | estimar CRS、estimación de CRS、reestimar | — | — | — |
| fr | estimer le CRS | estimer le CRS、estimation du CRS、réestimer | — | — | — |
| id | estimasi CRS | estimasi CRS、memperkirakan CRS、estimasi ulang | — | — | — |
| ja | CRS を推定 | CRS を推定、CRS の推定、再推定 | — | 自動推定 | — |
| ko | CRS 추정 | CRS 추정、재추정 | — | — | — |
| th | ประเมิน CRS | ประเมิน CRS、การประเมิน CRS、ประเมินใหม่ | — | — | — |
| vi | ước tính CRS | ước tính CRS、ước lượng CRS、ước tính lại | — | — | — |
| zh | 估计 CRS | 估计 CRS、CRS 估计、重新估计 | — | — | — |
| zh-TW | 推定 CRS | 推定 CRS、CRS 推定、重新推定 | — | — | — |

## crs-candidate

推定結果として比較する候補の CRS。採用済みの CRS とは区別する

根拠キー `mapedit.crs_candidates_heading`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW。先行登録キー: `mapedit.crs_candidates_heading`

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | CRS-Kandidat | CRS-Kandidat、CRS-Kandidaten、Kandidat | — | — | — |
| en | candidate CRS | candidate CRS、CRS candidate、CRS candidates、candidate、candidates | — | adopted CRS | — |
| es | CRS candidato | CRS candidato、CRS candidatos、candidato、candidatos | — | — | — |
| fr | CRS candidat | CRS candidat、CRS candidats、candidat、candidats | — | — | — |
| id | CRS kandidat | CRS kandidat、kandidat CRS、kandidat | — | — | — |
| ja | 候補の CRS | 候補の CRS、CRS 候補、候補 | — | 採用済み CRS | — |
| ko | 후보 CRS | 후보 CRS、CRS 후보、후보 | — | — | — |
| th | CRS ที่เป็นตัวเลือก | CRS ที่เป็นตัวเลือก、ตัวเลือก CRS、ตัวเลือก | — | — | — |
| vi | CRS ứng viên | CRS ứng viên、ứng viên CRS、ứng viên | — | — | — |
| zh | 候选 CRS | 候选 CRS、CRS 候选、候选 | — | — | — |
| zh-TW | 候選 CRS | 候選 CRS、CRS 候選、候選 | — | — | — |

## crs-score

相似の当てはめの残差 RMS を GCP の bbox の対角で割った、小さいほど良い当てはまりの指標（score）

根拠キー `mapedit.crs_setup_borderline_note`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW。先行登録キー: `mapedit.crs_setup_borderline_note`

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | Score | Score、Passungsgüte-Score | — | — | — |
| en | score | score、fit score、goodness-of-fit score | — | accuracy | — |
| es | score | score、puntuación de ajuste | — | — | — |
| fr | score | score、score d’ajustement、indice d’ajustement | — | — | — |
| id | skor | skor、skor kecocokan、score | — | — | — |
| ja | 適合スコア | 適合スコア、score、当てはまりの指標 | — | 精度 | — |
| ko | score | score、적합 점수、점수 | — | — | — |
| th | score | score、คะแนนความพอดี、คะแนน | — | — | — |
| vi | score | score、điểm phù hợp | — | — | — |
| zh | score | score、拟合分数、分数 | — | — | — |
| zh-TW | score | score、擬合分數、分數 | — | — | — |

## transform-setup

CRS・world file・三角網・外側の変換を組み合わせた変換の形（CRS／三角網＋大域外挿／三角網＋扇形外挿。画面には A〜C の記号を出さない）。定義データを指して「設定」とは呼ばない

根拠キー `mapedit.crs_adopt_button`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW。先行登録キー: `mapedit.crs_adopt_button`

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | Aufbau | Aufbau、Transformationsaufbau | — | — | — |
| en | setup | setup、setups、transform setup、transform setups | — | transform settings | — |
| es | forma de transformación | forma de transformación | — | — | — |
| fr | forme de transformation | forme de transformation | — | — | — |
| id | bentuk transformasi | bentuk transformasi | — | — | — |
| ja | 変換の形 | 変換の形、構成、変換方式 | — | 変換の設定 | — |
| ko | 구성 | 구성、변환 형태 | — | — | — |
| th | รูปแบบการแปลง | รูปแบบการแปลง、โครงสร้าง | — | — | — |
| vi | dạng biến đổi | dạng biến đổi | — | — | — |
| zh | 转换形式 | 转换形式、构成、配置 | — | — | — |
| zh-TW | 轉換形式 | 轉換形式、構成、組態 | — | — | — |

## transform-setup-a

変換の形「CRS」: CRS と world file だけを使い、三角網を持たない形。画面には A〜C の記号を出さない。定義データを指して「設定」とは呼ばない

根拠キー `mapedit.crs_setup_a`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW。先行登録キー: `mapedit.crs_setup_a`

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | nur CRS | nur CRS、CRS only、A: nur CRS | A: nur World file、nur World file、World file only | Transformationseinstellungen | — |
| en | CRS only | CRS only、A: CRS only | A: World file only、World file only、A: CRS + World file | transform settings | — |
| es | solo CRS | solo CRS、CRS only、A: solo CRS | A: solo World file、solo World file、World file only | — | — |
| fr | CRS uniquement | CRS uniquement、CRS seul、A : CRS uniquement | A : World file uniquement、World file uniquement、World file only | — | — |
| id | hanya CRS | hanya CRS、CRS saja、A: hanya CRS | A: hanya World file、hanya World file、World file only | — | — |
| ja | CRS | CRS、A: CRS | A: ワールドファイルのみ、ワールドファイルのみ、world file のみ | 変換の設定 | — |
| ko | CRS만 | CRS만、CRS only、A: CRS만 | A: 월드 파일만、월드 파일만、World file only | — | — |
| th | CRS เท่านั้น | CRS เท่านั้น、CRS only、A: CRS เท่านั้น | A: World file เท่านั้น、World file เท่านั้น、World file only | การตั้งค่าการแปลง | — |
| vi | chỉ CRS | chỉ CRS、CRS only、A: chỉ CRS | A: chỉ World file、chỉ World file、World file only | — | — |
| zh | 仅 CRS | 仅 CRS、CRS only、A: 仅 CRS、A: CRS | A: 仅世界文件、仅世界文件、World file only | — | — |
| zh-TW | 僅 CRS | 僅 CRS、CRS only、A: 僅 CRS | A: 僅世界檔案、僅世界檔案、World file only | 轉換設定 | — |

## transform-setup-b

変換の形「三角網＋大域外挿」: CRS と三角網を使い、四辺形の外を大域外挿（world file が表す大域モデル）で変換する形。画面には A〜C の記号を出さない

根拠キー `mapedit.crs_setup_b`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW。先行登録キー: `mapedit.crs_setup_b`

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | TIN + globale Extrapolation | TIN + globale Extrapolation、B: TIN + globale Extrapolation | B: TIN + globales Modell、TIN + globales Modell、B: CRS + TIN | Transformationseinstellungen | — |
| en | TIN + global extrapolation | TIN + global extrapolation、B: TIN + global extrapolation | B: TIN + global model、TIN + global model、B: CRS + TIN | — | — |
| es | TIN + extrapolación global | TIN + extrapolación global、B: TIN + extrapolación global | B: TIN + modelo global、TIN + modelo global、B: CRS + TIN | — | — |
| fr | TIN + extrapolation globale | TIN + extrapolation globale、B : TIN + extrapolation globale | B : TIN + modèle global、TIN + modèle global、B : CRS + TIN | — | — |
| id | TIN + ekstrapolasi global | TIN + ekstrapolasi global、B: TIN + ekstrapolasi global | B: TIN + model global、B: CRS + TIN、TIN + model global | — | — |
| ja | 三角網＋大域外挿 | 三角網＋大域外挿、B: 三角網＋大域外挿 | B: 三角網＋大域モデル、三角網＋大域モデル、B: CRS＋三角網 | — | — |
| ko | TIN + 전역 외삽 | TIN + 전역 외삽、B: TIN + 전역 외삽 | B: TIN + 전역 모델、TIN + 전역 모델、B: CRS + TIN | — | — |
| th | TIN + การประมาณค่านอกช่วงแบบโกลบอล | TIN + การประมาณค่านอกช่วงแบบโกลบอล、B: TIN + การประมาณค่านอกช่วงแบบโกลบอล | B: TIN + แบบจำลองโกลบอล、TIN + แบบจำลองโกลบอล、B: CRS + TIN、TIN + การคาดคะเนแบบโกลบอล、B: TIN + การคาดคะเนแบบโกลบอล | การตั้งค่าการแปลง | — |
| vi | TIN + ngoại suy toàn cục | TIN + ngoại suy toàn cục、B: TIN + ngoại suy toàn cục | TIN + mô hình toàn cục、B: TIN + mô hình toàn cục、B: CRS + TIN | — | — |
| zh | TIN + 全局外推 | TIN + 全局外推、B: TIN + 全局外推、三角网 + 全局外推 | B: TIN + 全局模型、B: CRS + TIN、TIN + 全局模型 | — | — |
| zh-TW | TIN + 全域外插 | TIN + 全域外插、B: TIN + 全域外插 | B: TIN + 全域模型、TIN + 全域模型、B: CRS + TIN | 轉換設定 | — |

## transform-setup-c

変換の形「三角網＋扇形外挿」: CRS と三角網を使い、四辺形の外を扇形に外挿する形。画面には A〜C の記号を出さない

根拠キー `mapedit.crs_setup_c`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW。先行登録キー: `mapedit.crs_setup_c`

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | TIN + Fächer-Extrapolation | TIN + Fächer-Extrapolation、C: TIN + Fächer-Extrapolation、C: TIN + Fächer | C: CRS + TIN | Transformationseinstellungen | — |
| en | TIN + fan extrapolation | TIN + fan extrapolation、C: TIN + fan extrapolation、C: TIN + fan | C: CRS + TIN | — | — |
| es | TIN + extrapolación en abanico | TIN + extrapolación en abanico、C: TIN + extrapolación en abanico、C: TIN + abanico、TIN + abanico | C: CRS + TIN | — | — |
| fr | TIN + extrapolation en éventail | TIN + extrapolation en éventail、C : TIN + extrapolation en éventail、C : TIN + éventail、TIN + éventail | C : CRS + TIN | — | — |
| id | TIN + ekstrapolasi kipas | TIN + ekstrapolasi kipas、C: TIN + ekstrapolasi kipas、C: TIN + kipas | C: CRS + TIN | — | — |
| ja | 三角網＋扇形外挿 | 三角網＋扇形外挿、C: 三角網＋扇形外挿、C: 三角網＋扇形、三角網＋扇形 | C: CRS＋三角網 | — | — |
| ko | TIN + 부채꼴 외삽 | TIN + 부채꼴 외삽、C: TIN + 부채꼴 외삽、C: TIN + 부채꼴、TIN + 부채꼴 | C: CRS + TIN | — | — |
| th | TIN + การประมาณค่านอกช่วงแบบรูปพัด | TIN + การประมาณค่านอกช่วงแบบรูปพัด、C: TIN + การประมาณค่านอกช่วงแบบรูปพัด、C: TIN + รูปพัด | C: CRS + TIN、TIN + การคาดคะเนแบบรูปพัด、C: TIN + การคาดคะเนแบบรูปพัด | การตั้งค่าการแปลง | — |
| vi | TIN + ngoại suy hình quạt | TIN + ngoại suy hình quạt、C: TIN + ngoại suy hình quạt、TIN + hình quạt、C: TIN + hình quạt | C: CRS + TIN | — | — |
| zh | TIN + 扇形外推 | TIN + 扇形外推、C: TIN + 扇形外推、三角网 + 扇形外推、C: TIN + 扇形 | C: CRS + TIN | — | — |
| zh-TW | TIN + 扇形外插 | TIN + 扇形外插、C: TIN + 扇形外插、C: TIN + 扇形、TIN + 扇形、TIN + 扇形外推 | C: CRS + TIN | 轉換設定 | — |

## transform-setup-legacy

CRS を持たない V2 の地図の変換の形（従来型）。V2 の地図は今も使えるので、廃止予定のような響きにしない

根拠キー `mapedit.crs_setup_legacy`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW。先行登録キー: `mapedit.crs_setup_legacy`

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | herkömmlich | herkömmlich、herkömmliche、herkömmlicher、herkömmlichen、Legacy | — | veraltet | — |
| en | legacy | legacy | — | — | — |
| es | convencional | convencional、heredado、legacy | — | antiguo | — |
| fr | classique | classique、classiques、de type classique、type classique、format classique | — | ancien type | — |
| id | konvensional | konvensional、bentuk konvensional、legacy | — | peta lama | — |
| ja | 従来型 | 従来型 | — | — | — |
| ko | 기존형 | 기존형、기존 방식、레거시 | — | 구형 | — |
| th | แบบเดิม | แบบเดิม、แผนที่แบบเดิม、แบบเดิม (V2) | — | แผนที่เก่า、แบบเก่า | — |
| vi | kiểu cũ | kiểu cũ、bản đồ kiểu cũ、bản đồ V2 | — | — | — |
| zh | 传统型 | 传统型、传统、传统方式 | — | 旧地图、旧型 | — |
| zh-TW | 傳統型 | 傳統型、傳統、舊版 | — | 舊地圖 | — |

## world-file

画像の画素座標と CRS の座標を対応付ける 6 係数の world file。定義データを指して「設定」とは呼ばない

根拠キー `mapedit.crs_gcp_edited_after_adopt`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW。先行登録キー: `mapedit.crs_gcp_edited_after_adopt`

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | World file | World file、World files、WF | — | — | — |
| en | world file | world file、world files、WF | — | world file settings | — |
| es | World file | World file、archivo world、WF | — | — | — |
| fr | World file | World file、fichier world、WF | — | — | — |
| id | World file | World file、berkas world、WF | — | — | — |
| ja | ワールドファイル | ワールドファイル、world file、WF | — | ワールドファイル設定 | — |
| ko | 월드 파일 | 월드 파일、world file、WF | — | — | — |
| th | World file | World file、เวิลด์ไฟล์、WF | — | — | — |
| vi | World file | World file、tệp world、WF | — | — | — |
| zh | 世界文件 | 世界文件、world file、WF | — | — | — |
| zh-TW | 世界檔案 | 世界檔案、world file、WF | — | — | — |

## tin

GCP と補助頂点で構成する三角網（TIN）。CRS だけの形では持たない

根拠キー `appedit.preview.compiled_required`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | TIN | TIN、trianguliertes unregelmäßiges Netz | — | — | — |
| en | TIN | TIN、triangular irregular network、triangulated irregular network、triangulation | — | TIN settings | — |
| es | TIN | TIN、red irregular de triángulos、triangulación | — | — | — |
| fr | TIN | TIN、réseau irrégulier de triangles、triangulation | — | — | — |
| id | TIN | TIN、jaring segitiga tidak beraturan、triangulasi | — | — | — |
| ja | 三角網 | 三角網、TIN | — | TIN 設定 | — |
| ko | 삼각망 | 삼각망、TIN | — | — | — |
| th | TIN | TIN、เครือข่ายสามเหลี่ยม、โครงข่ายสามเหลี่ยม | — | — | — |
| vi | TIN | TIN、lưới tam giác、mạng tam giác | — | — | — |
| zh | 三角网 | 三角网、TIN | — | — | — |
| zh-TW | 三角網 | 三角網、TIN | — | — | — |

## corresponding-line

2 つの GCP を結ぶ線（技術文書では制約エッジ）。三角網は必ずこの線を辺に含む。人間が打つ

根拠キー `mapedit.edge_error_not_found`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | Verbindungslinie | Verbindungslinie、Verbindungslinien、Zwangskante、Zwangskanten | — | Hilfslinie | — |
| en | corresponding line | corresponding line、corresponding lines、constraint edge、constraint edges | — | — | — |
| es | línea de correspondencia | línea de correspondencia、líneas de correspondencia、arista de restricción、aristas de restricción | — | — | — |
| fr | ligne de correspondance | ligne de correspondance、lignes de correspondance、ligne de contrainte、lignes de contrainte | — | ligne correspondante | — |
| id | garis korespondensi | garis korespondensi、garis-garis korespondensi、sisi kendala | — | garis kontrol、garis penghubung | — |
| ja | 対応線 | 対応線、制約エッジ | — | — | — |
| ko | 대응선 | 대응선、제약 엣지 | — | 마커 선、대응 라인 | — |
| th | เส้นที่สอดคล้อง | เส้นที่สอดคล้อง、เส้นสอดคล้อง、เส้นข้อบังคับ | — | เส้นควบคุม | — |
| vi | đường tương ứng | đường tương ứng、các đường tương ứng、cạnh ràng buộc | — | đường đối ứng | — |
| zh | 对应线 | 对应线、约束边 | — | 控制线、对应边 | — |
| zh-TW | 對應線 | 對應線、約束邊 | — | 標記線 | — |

## bend-point

対応線を折れ線にするための点。紙の面と地理の面で、別々に打てる。人間が打つ。GCP のマーカーとは別

根拠キー `mapedit.context_marker_on_line`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW。先行登録キー: `mapedit.context_marker_on_line`（旧文言を記録）

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | Knickpunkt | Knickpunkt、Knickpunkte、Knickpunkten、Knickpunkts | — | Stützpunkt、Marker auf Verbindungslinie | — |
| en | bend point | bend point、bend points | — | — | — |
| es | punto de quiebre | punto de quiebre、puntos de quiebre | — | punto de inflexión | — |
| fr | point de brisure | point de brisure、points de brisure | — | point d'inflexion、point d’inflexion、point de rupture | — |
| id | titik tekuk | titik tekuk、titik-titik tekuk | — | penanda、titik belok、titik patah | — |
| ja | 折れ点 | 折れ点 | — | — | — |
| ko | 꺾임점 | 꺾임점、굴곡점 | — | 절점、변곡점 | — |
| th | จุดหักมุม | จุดหักมุม、จุดหักเห | — | จุดโค้ง | — |
| vi | điểm gấp khúc | điểm gấp khúc、các điểm gấp khúc | — | điểm uốn | — |
| zh | 折点 | 折点 | — | 拐点、节点 | — |
| zh-TW | 折點 | 折點、轉折點 | — | 節點 | — |

## proportional-point

折れ点の、相手の面での位置。相手の面の折れ線の上で、始点から同じ長さの比になる点。Tin が求める（システムが置く）

根拠キー `mapedit.tin_proportional_point`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW。先行登録キー: `mapedit.tin_proportional_point`

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | Teilungspunkt | Teilungspunkt、Teilungspunkte、Teilungspunkten、Teilungspunkts | — | — | — |
| en | proportional point | proportional point、proportional points | — | — | — |
| es | punto proporcional | punto proporcional、puntos proporcionales、punto de división proporcional、puntos de división proporcional | — | punto intermedio、punto auxiliar | — |
| fr | point proportionnel | point proportionnel、points proportionnels | — | point d'interpolation、point d’interpolation | — |
| id | titik proporsional | titik proporsional、titik-titik proporsional、titik pembagi proporsional | — | titik tengah | — |
| ja | 内分点 | 内分点 | — | — | — |
| ko | 내분점 | 내분점 | — | 보간점、비례점 | — |
| th | จุดแบ่งตามสัดส่วน | จุดแบ่งตามสัดส่วน、จุดแบ่งตามอัตราส่วน | — | จุดเสริม | — |
| vi | điểm chia theo tỉ lệ | điểm chia theo tỉ lệ、điểm chia tỉ lệ、các điểm chia theo tỉ lệ | — | — | — |
| zh | 内分点 | 内分点、比例分点、比例点 | — | 辅助点 | — |
| zh-TW | 內分點 | 內分點、比例點 | — | 中點、補點 | — |

## supplement-point

strict を保つために制約から外した凸包の辺や、向きが食い違う所に、システムが足す対応の組。補助頂点とは別（システムが置く）

根拠キー `mapedit.tin_supplement_point`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW。先行登録キー: `mapedit.tin_supplement_point`

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | Ergänzungspunkt | Ergänzungspunkt、Ergänzungspunkte、Ergänzungspunkten、Ergänzungspunkts | — | Hilfspunkt | — |
| en | supplement point | supplement point、supplement points | — | auxiliary point | — |
| es | punto complementario | punto complementario、puntos complementarios、par complementario、pares complementarios | — | punto auxiliar、vértice complementario、punto suplementario | — |
| fr | point complémentaire | point complémentaire、points complémentaires、paire complémentaire、paires complémentaires | — | point auxiliaire、point supplémentaire | — |
| id | titik pelengkap | titik pelengkap、titik-titik pelengkap、pasangan pelengkap | — | titik tambahan、titik bantu、simpul pelengkap | — |
| ja | 補完点 | 補完点 | — | 補助点 | — |
| ko | 보완점 | 보완점、보완 점 | — | 보조점、보충점 | — |
| th | จุดเติมเต็ม | จุดเติมเต็ม、คู่จุดเติมเต็ม | — | จุดเสริม、จุดช่วย、จุดเพิ่มเติม | — |
| vi | điểm bổ sung | điểm bổ sung、các điểm bổ sung、cặp điểm bổ sung | — | điểm phụ trợ、điểm bổ trợ、đỉnh bổ sung | — |
| zh | 补全点 | 补全点 | — | 补充点、补点、补助 | — |
| zh-TW | 補全點 | 補全點 | — | 補助點、輔助點、補充頂點 | — |

## extrapolation-quadrilateral

GCP の外側を受け持つ範囲の枠。内側は三角網、外側は大域外挿か扇形外挿で変換する（システムが置く）

根拠キー `mapedit.tin_extrapolation_quadrilateral`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW。先行登録キー: `mapedit.tin_extrapolation_quadrilateral`

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | Extrapolationsviereck | Extrapolationsviereck、Extrapolationsvierecks、Extrapolationsvierecke、Extrapolationsvierecken、Extrapolations-Viereck | — | — | — |
| en | extrapolation quadrilateral | extrapolation quadrilateral、extrapolation quadrilaterals | — | — | — |
| es | cuadrilátero de extrapolación | cuadrilátero de extrapolación、cuadriláteros de extrapolación | — | — | — |
| fr | quadrilatère d'extrapolation | quadrilatère d'extrapolation、quadrilatère d’extrapolation、quadrilatères d'extrapolation、quadrilatères d’extrapolation | — | — | — |
| id | segi empat ekstrapolasi | segi empat ekstrapolasi、segiempat ekstrapolasi | — | segi empat bantu | — |
| ja | 外挿四辺形 | 外挿四辺形 | — | — | — |
| ko | 외삽 사각형 | 외삽 사각형、외삽 사변형 | — | 외삽 사각 영역 | — |
| th | รูปสี่เหลี่ยมประมาณค่านอกช่วง | รูปสี่เหลี่ยมประมาณค่านอกช่วง、รูปสี่เหลี่ยมสำหรับการประมาณค่านอกช่วง | รูปสี่เหลี่ยมคาดคะเน、รูปสี่เหลี่ยมสำหรับการคาดคะเน、รูปสี่เหลี่ยมการอนุมาน、รูปสี่เหลี่ยมสำหรับการอนุมาน | — | — |
| vi | tứ giác ngoại suy | tứ giác ngoại suy、hình tứ giác ngoại suy | — | tứ giác ngoại vi | — |
| zh | 外推四边形 | 外推四边形、外插四边形 | — | 外延四边形、边界四边形 | — |
| zh-TW | 外插四邊形 | 外插四邊形、外推四邊形 | — | — | — |

## auxiliary-vertex

外挿四辺形の四隅と辺の上に置く頂点（隅の補助頂点・辺の補助頂点）。補完点とは別（システムが置く）

根拠キー `mapedit.tin_auxiliary_vertex`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW。先行登録キー: `mapedit.tin_auxiliary_vertex`

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | Hilfsknoten | Hilfsknoten、Eck-Hilfsknoten、Seiten-Hilfsknoten | — | Hilfspunkt | — |
| en | auxiliary vertex | auxiliary vertex、auxiliary vertices | — | supplement vertex | — |
| es | vértice auxiliar | vértice auxiliar、vértices auxiliares、vértice auxiliar de esquina、vértices auxiliares de esquina、vértice auxiliar de lado、vértices auxiliares de lado | — | punto auxiliar、vértice complementario | — |
| fr | sommet auxiliaire | sommet auxiliaire、sommets auxiliaires、sommet auxiliaire de coin、sommet auxiliaire de côté、sommets auxiliaires de coin、sommets auxiliaires de côté | — | point auxiliaire | — |
| id | simpul bantu | simpul bantu、simpul-simpul bantu、simpul bantu sudut、simpul bantu sisi、verteks bantu | — | — | — |
| ja | 補助頂点 | 補助頂点 | — | 補完頂点 | — |
| ko | 보조 정점 | 보조 정점、모서리 보조 정점、변 보조 정점 | — | 보완 정점、꼭짓점 | — |
| th | จุดยอดช่วย | จุดยอดช่วย、จุดยอดช่วยที่มุม、จุดยอดช่วยที่ขอบ | — | จุดเสริม | — |
| vi | đỉnh phụ trợ | đỉnh phụ trợ、các đỉnh phụ trợ、đỉnh phụ trợ ở góc、đỉnh phụ trợ ở cạnh | — | đỉnh bổ sung | — |
| zh | 辅助顶点 | 辅助顶点、角辅助顶点、边辅助顶点 | — | 补助顶点、辅助点 | — |
| zh-TW | 輔助頂點 | 輔助頂點、角輔助頂點、邊輔助頂點 | — | 補助頂點、補全頂點 | — |

## residual

変換後の位置と GCP の地理座標の GCP ごとのずれ（残差）。変換失敗や往復検査の誤差とは区別する

根拠キー `mapedit.crs_residuals_heading`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW。先行登録キー: `mapedit.crs_residuals_heading`

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | Residuum | Residuum、Residuen、Abweichung | — | — | — |
| en | residual | residual、residuals、offset、offsets | — | error | — |
| es | residual | residual、residuo、residuos、desviación | — | — | — |
| fr | résidu | résidu、résidus、écart | — | — | — |
| id | residual | residual、residu、selisih | — | — | — |
| ja | 残差 | 残差、ずれ | — | 誤差 | — |
| ko | 잔차 | 잔차、차이 | — | — | — |
| th | ค่าตกค้าง | ค่าตกค้าง、ความคลาดเคลื่อน | — | — | — |
| vi | phần dư | phần dư、độ lệch | — | — | — |
| zh | 残差 | 残差、偏差 | — | — | — |
| zh-TW | 殘差 | 殘差、偏差 | — | — | — |

## global-model

三角網＋大域外挿で四辺形の外に使う、world file が表す大域的なアフィン変換（大域モデル）

根拠キー `mapedit.crs_setup_fallback_notice`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW。先行登録キー: `mapedit.crs_setup_fallback_notice`

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | globales Modell | globales Modell、globale Modelle、Globalmodell | — | — | — |
| en | global model | global model、global models、global affine model | — | global settings、global configuration | — |
| es | modelo global | modelo global、modelos globales、modelo afín global | — | — | — |
| fr | modèle global | modèle global、modèles globaux、modèle affine global | — | — | — |
| id | model global | model global、model afine global | — | — | — |
| ja | 大域モデル | 大域モデル、グローバルモデル、大域アフィンモデル | — | 大域設定、全体モデル | — |
| ko | 전역 모델 | 전역 모델、글로벌 모델、전역 아핀 모델 | — | — | — |
| th | แบบจำลองโกลบอล | แบบจำลองโกลบอล、แบบจำลองทั่วทั้งแผนที่、แบบจำลองอะฟินโกลบอล | — | — | — |
| vi | mô hình toàn cục | mô hình toàn cục、mô hình affine toàn cục | — | — | — |
| zh | 全局模型 | 全局模型、全局仿射模型 | — | — | — |
| zh-TW | 全域模型 | 全域模型、全域仿射模型 | — | — | — |

## recommendation

score と閾値から示す推奨。採用を強制するものではない

根拠キー `mapedit.crs_setup_recommended_badge`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW。先行登録キー: `mapedit.crs_setup_recommended_badge`、`mapedit.crs_switch_recommended`、`mapedit.crs_keep_3857_recommended`

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | empfohlen | empfohlen、empfehl、empfohl | — | — | — |
| en | recommended | recommend、recommends、recommended、recommendation | — | required、mandatory | — |
| es | recomendado | recomendado、recomendada、recomendar、recomendación | — | — | — |
| fr | recommandé | recommandé、recommandée、recommander、recommandation | — | — | — |
| id | direkomendasikan | rekomendasi、direkomendasikan、merekomendasikan | — | — | — |
| ja | 推奨 | 推奨、おすすめ | — | 必須、強制 | — |
| ko | 권장 | 권장、추천 | — | — | — |
| th | แนะนำ | แนะนำ | — | — | — |
| vi | đề xuất | đề xuất、được đề xuất、khuyến nghị | — | — | — |
| zh | 推荐 | 推荐 | — | — | — |
| zh-TW | 建議 | 建議、推薦 | — | — | — |

## adoption

推定で選んだ CRS と変換の形を地図へ書き込む明示的な採用操作。比較・保存・自動更新とは区別する

根拠キー `mapedit.crs_adopt_button`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW。先行登録キー: `mapedit.crs_adopt_button`、`mapedit.crs_core_incompatible`、`mapedit.crs_reproject_error`、`mapedit.crs_setup_fallback_notice`

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | übernehmen | übernehmen、übernehm、übernommen | — | — | — |
| en | adopt | adopt、adopts、adopted、adopting、adoption、re-adopt | — | automatically adopt、automatic adoption | — |
| es | adoptar | adoptar、adoptado、adoptada、adopción、readoptar | — | — | — |
| fr | adopter | adopter、adopté、adoptée、adoption、réadopter | — | — | — |
| id | adopsi | adopsi、mengadopsi、diadopsi | — | — | — |
| ja | 採用 | 採用、適用 | — | 自動採用、自動で採用 | — |
| ko | 채택 | 채택、적용 | — | — | — |
| th | นำมาใช้ | นำมาใช้、การนำไปใช้、ใช้ | — | — | — |
| vi | áp dụng | áp dụng、chấp nhận、sử dụng | — | — | — |
| zh | 采用 | 采用、应用 | — | — | — |
| zh-TW | 採用 | 採用、套用 | — | — | — |

## fan-fallback

大域外挿を組めないときに四辺形の外を扇形外挿へ切り替えたことを知らせる通知。扇形外挿の形全般や内部の strict_error とは区別する

根拠キー `mapedit.crs_setup_fallback_notice`。必須形を求める言語: de, en, es, fr, id, ja, ko, th, vi, zh, zh-TW。先行登録キー: `mapedit.crs_setup_fallback_notice`

| 言語 | 代表語 | 許容形 | 統一前の形 | 禁止形 | 除外語 |
|---|---|---|---|---|---|
| de | Wechsel zum Fächermodus | Wechsel zum Fächermodus、zum Fächermodus gewechselt、Fächer-Extrapolation | — | — | — |
| en | switch to fan extrapolation | switch to fan extrapolation、switched to fan extrapolation、switch to fan mode、switched outer extrapolation to fan mode、switch outer extrapolation to fan mode | — | downgrade、fallback | — |
| es | cambio a modo abanico | cambio a modo abanico、cambiado a modo abanico、extrapolación en abanico | — | — | — |
| fr | passage en mode éventail | passage en mode éventail、passé en mode éventail、extrapolation en éventail | — | — | — |
| id | beralih ke mode kipas | beralih ke mode kipas、beralih ke ekstrapolasi kipas、ekstrapolasi kipas | — | — | — |
| ja | 扇形外挿への切り替え | 扇形外挿への切り替え、扇形外挿に切り替え、扇形への切り替え、扇形に切り替え、扇形（従来の外挿）に切り替え | — | 降格、フォールバック | — |
| ko | 부채꼴로 전환 | 부채꼴로 전환、부채꼴 모드로 전환、부채꼴 외삽 | — | — | — |
| th | สลับเป็นโหมดรูปพัด | สลับเป็นโหมดรูปพัด、สลับเป็นการประมาณค่านอกช่วงแบบรูปพัด、การประมาณค่านอกช่วงแบบรูปพัด | สลับเป็นการคาดคะเนแบบรูปพัด、การคาดคะเนแบบรูปพัด | — | — |
| vi | chuyển sang chế độ hình quạt | chuyển sang chế độ hình quạt、chuyển sang ngoại suy hình quạt、ngoại suy hình quạt | — | — | — |
| zh | 切换为扇形模式 | 切换为扇形模式、切换为扇形外推 | — | — | — |
| zh-TW | 切換為扇形模式 | 切換為扇形模式、切換為扇形外推、切換為扇形外插 | — | — | — |

