/**
 * m6-t12 (§2.2): 署名ビルドの実行可否ガード。
 *
 * 2軸モデル（人間決定 D6・2026-08-08）。ゲートの根拠は**課金の有無**である:
 *
 *   mode=verify … Mac 署名のみ / Win 署名なし / draft Release なし
 *                 → Apple Developer Program は年額で署名ごとの課金がなく、eSigner も呼ばない
 *                 → 課金ゼロ ∴ **全バージョン・全ブランチで許可**
 *
 *   mode=full   … Mac 署名+公証 / Win eSigner 署名 / draft Release
 *                 → eSigner は署名ごとに課金（2回/リリース）
 *                 → **rc 以降に限定**する
 *
 * 「rc 以降」の定義:
 *   - prerelease を持つ場合: 識別子が `rc` 始まりであること（alpha / beta は拒否）
 *   - prerelease を持たない正式版: master ブランチ限定
 *     （正式版を作業ブランチから配布する事故を防ぐ。D2 の方針を継承）
 *
 * workflow（prepare ジョブ）と smoke（AC3）の両方から同一実装として呼ばれる。
 * 入力は env: MODE（verify / full）・GITHUB_REF（runner 提供）・VERSION。
 */
const mode = process.env.MODE ?? 'verify';
const ref = process.env.GITHUB_REF ?? '';
const version = process.env.VERSION ?? '';

if (mode !== 'full') {
  console.log(`ガード: mode=${mode} は課金を伴わないため制約なし（version=${version} / ${ref}）`);
  process.exit(0);
}

// semver の prerelease 部（最初の '-' 以降、ビルドメタデータ '+' は除く）
const prerelease = version.includes('-')
  ? version.slice(version.indexOf('-') + 1).split('+')[0]
  : '';

if (prerelease === '') {
  // 正式版: master 限定
  if (ref === 'refs/heads/master') {
    console.log(`ガード: mode=full / 正式版 ${version} / master ∴ 許可`);
    process.exit(0);
  }
  console.error(
    `::error::正式版バージョン（${version}）の完全ビルドは master ブランチ限定です（現在: ${ref}）。` +
    ` rc 版（例 1.0.0-rc1）であれば任意のブランチから実行できます。`
  );
  process.exit(1);
}

// prerelease: rc 始まりのみ許可（rc1 / rc.3 / rc-2 いずれも可）
if (/^rc(\b|[.\-_]?\d)/i.test(prerelease)) {
  console.log(`ガード: mode=full / rc 版 ${version} ∴ ${ref} からの実行を許可`);
  process.exit(0);
}

console.error(
  `::error::完全ビルド（mode=full）は rc 以降のバージョンに限定されています。` +
  ` 現在のバージョンは ${version}（prerelease 識別子: ${prerelease}）で、rc に達していません。` +
  ` alpha / beta 段階では mode=verify（Mac 署名のみ・Win 署名なし・課金ゼロ）を使ってください。`
);
process.exit(1);
