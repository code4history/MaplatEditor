// m19-t12: サムネイル置換の**単一実装**。
//
// 地図管理（MapEdit.vue）とベースマップ管理（BaseMapEdit.vue）は、これまで構造が同型の
// 置換ロジックを 2 本持っていた（プレビュー state / nonce / refreshThumbnails /
// replaceThumbnail / エラー）。同一扱いの処理は「挙動を似せる」のではなく**同一実装へ寄せる**
// （人間の恒久指示・M11-T10 由来）ため、本モジュールへ集約し、差分だけをホストが注入する。
//
// 【確定した意味論】（タスク設計 §4.1。UI にも同じ言葉で出す）
//   規則 T1: サムネイル画像そのものの置換は**即時反映の資源操作**である。保存の対象ではなく、
//            元に戻す（undo）の対象でもない。戻したい場合は再度置換する。
//   規則 T2: 文書が「どのファイルをサムネイルとするか」を保持している場合（ベースマップの
//            `thumbnail`）、その**指し先の移動は文書編集**であり保存して初めて確定する。
//            ただし指し先は undo/redo の対象にしない（画像は戻らないため、戻すと食い違う）。
//            本モジュールは移動の検出だけを行い、履歴の扱いはホストの `onPointerMoved` に委ねる。
//   規則 T3: 書き込み先のキーが確定していないときは置換ボタンを disabled にして理由を示す。
//            無言の no-op にしない。
//
// 【不変条件 INV-T】52px の所在（`rel52()`）が正本であり、512px の所在は
// `thumb512PathFor(rel52())` からのみ導く。**このモジュールを含め、512px パスの文字列を
// 手で組み立ててはならない**（m19-t5 が置いた拡張子の単一変化点を迂回してしまうため）。
import { computed, ref, type ComputedRef, type Ref, type WritableComputedRef } from "vue";
import i18next from "i18next";
import { thumb512PathFor } from "../utils/thumbnailPaths";

export interface ThumbnailReplaceHost {
  /**
   * 52px の**現在の所在**（saveFolder 相対）。**表示解決の入力専用**である。
   *   - プレビュー（52px / 512px）の解決に使う
   *   - exists52 の判定に使う
   * **規則 T3 のゲートには使わない。** null は「まだ 52px が置かれていない」を意味するだけで、
   * 「置換できない」を意味しない（新規ベースマップは thumbnail 空のまま置換できる）。
   */
  rel52: () => string | null;
  /**
   * 置換の**書き込み先キーと拡張子**。null = キー未確定。
   * **規則 T3 のゲートはこの 1 つだけに依存する**（設計 §4.3.1）。
   */
  writeTarget: () => { fileKey: string; ext: string } | null;
  /** キー未確定の理由（i18n 済み文言）。writeTarget() が null のときだけ使う */
  disabledReason: () => string;
  /**
   * derive52 チェックボックスを強制 ON にするか。
   * `exists52` は本モジュールが算出して**引数で渡す**（ホストは自前で解決しない。設計 §4.3.2）。
   */
  forceDerive52: (ctx: { exists52: boolean }) => boolean;
  /**
   * 52px プレビューの**生 URL を保持する ref**（任意）。
   *   - 与えた場合: この ref を生 URL の正本として `?v=` を付けて表示し、置換成功時に
   *     新しい URL を**この ref へ書き戻す**。`rel52()` からの再解決は行わない
   *   - 与えない場合: `rel52()` から毎回 `fileUrl` で解決する
   * ベースマップは**与える**（一覧 IPC が持つレガシー補完 `tmbs/{mapID}_menu.jpg` を温存する
   * m19-t2 §5.7 の決定を壊さないため）。地図は与えない（設計 §4.3.3）。
   */
  raw52UrlRef?: Ref<string | null>;
  /**
   * このコールが新しい 52px を書き、その所在が現在の指し先と異なるときだけ呼ばれる（規則 U の
   * 同値ガード）。地図は未指定（指し先を持たない）。ベースマップは規則 T2 の rebase を行う。
   */
  onPointerMoved?: (next: string, fileUrl52: string | null) => void;
}

export interface ThumbnailReplace {
  thumbnail512Url: Ref<string | null>;
  thumbnail52Url: ComputedRef<string | null>;
  thumbnailError: Ref<string>;
  thumbnailNonce: Ref<number>;
  /** 52px の実体が rel52() の位置に存在するか。**所有権は本モジュールにある**（設計 §4.3.2） */
  exists52: Ref<boolean>;
  /** v-model 用。derive52Forced が真なら常に true を返し set を無視する */
  derive52Model: WritableComputedRef<boolean>;
  derive52Forced: ComputedRef<boolean>;
  /** 規則 T3。`writeTarget() === null` と等価（設計 §4.3.1） */
  replaceDisabled: ComputedRef<boolean>;
  replaceDisabledReason: ComputedRef<string>;
  refreshThumbnails: () => Promise<void>;
  replaceThumbnail: (kind: "512" | "52") => Promise<void>;
}

