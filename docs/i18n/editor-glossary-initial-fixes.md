# エディタ UI 用語集の初版で直した訳の一覧

> **注意: この一覧の訳は、まだ人間が確認していません（未レビュー）。** 用語集の初版を入れたときに、既存の揺れを機械で見つけて直した訳です。各言語の担当のレビューで直してよく、ここに載っていることは訳文の承認を意味しません。

直した件数は 238 件（言語×キー）です。このほか、英語を直したキーで英語のまま残っていた他言語の値（未翻訳の写し）54 件を、新しい英語の文に揃えました（未翻訳のまま。翻訳は別の変更で行います）。

| 言語 | 直した件数 | 未翻訳の写しを揃えた件数 |
|---|---:|---:|
| de（ドイツ語） | 12 | 6 |
| en（英語） | 16 | 0 |
| es（スペイン語） | 10 | 6 |
| fr（フランス語） | 8 | 6 |
| id（インドネシア語） | 19 | 6 |
| ja（日本語） | 46 | 0 |
| ko（韓国語） | 22 | 6 |
| th（タイ語） | 64 | 6 |
| vi（ベトナム語） | 12 | 6 |
| zh（中国語（簡体字）） | 13 | 6 |
| zh-TW（中国語（繁体字）） | 16 | 6 |
| 計 | 238 | 54 |

概念と統一先の語は `docs/i18n/editor-glossary.md`（生成物）を見てください。日本語の `appedit.builtin_source_note` だけは機械の照合では見つからない揺れ（「設定」が定義データを指す）で、手で直しました。

## de（ドイツ語）: 12 件

| キー | 概念 | 変更前 | 変更後 |
|---|---|---|---|
| `appedit.export_key_prompt_description` | basemap | Der Veröffentlichungsschlüssel für den ausgewählten Anbieter ist nicht festgelegt. Er wird nur für diesen Export verwendet und nicht gespeichert. Bleibt das Feld leer, wird die entsprechende Hintergrundkarte nicht einbezogen. | Der Veröffentlichungsschlüssel für den ausgewählten Anbieter ist nicht festgelegt. Er wird nur für diesen Export verwendet und nicht gespeichert. Bleibt das Feld leer, wird die entsprechende Basiskarte nicht einbezogen. |
| `appedit.overlay_ui_note` | basemap | Eine Oberfläche, die die historische Karte halbtransparent über die Hintergrundkarte legt. Im Viewer erscheint ein Bedienelement zur Überlagerung. Enthält die App keine Basiskarte als Hintergrund, bleibt die Option wirkungslos. | Eine Oberfläche, die die historische Karte halbtransparent über die Basiskarte legt. Im Viewer erscheint ein Bedienelement zur Überlagerung. Enthält die App keine Basiskarte als Hintergrund, bleibt die Option wirkungslos. |
| `appedit.warn_provider_google_key_missing` | basemap | Die Google-Hintergrundkarte ist nicht enthalten, da kein API-Schlüssel festgelegt ist. Registrieren Sie einen Editor-Schlüssel unter Einstellungen > Basiskarte oder legen Sie den Schlüssel der App fest. | Die Google-Basiskarte ist nicht enthalten, da kein API-Schlüssel festgelegt ist. Registrieren Sie einen Editor-Schlüssel unter Einstellungen > Basiskarte oder legen Sie den Schlüssel der App fest. |
| `appedit.warn_provider_mapbox_key_missing` | basemap | Die Mapbox-Hintergrundkarte ist nicht enthalten, da kein API-Schlüssel festgelegt ist. Registrieren Sie einen Editor-Schlüssel unter Einstellungen > Basiskarte oder legen Sie den Schlüssel der App fest. | Die Mapbox-Basiskarte ist nicht enthalten, da kein API-Schlüssel festgelegt ist. Registrieren Sie einen Editor-Schlüssel unter Einstellungen > Basiskarte oder legen Sie den Schlüssel der App fest. |
| `basemap.google.default_license_note` | attribution | Es gelten die Nutzungsbedingungen der Google Maps Platform. Die Attribution muss sichtbar bleiben. | Es gelten die Nutzungsbedingungen der Google Maps Platform. Die Quellenangabe muss sichtbar bleiben. |
| `basemap.modal.data_attr_label` | attribution | Datenattribution | Quellenangabe der Daten |
| `dataupload.error_upload` | import | Beim Registrieren der Kartendaten ist ein Fehler aufgetreten. | Beim Importieren der Kartendaten ist ein Fehler aufgetreten. |
| `dataupload.success_upload` | import | Die Kartendaten wurden erfolgreich registriert. | Die Kartendaten wurden erfolgreich importiert. |
| `mapedit.map_gcp_copyright` | attribution | Datenattribution | Quellenangabe der Daten |
| `poiedit.layer_icon` | layer | Layer-Symbol | Ebenensymbol |
| `poiedit.layer_metadata` | layer | Layer-Metadaten | Ebenen-Metadaten |
| `poiedit.layer_selected_icon` | layer | Layer-Symbol (ausgewählt) | Ebenensymbol (ausgewählt) |

## en（英語）: 16 件

| キー | 概念 | 変更前 | 変更後 |
|---|---|---|---|
| `appedit.export_key_prompt_description` | basemap | The publish key for the selected provider is not set. It will be used only for this export and will not be saved. If left blank, the corresponding background map will not be included. | The publish key for the selected provider is not set. It will be used only for this export and will not be saved. If left blank, the corresponding base map will not be included. |
| `appedit.overlay_ui_note` | basemap | A UI that overlays the historical map semi-transparently on top of the background map. An overlay control appears in the viewer. If the app contains no base map to serve as the background, turning it on has no effect. | A UI that overlays the historical map semi-transparently on top of the base map. An overlay control appears in the viewer. If the app contains no base map to serve as the background, turning it on has no effect. |
| `appedit.selected_sources` | app | Selected Maps | Maps in this app |
| `appedit.warn_provider_google_key_missing` | basemap | The Google background map is not included because no API key is set. Register an editor key under Settings > Base Map, or set the app's key. | The Google base map is not included because no API key is set. Register an editor key under Settings > Base Map, or set the app's key. |
| `appedit.warn_provider_mapbox_key_missing` | basemap | The Mapbox background map is not included because no API key is set. Register an editor key under Settings > Base Map, or set the app's key. | The Mapbox base map is not included because no API key is set. Register an editor key under Settings > Base Map, or set the app's key. |
| `basemap.tilejson.import` | import | Import | Load |
| `basemap.tilejson.importing` | import | Importing... | Loading... |
| `common.revision_conflict` | asset | This asset was updated in another window. | This item was updated in another window. |
| `iiif_import.verdict.metadata_only` | bibliography | Metadata only from IIIF | Bibliographic data only from IIIF |
| `iiif_metadata.canvas_heading` | bibliography | Metadata of this canvas | Bibliographic data of this canvas |
| `iiif_metadata.copy_failed.unknown` | bibliography | The metadata could not be copied. | The bibliographic data could not be copied. |
| `iiif_metadata.heading` | bibliography | Binding to the IIIF metadata | Binding to the IIIF bibliographic data |
| `iiif_metadata.manifest_heading` | bibliography | Manifest metadata | Manifest bibliographic data |
| `iiif_metadata.readonly_heading` | bibliography | Metadata copied from IIIF | Bibliographic data copied from IIIF |
| `mapedit.map_mapper_desc` | gcp | Enter the person who did mapping GCPs od the map. | Enter the person who did the mapping. |
| `mapedit.map_mapper_pf` | gcp | Enter the person who did mapping GCPs od the map. | Enter the person who did the mapping. |

## es（スペイン語）: 10 件

| キー | 概念 | 変更前 | 変更後 |
|---|---|---|---|
| `appedit.export_key_prompt_description` | basemap | La clave de publicación del proveedor seleccionado no está configurada. Se usará solo para esta exportación y no se guardará. Si se deja en blanco, el mapa de fondo correspondiente no se incluirá. | La clave de publicación del proveedor seleccionado no está configurada. Se usará solo para esta exportación y no se guardará. Si se deja en blanco, el mapa base correspondiente no se incluirá. |
| `appedit.overlay_ui_note` | basemap | Una interfaz que superpone el mapa histórico de forma semitransparente sobre el mapa de fondo. En el visor aparece un control de superposición. Si la aplicación no incluye ningún mapa base que sirva de fondo, activarlo no tiene efecto. | Una interfaz que superpone el mapa histórico de forma semitransparente sobre el mapa base. En el visor aparece un control de superposición. Si la aplicación no incluye ningún mapa base que sirva de fondo, activarlo no tiene efecto. |
| `appedit.provider_source_note` | tile | La URL del mosaico se genera automáticamente a partir de la clave de API y el tipo, por lo que no es necesario introducirla manualmente. | La URL de las teselas se genera automáticamente a partir de la clave de API y el tipo, por lo que no es necesario introducirla manualmente. |
| `appedit.warn_provider_google_key_missing` | basemap | El mapa de fondo de Google no se incluye porque no hay una clave API configurada. Registre una clave de editor en Configuración > Mapa base, o configure la clave de la app. | El mapa base de Google no se incluye porque no hay una clave API configurada. Registre una clave de editor en Configuración > Mapa base, o configure la clave de la app. |
| `appedit.warn_provider_mapbox_key_missing` | basemap | El mapa de fondo de Mapbox no se incluye porque no hay una clave API configurada. Registre una clave de editor en Configuración > Mapa base, o configure la clave de la app. | El mapa base de Mapbox no se incluye porque no hay una clave API configurada. Registre una clave de editor en Configuración > Mapa base, o configure la clave de la app. |
| `dataupload.error_upload` | import | Se ha producido un error al registrar los datos del mapa. | Se ha producido un error al importar los datos del mapa. |
| `dataupload.success_upload` | import | Los datos del mapa se han registrado correctamente. | Los datos del mapa se han importado correctamente. |
| `poiref.icon_override` | override | Icono de reemplazo | Icono sobrescrito |
| `poiref.override_title` | override | Título de reemplazo | Título sobrescrito |
| `poiref.selected_icon_override` | override | Icono de reemplazo al seleccionar | Icono sobrescrito al seleccionar |

