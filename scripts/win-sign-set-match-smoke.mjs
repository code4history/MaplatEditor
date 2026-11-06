#!/usr/bin/env node
/**
 * 署名した PE の集合と配布物の中身の突き合わせ（scripts/win-sign/verify-win-sign-set.mjs）の受け入れ検査。
 *
 * 実署名と Setup.exe の展開は CI（build.yml の verify-win-install の x64 の脚）でしか走らないため、
 * ここでは Windows も 7-Zip も要らない部分を固める:
 *   [1] compareSignSet の表（判定 A: 署名したのに配布物に無い PE が無い・判定 B: 配布物の Microsoft 以外の署名の PE が
 *       すべて署名した集合にある・記録の形）
 *   [2] build.yml の静的検査（verify-win-install の matrix・x64 の脚にだけある突き合わせ・署名の記録の積み直し・
 *       依存を入れないこと）
 *   [3] 自己検査: [2] の各条件を外した変異を [2] が落とす（規則の空振りの検出）
 *
 * 実行: node scripts/win-sign-set-match-smoke.mjs（rtk を付けない）
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const WORKFLOW = path.join(projectRoot, '.github/workflows/build.yml');
const SET_SCRIPT = path.join(projectRoot, 'scripts/win-sign/verify-win-sign-set.mjs');

const { compareSignSet } = await import('./win-sign/verify-win-sign-set.mjs');

const AS_SUBJECT = 'CN="Nayuta, Inc.", O="Nayuta, Inc.", L=Osaka-shi, S=Osaka-fu, C=JP';
const MS_SUBJECT = 'CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond, S=Washington, C=US';
const hex = (ch) => ch.repeat(64);
const rec = (i, o, status = 'Valid') => ({ in: hex(i), out: hex(o), status, subject: AS_SUBJECT });
const pe = (file, o, subject = AS_SUBJECT, status = 'Valid') => ({ file, sha256: hex(o), authenticode: subject == null ? null : { status, subject } });

// ───────────────────────────────────────────────
// [1] compareSignSet の表
// ───────────────────────────────────────────────
{
  const records = [
    { role: 'payload', file: 'payload/signing-record.json', entries: [rec('1', 'a'), rec('2', 'b'), rec('3', 'c')] },
    { role: 'uninstaller', file: 'uninstaller/signing-record.json', entries: [rec('4', 'd'), rec('5', 'e')] },
    { role: 'installer', file: 'installer/signing-record.json', entries: [rec('6', 'f'), rec('7', '0')] },
  ];
  const dist = [
    pe('x64-Setup.exe', 'f'), pe('arm64-Setup.exe', '0'),
    pe('x64/app/MaplatEditor.exe', 'a'), pe('x64/app/ffmpeg.dll', 'b'), pe('x64/$PLUGINSDIR/nsis7z.dll', 'c'),
    pe('x64/Uninstall.exe', 'd'), pe('arm64/Uninstall.exe', 'e'),
    pe('x64/app/d3dcompiler_47.dll', '9', MS_SUBJECT), pe('arm64/app/dxil.dll', '8', MS_SUBJECT),
  ];

  // 緑: S ⊆ D・Microsoft 署名の PE は S に無くてもよい
  {
    const r = compareSignSet({ records, distribution: dist });
    assert.deepEqual(r.errors, [], `[1] 緑の表で errors: ${r.errors.join(' / ')}`);
    assert.equal(r.ok, true, '[1] S ⊆ D で緑');
    assert.deepEqual(r.sizes, { records: 7, S: 7, D: 9, SD: 7 }, '[1] |S|・|D|・|S∩D|');
    assert.deepEqual(r.missingFromDistribution, [], '[1] 判定 A: S \\ D が空');
    assert.deepEqual(r.unsignedInDistribution, [], '[1] 判定 B: Microsoft 署名の PE は外れに数えない');
    assert.equal(r.authenticodeChecked, true, '[1] Authenticode を読んだ印');
  }
  // 赤: S に D に無い 1 件（署名したのに配布物に無い）
  {
    const r = compareSignSet({ records: [...records, { role: null, file: 'x', entries: [rec('8', '7')] }], distribution: dist });
    assert.equal(r.ok, false, '[1] 判定 A: 署名したのに配布物に無い PE があれば赤');
    assert.deepEqual(r.missingFromDistribution.map((m) => m.out), [hex('7')], '[1] 判定 A: S \\ D の一覧');
  }
  // 赤: D の Microsoft 以外の署名の PE が S に無い
  {
    const r = compareSignSet({ records, distribution: [...dist, pe('x64/app/rogue.dll', '5', 'CN=Rogue, O=Rogue, C=US')] });
    assert.equal(r.ok, false, '[1] 判定 B: Microsoft 以外が署名した PE が S に無ければ赤');
    assert.deepEqual(r.unsignedInDistribution.map((u) => u.file), ['x64/app/rogue.dll'], '[1] 判定 B: 外れの一覧');
  }
  // 赤: D の無署名の PE が S に無い（authenticode の status が Valid でない・subject が無い）
  {
    const r = compareSignSet({ records, distribution: [...dist, { file: 'x64/app/naked.dll', sha256: hex('4'), authenticode: { status: 'NotSigned', subject: null } }] });
    assert.equal(r.ok, false, '[1] 判定 B: 無署名の PE が S に無ければ赤');
    assert.deepEqual(r.unsignedInDistribution.map((u) => u.file), ['x64/app/naked.dll']);
  }
  // Authenticode を読まないとき（--no-authenticode）は判定 B を飛ばし、その印を出す
  {
    const noAuth = dist.map((d) => ({ ...d, authenticode: null }));
    const r = compareSignSet({ records, distribution: [...noAuth, pe('x64/app/rogue.dll', '5', null)] });
    assert.equal(r.ok, true, '[1] Authenticode を読まなければ判定 B は飛ばす（判定 A は行う）');
    assert.equal(r.authenticodeChecked, false);
    assert.deepEqual(r.unsignedInDistribution, []);
    const r2 = compareSignSet({ records: [...records, { role: null, file: 'x', entries: [rec('8', '7')] }], distribution: noAuth });
    assert.equal(r2.ok, false, '[1] Authenticode を読まなくても判定 A は赤になる');
  }
  // 赤: 記録が空
  {
    const r = compareSignSet({ records: [], distribution: dist });
    assert.equal(r.ok, false, '[1] 記録が空なら赤');
    assert.ok(r.errors.some((e) => /記録/.test(e)), `[1] 記録が空の理由: ${r.errors.join(' / ')}`);
    const r2 = compareSignSet({ records: [{ role: 'payload', file: 'p', entries: [] }], distribution: dist });
    assert.equal(r2.ok, false, '[1] 記録のファイルがあっても件数 0 なら赤');
  }
  // 赤: status が Valid でない記録
  {
    const bad = structuredClone(records);
    bad[0].entries[1].status = 'HashMismatch';
    const r = compareSignSet({ records: bad, distribution: dist });
    assert.equal(r.ok, false, '[1] Valid でない記録があれば赤');
    assert.ok(r.errors.some((e) => /HashMismatch/.test(e)), `[1] Valid でない記録の理由: ${r.errors.join(' / ')}`);
  }
  // 同じ out の重複は 1 件に数える
  {
    const dup = structuredClone(records);
    dup[0].entries.push(rec('1', 'a'));
    const r = compareSignSet({ records: dup, distribution: dist });
    assert.equal(r.ok, true);
    assert.equal(r.sizes.S, 7, '[1] 同じ out の重複は 1 件');
    assert.equal(r.sizes.records, 8, '[1] 記録の行数は重複を含めて数える');
  }
  // 赤: in・out が SHA-256（64 桁 hex）でない
  {
    const badIn = structuredClone(records);
    badIn[1].entries[0].in = '../evil';
    assert.equal(compareSignSet({ records: badIn, distribution: dist }).ok, false, '[1] in が 64 桁 hex でなければ赤');
    const badOut = structuredClone(records);
    badOut[1].entries[0].out = hex('A');
    assert.equal(compareSignSet({ records: badOut, distribution: dist }).ok, false, '[1] out が小文字 64 桁 hex でなければ赤');
  }
  // 赤: uninstaller・installer の記録がちょうど 2 件でない
  {
    const three = structuredClone(records);
    three[2].entries.push(rec('9', '6'));
    const r = compareSignSet({ records: three, distribution: [...dist, pe('other-Setup.exe', '6')] });
    assert.equal(r.ok, false, '[1] installer の記録が 3 件なら赤');
    assert.ok(r.errors.some((e) => /installer/.test(e) && /2/.test(e)), `[1] 件数の理由: ${r.errors.join(' / ')}`);
    const one = structuredClone(records);
    one[1].entries.pop();
    assert.equal(compareSignSet({ records: one, distribution: dist }).ok, false, '[1] uninstaller の記録が 1 件なら赤');
    // 役が無い記録は件数を見ない
    const noRole = records.map((x) => ({ ...x, role: null }));
    assert.equal(compareSignSet({ records: noRole, distribution: dist }).ok, true, '[1] 役の無い記録は件数を見ない');
  }
  // 赤: 配布物が空
  {
    const r = compareSignSet({ records, distribution: [] });
    assert.equal(r.ok, false, '[1] 配布物が空なら赤');
  }
  console.log('  [1/3] compareSignSet の表（判定 A・B・記録の形）: PASS');
}

// ───────────────────────────────────────────────
// [2] build.yml の静的検査
// ───────────────────────────────────────────────
const JOB = 'verify-win-install';
const RECORD_UPLOADS = { 'pack-win-1': 'payload', 'pack-win-2': 'uninstaller', 'finalize-win': 'installer' };
const RECORDS_PREFIX = 'win-signing-records-';
const RETENTION = "${{ inputs.mode == 'sign-check' && 3 || 30 }}";
const X64_IF = "matrix.arch == 'x64'";
// 受け渡しの artifact（保持 1 日）の名前の正規表現。既存の署名の経路の smoke と同じ字面
const HANDOFF_RE = /^(win-stage1|win-stage1-meta|win-sign-in-|win-signed-|win-pack\d-record|win-finalize-record)/;
const runOf = (st) => (typeof st?.run === 'string' ? st.run : '');
const usesOf = (st) => (typeof st?.uses === 'string' ? st.uses : '');
const isUpload = (st) => usesOf(st).startsWith('actions/upload-artifact@');
const isDownload = (st) => usesOf(st).startsWith('actions/download-artifact@');

/** 違反の文言の配列（空なら合格） */
export function checkWorkflow(wf) {
  const v = [];
  const jobs = wf?.jobs ?? {};
  const job = jobs[JOB];
  if (!job) return [`${JOB} が無い`];
  const steps = job.steps ?? [];

  // matrix
  const inc = job.strategy?.matrix?.include;
  const legs = Array.isArray(inc) ? inc.map((x) => `${x.arch}=${x.runner}`).sort() : null;
  if (JSON.stringify(legs) !== JSON.stringify(['arm64=windows-11-arm', 'x64=windows-2025'])) {
    v.push(`${JOB} の matrix が x64→windows-2025・arm64→windows-11-arm の 2 脚でない: ${JSON.stringify(inc)}`);
  }
  if (job.strategy?.['fail-fast'] !== false) v.push(`${JOB} の strategy に fail-fast: false が無い`);
  if (job['runs-on'] !== '${{ matrix.runner }}') v.push(`${JOB} の runs-on が matrix.runner でない: ${JSON.stringify(job['runs-on'])}`);
  if (job.name !== `${JOB} (\${{ matrix.arch }})`) v.push(`${JOB} の name が「${JOB} (\${{ matrix.arch }})」でない: ${JSON.stringify(job.name)}`);

  // 依存を入れない・id-token と environment を持たない
  if (job.permissions && typeof job.permissions === 'object' && 'id-token' in job.permissions) v.push(`${JOB} が id-token を持つ`);
  if ('environment' in job) v.push(`${JOB} が environment を持つ`);
  for (const st of steps) {
    if (/pnpm/.test(usesOf(st)) || /\bpnpm\b/.test(runOf(st))) v.push(`${JOB}「${st.name ?? usesOf(st)}」が pnpm を使う（依存を入れないジョブ）`);
    if (isDownload(st) && /^win-signed-/.test(String(st.with?.name ?? ''))) v.push(`${JOB} が保持 1 日の ${st.with.name} を download する`);
  }

  // 両方の脚: 自分の arch の Setup.exe を入れる
  const install = steps.filter((st) => /verify-win-install\.mjs/.test(runOf(st)));
  if (install.length !== 1) v.push(`${JOB} の verify-win-install.mjs の step が 1 つでない: ${install.length}`);
  else {
    const r = runOf(install[0]);
    if (install[0].if != null) v.push(`${JOB} の verify-win-install.mjs の step に if がある（両方の脚で走らせる）`);
    if (!r.includes('--installer win-artifacts/MaplatEditor-Windows-${{ env.VERSION }}-${{ matrix.arch }}-Setup.exe')) v.push(`${JOB} の --installer が自分の arch の Setup.exe でない: ${r}`);
    if (!r.includes('--signer artifact-signing')) v.push(`${JOB} の verify-win-install.mjs に --signer artifact-signing が無い`);
  }
  const winArt = steps.filter((st) => isDownload(st) && st.with?.name === 'win-artifacts');
  if (winArt.length !== 1 || winArt[0].if != null) v.push(`${JOB} の win-artifacts の download が両方の脚に 1 つでない`);

  // x64 の脚だけ: 突き合わせと 3 つの記録の download
  const match = steps.filter((st) => /verify-win-sign-set\.mjs/.test(runOf(st)));
  if (match.length !== 1) v.push(`${JOB} の verify-win-sign-set.mjs の step が 1 つでない: ${match.length}`);
  else {
    const st = match[0];
    const r = runOf(st);
    if (st.if !== X64_IF) v.push(`突き合わせの step の if が ${X64_IF} でない: ${JSON.stringify(st.if)}`);
    for (const role of ['payload', 'uninstaller', 'installer']) {
      if (!new RegExp(`\\s${role}=\\S*signing-record\\.json`).test(r)) v.push(`突き合わせの --records に ${role}=…/signing-record.json が無い`);
    }
    for (const arch of ['x64', 'arm64']) {
      if (!r.includes(`win-artifacts/MaplatEditor-Windows-\${{ env.VERSION }}-${arch}-Setup.exe`)) v.push(`突き合わせの --installers に ${arch} の Setup.exe が無い`);
    }
    if (!r.includes('--signer artifact-signing')) v.push('突き合わせに --signer artifact-signing が無い');
  }
  for (const role of ['payload', 'uninstaller', 'installer']) {
    const dl = steps.filter((st) => isDownload(st) && st.with?.name === `${RECORDS_PREFIX}${role}`);
    if (dl.length !== 1) v.push(`${JOB} の ${RECORDS_PREFIX}${role} の download が 1 つでない: ${dl.length}`);
    else if (dl[0].if !== X64_IF) v.push(`${RECORDS_PREFIX}${role} の download の if が ${X64_IF} でない`);
  }

  // --no-authenticode は CI の step で使わない（判定 B は CI でだけ走る）
  for (const [name, j] of Object.entries(jobs)) {
    for (const st of j?.steps ?? []) if (runOf(st).includes('--no-authenticode')) v.push(`${name}「${st.name}」が --no-authenticode を使う`);
  }

  // 署名の記録の積み直し（id-token を持たないジョブが、保持 1 日の win-signed-* から signing-record.json だけを長めの保持で上げる）
  for (const [name, role] of Object.entries(RECORD_UPLOADS)) {
    const js = jobs[name]?.steps ?? [];
    const ups = js.filter((st) => isUpload(st) && String(st.with?.name ?? '').startsWith(RECORDS_PREFIX));
    if (ups.length !== 1) { v.push(`${name} の ${RECORDS_PREFIX}* の upload が 1 つでない: ${ups.length}`); continue; }
    const up = ups[0];
    if (up.with.name !== `${RECORDS_PREFIX}${role}`) v.push(`${name} の積み直しの名前が ${RECORDS_PREFIX}${role} でない: ${up.with.name}`);
    if (up.with['retention-days'] !== RETENTION) v.push(`${name} の積み直しの保持が win-artifacts と同じ式でない: ${JSON.stringify(up.with['retention-days'])}`);
    if (up.with['if-no-files-found'] !== 'error') v.push(`${name} の積み直しの if-no-files-found が error でない`);
    const p = String(up.with.path ?? '').trim();
    if (p.includes('\n') || !p.endsWith('/signing-record.json')) v.push(`${name} の積み直しの path が signing-record.json 1 つでない: ${JSON.stringify(p)}`);
    if (up.if != null) v.push(`${name} の積み直しに if がある（download の直後に必ず上げる）`);
    // 置き場所: 対応する win-signed-* の download の直後・依存のコード（apply-signed・electron-builder）が走る前
    const upAt = js.indexOf(up);
    const dlAt = js.findIndex((st) => isDownload(st) && st.with?.name === `win-signed-${role}`);
    if (dlAt < 0) v.push(`${name} に win-signed-${role} の download が無い`);
    else if (upAt !== dlAt + 1) v.push(`${name} の積み直しが win-signed-${role} の download の直後にない（download ${dlAt}・upload ${upAt}）`);
    const codeAt = js.findIndex((st) => new RegExp(`apply-signed\\.mjs --phase ${role}\\b`).test(runOf(st)));
    if (codeAt >= 0 && upAt > codeAt) v.push(`${name} の積み直しが apply-signed（${role}）より後にある`);
  }
  // 名前が受け渡し（保持 1 日）の正規表現に当たらず、release の download の pattern にも入らない
  for (const role of Object.values(RECORD_UPLOADS)) {
    if (HANDOFF_RE.test(`${RECORDS_PREFIX}${role}`)) v.push(`${RECORDS_PREFIX}${role} が受け渡しの正規表現に当たる（保持 1 日を要られる）`);
  }
  for (const [name, j] of Object.entries(jobs)) {
    for (const st of j?.steps ?? []) {
      if (isUpload(st) && HANDOFF_RE.test(String(st.with?.name ?? '')) && st.with?.['retention-days'] !== 1) {
        // 受け渡しの保持が 1 日であることは既存の smoke が断言する。ここでは積み直しの改名の変異だけを捕まえる
        if (String(st.with.name).includes('records-')) v.push(`${name} の ${st.with.name} が受け渡しの名前で保持 1 日でない`);
      }
    }
  }
  const relDl = (jobs.release?.steps ?? []).find(isDownload);
  const pat = String(relDl?.with?.pattern ?? '');
  const m = /^\{(.*)\}$/.exec(pat);
  const items = m ? m[1].split(',').map((x) => x.trim()) : [pat];
  for (const it of items) {
    if (/[*?[]/.test(it)) v.push(`release の download の pattern に glob がある: ${it}`);
    if (it.startsWith(RECORDS_PREFIX)) v.push(`release の download の pattern に ${it} がある（配布物に混ざる）`);
  }
  return v;
}

/** verify-win-sign-set.mjs が読むのは Node の組み込みと同じディレクトリの既存のファイルだけ（依存を入れないジョブで動く） */
function checkImports(src) {
  const v = [];
  const specs = [...src.matchAll(/(?:^import\s[^'"]*from\s*|^import\s*|\brequire\()\s*['"]([^'"]+)['"]/gm)].map((x) => x[1]);
  if (specs.length === 0) v.push('import が 1 つも見つからない');
  for (const s of specs) {
    if (!s.startsWith('node:') && !/^\.\/(verify-win-install\.mjs|signer-identity\.cjs|win-sign\.cjs)$/.test(s)) v.push(`組み込みでも既存の win-sign のファイルでもない import: ${s}`);
  }
  return v;
}

const wf = yaml.load(readFileSync(WORKFLOW, 'utf8'));
{
  const v = checkWorkflow(wf);
  assert.deepEqual(v, [], `build.yml の違反:\n  ${v.join('\n  ')}`);
  const vi = checkImports(readFileSync(SET_SCRIPT, 'utf8'));
  assert.deepEqual(vi, [], `verify-win-sign-set.mjs の import の違反:\n  ${vi.join('\n  ')}`);
  console.log('  [2/3] build.yml の静的検査（matrix・x64 の脚の突き合わせ・記録の積み直し・依存なし）: PASS');
}

// ───────────────────────────────────────────────
// [3] 自己検査: 変異を [2] が落とす
// ───────────────────────────────────────────────
{
  const job = (w) => w.jobs[JOB];
  const stepsOf = (w, name) => w.jobs[name].steps;
  const matchStep = (w) => job(w).steps.find((st) => /verify-win-sign-set\.mjs/.test(runOf(st)));
  const recordsDl = (w, role) => job(w).steps.find((st) => isDownload(st) && st.with?.name === `${RECORDS_PREFIX}${role}`);
  const recordsUp = (w, name) => stepsOf(w, name).find((st) => isUpload(st) && String(st.with?.name ?? '').startsWith(RECORDS_PREFIX));
  const mutations = [
    ['arm64 の脚を消す', (w) => { job(w).strategy.matrix.include = job(w).strategy.matrix.include.filter((x) => x.arch !== 'arm64'); }],
    ['arm64 の runner を x64 と同じにする', (w) => { job(w).strategy.matrix.include.find((x) => x.arch === 'arm64').runner = 'windows-2025'; }],
    ['fail-fast を消す', (w) => { delete job(w).strategy['fail-fast']; }],
    ['name を消す', (w) => { delete job(w).name; }],
    ['runs-on を固定にする', (w) => { job(w)['runs-on'] = 'windows-2025'; }],
    ['突き合わせの if を外して両脚にする', (w) => { delete matchStep(w).if; }],
    ['突き合わせを消す', (w) => { job(w).steps = job(w).steps.filter((st) => st !== matchStep(w)); }],
    ['突き合わせの --installers から arm64 を外す', (w) => { matchStep(w).run = matchStep(w).run.replace(/\S*-arm64-Setup\.exe/, ''); }],
    ['突き合わせの --records から installer を外す', (w) => { matchStep(w).run = matchStep(w).run.replace(/\sinstaller=\S+/, ''); }],
    ['突き合わせに --no-authenticode を足す', (w) => { matchStep(w).run += ' --no-authenticode'; }],
    ['記録の download を 1 つ消す', (w) => { job(w).steps = job(w).steps.filter((st) => st !== recordsDl(w, 'installer')); }],
    ['記録の download の if を外す', (w) => { delete recordsDl(w, 'payload').if; }],
    ['win-signed-payload の download に戻す', (w) => { recordsDl(w, 'payload').with.name = 'win-signed-payload'; }],
    ['pnpm install を足す', (w) => { job(w).steps.splice(2, 0, { name: 'Install dependencies', run: 'pnpm install --frozen-lockfile' }); }],
    ['pnpm/action-setup を足す', (w) => { job(w).steps.splice(1, 0, { uses: 'pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413', with: { version: 11 } }); }],
    ['id-token を足す', (w) => { job(w).permissions = { 'id-token': 'write' }; }],
    ['environment を足す', (w) => { job(w).environment = 'release'; }],
    ['verify-win-install.mjs の --installer を x64 固定にする', (w) => { const st = job(w).steps.find((s) => /verify-win-install\.mjs/.test(runOf(s))); st.run = st.run.replace('${{ matrix.arch }}-Setup.exe', 'x64-Setup.exe'); }],
    ['積み直しの名前を win-signed-records-payload にする', (w) => { recordsUp(w, 'pack-win-1').with.name = 'win-signed-records-payload'; }],
    ['積み直しの保持を 1 にする', (w) => { recordsUp(w, 'pack-win-2').with['retention-days'] = 1; }],
    ['積み直しの if-no-files-found を ignore にする', (w) => { recordsUp(w, 'finalize-win').with['if-no-files-found'] = 'ignore'; }],
    ['積み直しを 1 つ消す', (w) => { w.jobs['finalize-win'].steps = stepsOf(w, 'finalize-win').filter((st) => st !== recordsUp(w, 'finalize-win')); }],
    ['積み直しを electron-builder の後に動かす', (w) => {
      const st = stepsOf(w, 'pack-win-1');
      const up = recordsUp(w, 'pack-win-1');
      st.splice(st.indexOf(up), 1);
      st.splice(st.findIndex((s) => /Collect the uninstallers/.test(s.name ?? '')), 0, up);
    }],
    ['積み直しの path に signing-record.json 以外を足す', (w) => { const up = recordsUp(w, 'pack-win-1'); up.with.path = `${up.with.path}\nrelease/win-sign/signed-payload/*.pe`; }],
    ['release の pattern に足す', (w) => {
      const dl = w.jobs.release.steps.find(isDownload);
      dl.with.pattern = dl.with.pattern.replace('}', `,${RECORDS_PREFIX}payload}`);
    }],
    ['release の pattern に glob を足す', (w) => {
      const dl = w.jobs.release.steps.find(isDownload);
      dl.with.pattern = dl.with.pattern.replace('}', ',win-*}');
    }],
  ];
  for (const [what, mutate] of mutations) {
    const w = structuredClone(wf);
    mutate(w);
    assert.notEqual(JSON.stringify(w), JSON.stringify(wf), `自己検査の前提: 変異「${what}」が build.yml を変えていない`);
    const v = checkWorkflow(w);
    assert.ok(v.length > 0, `自己検査: 変異「${what}」を [2] が落とさない`);
    console.log(`    変異「${what}」→ 違反 ${v.length} 件`);
  }
  // import の検査も空振りしない
  assert.ok(checkImports("import yaml from 'js-yaml';\n").length > 0, '自己検査: 依存の import を落とさない');
  assert.ok(checkImports("const x = require('../ci/foo.mjs');\n").length > 0, '自己検査: 別のディレクトリの require を落とさない');
  console.log('  [3/3] 自己検査（変異を [2] が落とす）: PASS');
}

console.log('\nwin-sign-set-match smoke: すべて成功');
