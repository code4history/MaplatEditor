# エディタ UI 用語集（生成物）

<!-- 生成物: 手で編集しない。`node scripts/editor-glossary-check.mjs --write` で作り直す。正本は docs/i18n/editor-glossary.json -->

正本は `editor-glossary.json`（概念・言語別の代表語・許容形・統一前の形・禁止形）と `editor-glossary.exceptions.json`（例外）。
検査は `node scripts/editor-glossary-check.mjs`（`pnpm smoke:editor-glossary`）。文言を設計する前に、ここで概念を探す。
正本と locale は同じ PR で変えられない（初版を除く）。新しい語・例外は、先に正本だけの PR を合流させてから locale の PR を出す。
まだ無いキーへの例外は、正本だけの PR の時点では警告（pending-key）になり、後の locale の PR でキーを足すと働く。手順は AGENTS.md の「UI Wording & Glossary」。

概念 26・結び付いたキー 504・例外 293（anchorExclusion 12・omission 100・untranslated 181）

| 概念 | 説明 | 根拠キー | 結び付け |
|---|---|---|---:|
| [asset](#asset) | 管理対象の画像・アイコン等。財務資産ではない | `navbar.assets` | 18 |
| [canvas](#canvas) | IIIF Manifest 内の canvas（コマ）。HTML canvas とは別 | `iiif_metadata.from_canvas` | 6 |
| [manifest](#manifest) | IIIF Presentation の Manifest。PWA の Web App Manifest は除外語で外す | `iiif_metadata.from_manifest` | 13 |
| [import](#import) | 外部データを取り込む操作 | `resource_list.import_map` | 48 |
| [export](#export) | 配布・交換用データを出す操作 | `editor_ui.export_button` | 37 |
| [configure](#configure) | 振る舞いを指定する画面・項目。データ主体の名詞にはしない（2026-10-21）。役割 screen（strict）と item（weak）に分ける | `navbar.settings` | 29 |
| [settings-file](#settings-file) | 地図・アプリ等の定義データを保持する主体（設定ファイル） | `appedit.source_advanced` | 7 |
| [map](#map) | 編集・公開する地図。ベースマップは別概念 | `navbar.edit_map` | 143 |
| [basemap](#basemap) | 古地図の下に敷く地図（ベースマップ） | `navbar.add_basemap` | 63 |
| [app](#app) | 地図と POI をまとめて公開するアプリ | `navbar.edit_app` | 53 |
| [poi](#poi) | 地図上の地点情報 | `navbar.edit_poi` | 61 |
| [source](#source) | POI ソース | `resource_list.kind_poi_source` | 34 |
| [citation](#citation) | 地図・ベースマップの出所（書誌的な典拠） | `mapedit.map_source` | 4 |
| [attribution](#attribution) | 地図画像・データの帰属（著作権表示） | `mapedit.map_copyright_pf` | 12 |
| [gcp](#gcp) | 地図画像と地理座標の対応点 | `editor_ui.tabs.gcps` | 15 |
| [bibliography](#bibliography) | IIIF 等から写す書誌情報。Maplat の地図メタデータ（editor_ui.tabs.metadata）とは別。代表語は ja・en だけ | `iiif_metadata.heading` | 9 |
| [tile](#tile) | 地図画像を分割した配信用画像。スタイル・TileJSON の tiles 配列・ベクタータイルセットは除外 | `editor_ui.tabs.merc` | 38 |
| [save](#save) | 編集内容を永続化する操作。エクスポート・端末キャッシュとは区別 | `common.save` | 57 |
| [overwrite](#overwrite) | 既存値の置換。POI import では同一 ID を更新し、無ければ追加 | `common.overwrite` | 9 |
| [override](#override) | 参照先を変えずに表示属性（タイトル・アイコン・非表示）だけを差し替える | `poiref.add_override` | 6 |
| [append](#append) | 既存 POI を置換せず全行を新規 POI として足す | `poiio.import_mode_append` | 1 |
| [viewer](#viewer) | エクスポートしたアプリの表示部（Maplat UI） | `appedit.border_ui_note` | 12 |
| [layer](#layer) | 地図のレイヤー・POI のレイヤー | `mapedit.edit_layer` | 13 |
| [preview](#preview) | エクスポートする前の確認表示 | `editor_ui.tabs.preview` | 20 |
| [publish-key](#publish-key) | エクスポートしたアプリが使う API キー（公開用キー） | `settings.default_publish_api_key_heading` | 5 |
| [server](#server) | MCP サーバー・タイルサーバー等 | `settings.mcp_tab` | 4 |

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
| zh | GCP | GCP、控制点 | — | — | — |
| zh-TW | GCP | GCP、控制點 | — | — | — |

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