## fr（フランス語）: 8 件

| キー | 概念 | 変更前 | 変更後 |
|---|---|---|---|
| `appedit.overlay_ui_note` | basemap | Une interface qui superpose la carte ancienne en semi-transparence sur la carte de fond. Un contrôle de superposition apparaît dans la visionneuse. Si l’application ne contient aucune carte de base servant de fond, l’activer reste sans effet. | Une interface qui superpose la carte ancienne en semi-transparence sur le fond de carte. Un contrôle de superposition apparaît dans la visionneuse. Si l’application ne contient aucun fond de carte servant d’arrière-plan, l’activer reste sans effet. |
| `basemap.kind.select_prompt` | basemap | Sélectionnez le type de carte de base. | Sélectionnez le type de fond de carte. |
| `dataupload.error_upload` | import | Une erreur s'est produite lors de l'enregistrement des données de carte. | Une erreur s'est produite lors de l'importation des données de carte. |
| `dataupload.success_upload` | import | Les données de carte ont été enregistrées avec succès. | Les données de carte ont été importées avec succès. |
| `field_help.display_label` | viewer | Un nom court affiché dans le sélecteur de sources du visualiseur. | Un nom court affiché dans le sélecteur de sources de la visionneuse. |
| `mapedit.error_image_memory_limit` | configure | Le décodage de cette image de carte nécessite environ {{required}} Mo, mais le réglage actuel est de {{configured}} Mo. Augmentez « Limite de mémoire de décodage JPEG » dans la page Réglages à {{recommended}} Mo ou plus. | Le décodage de cette image de carte nécessite environ {{required}} Mo, mais le réglage actuel est de {{configured}} Mo. Augmentez « Limite de mémoire de décodage JPEG » dans la page Paramètres à {{recommended}} Mo ou plus. |
| `mapedit.error_image_resolution_limit` | configure | Cette image de carte fait environ {{megapixels}} MP, mais le réglage actuel est de {{configured}} MP. Augmentez « Limite de résolution JPEG » dans la page Réglages à {{recommended}} MP ou plus. | Cette image de carte fait environ {{megapixels}} MP, mais le réglage actuel est de {{configured}} MP. Augmentez « Limite de résolution JPEG » dans la page Paramètres à {{recommended}} MP ou plus. |
| `settings.editor_api_key_notice` | map | Utilisées pour l'affichage du fond de carte en édition, l'aperçu et la génération de vignettes. Considérée comme un secret interne qui ne peut pas être restreint, veuillez donc émettre une clé distincte de la clé de publication. | Utilisée pour l'affichage de l'arrière-plan lors de l'édition de carte, l'aperçu et la génération de vignettes. Considérée comme un secret interne qui ne peut pas être restreint, veuillez donc émettre une clé distincte de la clé de publication. |

## id（インドネシア語）: 19 件

| キー | 概念 | 変更前 | 変更後 |
|---|---|---|---|
| `appedit.export_key_prompt_description` | basemap | Kunci publikasi untuk penyedia yang dipilih belum diatur. Kunci ini hanya akan digunakan untuk ekspor ini dan tidak akan disimpan. Jika dibiarkan kosong, peta latar yang sesuai tidak akan disertakan. | Kunci publikasi untuk penyedia yang dipilih belum diatur. Kunci ini hanya akan digunakan untuk ekspor ini dan tidak akan disimpan. Jika dibiarkan kosong, peta dasar yang sesuai tidak akan disertakan. |
| `appedit.overlay_ui_note` | basemap | Antarmuka yang menampilkan peta lama secara semitransparan di atas peta latar. Kendali overlay muncul di penampil. Jika aplikasi tidak memuat peta dasar sebagai latar, mengaktifkannya tidak berpengaruh. | Antarmuka yang menampilkan peta lama secara semitransparan di atas peta dasar. Kendali overlay muncul di penampil. Jika aplikasi tidak memuat peta dasar sebagai latar, mengaktifkannya tidak berpengaruh. |
| `appedit.warn_mixed_pois` | viewer | Data POI mencampur format GeoJSON dan format lain. Mungkin tidak ditampilkan dengan benar di viewer. Konversikan POI format lama ke GeoJSON. | Data POI mencampur format GeoJSON dan format lain. Mungkin tidak ditampilkan dengan benar di penampil. Konversikan POI format lama ke GeoJSON. |
| `appedit.warn_provider_google_key_missing` | basemap | Peta latar Google tidak disertakan karena kunci API belum diatur. Daftarkan kunci editor di Pengaturan > Peta Dasar, atau atur kunci aplikasi. | Peta dasar Google tidak disertakan karena kunci API belum diatur. Daftarkan kunci editor di Pengaturan > Peta Dasar, atau atur kunci aplikasi. |
| `appedit.warn_provider_mapbox_key_missing` | basemap | Peta latar Mapbox tidak disertakan karena kunci API belum diatur. Daftarkan kunci editor di Pengaturan > Peta Dasar, atau atur kunci aplikasi. | Peta dasar Mapbox tidak disertakan karena kunci API belum diatur. Daftarkan kunci editor di Pengaturan > Peta Dasar, atau atur kunci aplikasi. |
| `dataupload.error_upload` | import | Terjadi kesalahan saat mendaftarkan data peta. | Terjadi kesalahan saat mengimpor data peta. |
| `dataupload.success_upload` | import | Data peta berhasil didaftarkan. | Data peta berhasil diimpor. |
| `mapedit.draft_tiles_lost` | gcp | Data sementara untuk gambar peta tidak dapat ditemukan. Silakan unggah gambar lagi. Suntingan Anda yang lain (titik kontrol, metadata, dll.) tetap tersimpan. | Data sementara untuk gambar peta tidak dapat ditemukan. Silakan unggah gambar lagi. Suntingan Anda yang lain (titik korespondensi, metadata, dll.) tetap tersimpan. |
| `mapedit.export_option_json` | settings-file | Berkas pengaturan peta (JSON dan POI) | File pengaturan peta (JSON dan POI) |
| `merc.generate_not_ready` | gcp | Tidak dapat dijalankan karena titik kontrol (GCP) belum lengkap, atau tile sudah mutakhir. | Tidak dapat dijalankan karena titik korespondensi (GCP) belum lengkap, atau tile sudah mutakhir. |
| `merc.tab_description` | gcp | Buat set tile Mercator dari titik kontrol (GCP) peta ini dan daftarkan sebagai peta dasar. | Buat set tile Mercator dari titik korespondensi (GCP) peta ini dan daftarkan sebagai peta dasar. |
| `poiedit.layer_icon` | layer | Ikon Layer | Ikon Lapisan |
| `poiedit.layer_metadata` | layer | Metadata Layer | Metadata Lapisan |
| `poiedit.layer_selected_icon` | layer | Ikon Layer (dipilih) | Ikon Lapisan (dipilih) |
| `poiref.icon_override` | override | Ikon pengganti | Ikon timpaan |
| `poiref.layer_key_missing_warning` | viewer | Elemen ini tidak memiliki pengenal lapisan (id), sehingga viewer akan gagal menampilkan keseluruhan data POI ini. Rapikan dengan mengonversinya ke GeoJSON (jika dapat dikonversi) atau menghapusnya. | Elemen ini tidak memiliki pengenal lapisan (id), sehingga penampil akan gagal menampilkan keseluruhan data POI ini. Rapikan dengan mengonversinya ke GeoJSON (jika dapat dikonversi) atau menghapusnya. |
| `poiref.mixed_layer_warning` | viewer | Data POI berformat GeoJSON dan format lainnya tercampur. Viewer tidak dapat menampilkan larik ini dengan benar. Konversikan ke GeoJSON dan rapikan. | Data POI berformat GeoJSON dan format lainnya tercampur. Penampil tidak dapat menampilkan larik ini dengan benar. Konversikan ke GeoJSON dan rapikan. |
| `poiref.override_title` | override | Judul pengganti | Judul timpaan |
| `poiref.selected_icon_override` | override | Ikon pengganti saat dipilih | Ikon timpaan saat dipilih |

## ja（日本語）: 46 件

