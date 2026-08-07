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
// AC3: release ガード（workflow と同一実装を直接実行）
// ───────────────────────────────────────────────
{
  const run = (RELEASE, GITHUB_REF, VERSION) =>
    spawnSync(process.execPath, [GUARD], {
      env: { ...process.env, RELEASE, GITHUB_REF, VERSION },
      encoding: 'utf8',
    });

  const a = run('true', 'refs/heads/master', '1.0.0');
  assert.equal(a.status, 0, `AC3(a) master+正式版+release は許可: ${a.stderr}`);

  const b = run('true', 'refs/heads/foss4g-hiroshima', '1.0.0-rc1');
  assert.equal(b.status, 0, `AC3(b) 非master+prerelease+release は許可: ${b.stderr}`);

  const c = run('true', 'refs/heads/foss4g-hiroshima', '1.0.0');
  assert.equal(c.status, 1, 'AC3(c) 非master+正式版+release は拒否');
  assert.match(c.stderr + c.stdout, /master/, 'AC3(c) 拒否理由に master 限定の説明がある');

  const d = run('false', 'refs/heads/foss4g-hiroshima', '1.0.0');
  assert.equal(d.status, 0, `AC3(d) release=false は ref/version に関わらず拒否しない: ${d.stderr}`);

  console.log('  [1/4] AC3 release ガード 4ケース: PASS');
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

  console.log('  [2/4] AC5 latest.yml 再計算 + blockmap 再生成: PASS');
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

  // AC4: release=false で発火しない条件式（eSigner・metadata 再計算・公証・Release job）
  const RELEASE_COND = /github\.event_name == 'workflow_dispatch' && inputs\.release/;
  const winSteps = wf.jobs['build-win'].steps;
  // IR-1: 署名対象は file_path 明示の2ステップ（x64/arm64）。dir_path の「署名不可ファイル
  // 混在時の挙動」は action 側で未文書化のため、課金付き経路では決定的な指定だけを使う
  const esigners = winSteps.filter((s) => (s.uses ?? '').startsWith('SSLcom/esigner-codesign@'));
  assert.equal(esigners.length, 2, 'IR-1: eSigner は file_path 明示の2ステップ');
  for (const s of esigners) {
    assert.ok(RELEASE_COND.test(s.if ?? ''), 'AC4: eSigner ステップは release 実行限定');
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
  assert.ok(resign && RELEASE_COND.test(resign.if ?? ''), 'AC4: metadata 再計算は release 実行限定');
  const macSteps = wf.jobs['build-mac'].steps;
  const notarize = macSteps.find((s) => (s.name ?? '').includes('notarization'));
  assert.ok(notarize && RELEASE_COND.test(notarize.if ?? ''), 'AC4: 公証 env は release 実行限定');
  assert.ok(RELEASE_COND.test(wf.jobs.release.if ?? ''), 'AC4: Release job は release 実行限定');

  // AC6: 旧 WIN_CSC_LINK と master push 署名経路の残存なし（repo 側の全域 grep は下で実施）
  assert.ok(!src.includes('WIN_CSC_LINK'), 'AC6: build.yml に WIN_CSC_LINK が残存しない');
  const importCert = macSteps.find((s) => (s.name ?? '').includes('Apple Developer certificate'));
  assert.ok(importCert && RELEASE_COND.test(importCert.if ?? ''), 'AC6: 証明書インポートは release 実行限定');
  assert.ok(!/push' && github\.ref == 'refs\/heads\/master'/.test(importCert.if ?? ''),
    'AC6: master push 署名経路が撤去されている');

  // §2.2: ガードは P3 スクリプト経由（判定の単一実装）
  const prepSteps = wf.jobs.prepare.steps;
  assert.ok(prepSteps.some((s) => (s.run ?? '').includes('check-release-guard.mjs')),
    'AC1: prepare が check-release-guard.mjs を呼ぶ');

  // §2.4: 動的 environment（release 実行時のみ 'release'）
  for (const job of ['build-mac', 'build-win', 'release']) {
    const envmt = String(wf.jobs[job].environment ?? '');
    assert.ok(envmt.includes("'release'") && envmt.includes('inputs.release'),
      `AC1: ${job} に動的 environment（release 切替）がある`);
  }

  // P1(e): win アーティファクトに blockmap を含める
  const upload = winSteps.find((s) => (s.uses ?? '').startsWith('actions/upload-artifact'));
  assert.ok(String(upload.with.path).includes('*.exe.blockmap'), 'AC1: win artifacts に blockmap を含む');

  console.log('  [3/4] AC1/AC4/AC6 build.yml 静的検査: PASS');
}

// ───────────────────────────────────────────────
// AC6: WIN_CSC_LINK / isWinSigning の repo 全域残存なし（P5）
// ───────────────────────────────────────────────
{
  const config = await readFile(path.join(projectRoot, 'electron-builder.config.cjs'), 'utf8');
  assert.ok(!config.includes('WIN_CSC_LINK'), 'AC6: electron-builder.config.cjs に WIN_CSC_LINK が残存しない');
  assert.ok(!config.includes('isWinSigning'), 'AC6: 未使用 isWinSigning が撤去されている');
  assert.ok(existsSync(GUARD) && existsSync(RESIGN), 'P3/P4 スクリプトが実在する');
  console.log('  [4/4] AC6 repo 側残存なし: PASS');
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
  console.log('  [5/5] AC9 公証経路の単一化: PASS');
}

console.log('\nm6-t12 release-workflow smoke: すべて成功');
