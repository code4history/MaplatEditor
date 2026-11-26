# 用語集の語を入れるときに、後の locale の PR で足す・直す訳

> **注意: この一覧の訳は、まだ人間が確認していません（未レビュー）。** 言語ごとの翻訳者の提案を、用語集（`editor-glossary.json`）の代表語に合わせてそろえたものです。日本語と英語は、設計書（`2026-11-25-jan27-crs-global-model-design.md` の 2.y）の決定をそのまま書いています。ここに載っていることは、訳文の承認を意味しません。

正本（`docs/i18n/editor-glossary.json`）と locale は同じ PR で変えられません（AGENTS.md の「UI Wording & Glossary」）。
そのため、この PR（正本だけ）では locale を変えず、画面の文言の新しい訳をここに残します。次の locale の PR で入れてください。

## 1. 直す文言: `mapedit.context_marker_on_line`（折れ点を打つ操作）

対応線の上に折れ点を足す操作の文言です。「マーカー」は GCP の印と紛れるため、折れ点（bend point）に直します。
この文言の概念は `bend-point`（根拠キーがこのキー）と `corresponding-line` です。

| 言語 | 今の文言 | 後の PR で入れる訳 |
|---|---|---|
| de（ドイツ語） | Marker auf Verbindungslinie hinzufügen | Knickpunkt auf Verbindungslinie hinzufügen |
| en（英語） | Add Marker On Corresponding Line | Add Bend Point on Corresponding Line |
| es（スペイン語） | Añadir marcador en la línea de correspondencia | Añadir punto de quiebre en la línea de correspondencia |
| fr（フランス語） | Ajouter un marqueur sur la ligne de correspondance | Ajouter un point de brisure à la ligne de correspondance |
| id（インドネシア語） | Tambah penanda pada garis korespondensi | Tambah titik tekuk pada garis korespondensi |
| ja（日本語） | 対応線上にマーカー追加 | 対応線に折れ点を追加 |
| ko（韓国語） | 대응선 위에 마커 추가 | 대응선에 꺾임점 추가 |
| th（タイ語） | เพิ่มหมุดบนเส้นที่สอดคล้อง | เพิ่มจุดหักมุมบนเส้นที่สอดคล้อง |
| vi（ベトナム語） | Thêm điểm đánh dấu trên đường tương ứng | Thêm điểm gấp khúc trên đường tương ứng |
| zh（中国語（簡体字）） | 在对应线上添加标记 | 在对应线上添加折点 |
| zh-TW（中国語（繁体字）） | 在對應線上新增標記 | 在對應線上新增折點 |

確かめたこと: この 11 言語の訳を別の作業場所へ入れて `node scripts/editor-glossary-check.mjs --write` を走らせると、違反は 0 件でした。
`bend-point` の旧い文言は、正本の `pendingTexts` に 11 言語分を全文で記録しています。この全文と一致するあいだだけ警告で、1 言語でも変えたら 11 言語すべてで代表語を検査します。入れたあとは `unused-pending-key` の警告になるので、`pendingKeys` と `pendingTexts` の記録を、正本だけの別の PR で消します。

## 2. 先行登録した新しいキー（画面にまだ出ない概念）

次の概念は、画面にまだ出ないため、根拠キーを `pendingKeys` に先行登録しました。画面を作る PR は、このキー名で 11 言語すべてに足してください
（キー名を変えるときは、先に正本だけの PR で `rootKey` と `pendingKeys` を直します）。各言語の代表語は `editor-glossary.md` の表のとおりです。

画面に出す持ち主は、J6 設計書（`2026-11-26-jan27-j6-editor-crs-estimation-task-design.md`）の §4.7 で決めました。

| 概念 | 根拠キー（先行登録） | 日本語の代表語 | 英語の代表語 | 画面に出す持ち主 |
|---|---|---|---|---|
| transform-setup-legacy | `mapedit.crs_setup_legacy` | 従来型 | legacy | J6-T5a |
| proportional-point | `mapedit.tin_proportional_point` | 内分点 | proportional point | MaplatEditor#321 |
| supplement-point | `mapedit.tin_supplement_point` | 補完点 | supplement point | MaplatEditor#321 |
| extrapolation-quadrilateral | `mapedit.tin_extrapolation_quadrilateral` | 外挿四辺形 | extrapolation quadrilateral | MaplatEditor#321 |
| auxiliary-vertex | `mapedit.tin_auxiliary_vertex` | 補助頂点 | auxiliary vertex | MaplatEditor#321 |

このほか、変換の形（`transform-setup-a`・`-b`・`-c`）の根拠キー `mapedit.crs_setup_a`・`_b`・`_c` の文言は、記号の付かない代表語
（CRS／三角網＋大域外挿／三角網＋扇形外挿。英語は CRS only／TIN + global extrapolation／TIN + fan extrapolation）にします。画面には A〜C の記号を出しません。

## 3. 根拠キーを付け替えた概念

変換の形の画面の文言から world file・大域モデルの語が消えるため、次の 2 概念の根拠キーを、その語が出るはずのキーへ付け替えました（どちらも先行登録のまま）。
画面を作る PR は、この 2 キーの文言に、それぞれの概念の語を入れてください。

| 概念 | 付け替え前 | 付け替え後（先行登録） | 文言に入れる語 |
|---|---|---|---|
| world-file | `mapedit.crs_setup_a` | `mapedit.crs_gcp_edited_after_adopt` | ワールドファイル／world file など（`editor-glossary.md` の表） |
| global-model | `mapedit.crs_setup_b` | `mapedit.crs_setup_fallback_notice` | 大域モデル／global model など（`editor-glossary.md` の表） |