| キー | 概念 | 変更前 | 変更後 |
|---|---|---|---|
| `appedit.builtin_source_note` | configure | ビューア内蔵のベースマップです。設定はビューア側定義を使用します。 | ビューア内蔵のベースマップです。ビューア側の定義を使用します。 |
| `appedit.cache_ui_note` | export | 一度読み込んだタイルを端末へ保存し、次回以降やオフラインでも表示できるようにする設定です。書き出し時に Service Worker を同梱します。PWA が前提のため、「PWA」がオフのときは設定できません。 | 一度読み込んだタイルを端末へ保存し、次回以降やオフラインでも表示できるようにする設定です。エクスポート時に Service Worker を同梱します。PWA が前提のため、「PWA」がオフのときは設定できません。 |
| `appedit.description_note` | export | このアプリの説明文です。書き出したアプリの index.html の meta description と OGP（og:description）、およびアプリ JSON の description に出力されます。検索結果や SNS の共有カードに出る要約なので、1〜2 文で簡潔に書いてください。 | このアプリの説明文です。エクスポートしたアプリの index.html の meta description と OGP（og:description）、およびアプリ JSON の description に出力されます。検索結果や SNS の共有カードに出る要約なので、1〜2 文で簡潔に書いてください。 |
| `appedit.error_missing_base_map_master` | export | このソースのベースマップが見つかりません。書き出しとプレビューから除外されます。 | このソースのベースマップが見つかりません。エクスポートとプレビューから除外されます。 |
| `appedit.export_key_prompt_continue` | export | この内容で書き出す | この内容でエクスポート |
| `appedit.export_key_prompt_description` | export, basemap | 選択した提供元の公開用キーが未設定です。今回の書き出しにのみ使用し、保存はされません。空欄のまま書き出すと、該当する背景地図は含まれません。 | 選択した提供元の公開用キーが未設定です。今回のエクスポートにのみ使用し、保存はされません。空欄のままエクスポートすると、該当するベースマップは含まれません。 |
| `appedit.extra_info_note` | export | このアプリについての自由記述のメモです。エディタの中だけに保存され、プレビューにも書き出したアプリにも出力されません。公開したい説明は「説明」欄へ書いてください。 | このアプリについての自由記述のメモです。エディタの中だけに保存され、プレビューにもエクスポートしたアプリにも出力されません。公開したい説明は「説明」欄へ書いてください。 |
| `appedit.maplibre_export_warning_continue` | export | このまま書き出す | このままエクスポート |
| `appedit.maplibre_export_warning_detail` | export | {{reasons}}<br><br>表示するには、アプリ管理の画面の「MapLibre GL JS の版」で 6 系に切り替えて保存してから、もう一度書き出してください。 | {{reasons}}<br><br>表示するには、アプリ管理の画面の「MapLibre GL JS の版」で 6 系に切り替えて保存してから、もう一度エクスポートしてください。 |
| `appedit.maplibre_version_6_confirm_detail` | export | 1. 新しいスタイルの機能（例: line-layer-opacity）が使えるようになります。<br>2. 書き出したアプリを見るブラウザに import map と WebGL 2 への対応が要ります。古いブラウザ（例: Safari 16.3 以前）では地図が表示されません。<br>3. 書き出したアプリを Content-Security-Policy 付きで配るときは、script-src https://cdn.jsdelivr.net と worker-src blob: の許可が要ります。 | 1. 新しいスタイルの機能（例: line-layer-opacity）が使えるようになります。<br>2. エクスポートしたアプリを見るブラウザに import map と WebGL 2 への対応が要ります。古いブラウザ（例: Safari 16.3 以前）では地図が表示されません。<br>3. エクスポートしたアプリを Content-Security-Policy 付きで配るときは、script-src https://cdn.jsdelivr.net と worker-src blob: の許可が要ります。 |
| `appedit.maplibre_version_note` | export | プレビューと書き出したアプリで MapLibre のベースマップを表示するときに使う版です。6 系は新しいスタイルの機能に対応しますが、import map と WebGL 2 に対応したブラウザが要ります。 | プレビューとエクスポートしたアプリで MapLibre のベースマップを表示するときに使う版です。6 系は新しいスタイルの機能に対応しますが、import map と WebGL 2 に対応したブラウザが要ります。 |
| `appedit.overlay_ui_note` | basemap | 古地図を背景地図の上に半透明で重ねて表示する UI です。ビューアに重ね合わせの操作子が出ます。背景となるベースマップがアプリに含まれていないときは、オンにしても無効になります。 | 古地図をベースマップの上に半透明で重ねて表示する UI です。ビューアに重ね合わせの操作子が出ます。背景となるベースマップがアプリに含まれていないときは、オンにしても無効になります。 |
| `appedit.pwa_manifest_note` | export | 書き出したアプリを PWA（ホーム画面へ追加して単独アプリのように使える形）として配信する設定です。オンにすると Web App Manifest を出力し、下に「マニフェスト設定」欄が現れます。オフのときは「キャッシュ」も設定できません。 | エクスポートしたアプリを PWA（ホーム画面へ追加して単独アプリのように使える形）として配信する設定です。オンにすると Web App Manifest を出力し、下に「マニフェスト設定」欄が現れます。オフのときは「キャッシュ」も設定できません。 |
| `appedit.warn_merc_name_collision` | export | 同じ名前で異なるメルカトルタイルセットが複数あったため、最初の1件のみ書き出しました。 | 同じ名前で異なるメルカトルタイルセットが複数あったため、最初の1件のみエクスポートしました。 |
| `appedit.warn_provider_google_key_missing` | basemap | Google の背景地図は API キー未設定のため含まれません。設定 > ベースマップ でエディタ用キーを登録するか、アプリのキーを設定してください。 | Google のベースマップは API キー未設定のため含まれません。設定 > ベースマップ でエディタ用キーを登録するか、アプリのキーを設定してください。 |
| `appedit.warn_provider_mapbox_key_missing` | basemap | Mapbox の背景地図は API キー未設定のため含まれません。設定 > ベースマップ でエディタ用キーを登録するか、アプリのキーを設定してください。 | Mapbox のベースマップは API キー未設定のため含まれません。設定 > ベースマップ でエディタ用キーを登録するか、アプリのキーを設定してください。 |
| `assetlist.errors.invalid` | import | 画像を取り込めませんでした | 画像をインポートできませんでした |
| `basemap.attribution` | attribution | 帰属表示 | 帰属表記 |
| `basemap.errors.tilejson_http_status` | server | TileJSON の取得に失敗しました（サーバエラー）。 | TileJSON の取得に失敗しました（サーバーエラー）。 |
| `basemap.source_metadata` | citation | 出典の情報（任意） | 典拠の情報（任意） |
| `dataio.csv_override_confirm` | import | GCPは既に登録済みです。CSVを読み込むとGCPはリセットされますが、よろしいですか? | GCPは既に登録済みです。CSVをインポートするとGCPはリセットされますが、よろしいですか? |
| `dataio.export_title` | export | データセット出力 | データセットのエクスポート |
| `dataio.import_csv` | import | CSV入力 | CSVインポート |
| `dataio.import_csv_status` | import | 入力設定エラー状態 | インポート設定エラー状態 |
| `dataio.import_csv_submit` | import | CSVファイル入力 | CSVファイルをインポート |
| `dataio.import_map_data` | import | 地図データ入力 | 地図データのインポート |
| `dataio.import_title` | import | データセット入力 | データセットのインポート |
| `dataupload.error_corrupt` | import | 地図データの ZIP が壊れているため取り込めません。 | 地図データの ZIP が壊れているためインポートできません。 |
| `dataupload.error_no_json` | import | 地図の設定ファイル（JSON）が含まれていないため取り込めません | 地図の設定ファイル（JSON）が含まれていないためインポートできません |
| `dataupload.error_too_large` | import | 地図データの ZIP が大きすぎます（2 GiB を超えるものは取り込めません）。 | 地図データの ZIP が大きすぎます（2 GiB を超えるものはインポートできません）。 |
| `dataupload.error_upload` | import | 地図データ登録でエラーが発生しました。 | 地図データのインポートでエラーが発生しました。 |
| `dataupload.success_upload` | import | 正常に地図データが登録できました。 | 地図データを正常にインポートできました。 |
| `editor_ui.export_dirty_prompt` | export | 未保存の変更があります。出力方法を選んでください。 | 未保存の変更があります。エクスポートの方法を選んでください。 |
| `iiif_import.canvas_heading` | import | 取り込むコマを選ぶ | インポートするコマを選ぶ |
| `iiif_import.error.stage_failed` | import | 取り込みの準備ができませんでした。 | インポートの準備ができませんでした。 |
| `iiif_import.open` | import | IIIF から取り込む | IIIF からインポート |
| `iiif_import.thumbnail_unavailable` | import | この画像サービスではサムネイルを作れませんでした。取り込みは続けます。 | この画像サービスではサムネイルを作れませんでした。インポートは続けます。 |
| `iiif_import.title` | import | IIIF から地図を取り込む | IIIF から地図をインポート |
| `mapedit.confirm_long_image_import` | import | この地図画像は約 {{megapixels}} MP と非常に大きく、取り込みに長い時間がかかります (100 MP で約5分、400 MP では1時間以上)。開始すると途中で取り消せません。実施しますか? | この地図画像は約 {{megapixels}} MP と非常に大きく、インポートに長い時間がかかります (100 MP で約5分、400 MP では1時間以上)。開始すると途中で取り消せません。実施しますか? |
| `mapedit.data_io` | import, export | データ入出力 | データのインポート/エクスポート |
| `mapedit.error_image_machine_limit` | import | この地図画像は約 {{megapixels}} MP あり、展開に約 {{required}} MB の作業領域が必要ですが、このアプリが使える上限は約 {{available}} MB です。画像を縮小してから取り込んでください。 | この地図画像は約 {{megapixels}} MP あり、展開に約 {{required}} MB の作業領域が必要ですが、このアプリが使える上限は約 {{available}} MB です。画像を縮小してからインポートしてください。 |
| `mapedit.export_map_data` | export | 地図データ出力 | 地図データのエクスポート |
| `mapedit.export_success` | export | 出力成功しました。 | エクスポートに成功しました。 |
| `mapedit.message_export` | export | 出力用地図データを準備しています。 | エクスポート用の地図データを準備しています。 |
| `poiedit.add_reference_asset` | asset | 素材を追加 | アセットを追加 |
| `poiedit.reference_assets` | asset | 参照素材 | 参照アセット |

