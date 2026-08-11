/**
 * m6-t12: 署名ビルド CI/CD の受け入れ検査（設計 v1.1）
 *
 * AC1: build.yml が YAML として妥当 + secrets 参照が §4 契約表と1対1 + action の SHA ピン
 * AC3: release ガード（P3 スクリプト）の4ケース
 * AC4: eSigner / 公証 / Release が release=false で発火しない（ワークフロー式の静的検査）
 * AC5: latest.yml 再計算 + blockmap 再生成（P4 スクリプト）
 * AC6: 旧 WIN_CSC_LINK 参照・master push 署名経路が残存しない
 */
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const GUARD = path.join(projectRoot, 'scripts/m6-t12/check-release-guard.mjs');
const RESIGN = path.join(projectRoot, 'scripts/m6-t12/resign-update-metadata.mjs');
const WORKFLOW = path.join(projectRoot, '.github/workflows/build.yml');

const sha512b64 = (buf) => createHash('sha512').update(buf).digest('base64');

// ───────────────────────────────────────────────
// AC3: リリースガード（workflow と同一実装を直接実行）
//
// 2軸モデル（人間決定 D6・2026-08-08）:
//   mode=verify … Mac 署名のみ / Win 署名なし / Release 作らない → 課金ゼロ → 全バージョン許可
//   mode=full   … Mac 署名+公証 / Win eSigner 署名 / draft Release → 課金あり → rc 以降に限定
// 「rc 以降」の定義: prerelease 識別子が rc 始まり（alpha/beta は拒否）、
//   または正式版（prerelease なし）で ref が master
// ───────────────────────────────────────────────
{
  const run = (MODE, GITHUB_REF, VERSION) =>
    spawnSync(process.execPath, [GUARD], {
      env: { ...process.env, MODE, GITHUB_REF, VERSION },
      encoding: 'utf8',
    });
  const ok = (r, msg) => assert.equal(r.status, 0, `${msg}: ${r.stderr}${r.stdout}`);
  const ng = (r, msg, re) => {
    assert.equal(r.status, 1, msg);
    if (re) assert.match(r.stderr + r.stdout, re, `${msg}（理由の説明）`);
  };

  // --- mode=full: rc 以降のみ ---
  ok(run('full', 'refs/heads/master', '1.0.0'), 'AC3(a) full + master + 正式版 → 許可');
  ok(run('full', 'refs/heads/foss4g-hiroshima', '1.0.0-rc1'), 'AC3(b) full + 非master + rc → 許可');
  ok(run('full', 'refs/heads/any/branch', '2.0.0-rc.3'), 'AC3(c) full + rc.3 表記も許可');
  ng(run('full', 'refs/heads/foss4g-hiroshima', '1.0.0'), 'AC3(d) full + 非master + 正式版 → 拒否', /master/);
  ng(run('full', 'refs/heads/foss4g-hiroshima', '1.0.0-alpha1'), 'AC3(e) full + alpha → 拒否', /rc/);
  ng(run('full', 'refs/heads/foss4g-hiroshima', '1.0.0-beta2'), 'AC3(f) full + beta → 拒否', /rc/);

  // --- mode=verify: 課金ゼロにつき全バージョン許可 ---
  ok(run('verify', 'refs/heads/foss4g-hiroshima', '1.0.0'), 'AC3(g) verify + 非master + 正式版 → 許可');
  ok(run('verify', 'refs/heads/wip/anything', '0.1.0-alpha1'), 'AC3(h) verify + alpha → 許可');
  ok(run('verify', 'refs/heads/master', '1.0.0-rc1'), 'AC3(i) verify + master + rc → 許可');

  console.log('  [1/7] AC3 リリースガード 9ケース（2軸モデル）: PASS');
}

