/**
 * nov26-m7-t1: Azure Artifact Signing の疎通 workflow（.github/workflows/artifact-signing-probe.yml）の静的検査。
 *
 * t1/AC1 (a)〜(j) を断言する:
 *   (a) トリガーは workflow_dispatch だけ・run-name は「artifact-signing-probe sha=${{ github.sha }}」と完全一致
 *       （承認スクリプト editor-m7-probe-2-approve.sh が表示名で自分の起動かを照合する）
 *   (b) id-token: write と environment: release を持つのは probe-sign だけ
 *   (c) checkSigningJob('probe-sign') が空（規則の正本は scripts/win-sign/signing-job-rules.mjs。ここで書き直さない）
 *   (d) workflow レベルの permissions は { contents: read }
 *   (e) uses: はすべて 40 桁 SHA
 *   (f) SignTool（Microsoft.Windows.SDK.BuildTools）・dlib（Microsoft.ArtifactSigning.Client）は版と SHA-256 で固定
 *   (g) TSA は http://timestamp.acs.microsoft.com
 *   (h) Endpoint は https://jpe.codesigning.azure.net のリテラルで、その step に ${{ が無い
 *   (i) probe-sign が upload するのは probe-result.json だけ
 *   (j) pnpm/action-setup は m10 の PIN
 * 加えて自己検査: 読み込んだ YAML を 1 か所ずつ壊した変異のそれぞれで、違反が 1 件以上出ること（規則の空振りの検出）。
 *
 * 実行: node scripts/nov26-m7-t1-artifact-signing-probe-smoke.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import {
  checkSigningJob, checkPnpmPin, ENDPOINT, TSA, PNPM_PIN,
} from './win-sign/signing-job-rules.mjs';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const WORKFLOW = path.join(projectRoot, '.github/workflows/artifact-signing-probe.yml');
const RUN_NAME = 'artifact-signing-probe sha=${{ github.sha }}';
const PINNED_USES_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_./-]+)?@[0-9a-f]{40}$/;
const NUGET_IDS = ['Microsoft.Windows.SDK.BuildTools', 'Microsoft.ArtifactSigning.Client'];

const runOf = (st) => (typeof st?.run === 'string' ? st.run : '');
const usesOf = (st) => (typeof st?.uses === 'string' ? st.uses : '');

/** t1/AC1 (a)〜(j) の違反の一覧（空なら合格）。text は pnpm の PIN の検査に使う workflow の本文 */
export function checkProbeWorkflow(wf, text) {
  const v = [];
  if (!wf || typeof wf !== 'object' || !wf.jobs) return ['workflow が読めない'];

  // (a)
  const on = wf.on;
  const triggers = typeof on === 'string' ? [on] : Array.isArray(on) ? on : Object.keys(on ?? {});
  if (!(triggers.length === 1 && triggers[0] === 'workflow_dispatch')) {
    v.push(`(a) トリガーが workflow_dispatch だけでない: ${JSON.stringify(triggers)}`);
  }
  if (on && typeof on === 'object' && !Array.isArray(on) && on.workflow_dispatch && on.workflow_dispatch.inputs) {
    v.push('(a) workflow_dispatch に inputs がある（式で値を差し込む口を作らない）');
  }
  if (wf['run-name'] !== RUN_NAME) v.push(`(a) run-name が「${RUN_NAME}」と一致しない: ${JSON.stringify(wf['run-name'])}`);

  // (b)
  const jobNames = Object.keys(wf.jobs);
  for (const want of ['probe-build', 'probe-sign']) {
    if (!wf.jobs[want]) v.push(`(b) ジョブ ${want} が無い`);
  }
  for (const name of jobNames) {
    const job = wf.jobs[name] ?? {};
    const hasIdToken = job.permissions && typeof job.permissions === 'object' && 'id-token' in job.permissions;
    const hasEnv = job.environment != null;
    if (name !== 'probe-sign' && hasIdToken) v.push(`(b) ${name} が id-token を持つ`);
    if (name !== 'probe-sign' && hasEnv) v.push(`(b) ${name} が environment を持つ`);
    if (name !== 'probe-sign' && /secrets\./.test(JSON.stringify(job))) v.push(`(b) ${name} が secrets を参照する`);
  }
  if (wf.jobs['probe-sign'] && wf.jobs['probe-sign'].needs !== 'probe-build'
    && !(Array.isArray(wf.jobs['probe-sign'].needs) && wf.jobs['probe-sign'].needs.includes('probe-build'))) {
    v.push('(b) probe-sign が probe-build を needs に持たない');
  }

  // (c)
  for (const msg of checkSigningJob('probe-sign', wf.jobs['probe-sign'])) v.push(`(c) ${msg}`);

  // (d)
  const wp = wf.permissions;
  if (!(wp && typeof wp === 'object' && Object.keys(wp).length === 1 && wp.contents === 'read')) {
    v.push(`(d) workflow レベルの permissions が { contents: read } でない: ${JSON.stringify(wp)}`);
  }

  // (e)
  for (const name of jobNames) {
    (wf.jobs[name]?.steps ?? []).forEach((st, i) => {
      const u = usesOf(st);
      if (u && !PINNED_USES_RE.test(u)) v.push(`(e) ${name}.steps[${i}] の uses が 40 桁 SHA でない: ${u}`);
    });
  }

  const signSteps = wf.jobs['probe-sign']?.steps ?? [];

  // (f)
  const nuget = signSteps.find((st) => /nuget\.org/i.test(runOf(st)));
  if (!nuget) {
    v.push('(f) probe-sign に NuGet から署名ツールを取る step が無い');
  } else {
    const blob = `${runOf(nuget)}\n${JSON.stringify(nuget.env ?? {})}`;
    for (const id of NUGET_IDS) {
      if (!blob.includes(id)) v.push(`(f) NuGet の取得 step に ${id} が無い`);
    }
    const env = nuget.env ?? {};
    for (const key of ['BUILDTOOLS_VERSION', 'BUILDTOOLS_SHA256', 'ARTIFACTSIGNING_VERSION', 'ARTIFACTSIGNING_SHA256']) {
      if (env[key] == null) v.push(`(f) NuGet の取得 step の env: に ${key} が無い`);
    }
  }

  // (g)
  const signers = signSteps.filter((st) => /\/dlib\b/.test(runOf(st)));
  if (signers.length === 0) v.push('(g) 署名の step が無い');
  for (const st of signers) {
    if (!runOf(st).includes(`/tr ${TSA}`)) v.push(`(g) 署名の step の TSA が ${TSA} でない`);
  }

  // (h)
  const meta = signSteps.filter((st) => /CodeSigningAccountName/.test(runOf(st)));
  if (meta.length !== 1) v.push(`(h) metadata.json を書く step がちょうど 1 つでない（${meta.length}）`);
  for (const st of meta) {
    if (!runOf(st).includes(`'${ENDPOINT}'`) && !runOf(st).includes(`"${ENDPOINT}"`)) {
      v.push(`(h) Endpoint が引用符つきのリテラル ${ENDPOINT} でない`);
    }
    if (/\$\{\{/.test(`${runOf(st)}\n${JSON.stringify(st.env ?? {})}\n${JSON.stringify(st.with ?? {})}`)) {
      v.push('(h) metadata.json を書く step に ${{ がある');
    }
  }

  // (i)
  const uploads = signSteps.filter((st) => usesOf(st).startsWith('actions/upload-artifact@'));
  if (uploads.length !== 1) v.push(`(i) probe-sign の upload がちょうど 1 つでない（${uploads.length}）`);
  for (const st of uploads) {
    if (String(st.with?.path ?? '').trim() !== 'probe-result.json') {
      v.push(`(i) probe-sign が probe-result.json 以外を上げる: ${JSON.stringify(st.with?.path)}`);
    }
    if (st.with?.['retention-days'] !== 14) v.push('(i) probe-result の retention-days が 14 でない');
  }

  // (j)
  if (!text.includes(PNPM_PIN)) v.push('(j) pnpm/action-setup の PIN の行が無い');
  for (const msg of checkPnpmPin(text)) v.push(`(j) ${msg}`);

  return v;
}

// ───────────────────────────────────────────────
// [1/2] 本物の workflow
// ───────────────────────────────────────────────
assert.ok(existsSync(WORKFLOW), `workflow が無い: ${path.relative(projectRoot, WORKFLOW)}`);
const text = readFileSync(WORKFLOW, 'utf8');
const wf = yaml.load(text);
{
  const v = checkProbeWorkflow(wf, text);
  assert.deepEqual(v, [], `t1/AC1 の違反:\n  ${v.join('\n  ')}`);
  console.log('  [1/2] t1/AC1 (a)〜(j): PASS');
}

// ───────────────────────────────────────────────
// [2/2] 自己検査: 1 か所ずつ壊した変異で違反が出る
// ───────────────────────────────────────────────
{
  const clone = () => structuredClone(wf);
  const signSteps = (w) => w.jobs['probe-sign'].steps;
  const idx = (w, pred) => {
    const i = signSteps(w).findIndex(pred);
    assert.ok(i >= 0, '自己検査の前提: 変異させる step が見つからない');
    return i;
  };
  const mutations = [
    ['probe-sign に checkout を足す', (w) => {
      signSteps(w).unshift({ uses: 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262' });
    }],
    ['probe-build に id-token を付ける', (w) => {
      w.jobs['probe-build'].permissions = { contents: 'read', 'id-token': 'write' };
    }],
    ['Endpoint を ${{ inputs.x }} にする', (w) => {
      const i = idx(w, (st) => /CodeSigningAccountName/.test(runOf(st)));
      signSteps(w)[i].run = runOf(signSteps(w)[i]).split(ENDPOINT).join('${{ inputs.x }}');
    }],
    ['azure/login をタグにする', (w) => {
      const i = idx(w, (st) => usesOf(st).startsWith('azure/login@'));
      signSteps(w)[i].uses = 'azure/login@v2';
    }],
    ['probe-sign に pnpm の run を足す', (w) => {
      signSteps(w).push({ run: 'pnpm install --frozen-lockfile' });
    }],
    ['入力の PE を実行する', (w) => {
      signSteps(w).push({ shell: 'pwsh', run: '& .\\probe-in\\MaplatEditor.exe' });
    }],
    // 以下は設計の 6 変異に加えた分（規則の各項が効くこと）
    ['入力の PE を Start-Process で起動する', (w) => {
      signSteps(w).push({ shell: 'pwsh', run: 'Start-Process probe-in\\MaplatEditor.exe' });
    }],
    ['azure/login 以外が secrets を参照する', (w) => {
      signSteps(w).push({ shell: 'pwsh', env: { X: '${{ secrets.AZURE_CLIENT_ID }}' }, run: 'echo hi' });
    }],
    ['TSA を外す', (w) => {
      const i = idx(w, (st) => /\/dlib\b/.test(runOf(st)));
      signSteps(w)[i].run = runOf(signSteps(w)[i]).split(`/tr ${TSA}`).join('');
    }],
    ['NuGet の SHA-256 を env: から消す', (w) => {
      const i = idx(w, (st) => /nuget\.org/i.test(runOf(st)));
      delete signSteps(w)[i].env.ARTIFACTSIGNING_SHA256;
    }],
    ['probe-sign が署名済みの PE も上げる', (w) => {
      const i = idx(w, (st) => usesOf(st).startsWith('actions/upload-artifact@'));
      signSteps(w)[i].with.path = 'probe-in';
    }],
    ['workflow に push トリガーを足す', (w) => {
      w.on = { ...w.on, push: { branches: ['master'] } };
    }],
    ['environment を式にする', (w) => {
      w.jobs['probe-sign'].environment = '${{ github.ref_name }}';
    }],
  ];
  for (const [what, mutate] of mutations) {
    const w = clone();
    mutate(w);
    const v = checkProbeWorkflow(w, text);
    assert.ok(v.length > 0, `自己検査: 変異「${what}」で違反が出ない（規則が空振りしている）`);
  }
  // PIN の検査は本文で行う ∴ 本文を壊した変異
  {
    const broken = text.replace(PNPM_PIN, 'pnpm/action-setup@v4');
    assert.ok(checkPnpmPin(broken).length > 0, '自己検査: pnpm/action-setup をタグにしても違反が出ない');
    assert.ok(checkProbeWorkflow(wf, broken).length > 0, '自己検査: 本文の PIN を壊しても (j) が出ない');
  }
  console.log(`  [2/2] 自己検査（変異 ${mutations.length + 1} 件がすべて違反を出す）: PASS`);
}

console.log('\nnov26-m7-t1 probe smoke: すべて成功');