## ko（韓国語）: 22 件

| キー | 概念 | 変更前 | 変更後 |
|---|---|---|---|
| `appedit.export_key_prompt_description` | basemap | 선택한 제공자의 공개용 키가 설정되지 않았습니다. 이번 내보내기에만 사용되며 저장되지 않습니다. 비워두면 해당 배경 지도가 포함되지 않습니다. | 선택한 제공자의 공개용 키가 설정되지 않았습니다. 이번 내보내기에만 사용되며 저장되지 않습니다. 비워두면 해당 베이스맵이 포함되지 않습니다. |
| `appedit.maplibre_export_warning_message` | basemap | 이 앱의 일부 MapLibre 배경 지도는 MapLibre GL JS 6이 필요하므로 버전 5에서는 표시되지 않습니다. | 이 앱의 일부 MapLibre 베이스맵은 MapLibre GL JS 6이 필요하므로 버전 5에서는 표시되지 않습니다. |
| `appedit.maplibre_version_note` | basemap | 미리보기와 내보낸 앱에서 MapLibre 배경 지도를 표시할 때 사용하는 MapLibre GL JS 버전입니다. 버전 6은 새로운 스타일 기능을 지원하지만 import map과 WebGL 2를 지원하는 브라우저가 필요합니다. | 미리보기와 내보낸 앱에서 MapLibre 베이스맵을 표시할 때 사용하는 MapLibre GL JS 버전입니다. 버전 6은 새로운 스타일 기능을 지원하지만 import map과 WebGL 2를 지원하는 브라우저가 필요합니다. |
| `appedit.maplibre_version_warning` | basemap | 배경 지도 "{{name}}"은(는) MapLibre GL JS 6이 필요한 기능({{reasons}})을 사용하므로 버전 5에서는 표시되지 않습니다. | 베이스맵 "{{name}}"은(는) MapLibre GL JS 6이 필요한 기능({{reasons}})을 사용하므로 버전 5에서는 표시되지 않습니다. |
| `appedit.maplibre_version_warning_unknown` | basemap | 배경 지도 "{{name}}"이(가) MapLibre GL JS 5에서 동작하는지 확인할 수 없습니다({{reasons}}). | 베이스맵 "{{name}}"이(가) MapLibre GL JS 5에서 동작하는지 확인할 수 없습니다({{reasons}}). |
| `appedit.overlay_ui_note` | basemap | 고지도를 배경 지도 위에 반투명하게 겹쳐 표시하는 UI입니다. 뷰어에 겹쳐 보기 조작자가 표시됩니다. 배경이 될 베이스맵이 앱에 포함되어 있지 않으면 켜도 동작하지 않습니다. | 고지도를 베이스맵 위에 반투명하게 겹쳐 표시하는 UI입니다. 뷰어에 겹쳐 보기 조작자가 표시됩니다. 배경이 될 베이스맵이 앱에 포함되어 있지 않으면 켜도 동작하지 않습니다. |
| `appedit.warn_provider_google_key_missing` | basemap | API 키가 설정되지 않아 Google 배경 지도가 포함되지 않습니다. 설정 > 베이스맵에서 에디터용 키를 등록하거나 앱의 키를 설정하세요. | API 키가 설정되지 않아 Google 베이스맵이 포함되지 않습니다. 설정 > 베이스맵에서 에디터용 키를 등록하거나 앱의 키를 설정하세요. |
| `appedit.warn_provider_mapbox_key_missing` | basemap | API 키가 설정되지 않아 Mapbox 배경 지도가 포함되지 않습니다. 설정 > 베이스맵에서 에디터용 키를 등록하거나 앱의 키를 설정하세요. | API 키가 설정되지 않아 Mapbox 베이스맵이 포함되지 않습니다. 설정 > 베이스맵에서 에디터용 키를 등록하거나 앱의 키를 설정하세요. |
| `basemap.source_description_pf` | basemap | 배경 지도의 설명을 입력하세요. | 베이스맵의 설명을 입력하세요. |
| `dataio.csv_override_confirm` | import | GCP가 이미 등록되어 있습니다. CSV를 불러오면 GCP가 초기화되는데, 계속하시겠습니까? | GCP가 이미 등록되어 있습니다. CSV를 가져오면 GCP가 초기화되는데, 계속하시겠습니까? |
| `dataio.export_title` | export | 데이터셋 출력 | 데이터셋 내보내기 |
| `dataio.import_csv` | import | CSV 입력 | CSV 가져오기 |
| `dataio.import_csv_status` | import | 입력 설정 오류 상태 | 가져오기 설정 오류 상태 |
| `dataio.import_csv_submit` | import | CSV 파일 입력 | CSV 파일 가져오기 |
| `dataio.import_map_data` | import | 지도 데이터 입력 | 지도 데이터 가져오기 |
| `dataio.import_title` | import | 데이터셋 입력 | 데이터셋 가져오기 |
| `dataupload.error_upload` | import | 지도 데이터 등록 중 오류가 발생했습니다. | 지도 데이터를 가져오는 중 오류가 발생했습니다. |
| `dataupload.success_upload` | import | 지도 데이터가 정상적으로 등록되었습니다. | 지도 데이터 가져오기에 성공했습니다. |
| `mapedit.data_io` | import, export | 데이터 입출력 | 데이터 가져오기/내보내기 |
| `mapedit.export_map_data` | export | 지도 데이터 출력 | 지도 데이터 내보내기 |
| `mapedit.export_success` | export | 출력에 성공했습니다. | 내보내기에 성공했습니다. |
| `mapedit.message_export` | export | 출력용 지도 데이터를 준비하고 있습니다. | 내보낼 지도 데이터를 준비하고 있습니다. |

## th（タイ語）: 64 件

