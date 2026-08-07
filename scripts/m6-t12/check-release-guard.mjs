/**
 * m6-t12 (§2.2): release ビルドの実行可否ガード。
 *
 * 許可 = release 入力が true でない（通常ビルドは常に通す）
 *      / ref が master
 *      / version が prerelease（'-' を含む。semver の prerelease 全般）
 *
 * なぜ '-rc' 限定にしないか: 人間決定 D2 の意図は「正式版でなければどこからでも
 * 署名ビルドを試せる」であり、-beta 等も同質のため（設計 §2.2・§7-1）。
 *
 * workflow（prepare ジョブ）と smoke（AC3）の両方から同一実装として呼ばれる。
 * 入力は env: RELEASE（'true' / それ以外）・GITHUB_REF（runner 提供）・VERSION。
 */
const release = process.env.RELEASE === 'true';
const ref = process.env.GITHUB_REF ?? '';
const version = process.env.VERSION ?? '';

if (!release) {
  console.log(`release ガード: 通常ビルド（release=false）のため制約なし`);
  process.exit(0);
}
if (ref === 'refs/heads/master') {
  console.log(`release ガード: master ブランチのため許可（version=${version}）`);
  process.exit(0);
}
if (version.includes('-')) {
  console.log(`release ガード: prerelease バージョン（${version}）のため ${ref} からの release ビルドを許可`);
  process.exit(0);
}
console.error(
  `::error::正式版バージョン（${version}）の release ビルドは master ブランチ限定です（現在: ${ref}）。` +
  ` prerelease（例: 1.0.0-rc1）であれば任意のブランチから実行できます。`
);
process.exit(1);
