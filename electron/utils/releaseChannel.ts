// m19-t4a (§6 / §7.3): 配布物の版とパッケージ状態から「RC 版以降」を判定する純関数群。
//
// electron を import しない（smoke から node --experimental-strip-types で直接 import
// できることが前提。既存前例: electron/services/slugReservationKind.ts を
// scripts/m11-t7-slug-reservation-smoke.mjs が直接 import している）。
//
// 「RC 版以降」は配布物の版を指す。開発実行（isPackaged=false）は常に開発メニューを出す
// （reload / toggleDevTools のアクセラレータを失うと開発体験を損なうため。設計書 H-1）。

/** SemVer のプレリリース識別子（"-" 以降）を取り出す。無ければ null（正式リリース）。 */
function prereleaseIdentifier(version: string): string | null {
  const hyphenIndex = version.indexOf('-');
  if (hyphenIndex === -1) return null;
  return version.slice(hyphenIndex + 1);
}

/**
 * 版文字列が「RC 版以降」（正式リリース、または `-rc` プレリリース）かどうかを判定する。
 *
 * 例: "1.0.0-rc1" -> true / "1.0.0" -> true / "1.1.0" -> true
 *     "0.7.0" -> false / "1.0.0-dev.3" -> false / "1.0.0-alpha.1" -> false / "1.0.0-beta.2" -> false
 *
 * 0.x 系（メジャー未達）は SemVer 上プレリリース識別子を持たなくても「RC 版以降」ではない
 * （"0.7.0" は正式リリースの体裁だが 1.0.0 未満のため除外する。§6 の契約表の唯一の非自明ケース）。
 */
export function isRcOrLater(version: string): boolean {
  const major = Number.parseInt(version, 10);
  if (!Number.isFinite(major) || major < 1) return false;

  const prerelease = prereleaseIdentifier(version);
  if (prerelease === null) return true; // 正式リリース（1.0.0 / 1.1.0 等）

  return prerelease.toLowerCase().startsWith('rc');
}

/**
 * 開発メニュー（reload / toggleDevTools / 手動移行）を出すかどうかを判定する。
 *
 * 配布物（isPackaged=true）かつ version が RC 版以降 → false（隠す）
 * それ以外（開発実行・E2E 起動、または pre-RC の配布物） → true（出す）
 */
export function shouldShowDevelopmentMenu(version: string, isPackaged: boolean): boolean {
  if (!isPackaged) return true;
  return !isRcOrLater(version);
}