| キー | 概念 | 変更前 | 変更後 |
|---|---|---|---|
| `appedit.app_coverage` | app | พื้นที่เป้าหมายของแอป | พื้นที่เป้าหมายของแอปพลิเคชัน |
| `appedit.app_coverage_modal_help` | app | กรุณาลากเพื่อระบุขอบเขตโดยประมาณที่แอปนี้มุ่งเน้น (พื้นที่เป้าหมายของแอป) ข้อมูลอ้างอิง | กรุณาลากเพื่อระบุขอบเขตโดยประมาณที่แอปพลิเคชันนี้มุ่งเน้น (พื้นที่เป้าหมายของแอปพลิเคชัน) ข้อมูลอ้างอิง |
| `appedit.app_coverage_modal_title` | app | ระบุพื้นที่เป้าหมายของแอป | ระบุพื้นที่เป้าหมายของแอปพลิเคชัน |
| `appedit.app_coverage_note` | app | ขอบเขตโดยประมาณที่แอปนี้มุ่งเน้น ใช้เป็นแนวทางและจุดยึดเมื่อวาดขอบเขตการใช้งานของแต่ละแผนที่ และใช้ในการกรองรายการแอปด้วย เป็นค่าอ้างอิงและไม่ได้ห้ามการใช้แผนที่นอกขอบเขตนี้ | ขอบเขตโดยประมาณที่แอปพลิเคชันนี้มุ่งเน้น ใช้เป็นแนวทางและจุดยึดเมื่อวาดขอบเขตการใช้งานของแต่ละแผนที่ และใช้ในการกรองรายการแอปพลิเคชันด้วย เป็นค่าอ้างอิงและไม่ได้ห้ามการใช้แผนที่นอกขอบเขตนี้ |
| `appedit.builtin_source_note` | viewer | นี่คือแผนที่พื้นฐานในตัวของตัวแสดงผล การตั้งค่าจะใช้ตามที่กำหนดไว้ในฝั่งตัวแสดงผล | นี่คือแผนที่พื้นฐานในตัวของโปรแกรมดู การตั้งค่าจะใช้ตามที่กำหนดไว้ในฝั่งโปรแกรมดู |
| `appedit.description_note` | app | คำอธิบายของแอปนี้ ค่านี้จะถูกส่งออกไปยัง meta description และ OGP (og:description) ของ index.html ที่ส่งออก รวมถึงฟิลด์ description ของ JSON ของแอป ข้อความนี้จะปรากฏเป็นบทสรุปในผลการค้นหาและการ์ดแชร์บนโซเชียล จึงควรเขียนให้กระชับภายในหนึ่งถึงสองประโยค | คำอธิบายของแอปพลิเคชันนี้ ค่านี้จะถูกส่งออกไปยัง meta description และ OGP (og:description) ของ index.html ที่ส่งออก รวมถึงฟิลด์ description ของ JSON ของแอปพลิเคชัน ข้อความนี้จะปรากฏเป็นบทสรุปในผลการค้นหาและการ์ดแชร์บนโซเชียล จึงควรเขียนให้กระชับภายในหนึ่งถึงสองประโยค |
| `appedit.envelope_help` | app | ขอบเขตที่แอปนี้ใช้แผนที่นี้จริง เป็นขอบเขตเดียวที่ส่งต่อไปยังแอป และกำหนดขอบเขตการส่งไทล์กับขอบเขตของการดาวน์โหลดแบบรวม จะถูกตัดให้อยู่ภายในขอบเขตที่มีอยู่ของแผนที่พื้นฐาน และจะยึดกับพื้นที่เป้าหมายของแอปแต่สามารถล้ำออกไปได้ | ขอบเขตที่แอปพลิเคชันนี้ใช้แผนที่นี้จริง เป็นขอบเขตเดียวที่ส่งต่อไปยังแอปพลิเคชัน และกำหนดขอบเขตการส่งไทล์กับขอบเขตของการดาวน์โหลดแบบรวม จะถูกตัดให้อยู่ภายในขอบเขตที่มีอยู่ของแผนที่พื้นฐาน และจะยึดกับพื้นที่เป้าหมายของแอปพลิเคชันแต่สามารถล้ำออกไปได้ |
| `appedit.envelope_modal_help_with_coverage` | app | สีฟ้าอ่อน = ขอบเขตที่มีอยู่ของแผนที่นี้, สีเขียวอ่อน = พื้นที่เป้าหมายของแอป บริเวณใกล้ขอบจะยึดติดอัตโนมัติ และเมื่อยืนยันจะถูกตัดให้อยู่ภายในขอบเขตที่มีอยู่ (พื้นที่เป้าหมายของแอปสามารถล้ำออกไปได้) | สีฟ้าอ่อน = ขอบเขตที่มีอยู่ของแผนที่นี้, สีเขียวอ่อน = พื้นที่เป้าหมายของแอปพลิเคชัน บริเวณใกล้ขอบจะยึดติดอัตโนมัติ และเมื่อยืนยันจะถูกตัดให้อยู่ภายในขอบเขตที่มีอยู่ (พื้นที่เป้าหมายของแอปพลิเคชันสามารถล้ำออกไปได้) |
| `appedit.error_missing_base_map_master` | basemap | ไม่พบแผนที่ฐานของแหล่งข้อมูลนี้ จะถูกยกเว้นจากการส่งออกและตัวอย่าง | ไม่พบแผนที่พื้นฐานของแหล่งข้อมูลนี้ จะถูกยกเว้นจากการส่งออกและตัวอย่าง |
| `appedit.export_key_prompt_description` | basemap | ยังไม่ได้ตั้งค่าคีย์เผยแพร่สำหรับผู้ให้บริการที่เลือก จะใช้เฉพาะการส่งออกครั้งนี้เท่านั้นและจะไม่ถูกบันทึก หากปล่อยว่างไว้ แผนที่พื้นหลังที่เกี่ยวข้องจะไม่ถูกรวมไว้ | ยังไม่ได้ตั้งค่าคีย์เผยแพร่สำหรับผู้ให้บริการที่เลือก จะใช้เฉพาะการส่งออกครั้งนี้เท่านั้นและจะไม่ถูกบันทึก หากปล่อยว่างไว้ แผนที่พื้นฐานที่เกี่ยวข้องจะไม่ถูกรวมไว้ |
| `appedit.extra_info_note` | app | บันทึกอิสระเกี่ยวกับแอปนี้ ข้อมูลนี้จะถูกเก็บไว้ในตัวแก้ไขเท่านั้น และจะไม่ถูกส่งออกทั้งในตัวอย่างและในแอปที่ส่งออก หากต้องการเผยแพร่คำอธิบาย โปรดเขียนในช่อง «คำอธิบาย» | บันทึกอิสระเกี่ยวกับแอปพลิเคชันนี้ ข้อมูลนี้จะถูกเก็บไว้ในตัวแก้ไขเท่านั้น และจะไม่ถูกส่งออกทั้งในตัวอย่างและในแอปพลิเคชันที่ส่งออก หากต้องการเผยแพร่คำอธิบาย โปรดเขียนในช่อง «คำอธิบาย» |
| `appedit.maplibre_export_warning_detail` | app | {{reasons}}<br><br>หากต้องการให้แสดง ให้เปลี่ยน "เวอร์ชันของ MapLibre GL JS" เป็น 6 ในหน้าจัดการแอป บันทึกแอป แล้วส่งออกอีกครั้ง | {{reasons}}<br><br>หากต้องการให้แสดง ให้เปลี่ยน "เวอร์ชันของ MapLibre GL JS" เป็น 6 ในหน้าจัดการแอปพลิเคชัน บันทึกแอปพลิเคชัน แล้วส่งออกอีกครั้ง |
| `appedit.maplibre_export_warning_message` | basemap, app | แผนที่ฐาน MapLibre บางส่วนในแอปนี้ต้องใช้ MapLibre GL JS 6 และจะไม่แสดงในเวอร์ชัน 5 | แผนที่พื้นฐาน MapLibre บางส่วนในแอปพลิเคชันนี้ต้องใช้ MapLibre GL JS 6 และจะไม่แสดงในเวอร์ชัน 5 |
| `appedit.maplibre_version_6_confirm_detail` | app | 1. ใช้ความสามารถของสไตล์ที่ใหม่กว่าได้ (เช่น line-layer-opacity)<br>2. เบราว์เซอร์ที่เปิดแอปที่ส่งออกต้องรองรับ import map และ WebGL 2 เบราว์เซอร์รุ่นเก่า (เช่น Safari 16.3 หรือเก่ากว่า) จะไม่แสดงแผนที่<br>3. หากเผยแพร่แอปที่ส่งออกพร้อม Content-Security-Policy ต้องอนุญาต script-src https://cdn.jsdelivr.net และ worker-src blob: | 1. ใช้ความสามารถของสไตล์ที่ใหม่กว่าได้ (เช่น line-layer-opacity)<br>2. เบราว์เซอร์ที่เปิดแอปพลิเคชันที่ส่งออกต้องรองรับ import map และ WebGL 2 เบราว์เซอร์รุ่นเก่า (เช่น Safari 16.3 หรือเก่ากว่า) จะไม่แสดงแผนที่<br>3. หากเผยแพร่แอปพลิเคชันที่ส่งออกพร้อม Content-Security-Policy ต้องอนุญาต script-src https://cdn.jsdelivr.net และ worker-src blob: |
| `appedit.maplibre_version_6_confirm_message` | app | ใช้ MapLibre GL JS เวอร์ชัน 6 กับแอปนี้หรือไม่? | ใช้ MapLibre GL JS เวอร์ชัน 6 กับแอปพลิเคชันนี้หรือไม่? |
| `appedit.maplibre_version_note` | basemap, app | เวอร์ชันของ MapLibre GL JS ที่ใช้แสดงแผนที่ฐาน MapLibre ในหน้าตัวอย่างและในแอปที่ส่งออก เวอร์ชัน 6 รองรับความสามารถของสไตล์ที่ใหม่กว่า แต่ต้องใช้เบราว์เซอร์ที่รองรับ import map และ WebGL 2 | เวอร์ชันของ MapLibre GL JS ที่ใช้แสดงแผนที่พื้นฐาน MapLibre ในหน้าตัวอย่างและในแอปพลิเคชันที่ส่งออก เวอร์ชัน 6 รองรับความสามารถของสไตล์ที่ใหม่กว่า แต่ต้องใช้เบราว์เซอร์ที่รองรับ import map และ WebGL 2 |
| `appedit.maplibre_version_warning` | basemap | แผนที่ฐาน "{{name}}" ใช้ความสามารถที่ต้องใช้ MapLibre GL JS 6 ({{reasons}}) จึงจะไม่แสดงในเวอร์ชัน 5 | แผนที่พื้นฐาน "{{name}}" ใช้ความสามารถที่ต้องใช้ MapLibre GL JS 6 ({{reasons}}) จึงจะไม่แสดงในเวอร์ชัน 5 |
| `appedit.maplibre_version_warning_unknown` | basemap | ไม่สามารถตรวจสอบได้ว่าแผนที่ฐาน "{{name}}" ทำงานกับ MapLibre GL JS 5 ได้หรือไม่ ({{reasons}}) | ไม่สามารถตรวจสอบได้ว่าแผนที่พื้นฐาน "{{name}}" ทำงานกับ MapLibre GL JS 5 ได้หรือไม่ ({{reasons}}) |
| `appedit.marker_list_ui_note` | app | ปุ่มที่ให้เลือกหมุดจากรายการแล้วเลื่อนไปยังตำแหน่งนั้น ปุ่มนี้จะถูกเพิ่มเป็นตัวควบคุมของโปรแกรมดู ทำให้ไปยังจุดที่ต้องการได้โดยไม่ต้องค้นหาบนแผนที่ ปุ่มนี้ไม่มีความหมายในแอปที่ไม่มีหมุดเลย | ปุ่มที่ให้เลือกหมุดจากรายการแล้วเลื่อนไปยังตำแหน่งนั้น ปุ่มนี้จะถูกเพิ่มเป็นตัวควบคุมของโปรแกรมดู ทำให้ไปยังจุดที่ต้องการได้โดยไม่ต้องค้นหาบนแผนที่ ปุ่มนี้ไม่มีความหมายในแอปพลิเคชันที่ไม่มีหมุดเลย |
| `appedit.overlay_ui_note` | basemap, app | UI ที่ซ้อนแผนที่เก่าแบบกึ่งโปร่งใสไว้บนแผนที่พื้นหลัง ตัวควบคุมการซ้อนทับจะปรากฏในโปรแกรมดู หากแอปไม่มีแผนที่ฐานสำหรับเป็นพื้นหลัง การเปิดใช้งานจะไม่มีผล | UI ที่ซ้อนแผนที่เก่าแบบกึ่งโปร่งใสไว้บนแผนที่พื้นฐาน ตัวควบคุมการซ้อนทับจะปรากฏในโปรแกรมดู หากแอปพลิเคชันไม่มีแผนที่พื้นฐานสำหรับเป็นพื้นหลัง การเปิดใช้งานจะไม่มีผล |
| `appedit.poi_format_unsupported` | preview | ข้อมูล POI อยู่ในรูปแบบที่เอดิเตอร์ไม่รองรับ (เช่น ออบเจ็กต์ที่ใช้ชื่อเลเยอร์เป็นคีย์) ข้อมูลเดิมจะไม่สูญหายเมื่อบันทึก แต่การแก้ไขในแท็บนี้ถูกปิดใช้งาน และจะไม่ปรากฏในพรีวิวหรือการส่งออก | ข้อมูล POI อยู่ในรูปแบบที่เอดิเตอร์ไม่รองรับ (เช่น ออบเจ็กต์ที่ใช้ชื่อเลเยอร์เป็นคีย์) ข้อมูลเดิมจะไม่สูญหายเมื่อบันทึก แต่การแก้ไขในแท็บนี้ถูกปิดใช้งาน และจะไม่ปรากฏในการดูตัวอย่างหรือการส่งออก |
| `appedit.preview.strict_error` | viewer | ไม่สามารถเลือกแผนที่ที่มี strict_error ได้ เนื่องจากตัวแสดงผลไม่สามารถแสดงได้ | ไม่สามารถเลือกแผนที่ที่มี strict_error ได้ เนื่องจากโปรแกรมดูไม่สามารถแสดงได้ |
| `appedit.pwa_manifest_note` | app | การตั้งค่าให้เผยแพร่แอปที่ส่งออกในรูปแบบ PWA (รูปแบบที่เพิ่มลงหน้าจอหลักและใช้งานเหมือนแอปเดี่ยวได้) เมื่อเปิดจะสร้าง Web App Manifest และช่อง «การตั้งค่าแมนิเฟสต์» จะปรากฏด้านล่าง ขณะที่ปิดอยู่จะตั้งค่า «แคช» ไม่ได้เช่นกัน | การตั้งค่าให้เผยแพร่แอปพลิเคชันที่ส่งออกในรูปแบบ PWA (รูปแบบที่เพิ่มลงหน้าจอหลักและใช้งานเหมือนแอปพลิเคชันเดี่ยวได้) เมื่อเปิดจะสร้าง Web App Manifest และช่อง «การตั้งค่าแมนิเฟสต์» จะปรากฏด้านล่าง ขณะที่ปิดอยู่จะตั้งค่า «แคช» ไม่ได้เช่นกัน |
| `appedit.warn_duplicate_poi_reference` | app | แหล่งข้อมูล POI เดียวกันถูกอ้างอิงทั้งจากแอปและแผนที่ POI อาจแสดงซ้ำสองครั้ง | แหล่งข้อมูล POI เดียวกันถูกอ้างอิงทั้งจากแอปพลิเคชันและแผนที่ POI อาจแสดงซ้ำสองครั้ง |
| `appedit.warn_missing_base_map_master` | basemap | ยกเว้นแหล่งข้อมูลที่ไม่พบแผนที่ฐาน | ยกเว้นแหล่งข้อมูลที่ไม่พบแผนที่พื้นฐาน |
| `appedit.warn_mixed_pois` | viewer | ข้อมูล POI มีทั้งรูปแบบ GeoJSON และรูปแบบอื่นปะปนกัน อาจแสดงผลไม่ถูกต้องในวิวเวอร์ โปรดแปลง POI รูปแบบเก่าเป็น GeoJSON | ข้อมูล POI มีทั้งรูปแบบ GeoJSON และรูปแบบอื่นปะปนกัน อาจแสดงผลไม่ถูกต้องในโปรแกรมดู โปรดแปลง POI รูปแบบเก่าเป็น GeoJSON |
| `appedit.warn_provider_google_key_missing` | basemap, app | ไม่มีแผนที่พื้นหลังของ Google เนื่องจากยังไม่ได้ตั้งค่าคีย์ API โปรดลงทะเบียนคีย์ตัวแก้ไขที่ การตั้งค่า > แผนที่ฐาน หรือกำหนดคีย์ของแอป | ไม่มีแผนที่พื้นฐานของ Google เนื่องจากยังไม่ได้ตั้งค่าคีย์ API โปรดลงทะเบียนคีย์ตัวแก้ไขที่ การตั้งค่า > แผนที่พื้นฐาน หรือกำหนดคีย์ของแอปพลิเคชัน |
| `appedit.warn_provider_mapbox_key_missing` | basemap, app | ไม่มีแผนที่พื้นหลังของ Mapbox เนื่องจากยังไม่ได้ตั้งค่าคีย์ API โปรดลงทะเบียนคีย์ตัวแก้ไขที่ การตั้งค่า > แผนที่ฐาน หรือกำหนดคีย์ของแอป | ไม่มีแผนที่พื้นฐานของ Mapbox เนื่องจากยังไม่ได้ตั้งค่าคีย์ API โปรดลงทะเบียนคีย์ตัวแก้ไขที่ การตั้งค่า > แผนที่พื้นฐาน หรือกำหนดคีย์ของแอปพลิเคชัน |
| `assetlist.delete_error` | asset | ลบรูปภาพไม่สำเร็จ | ลบทรัพยากรไม่สำเร็จ |
| `assetlist.errors.not_found` | asset | ไม่พบรูปภาพที่ต้องการ | ไม่พบทรัพยากรที่ต้องการ |
| `assetlist.master_detail.new_draft` | asset | แอสเซ็ตรูปภาพใหม่ | ทรัพยากรใหม่ |
| `assetlist.master_detail.not_found` | asset | ไม่พบแอสเซ็ตรูปภาพที่เลือก | ไม่พบทรัพยากรที่เลือก |
| `assetlist.master_detail.select_prompt` | asset | เลือกแอสเซ็ตรูปภาพจากรายการด้านซ้ายหรือสร้างใหม่ | เลือกทรัพยากรจากรายการด้านซ้ายหรือสร้างใหม่ |
| `assetlist.no_assets_found` | asset | ไม่พบรูปภาพ | ไม่พบทรัพยากร |
| `assetlist.search_placeholder` | asset | ค้นหารูปภาพ… | ค้นหาทรัพยากร… |
| `basemap.attribution` | attribution | การระบุแหล่งที่มา | การระบุที่มา |
| `basemap.coverage_help` | app | ขอบเขตทางภูมิศาสตร์โดยประมาณที่มีไทล์ของแผนที่พื้นฐานนี้อยู่ ใช้สำหรับการค้นหาตามช่วงพื้นที่เมื่อค้นหาแผนที่พื้นฐานตามภูมิภาค หากไม่ได้ตั้งค่าจะถือว่าครอบคลุมทั่วโลก เมื่อแอปใช้แผนที่นี้ ขอบเขตการใช้งานจะถูกตัดให้อยู่ภายในขอบเขตนี้ | ขอบเขตทางภูมิศาสตร์โดยประมาณที่มีไทล์ของแผนที่พื้นฐานนี้อยู่ ใช้สำหรับการค้นหาตามช่วงพื้นที่เมื่อค้นหาแผนที่พื้นฐานตามภูมิภาค หากไม่ได้ตั้งค่าจะถือว่าครอบคลุมทั่วโลก เมื่อแอปพลิเคชันใช้แผนที่นี้ ขอบเขตการใช้งานจะถูกตัดให้อยู่ภายในขอบเขตนี้ |
| `basemap.kind.key_required_reason` | basemap | ยังไม่ได้ตั้งค่าคีย์ตัวแก้ไขสำหรับ {{provider}} โปรดลงทะเบียนที่ การตั้งค่า > แผนที่ฐาน | ยังไม่ได้ตั้งค่าคีย์ตัวแก้ไขสำหรับ {{provider}} โปรดลงทะเบียนที่ การตั้งค่า > แผนที่พื้นฐาน |
| `basemap.kind.select_prompt` | basemap | เลือกประเภทแผนที่ฐาน | เลือกประเภทแผนที่พื้นฐาน |
| `basemap.master_detail.search_placeholder` | basemap | ค้นหาแผนที่ฐาน… | ค้นหาแผนที่พื้นฐาน… |
| `basemap.source_description_pf` | basemap | กรุณากรอกคำอธิบายของแผนที่ฐาน | กรุณากรอกคำอธิบายของแผนที่พื้นฐาน |
| `basemap.source_metadata` | citation | ข้อมูลแหล่งที่มา (ไม่บังคับ) | ข้อมูลแหล่งอ้างอิง (ไม่บังคับ) |
| `dataupload.error_upload` | import | เกิดข้อผิดพลาดในการลงทะเบียนข้อมูลแผนที่ | เกิดข้อผิดพลาดในการนำเข้าข้อมูลแผนที่ |
| `dataupload.success_upload` | import | ลงทะเบียนข้อมูลแผนที่สำเร็จแล้ว | นำเข้าข้อมูลแผนที่สำเร็จแล้ว |
| `mapedit.draft_tiles_lost` | gcp | ไม่พบข้อมูลชั่วคราวของภาพแผนที่ กรุณาอัปโหลดภาพอีกครั้ง การแก้ไขอื่น ๆ ของคุณ (จุดควบคุม ข้อมูลเมตา ฯลฯ) ยังคงอยู่ | ไม่พบข้อมูลชั่วคราวของภาพแผนที่ กรุณาอัปโหลดภาพอีกครั้ง การแก้ไขอื่น ๆ ของคุณ (จุดควบคุมภาคพื้นดิน ข้อมูลเมตา ฯลฯ) ยังคงอยู่ |
| `mapedit.edit_basemap_align` | basemap | ปรับตำแหน่งแผนที่ฐาน | ปรับตำแหน่งแผนที่พื้นฐาน |
| `merc.generate_not_ready` | gcp | ไม่สามารถทำงานได้เนื่องจากจุดควบคุม (GCP) ยังไม่เสร็จสมบูรณ์ หรือไทล์เป็นข้อมูลล่าสุดอยู่แล้ว | ไม่สามารถทำงานได้เนื่องจากจุดควบคุมภาคพื้นดิน (GCP) ยังไม่เสร็จสมบูรณ์ หรือไทล์เป็นข้อมูลล่าสุดอยู่แล้ว |
| `merc.tab_description` | gcp | สร้างชุดไทล์เมอร์เคเตอร์จากจุดควบคุม (GCP) ของแผนที่นี้ และลงทะเบียนเป็นแผนที่พื้นฐาน | สร้างชุดไทล์เมอร์เคเตอร์จากจุดควบคุมภาคพื้นดิน (GCP) ของแผนที่นี้ และลงทะเบียนเป็นแผนที่พื้นฐาน |
| `poiedit.icon_asset_missing` | asset | ไม่พบรูปภาพที่ถูกอ้างอิง | ไม่พบทรัพยากรที่ถูกอ้างอิง |
| `poiedit.layer_icon` | layer | ไอคอนชั้น | ไอคอนเลเยอร์ |
| `poiedit.layer_metadata` | layer | ข้อมูลเมตาดาต้าของชั้น | ข้อมูลเมตาดาต้าของเลเยอร์ |
| `poiedit.layer_selected_icon` | layer | ไอคอนชั้น (เลือกแล้ว) | ไอคอนเลเยอร์ (เลือกแล้ว) |
| `poiedit.picker.no_assets` | asset | ไม่พบรูปภาพ | ไม่พบทรัพยากร |
| `poiedit.picker.tab_assets` | asset | รูปภาพ | ทรัพยากร |
| `poiref.hide_override_note` | app | เมื่อทำเครื่องหมาย เลเยอร์ POI นี้จะเริ่มซ่อนเมื่อเปิดแผนที่/แอปนี้ (ผู้ชมสามารถเปิดได้) ไม่มีการแก้ไขแหล่งที่มาของ POI | เมื่อทำเครื่องหมาย เลเยอร์ POI นี้จะเริ่มซ่อนเมื่อเปิดแผนที่/แอปพลิเคชันนี้ (ผู้ชมสามารถเปิดได้) ไม่มีการแก้ไขแหล่งที่มาของ POI |
| `poiref.layer_ref_note` | app | อ้างอิงไฟล์ภายนอกและแทนที่เฉพาะแอตทริบิวต์การแสดงผลสำหรับแผนที่/แอปนี้ เนื้อหาที่อ้างอิงจะไม่ถูกเปลี่ยนแปลง | อ้างอิงไฟล์ภายนอกและแทนที่เฉพาะแอตทริบิวต์การแสดงผลสำหรับแผนที่/แอปพลิเคชันนี้ เนื้อหาที่อ้างอิงจะไม่ถูกเปลี่ยนแปลง |
| `poiref.missing_source` | source | ไม่พบแหล่ง POI ที่อ้างอิง (อาจถูกลบไปแล้ว) ใช้ × เพื่อยกเลิกการอ้างอิง | ไม่พบแหล่งข้อมูล POI ที่อ้างอิง (อาจถูกลบไปแล้ว) ใช้ × เพื่อยกเลิกการอ้างอิง |
| `poiref.selected_list_app` | app | POI ในแอปนี้ | POI ในแอปพลิเคชันนี้ |
| `poisource.delete_referenced` | app | แหล่งข้อมูล POI นี้ถูกอ้างอิงโดยแอป {{app}} รายการ / แผนที่ {{map}} รายการ: | แหล่งข้อมูล POI นี้ถูกอ้างอิงโดยแอปพลิเคชัน {{app}} รายการ / แผนที่ {{map}} รายการ: |
| `poisource.ref_kind.app` | app | แอป | แอปพลิเคชัน |
| `resource_list.badge_missing_asset` | asset | แอสเซ็ตหายไป | ทรัพยากรหายไป |
| `resource_list.badge_missing_base_map` | basemap | แผนที่ฐานหายไป | แผนที่พื้นฐานหายไป |
| `resource_selector.context_app_coverage` | app | พื้นที่เป้าหมายของแอป | พื้นที่เป้าหมายของแอปพลิเคชัน |
| `settings.default_publish_api_key_notice` | app | ค่าเริ่มต้นที่ใช้เมื่อไม่ได้ตั้งค่าคีย์เฉพาะแอป | ค่าเริ่มต้นที่ใช้เมื่อไม่ได้ตั้งค่าคีย์เฉพาะแอปพลิเคชัน |

