# 実在の IIIF Manifest

取得日: 2026-11-11。提供元の重複がない 9 件。Manifest 全文と、選択対象の **先頭 canvas の画像サービス** の info.json のみを保存する。画像本体は保存しない。33 枚・36 枚等の資料でも、全画像の info.json を取得したわけではない。

各 `*.source.json` に取得 URL、リダイレクト後の URL、確認した利用条件と根拠 URL、クレジット、Editor の main と同じ要求ヘッダ（`Origin: https://example.org`）で取得したときの CORS ヘッダ、元バイト列の SHA-256 を記録した。fixture の利用条件はリポジトリのソフトウェアライセンスとは別であり、元の権利表示を保持する。

`cases.json` の題名・枚数・寸法・書誌の見本は JSON 原文を読んで固定した。製品の実装結果やスナップショットから生成していない。確認を行ったのは実装エージェントであり、人間の承認済みという意味ではない。寸法は info.json の申告値で、画像をダウンロードしてデコードした実測値ではない。

## 固定した期待値

| 提供元 | 版 | 題名（末尾空白も保持） | canvas 数 | 先頭画像の幅×高さ | 取得元 |
|---|---|---|---:|---|---|
| 国立国会図書館 | 2 | `新潟市圖` | 9 | 4074×2705 | [Manifest](https://dl.ndl.go.jp/api/iiif/948741/manifest.json) / [info.json](https://dl.ndl.go.jp/api/iiif/948741/R0000001/info.json) |
| IIIF Cookbook | 3 | `Picture of Göttingen taken during the 2019 IIIF Conference` | 1 | 4032×3024 | [Manifest](https://iiif.io/api/cookbook/recipe/0005-image-service/manifest.json) / [info.json](https://iiif.io/api/image/3.0/example/reference/918ecd18c2592080851777620de9bcb5-gottingen/info.json) |
| Stanford University Libraries | 2 | `France - ports` | 1 | 7452×7868 | [Manifest](https://purl.stanford.edu/zc368qw3281/iiif/manifest) / [info.json](https://stacks.stanford.edu/image/iiif/zc368qw3281%2Fzc368qw3281_00_0001/info.json) |
| Digital Bodleian / All Souls College | 2 | `All Souls College Hovenden I` | 33 | 7435×10328 | [Manifest](https://iiif.bodleian.ox.ac.uk/iiif/manifest/acd9492e-25fa-4286-9fe6-e0cf2fc28106.json) / [info.json](https://iiif.bodleian.ox.ac.uk/iiif/image/27e0b7cb-ae81-4bdc-a127-d3815147690e/info.json) |
| Boston Public Library / Leventhal Map Center | 2 | `Bird's eye view of Boston` | 1 | 9587×6671 | [Manifest](https://collections.leventhalmap.org/search/commonwealth:x059cb10w/manifest) / [info.json](https://iiif.digitalcommonwealth.org/iiif/2/commonwealth:x059cb115/info.json) |
| Wellcome Collection | 3 | `Wunder der Vererbung / von Fritz Bolle.` | 36 | 2569×3543 | [Manifest](https://iiif.wellcomecollection.org/presentation/v3/b18035723) / [info.json](https://iiif.wellcomecollection.org/image/b18035723_0001.JP2/info.json) |
| J. Paul Getty Museum | 3 | `[ ]` | 1 | 3942×5728 | [Manifest](https://media.getty.edu/iiif/manifest/bff54470-38c3-4865-bd58-b550f19b715e) / [info.json](https://media.getty.edu/iiif/image/3bb42b25-96e0-4412-b4da-1dee64694e41/info.json) |
| National Library of Wales | 2 | `Papyri from Oxyrhynchus, 2-4 cents` | 16 | 7304×6496 | [Manifest](https://damsssl.llgc.org.uk/iiif/2.0/4398332/manifest.json) / [info.json](https://iiif.llyfrgell.cymru/iiif/4398333/info.json) |
| Ghent University Library | 3 | `[print] Beer, leeuw, struisvogel en dromedaries ` | 2 | 2526×3880 | [Manifest](https://adore.ugent.be/IIIF/v3/manifests/archive.ugent.be:ACB41F1C-F681-11E9-9639-C36B765DA7FD) / [info.json](https://eu-img02.ext.exlibrisgroup.com/iiif/2/eyJyZWdpb24iOiJldS1jZW50cmFsLTEiLCJidWNrZXQiOiJldS1zdDAxLmV4dC5leGxpYnJpc2dyb3VwLmNvbSIsImtleSI6IjMyUlVHX0lOU1Qvc3RvcmFnZS9hbG1hLzMzLzBFLzIyLzFBLzY5LzU1LzUzL0JEL0RDLzgyL0QzL0IzLzRGLzcwL0UzLzk1LzkxMDAwMDQyMjA2NV8yMDE5XzAwMDFfTUEuanBnIiwicmVwX2lkIjoiMTIyOTA5NzQwODAwMDkxNjEiLCJpbnN0YW5jZSI6ImV1MDYiLCJpbnN0aXR1dGlvbiI6IjMyUlVHX0lOU1QiLCJ3aWR0aCI6IjI1MjYiLCJoZWlnaHQiOiIzODgwIiwid21LZXkiOm51bGwsIndtV2lkdGgiOm51bGwsIndtSGVpZ2h0IjpudWxsLCJ3bVBvc2l0aW9uIjpudWxsLCJ3bVJlcGVhdCI6ZmFsc2UsIm5hOTEiOm51bGx9/info.json) |

## 利用条件の確認

- **国立国会図書館**: 国立国会図書館作成書誌データの無償利用。画像は保存しない。 [確認先](https://www.ndl.go.jp/en/data/data_service/quickguide)。クレジット: 国立国会図書館 National Diet Library, JAPAN
- **IIIF Cookbook**: 仕様に付随する JSON の例・試験資料は CC0。写真の権利とは別。 [確認先](https://iiif.io/api/annex/notes/disclaimer/)。クレジット: IIIF Consortium and Community
- **Stanford University Libraries**: 図書館メタデータは CC0。対象画像の表示は Public Domain Mark。 [確認先](https://library.stanford.edu/stanford-university-libraries-open-metadata-policy)。クレジット: Stanford University Libraries
- **Digital Bodleian / All Souls College**: 対象資料の attribution が CC BY 4.0 を指定。一般画像の CC BY-NC と区別し、個別表示とクレジットを保持する。 [確認先](https://digital.bodleian.ox.ac.uk/terms/)。クレジット: All Souls College Hovenden I. Photo: © The Warden and Fellows of All Souls College, Oxford. CC BY 4.0. https://digital.bodleian.ox.ac.uk/objects/acd9492e-25fa-4286-9fe6-e0cf2fc28106/
- **Boston Public Library / Leventhal Map Center**: リポジトリのメタデータは CC0。対象資料の Terms of Use は No known restrictions on use。 [確認先](https://www.bpl.org/digitization/metadata-resources/)。クレジット: Boston Public Library, Norman B. Leventhal Map & Education Center
- **Wellcome Collection**: Wellcome 自作のメタデータは CC0。対象の画像・本文は CC BY-NC 4.0 だが、ここには画像も本文も保存しない。書誌と画像サービスの技術情報のみ。 [確認先](https://developers.wellcomecollection.org/docs/catalogue)。クレジット: Wellcome Collection
- **J. Paul Getty Museum**: requiredStatement と公式規約でテキストは CC BY 4.0。rights の CC0 は画像の条件。両者を混同しない。 [確認先](https://www.getty.edu/legal/terms-of-use/)。クレジット: © J. Paul Getty Trust. Text: CC BY 4.0. https://creativecommons.org/licenses/by/4.0/
- **National Library of Wales**: 図書館が作成したメタデータ・説明文は CC0。対象は同館の目録で、第三者権利の記載なし。 [確認先](https://www.library.wales/copyright)。クレジット: Llyfrgell Genedlaethol Cymru – The National Library of Wales
- **Ghent University Library**: 目録の記述メタデータは CC0。Manifest の requiredStatement は PUBLIC DOMAIN。 [確認先](https://www.lib.ugent.be/nl/disclaimer/)。クレジット: Universiteitsbibliotheek Gent

## 保存しなかった資料

- [山形 amane](https://ourarchives.amane-project.jp/iiif/img/yamagata/maps_org/manifest/001-002-00001.json): Presentation 2、題名 `〔地図〕最上時代山形城下絵図`、canvas 1 枚、canvas/body は 6000×6000、label は `page 1`。[所蔵館の条件](https://www.lib.yamagata-u.ac.jp/museum/copyright.htm)に利用報告と営利利用時の事前許可があるため保存しなかった。原文の転載を伴わない既存の再現試験を維持する。
- [Harvard Art Museums](https://iiif.harvardartmuseums.org/manifests/object/299843): Presentation 2、`Self-Portrait Dedicated to Paul Gauguin`、7 枚。[API 規約](https://github.com/harvardartmuseums/api-docs#terms-of-use)に原則 2 週間超の保存禁止があり、保存しなかった。
- [京都大学](https://rmda.kulib.kyoto-u.ac.jp/iiif/metadata_manifest/RB00007683/manifest.json): Presentation 3、`Newe Zeyttung auss der Insel Japonien`、5 枚。先頭 canvas は 6463×5880、info.json は 6464×5880。[利用条件](https://rmda.kulib.kyoto-u.ac.jp/reuse)で画像の二次利用条件は確認できたが、Manifest の長期再配布への適用を確定できないため保存しなかった。
- [Princeton](https://figgy.princeton.edu/concern/scanned_resources/8d8b3997-d323-4b1c-aaca-1670a3181566/manifest): Presentation 2、41 枚。rights は No Known Copyright だが、メタデータの再配布許諾を確定できず保存しなかった。
- [British Library](https://api.bl.uk/metadata/iiif/ark:/81055/vdc_100147468685.0x000001/manifest.json): DNS 解決に失敗して取得できず、保存しなかった。
- [Library of Congress](https://www.loc.gov/item/2012402171/manifest.json)、[BnF](https://gallica.bnf.fr/iiif/ark:/12148/btv1b53061917g/manifest.json): HTTP 403 で取得できず、保存しなかった。
- [Smithsonian](https://ids.si.edu/ids/manifest/NMNH-USNMENT00802025_Antron_daileyi_Lyon_dorsal_habitus): 取得できたが旧 Shared Canvas context であり、Presentation 2/3 の集合には入れなかった。

## 見つかった差異と試験範囲

- Wellcome は Presentation 3 の中に `@id` / `@type: ImageService2` がある。Core の修正前はサイズ確認に到達しない。Editor は固定 Core のまま、この差だけを `TODO(core)` の互換期待値として分離する。題名・書誌・書誌のみの写し直しは省略しない。
- NDL の info.json は、Origin の無い要求には `Access-Control-Allow-Origin` を返さず、Origin を付けると `*` を返す。最初の記録は Origin なしで取ったため NDL を `metadata-only / cors-not-wildcard` と誤って固定していた。Editor の main は Origin を付けて取得する（`electron/services/iiifFetch.ts`）ので、実アプリでは配信できる。全件を Origin 付きで取り直し、本文の SHA-256 は変わらないことを確かめた。
- 配信に使う URL は info.json の `id`／`@id`（`deliveryServiceUrl`）。Stanford（`%2F` と `/`）と Wales（`4398333` と `04/398/04398333.jp2`）は Manifest のサービス id と綴りが違う。どちらの綴りでも 64 px 幅の画像要求が 200 を返すことを確かめた（画像は保存していない）。
- Getty の題名は原文どおり `[ ]`。canvas の `Full Front` や説明文へ勝手に置き換えない。canvas 側にも書誌 1 行がある。
- Ghent の題名は `none` 言語で末尾空白がある。これも保存時に修正しない。
- Boston の Creator 行には配列の中に配列がある。Core は仕様どおり一段までしか読まないため、内側の作者名は書誌表へ写らない。今回の修正対象には広げていない。題名・画像サービス・サイズの判定には影響しない。
- 今回採用した実在資料の画像サービスは単一候補。ImageService2/3 の複数候補と不正な先頭候補は Core の明示的な再現試験で覆う。
- 通信を止めた試験で、題名の既定、選択 canvas、初回の写し、写し直しの計画、画像サイズ一致・不一致・取得失敗を確かめる。CORS は記録した応答の事実。実画像の配信、ブラウザ表示、画像デコード、全 canvas のサイズ、人間の目による確認は行っていない。

## 更新時の約束

URL から自動更新しない。利用条件を再確認して JSON 本文と CORS を取得し、題名・canvas 数・選択画像の info.json を直接読んで期待値を編集する。Core と Editor は独立 clone なので同じ資料を各 repo に置く。変更時は両側の SHA-256 と cases.json を合わせる。