// ───────────────────────────────────────────────
// AC5: latest.yml 再計算 + blockmap 再生成
// ───────────────────────────────────────────────
{
  const dir = await mkdtemp(path.join(tmpdir(), 'm6-t12-resign-'));
  const files = ['MaplatEditor-Windows-9.9.9-x64-Setup.exe', 'MaplatEditor-Windows-9.9.9-arm64-Setup.exe'];
  for (const f of files) {
    // 「署名済み」相当のバイナリ（内容は任意。blockmap は内容定義チャンクなので形式不問）
    await writeFile(path.join(dir, f), randomBytes(256 * 1024));
    // 未署名バイナリ由来の stale blockmap（garbage で代替。再生成されるべき対象）
    await writeFile(path.join(dir, f + '.blockmap'), Buffer.from('stale-blockmap'));
  }
  const staleSha = sha512b64(Buffer.from('stale'));
  const latest = {
    version: '9.9.9',
    files: files.map((f) => ({ url: f, sha512: staleSha, size: 1, blockMapSize: 1 })),
    path: files[0],
    sha512: staleSha,
    releaseDate: new Date(0).toISOString(),
  };
  await writeFile(path.join(dir, 'latest.yml'), yaml.dump(latest));

  const r = spawnSync(process.execPath, [RESIGN, dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, `AC5 再計算スクリプトが成功する: ${r.stderr}\n${r.stdout}`);

  const updated = yaml.load(await readFile(path.join(dir, 'latest.yml'), 'utf8'));
  for (const f of files) {
    const buf = readFileSync(path.join(dir, f));
    const entry = updated.files.find((e) => e.url === f);
    assert.ok(entry, `AC5 files エントリが保持される: ${f}`);
    assert.equal(entry.sha512, sha512b64(buf), `AC5 sha512 が署名後バイナリと一致: ${f}`);
    assert.equal(entry.size, buf.length, `AC5 size が一致: ${f}`);

    // blockmap: 再生成済み（gzip JSON として解釈でき、stale 内容ではない）
    const bmBuf = readFileSync(path.join(dir, f + '.blockmap'));
    assert.notEqual(bmBuf.toString(), 'stale-blockmap', `AC5 blockmap が再生成されている: ${f}`);
    const bm = JSON.parse(gunzipSync(bmBuf).toString());
    assert.ok(Array.isArray(bm.files) && bm.files.length > 0, `AC5 blockmap が有効な形式: ${f}`);
    assert.equal(entry.blockMapSize, bmBuf.length, `AC5 blockMapSize が新 blockmap と一致: ${f}`);
  }
  // legacy トップレベル（旧 electron-updater 互換）も更新される
  assert.equal(updated.sha512, sha512b64(readFileSync(path.join(dir, updated.path))), 'AC5 legacy sha512 も更新');

  console.log('  [2/7] AC5 latest.yml 再計算 + blockmap 再生成: PASS');
}

// ───────────────────────────────────────────────
// AC1 / AC4 / AC6: build.yml の静的検査
// ───────────────────────────────────────────────
{
  const src = await readFile(WORKFLOW, 'utf8');
  const wf = yaml.load(src); // AC1: YAML として妥当

  // AC1: secrets 参照の全数が契約表（設計 §4）と1対1
  const EXPECTED_SECRETS = [
    'APPLE_CERT_BASE64', 'APPLE_CERT_PASSWORD',
    'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID',
    'ES_USERNAME', 'ES_PASSWORD', 'ES_CREDENTIAL_ID', 'ES_TOTP_SECRET',
  ].sort();
  const referenced = [...new Set([...src.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(referenced, EXPECTED_SECRETS, 'AC1: secrets 参照が契約表と完全一致');

  // AC1/D4: サードパーティ action は 40桁 SHA ピン
  const uses = [...src.matchAll(/uses:\s*([^\s#]+)/g)].map((m) => m[1]);
  for (const u of uses) {
    if (u.startsWith('actions/')) continue; // GitHub first-party は tag 許容
    const [, ref] = u.split('@');
    assert.match(ref ?? '', /^[0-9a-f]{40}$/, `AC1: サードパーティ action が SHA ピンされている: ${u}`);
  }
  // eSigner action が存在する
  assert.ok(uses.some((u) => u.startsWith('SSLcom/esigner-codesign@')), 'AC1: eSigner action を使用');

  // AC4: 課金・公証を伴う経路が mode=full のときだけ発火する（D6 の2軸モデル）
  const FULL_COND = /github\.event_name == 'workflow_dispatch' && inputs\.mode == 'full'/;
  const DISPATCH_COND = /github\.event_name == 'workflow_dispatch'/;

  // AC10: 入力が2軸（mode / platforms）であり、既定が課金ゼロ側であること
  const inputs = wf.on.workflow_dispatch.inputs;
  assert.deepEqual(Object.keys(inputs).sort(), ['mode', 'platforms'], 'AC10: 入力は mode / platforms の2軸');
  assert.deepEqual(inputs.mode.options, ['verify', 'full'], 'AC10: mode の選択肢');
  assert.equal(inputs.mode.default, 'verify', 'AC10: mode の既定は課金ゼロ側（verify）');
  assert.deepEqual(inputs.platforms.options, ['all', 'mac', 'win', 'linux'], 'AC10: platforms の選択肢');
  assert.equal(inputs.platforms.default, 'all', 'AC10: platforms の既定は all');

  // AC10: platforms フィルタが各ビルドジョブに掛かる（push では常に全部走る）
  for (const [job, key] of [['build-mac', 'mac'], ['build-win', 'win'], ['build-linux', 'linux']]) {
    const cond = wf.jobs[job].if ?? '';
    assert.match(cond, /github\.event_name != 'workflow_dispatch'/, `AC10: ${job} は push で常に走る`);
    assert.ok(
      cond.includes("inputs.platforms == 'all'") && cond.includes(`inputs.platforms == '${key}'`),
      `AC10: ${job} が platforms フィルタを持つ`
    );
  }
  const winSteps = wf.jobs['build-win'].steps;
  // IR-1: 署名対象は file_path 明示の2ステップ（x64/arm64）。dir_path の「署名不可ファイル
  // 混在時の挙動」は action 側で未文書化のため、課金付き経路では決定的な指定だけを使う
  const esigners = winSteps.filter((s) => (s.uses ?? '').startsWith('SSLcom/esigner-codesign@'));
  assert.equal(esigners.length, 2, 'IR-1: eSigner は file_path 明示の2ステップ');
  for (const s of esigners) {
    assert.ok(FULL_COND.test(s.if ?? ''), 'AC4: eSigner 署名は mode=full 限定（verify では Win 署名なし）');
    assert.equal(s.with.command, 'sign', 'IR-1: 単一ファイル署名コマンドを使う');
    assert.ok(!('dir_path' in s.with), 'IR-1: dir_path を使わない');
  }
  const signTargets = esigners.map((s) => String(s.with.file_path));
  assert.ok(
    signTargets.some((t) => t.endsWith('-x64-Setup.exe')) &&
    signTargets.some((t) => t.endsWith('-arm64-Setup.exe')),
    'IR-1: x64/arm64 の Setup.exe を artifactName パターンどおり明示指定'
  );
  // dir_path の不使用は上の per-step 検査（with キー）で担保する。文字列全域 grep にしないのは
  // 「dir_path を使わない理由」を説明するコメント自体まで禁止しないため
  const resign = winSteps.find((s) => (s.run ?? '').includes('resign-update-metadata'));
  assert.ok(resign && FULL_COND.test(resign.if ?? ''), 'AC4: metadata 再計算は mode=full 限定');
  const macSteps = wf.jobs['build-mac'].steps;
  const notarize = macSteps.find((s) => (s.name ?? '').includes('notarization'));
  assert.ok(notarize && FULL_COND.test(notarize.if ?? ''), 'AC4: 公証 env は mode=full 限定');
  assert.ok(FULL_COND.test(wf.jobs.release.if ?? '') && (wf.jobs.release.if ?? '').includes("inputs.platforms == 'all'"),
    'AC4: draft Release は mode=full かつ platforms=all 限定');

  // AC6: 旧 WIN_CSC_LINK と master push 署名経路の残存なし（repo 側の全域 grep は下で実施）
  assert.ok(!src.includes('WIN_CSC_LINK'), 'AC6: build.yml に WIN_CSC_LINK が残存しない');
  const importCert = macSteps.find((s) => (s.name ?? '').includes('Apple Developer certificate'));
  assert.ok(importCert && DISPATCH_COND.test(importCert.if ?? ''), 'AC6: 証明書インポートは dispatch 限定');
  assert.ok(!FULL_COND.test(importCert.if ?? ''), 'AC10: Mac の署名は verify でも行う（full 限定にしない）');
  assert.ok(!/push' && github\.ref == 'refs\/heads\/master'/.test(importCert.if ?? ''),
    'AC6: master push 署名経路が撤去されている');

  // §2.2: ガードは P3 スクリプト経由（判定の単一実装）
  const prepSteps = wf.jobs.prepare.steps;
  assert.ok(prepSteps.some((s) => (s.run ?? '').includes('check-release-guard.mjs')),
    'AC1: prepare が check-release-guard.mjs を呼ぶ');

  // §2.4: 動的 environment（release 実行時のみ 'release'）
  for (const job of ['build-mac', 'build-win', 'release']) {
    const envmt = String(wf.jobs[job].environment ?? '');
    assert.ok(envmt.includes("'release'") && envmt.includes("workflow_dispatch"),
      `AC1: ${job} に動的 environment（dispatch のとき release 環境）がある`);
  }

  // P1(e): win アーティファクトに blockmap を含める
  const upload = winSteps.find((s) => (s.uses ?? '').startsWith('actions/upload-artifact'));
  assert.ok(String(upload.with.path).includes('*.exe.blockmap'), 'AC1: win artifacts に blockmap を含む');

  console.log('  [3/7] AC1/AC4/AC6/AC10 build.yml 静的検査: PASS');
}

// ───────────────────────────────────────────────
// AC6: WIN_CSC_LINK / isWinSigning の repo 全域残存なし（P5）
// ───────────────────────────────────────────────
{
  const config = await readFile(path.join(projectRoot, 'electron-builder.config.cjs'), 'utf8');
  assert.ok(!config.includes('WIN_CSC_LINK'), 'AC6: electron-builder.config.cjs に WIN_CSC_LINK が残存しない');
  assert.ok(!config.includes('isWinSigning'), 'AC6: 未使用 isWinSigning が撤去されている');
  assert.ok(existsSync(GUARD) && existsSync(RESIGN), 'P3/P4 スクリプトが実在する');
  console.log('  [4/7] AC6 repo 側残存なし: PASS');
}

// ───────────────────────────────────────────────
// AC9: 公証経路が二重にならない（AC7 実走で発見した欠陥の回帰止め）
//
// electron-builder 24.13.3 は APPLE_ID を env に見つけると自前の notarizeIfProvided を
// 走らせる。mac.notarize が未定義だと macPackager.js:501 の
// `const { appBundleId, ascProvider } = options` が undefined を分解して落ちる（実測）。
// 本プロジェクトの公証は afterSign（scripts/notarize/notarize.cjs）が担うため、
// electron-builder 側は明示的に false で止める。両方有効だと二重公証になる。
// ───────────────────────────────────────────────
{
  process.env.APPLE_ID = 'smoke@example.com';
  process.env.APPLE_APP_SPECIFIC_PASSWORD = 'xxxx-xxxx-xxxx-xxxx';
  process.env.APPLE_TEAM_ID = 'SMOKETEAM1';
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const configPath = path.join(projectRoot, 'electron-builder.config.cjs');
  delete req.cache?.[configPath];
  const cfg = req(configPath);

  assert.equal(
    cfg.mac.notarize, false,
    'AC9: APPLE_ID 設定時に mac.notarize が明示 false でない'
    + '（electron-builder 自前の公証が起動し、mac.notarize 未定義のため分解エラーで落ちる）'
  );
  assert.equal(
    cfg.afterSign, 'scripts/notarize/notarize.cjs',
    'AC9: 公証は afterSign フックが担う（APPLE_ID があるとき）'
  );
  assert.equal(cfg.mac.hardenedRuntime, true, 'AC9: 公証時は Hardened Runtime が有効');
  console.log('  [5/7] AC9 公証経路の単一化: PASS');
}

// ───────────────────────────────────────────────
// AC11: GITHUB_TOKEN の最小権限（セキュリティレビュー SR-t12-M-1）
//
// contents: write を必要とするのは Release を作る release ジョブだけである。
// workflow レベルに置くとビルド3ジョブの GITHUB_TOKEN にも書き込み権限が乗り、
// checkout の既定（persist-credentials: true）が .git/config へ残したトークンを
// 経由して、ビルド時に走る依存ツリー（vite / vue-tsc / electron-builder の
// プラグイン群）の汚染がそのままリポジトリ書き込みに直結する。署名パイプラインでは
// 「次に署名される内容を書き換えられる」ことを意味するため、
// 外部 action を SHA ピンする脅威モデルと整合させる。
// ───────────────────────────────────────────────
{
  const wf = yaml.load(readFileSync(WORKFLOW, 'utf8'));

  assert.equal(
    wf.permissions?.contents, 'read',
    'AC11: workflow レベルの permissions.contents は read（write を全ジョブへ配らない）'
  );
  assert.equal(
    wf.jobs.release.permissions?.contents, 'write',
    'AC11: contents: write は Release を作る release ジョブにのみ与える'
  );
  for (const job of ['prepare', 'build-mac', 'build-win', 'build-linux']) {
    assert.notEqual(
      wf.jobs[job].permissions?.contents, 'write',
      `AC11: ${job} に contents: write を与えない`
    );
  }
  // 多層防御: ビルドジョブの checkout はトークンを .git/config へ残さない
  for (const job of ['build-mac', 'build-win', 'build-linux']) {
    const co = wf.jobs[job].steps.find((s) => (s.uses ?? '').startsWith('actions/checkout@'));
    assert.equal(
      co?.with?.['persist-credentials'], false,
      `AC11: ${job} の checkout は persist-credentials: false`
    );
  }
  console.log('  [6/7] AC11 GITHUB_TOKEN の最小権限: PASS');
}

// ───────────────────────────────────────────────
// AC12: Hardened Runtime 下で V8 が起動できる entitlements（2026-08-09 の起動不能事故）
//
// Apple Silicon では Hardened Runtime 下の V8 が JIT 用 CodeRange を MAP_JIT で確保する。
// これを許すのは com.apple.security.cs.allow-jit のみで、
// allow-unsigned-executable-memory は別物であり代替にならない。欠けると **署名ビルドだけ**が
// 起動直後に「Failed to reserve virtual memory for CodeRange」で自死し、
// 未署名のローカルビルドでは再現しないため CI のビルド成功だけでは検出できない
// （1.0.0-rc1 の公証済み .app で実測。同じ .app に allow-jit を足して再署名すると起動した）。
// ───────────────────────────────────────────────
{
  const entPath = path.join(projectRoot, 'scripts/notarize/entitlements.mac.plist');
  const ent = readFileSync(entPath, 'utf8');

  // <key>…</key> の直後の <true/> までを1組として拾う（順序・空白に依存しない）
  const granted = new Set(
    [...ent.matchAll(/<key>\s*([^<]+?)\s*<\/key>\s*<true\s*\/>/g)].map((m) => m[1])
  );
  assert.ok(
    granted.has('com.apple.security.cs.allow-jit'),
    'AC12: entitlements に com.apple.security.cs.allow-jit が無い'
      + '（Apple Silicon の署名ビルドが V8 の CodeRange 確保に失敗して起動直後に落ちる。'
      + ' allow-unsigned-executable-memory は代替にならない）'
  );

  // 署名時のみ有効化される entitlements 経路が、上のファイルを指していること。
  // entitlementsInherit も同じでなければヘルパー（Renderer/GPU/Plugin）に権限が渡らない
  const cfgSrc = readFileSync(path.join(projectRoot, 'electron-builder.config.cjs'), 'utf8');
  for (const key of ['entitlements', 'entitlementsInherit']) {
    assert.match(
      cfgSrc,
      new RegExp(`${key}:\\s*'scripts/notarize/entitlements\\.mac\\.plist'`),
      `AC12: electron-builder.config.cjs の ${key} が entitlements.mac.plist を指していない`
    );
  }
  console.log('  [7/7] AC12 Hardened Runtime 下の JIT entitlements: PASS');
}

console.log('\nm6-t12 release-workflow smoke: すべて成功');