export function useThumbnailReplace(host: ThumbnailReplaceHost): ThumbnailReplace {
  const thumbnail512Url = ref<string | null>(null);
  // ホストが raw52UrlRef を与えない場合の受け皿（地図側）。与えた場合はそちらが正本。
  const ownRaw52Url = ref<string | null>(null);
  const raw52Url = host.raw52UrlRef ?? ownRaw52Url;
  const ownsRaw52 = host.raw52UrlRef === undefined;
  const thumbnailError = ref("");
  // 置換後に同一 file:// URL でブラウザが画像をキャッシュするのを防ぐ cache buster。
  // キャッシュバスターの方式は ?v={nonce} に一本化する。
  const thumbnailNonce = ref(0);
  const exists52 = ref(false);
  // 「512px から 52px も作成する」チェックボックス（既定 ON）
  const derive52FromUpload = ref(true);

  const thumbnail52Url = computed<string | null>(() =>
    raw52Url.value ? `${raw52Url.value}?v=${thumbnailNonce.value}` : null,
  );

  const derive52Forced = computed(() => host.forceDerive52({ exists52: exists52.value }));
  const derive52Model = computed<boolean>({
    get: () => (derive52Forced.value ? true : derive52FromUpload.value),
    set: (value: boolean) => { derive52FromUpload.value = value; },
  });

  // 規則 T3。rel52() を混ぜてはならない（設計 §4.3.1。混ぜると thumbnail 空の新規ベースマップで
  // 置換が塞がれ、m19-t2 の T4 / T8 / AC7 が RED になる＝機能が落ちる）
  const replaceDisabled = computed(() => host.writeTarget() === null);
  const replaceDisabledReason = computed(() => (replaceDisabled.value ? host.disabledReason() : ""));

  async function refreshThumbnails(): Promise<void> {
    const rel52 = host.rel52();
    const version = `?v=${thumbnailNonce.value}`;
    try {
      // 512px の所在は派生規約の単一関数からのみ導く（INV-T）
      const rel512 = rel52 ? thumb512PathFor(rel52) : null;
      const url512 = rel512 ? await window.appAssets.fileUrl(rel512) : null;
      thumbnail512Url.value = url512 ? url512 + version : null;
    } catch {
      thumbnail512Url.value = null;
    }
    try {
      const url52 = rel52 ? await window.appAssets.fileUrl(rel52) : null;
      // exists52 の所有権は本モジュールにある。ホストは forceDerive52 の引数として受け取る
      exists52.value = !!url52;
      if (ownsRaw52) raw52Url.value = url52;
    } catch {
      exists52.value = false;
      if (ownsRaw52) raw52Url.value = null;
    }
  }

  async function replaceThumbnail(kind: "512" | "52"): Promise<void> {
    const target = host.writeTarget();
    // 規則 T3 / 規則 K0: 書き込み先キーが未確定なら 1 バイトも書かない。
    // UI 側はこの状態でボタンを disabled にして理由を常時表示しているため通常は到達しないが、
    // 「無言の no-op」を残さないために理由を出す。
    if (!target) { thumbnailError.value = host.disabledReason(); return; }
    thumbnailError.value = "";
    const derive52 = kind === "512" ? derive52Model.value : false;
    try {
      const result = await window.appAssets.replaceMapThumbnail(target.fileKey, kind, derive52, target.ext);
      if (result?.err) {
        if (result.err !== "Canceled") thumbnailError.value = i18next.t("appedit.error_invalid_image");
        return;
      }
      // 規則 U: **このコールが新しい 52px を書いたときだけ**指し先の移動を通知する。
      // 返値の path は「kind が指す側の所在」であり 52px の所在ではない。
      // ∴ path52 が無いときに path で代替するようなフォールバックを書いてはならない（512px を掴む）。
      const written52 = kind === "52" ? result.path : result.path52;
      if (written52) {
        const url52 = (kind === "52" ? result.fileUrl : result.fileUrl52) ?? null;
        if (url52) raw52Url.value = url52;
        // 同値ガード: 指し先が動かないときは通知しない（1 commit = 1 undo / K1 で dirty にしない）
        if (written52 !== host.rel52()) host.onPointerMoved?.(written52, url52);
      }
      // 開発時の保険: 書き込み先が派生規約の位置と食い違ったら沈黙させない。
      // 指し先の移動後に評価する（K2 では移動後の rel52() が正しい基準になる）。
      const rel52After = host.rel52();
      if (import.meta.env.DEV && kind === "512" && rel52After && result.path !== thumb512PathFor(rel52After)) {
        console.warn(
          "[useThumbnailReplace] 512px の書き込み先が thumb512PathFor(rel52()) と一致しません",
          result.path,
          rel52After,
        );
      }
    } catch (cause) {
      console.error("Failed to replace thumbnail", cause);
      thumbnailError.value = i18next.t("appedit.error_invalid_image");
    } finally {
      // 置換後は nonce を上げてプレビューを強制再読込（同一 URL のブラウザキャッシュを回避）
      thumbnailNonce.value++;
      await refreshThumbnails();
    }
  }

  return {
    thumbnail512Url,
    thumbnail52Url,
    thumbnailError,
    thumbnailNonce,
    exists52,
    derive52Model,
    derive52Forced,
    replaceDisabled,
    replaceDisabledReason,
    refreshThumbnails,
    replaceThumbnail,
  };
}
