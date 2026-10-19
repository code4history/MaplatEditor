# Issue #148: ベースマップ複製時のアイコン保全

検証基点: master `4f7bb029805d387df063b4affbd21195da03e0e7`。Issue #148 は取得時 open、PR #149 は merged。

## 確認できた事実

`BaseMapEdit.vue::duplicateInitial` は catalog document の thumbnail を維持して uid と scope/slug を変更する。初回保存は create=true を付ける。`saveUserBaseMap` は kind/scope による画像所有者の判定をせず、別キーの `tmbs/<key>.<ext>` を relocate する。

修正前の実サービスを、Electron / electron-store だけをスタブした Vite SSR harness から呼び、独立した SQLite とファイルで実行した。ユーザーTMSのUUID名PNGを複製保存すると、元52pxの読み出しが ENOENT になり、回帰テストは失敗した。実利用者のデータは使用していない。

| 複製元・参照形式 | 修正前の成立条件／修正後の検証 |
| --- | --- |
| ユーザー地図、`tmbs/<元uid>.<ext>` | 元52pxが存在し宛先とキーが異なる場合、move対象。修正後は元DB行と両ファイルを保全 |
| kind=tms/merc/google/mapbox/maplibre | 保存処理は種別によらない。5種×png/jpg/jpeg/webp/PNGの25組を修正後に検証 |
| 旧slug名 `tmbs/<slug>.png` | UUID名と同じ経路。コピー後も旧ファイルを残す |
| builtinやプリセット既定 `basemap_icons/...` | relocate正規表現の対象外。参照を維持する |
| 新uid名にアップロード済み | 同一キーなので何もしない。revision=1を維持 |
| URL、file URL、ネストしたパス | relocate対象外。参照を維持。表示の有効性までは保証しない |
| 元52pxなし／512pxだけあり | relocateしない。既存の欠損を修復するものではない |
| 元512pxなし | 52pxのみコピー。宛先に無関係な512pxが既存なら参照を切り替えない |

## 修正と失敗時の挙動

- move/逆moveをコピーへ置換。既存 `copyVerified` を再利用し、両サイズのSHA-256一致を追加確認してから参照を返す。
- 異なる内容の宛先は上書きしない。同一内容の部分コピーは再利用する。
- コピー例外・同じサイズの内容破損でも元参照を維持する。未参照の部分コピーは保全側に倒して残す。破損・衝突が残った場合、再試行だけで必ず正規化されるとは限らない。
- INSERT失敗ではコピー前に終了する。
- INSERT後の参照UPDATE失敗では例外が伝播するが、作成済み行の元参照は有効なまま。既存更新経路にuid/revisionを渡す復旧を実テストした。
- **新規行のINSERTと参照UPDATEは従来どおり別トランザクション**。UPDATE失敗後にUIで新規保存をそのまま再試行すると衝突し得る。UIでの自動復旧は本修正に含めない。データを失わないことと、保存操作全体の原子性は別である。
- DBスキーマ、既存データ移行、同梱画像、画像符号化、mercのthumbnail未指定時の継承処理は変更しない。

## 実行結果

以下すべて成功:

- `pnpm smoke:issue-148-basemap-icon`
- `pnpm smoke:m19-t2-basemap-thumbnail-512`
- `pnpm smoke:nov26-m6-t5-asset-uuid-migration`
- `pnpm build`（vue-tscを含む）
- `git diff --check`

依存関係はリポジトリCIの方式に従い `ci/pnpm-workspace.ci.yaml` をローカルにコピーし、frozen lockfile / ignore-scriptsでインストールした。lockfile変更なし。

新規回帰テストの画像はバイト列のsentinelであり、転送・同一性・参照の検証を行う。既存m19-t2 smokeは実画像の生成・寸法・書き出しも検証する。

## 実機未検証

Electron画面からの「複製→保存→再起動」、Windows/macOS固有のファイルロック・権限、電源断、同時編集、実ユーザーデータは未検証。上の結果を実機再現済みとは扱わない。

画面確認は新規の `MAPLAT_E2E_ROOT` と `--user-data-dir` を同じ専用一時フォルダに指定して行う。元データを開かず、専用プロファイル内で作ったユーザー地図の52px/512pxをハッシュ記録し、複製保存後・再起動後に元地図と複製地図の両方を確認する。builtin既定、旧名、52pxのみも独立fixtureとし、テスト終了後も診断用データを残す。