## vi（ベトナム語）: 12 件

| キー | 概念 | 変更前 | 変更後 |
|---|---|---|---|
| `appedit.cache_ui_note` | tile | Thiết lập lưu các ô bản đồ đã tải một lần vào thiết bị để có thể hiển thị ở lần sau và khi ngoại tuyến. Khi xuất, một Service Worker sẽ được đóng gói kèm. Thiết lập này cần có PWA nên không thể cấu hình khi «PWA» đang tắt. | Thiết lập lưu các tile đã tải một lần vào thiết bị để có thể hiển thị ở lần sau và khi ngoại tuyến. Khi xuất, một Service Worker sẽ được đóng gói kèm. Thiết lập này cần có PWA nên không thể cấu hình khi «PWA» đang tắt. |
| `appedit.error_missing_base_map_master` | export | Không tìm thấy bản đồ nền cho nguồn này. Nguồn sẽ bị loại khỏi xuất bản và xem trước. | Không tìm thấy bản đồ nền cho nguồn này. Nguồn sẽ bị loại khỏi việc xuất và xem trước. |
| `appedit.provider_source_note` | tile | URL ô bản đồ được tạo tự động từ khóa API và loại, nên không cần nhập thủ công. | URL tile được tạo tự động từ khóa API và loại, nên không cần nhập thủ công. |
| `basemap.kind.label_merc` | tile | Ô bản đồ Mercator | Tile Mercator |
| `basemap.kind.label_tms` | tile | URL ô bản đồ | URL tile |
| `dataupload.error_upload` | import | Đã xảy ra lỗi khi đăng ký dữ liệu bản đồ. | Đã xảy ra lỗi khi nhập dữ liệu bản đồ. |
| `dataupload.success_upload` | import | Đã đăng ký dữ liệu bản đồ thành công. | Đã nhập dữ liệu bản đồ thành công. |
| `mapedit.draft_tiles_lost` | gcp | Không tìm thấy dữ liệu tạm thời của hình ảnh bản đồ. Vui lòng tải lên hình ảnh lại. Các chỉnh sửa khác của bạn (điểm khống chế, siêu dữ liệu, v.v.) vẫn được giữ nguyên. | Không tìm thấy dữ liệu tạm thời của hình ảnh bản đồ. Vui lòng tải lên hình ảnh lại. Các chỉnh sửa khác của bạn (điểm tương ứng, siêu dữ liệu, v.v.) vẫn được giữ nguyên. |
| `mapedit.export_option_tiles` | tile | Ô bản đồ (bao gồm ảnh thu nhỏ) | Tile (bao gồm ảnh thu nhỏ) |
| `mapedit.export_option_tiles_help` | tile | Ô bản đồ là hình ảnh bản đồ được chia thành các ô vuông nhỏ để hiển thị bản đồ. Chúng được dùng khi mở bản đồ. Bao gồm cả ảnh thu nhỏ (ảnh nhỏ hiển thị trong danh sách). | Tile là hình ảnh bản đồ được chia thành các ô vuông nhỏ để hiển thị bản đồ. Chúng được dùng khi mở bản đồ. Bao gồm cả ảnh thu nhỏ (ảnh nhỏ hiển thị trong danh sách). |
| `merc.generate_not_ready` | gcp | Không thể thực hiện vì điểm khống chế (GCP) chưa hoàn tất, hoặc tile đã được cập nhật mới nhất. | Không thể thực hiện vì điểm tương ứng (GCP) chưa hoàn tất, hoặc tile đã được cập nhật mới nhất. |
| `merc.tab_description` | gcp | Tạo bộ tile Mercator từ điểm khống chế (GCP) của bản đồ này và đăng ký làm bản đồ nền. | Tạo bộ tile Mercator từ điểm tương ứng (GCP) của bản đồ này và đăng ký làm bản đồ nền. |

