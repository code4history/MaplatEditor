# issue #192: 複製直後（未保存）のサムネイル置換が複製元のアイコンを壊す

検証基点: `origin/master` `aa81368`（2026-10-25 時点）。issue は open。

## 症状

ベースマップを複製した直後、まだ一度も保存していない状態でサムネイルの「置換」を行うと、
置換した画像が**複製元のアイコンのファイル**（`tmbs/<複製元 uid>.png`、512px も同様）へ
書き込まれ、複製元のベースマップのアイコンが変わってしまう。データを壊す不具合である。

## 規則 K（K1）の現行記述

設計書 `docs/superpowers/specs/2026-08-09-m19-t2-basemap-thumbnail-512-design.md` と
`2026-08-10-m19-t12-thumbnail-replace-persistence-parity-design.md` が定める規則 K は、
置換の書き込みキーと拡張子を `document.thumbnail` から採る（K1）。`thumbnail` が空・
同梱画像・URL のときは自分の uid 名へ新しく作る（K2）。slug 未入力なら書かない（K0）。

**この規則は変更しない。** 本件は K1 の適用範囲に例外を足す。

## 例外（K1'）: `thumbnail` が自分の uid 名でないとき

`document.thumbnail` が `tmbs/<key>.<ext>` の形でも、`key` が**この文書の uid と一致しない**
ときは、他者のファイルを指している可能性がある（複製直後・旧 slug 名・未保存文書）。
この場合は K1 を適用せず、次を行う。

1. 書き込み先は、事前に採番済みの**自分の uid 名**（`BaseMapEdit.vue` の `iconFileKey()`）にする。
   拡張子は `thumbnail` から引き継ぐ（merc 継承の `.jpg` などを保つ）。
2. 置換後、`thumbnail` を自分の uid 名へ付け替える（規則 T2 の rebase。undo の対象外）。
3. 52px 単独置換では、元の 512px を**複製**して自分の uid 名の 512px を用意する
   （元ファイルは読むだけで、書き換え・移動・削除をしない）。
4. 512px 置換では、52px の派生を強制する（他者の 52px を参照したまま自分の 512px だけを
   作らない）。強制を外すのは「自分の uid 名を指し、かつ 52px の実体がある」ときだけ。

自分の uid 名を指しているときは従来どおり K1 である。

## 実装箇所

- 書き込み先の決定: `src/components/basemap/baseMapThumbnailTarget.ts`
  （`resolveBaseMapThumbnailWriteTarget` / `shouldForceDerive52`）
- 置換の単一実装: `src/composables/useThumbnailReplace.ts`
- IPC: `electron/ipc/appassets.ts` / `electron/preload.ts` / `src/electron.d.ts`
- 書き込みと 512px の引き継ぎ: `electron/services/AppAssetService.ts`
- 初回保存の整合: `electron/services/SqliteDataService.ts` の `saveUserBaseMap`
  （`thumbnail` が自分の uid 名なので relocate / repoint は何もしない。#148 の copy 方式とも整合）

## 検証

`pnpm smoke:issue-192-thumbnail-replace` が、実 SQLite・実 IPC ハンドラ・実
`AppAssetService`／`SqliteDataService` と実ファイルで、52px / 512px（derive OFF を含む）・
`.jpg`・K1・K2/K0 を検証する。修正前は複製元の 52px が置換画像で上書きされて赤になることを
実測してから修正した。

## 未検証

- Electron 画面からの「複製 → 置換 → 初回保存 → 再起動」の実機操作
- Windows/macOS 固有のファイルロック・権限、電源断、同時編集