## zh（中国語（簡体字））: 13 件

| キー | 概念 | 変更前 | 変更後 |
|---|---|---|---|
| `appedit.export_key_prompt_description` | basemap | 所选提供方的发布密钥尚未设置。该密钥仅用于本次导出，不会被保存。留空则不会包含相应的背景地图。 | 所选提供方的发布密钥尚未设置。该密钥仅用于本次导出，不会被保存。留空则不会包含相应的底图。 |
| `appedit.overlay_ui_note` | basemap | 将古地图以半透明方式叠加显示在背景地图之上的 UI。查看器中会出现叠加操作控件。若应用中没有可作为背景的底图，即使开启也不会生效。 | 将古地图以半透明方式叠加显示在底图之上的 UI。查看器中会出现叠加操作控件。若应用中没有可作为背景的底图，即使开启也不会生效。 |
| `appedit.warn_provider_google_key_missing` | basemap | 由于未设置 API 密钥，Google 背景地图未包含在内。请在“设置 > 底图”中注册编辑器密钥，或设置应用密钥。 | 由于未设置 API 密钥，Google 底图未包含在内。请在“设置 > 底图”中注册编辑器密钥，或设置应用密钥。 |
| `appedit.warn_provider_mapbox_key_missing` | basemap | 由于未设置 API 密钥，Mapbox 背景地图未包含在内。请在“设置 > 底图”中注册编辑器密钥，或设置应用密钥。 | 由于未设置 API 密钥，Mapbox 底图未包含在内。请在“设置 > 底图”中注册编辑器密钥，或设置应用密钥。 |
| `assetlist.master_detail.new_draft` | asset | 新建图像资源 | 新建素材 |
| `assetlist.master_detail.not_found` | asset | 找不到所选图像资源。 | 找不到所选素材。 |
| `assetlist.master_detail.select_prompt` | asset | 请从左侧列表选择图像资源，或新建一个。 | 请从左侧列表选择素材，或新建一个。 |
| `basemap.attribution` | attribution | 版权信息 | 署名 |
| `dataupload.error_upload` | import | 注册地图数据时发生错误。 | 导入地图数据时发生错误。 |
| `dataupload.success_upload` | import | 地图数据已成功注册。 | 地图数据已成功导入。 |
| `mapedit.data_io` | import, export | 数据输入输出 | 数据导入导出 |
| `mapedit.export_option_tiles_help` | tile | 图砖是把地图图像分成小正方形以便显示地图的部分，打开地图时使用。也包含缩略图（列表中显示的小图）。 | 瓦片是把地图图像分成小正方形以便显示地图的部分，打开地图时使用。也包含缩略图（列表中显示的小图）。 |
| `resource_list.badge_missing_asset` | asset | 资源缺失 | 素材缺失 |

## zh-TW（中国語（繁体字））: 16 件

| キー | 概念 | 変更前 | 変更後 |
|---|---|---|---|
| `appedit.export_key_prompt_description` | basemap | 所選提供者的發布金鑰尚未設定。此金鑰僅用於本次匯出，不會被儲存。留空則不會包含對應的背景地圖。 | 所選提供者的發布金鑰尚未設定。此金鑰僅用於本次匯出，不會被儲存。留空則不會包含對應的底圖。 |
| `appedit.overlay_ui_note` | basemap | 將古地圖以半透明方式疊加顯示在背景地圖之上的 UI。檢視器中會出現疊加操作控制項。若應用程式中沒有可作為背景的底圖，即使開啟也不會生效。 | 將古地圖以半透明方式疊加顯示在底圖之上的 UI。檢視器中會出現疊加操作控制項。若應用程式中沒有可作為背景的底圖，即使開啟也不會生效。 |
| `appedit.warn_provider_google_key_missing` | basemap | 由於未設定 API 金鑰，Google 背景地圖未包含在內。請在「設定 > 底圖」中註冊編輯器金鑰，或設定應用程式金鑰。 | 由於未設定 API 金鑰，Google 底圖未包含在內。請在「設定 > 底圖」中註冊編輯器金鑰，或設定應用程式金鑰。 |
| `appedit.warn_provider_mapbox_key_missing` | basemap | 由於未設定 API 金鑰，Mapbox 背景地圖未包含在內。請在「設定 > 底圖」中註冊編輯器金鑰，或設定應用程式金鑰。 | 由於未設定 API 金鑰，Mapbox 底圖未包含在內。請在「設定 > 底圖」中註冊編輯器金鑰，或設定應用程式金鑰。 |
| `assetlist.master_detail.new_draft` | asset | 新增圖片資產 | 新增素材 |
| `assetlist.master_detail.not_found` | asset | 找不到所選圖片資產。 | 找不到所選素材。 |
| `assetlist.master_detail.select_prompt` | asset | 請從左側清單選擇圖片資產，或新增一個。 | 請從左側清單選擇素材，或新增一個。 |
| `basemap.attribution` | attribution | 版權標示 | 署名 |
| `basemap.kind.label_merc` | tile | 麥卡托瓦片 | 麥卡托圖磚 |
| `basemap.kind.label_tms` | tile | 瓦片URL | 圖磚URL |
| `dataupload.error_upload` | import | 登錄地圖資料時發生錯誤。 | 匯入地圖資料時發生錯誤。 |
| `dataupload.success_upload` | import | 地圖資料已成功登錄。 | 地圖資料已成功匯入。 |
| `poiref.selected_list_app` | app | 此應用的POI | 此應用程式的POI |
| `resource_list.badge_missing_asset` | asset | 資源缺失 | 素材缺失 |
| `resource_list.import_map` | import | 導入 | 匯入 |
| `resource_list.import_poi` | import | 導入 | 匯入 |

## 未翻訳の写しを新しい英語に揃えたもの

英語を直した 6 キー（書誌の見出しなど）では、9 言語の値が英語の文のまま（未翻訳）でした。英語と全文一致することが未翻訳の例外の条件なので、同じ新しい英語の文に揃えました。訳したものではありません。

| キー | 言語 | 変更前 | 変更後 |
|---|---|---|---|
| `iiif_import.verdict.metadata_only` | de, es, fr, id, ko, th, vi, zh, zh-TW | Metadata only from IIIF | Bibliographic data only from IIIF |
| `iiif_metadata.canvas_heading` | de, es, fr, id, ko, th, vi, zh, zh-TW | Metadata of this canvas | Bibliographic data of this canvas |
| `iiif_metadata.copy_failed.unknown` | de, es, fr, id, ko, th, vi, zh, zh-TW | The metadata could not be copied. | The bibliographic data could not be copied. |
| `iiif_metadata.heading` | de, es, fr, id, ko, th, vi, zh, zh-TW | Binding to the IIIF metadata | Binding to the IIIF bibliographic data |
| `iiif_metadata.manifest_heading` | de, es, fr, id, ko, th, vi, zh, zh-TW | Manifest metadata | Manifest bibliographic data |
| `iiif_metadata.readonly_heading` | de, es, fr, id, ko, th, vi, zh, zh-TW | Metadata copied from IIIF | Bibliographic data copied from IIIF |

## 実装レビューを受けて足した是正

en「source」の共有形（POI ソースと典拠）は、ja にどちらの語も無いと失敗にする。ja だけがソースを言っていなかった 1 キーを直した（これまでは ja の省略の例外で抑えていた。例外は消した）。

| 言語 | キー | 概念 | 変更前 | 変更後 |
|---|---|---|---|---|
| ja | `poiedit.clone_failed` | source | ローカルへの複製に失敗しました。 | ローカルのソースへの複製に失敗しました。 |

es・id の override の 3 キーは、「上書きすることのアイコン」と読めないよう、上の表のとおり「Icono sobrescrito」「Ikon timpaan」などにした（es は許容形に sobrescrito・sobrescrita を足した）。
