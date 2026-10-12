/**
 * nov26-m7-t1: 署名専用ジョブ（Azure Artifact Signing・OIDC の id-token を持つジョブ）の規則の正本。
 *
 * t1 の疎通 workflow（.github/workflows/artifact-signing-probe.yml の probe-sign）と、t2 で入る署名専用ジョブが
 * **同じ規則で検査される**ように、規則をこの 1 か所に置く。各 smoke は自前で規則を書き直さず、ここを呼ぶ。
 *
 * 署名専用ジョブは OIDC の要求口（id-token: write）をジョブの間ずっと持つ。そのため:
 *   - リポジトリのコード・依存を一切実行しない（checkout・pnpm・npm・node を持たない）
 *   - 外部 action は first-party の actions/* も含めて 40 桁 SHA で固定する
 *   - secrets は azure/login の 3 つだけ
 *   - 署名先の Endpoint・アカウントは step の中のリテラル（式や前段の出力から作らない）
 *   - 入力（署名する PE）を実行しない。& で呼んでよいのは $env:SIGNTOOL だけ
 *
 * checkSigningJob(jobName, job) → string[]（違反の一覧。空なら合格）
 * checkPnpmPin(workflowText) → string[]（pnpm/action-setup の行がすべて m10 の PIN か）
 */

export const ENDPOINT = 'https://jpe.codesigning.azure.net';
export const ACCOUNT = 'nayutasigning';
export const TSA = 'http://timestamp.acs.microsoft.com';
export const PNPM_PIN = 'pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413';

/** azure/login の step が参照してよい secrets */
export const ALLOWED_SECRETS = ['AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_SUBSCRIPTION_ID'];

/** 署名専用ジョブが受け取る入力のディレクトリ（t1 は probe-in・t2 は sign-in） */
export const INPUT_DIRS = ['probe-in', 'sign-in'];

/** コマンド位置のパッケージマネージャ・JS 実行系（m6-t12 AC11 の正規表現に yarn|bun を足したもの） */
const RUNTIME_RE = /(^|[\s;&|(])(pnpm|npm|npx|node|yarn|bun)\s/m;
/** owner/repo[/path]@<40 桁 hex> */
const PINNED_USES_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_./-]+)?@[0-9a-f]{40}$/;
const VERSION_RE = /^\d+(\.\d+){2,3}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

const stepLabel = (jobName, i, st) => `${jobName}.steps[${i}]${st?.name ? `「${st.name}」` : ''}`;

/** オブジェクト中の文字列をすべて連結する（secrets・式の参照を位置を問わず拾う） */
function allStrings(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v !== 'object') return String(v);
  return Object.entries(v).map(([k, x]) => `${k}\n${allStrings(x)}`).join('\n');
}

/** run: の中の呼び出し演算子 & の対象を列挙する（2>&1 や && は対象にしない） */
function callTargets(run) {
  const out = [];
  for (const m of run.matchAll(/(^|[\s;|({])&(?!&)\s*([^\s;|)]+)/gm)) {
    out.push(m[2].replace(/^["']|["']$/g, ''));
  }
  return out;
}

export function checkSigningJob(jobName, job) {
  const v = [];
  if (!job || typeof job !== 'object') return [`${jobName}: ジョブが無い`];

  // 1. permissions は { contents: read, id-token: write } と完全一致
  const perm = job.permissions;
  const permKeys = perm && typeof perm === 'object' ? Object.keys(perm).sort() : [];
  if (!(permKeys.length === 2 && permKeys[0] === 'contents' && permKeys[1] === 'id-token'
    && perm.contents === 'read' && perm['id-token'] === 'write')) {
    v.push(`${jobName}: permissions が { contents: read, id-token: write } と一致しない: ${JSON.stringify(perm)}`);
  }

  // 2. environment は文字列 release（式でない）
  if (job.environment !== 'release') {
    v.push(`${jobName}: environment が文字列 release でない: ${JSON.stringify(job.environment)}`);
  }

  // ジョブ全体（steps 以外）で secrets を参照しない（env: 等で全 step へ配らない）
  const { steps: rawSteps, ...rest } = job;
  if (/secrets\./.test(allStrings(rest))) v.push(`${jobName}: ジョブレベルで secrets を参照している`);

  const steps = Array.isArray(rawSteps) ? rawSteps : [];
  if (steps.length === 0) v.push(`${jobName}: steps が無い`);

  let metadataSteps = 0;
  let signSteps = 0;
  let nugetSteps = 0;
  let azureLoginSteps = 0;

  steps.forEach((st, i) => {
    const label = stepLabel(jobName, i, st);
    const uses = typeof st.uses === 'string' ? st.uses : '';
    const run = typeof st.run === 'string' ? st.run : '';

    // 3. checkout・pnpm・setup-node を使わない・コマンド位置の pnpm/npm/npx/node/yarn/bun が無い
    if (uses.startsWith('actions/checkout@') || uses.startsWith('pnpm/') || uses.startsWith('actions/setup-node@')) {
      v.push(`${label}: リポジトリの checkout・依存の導入をしている: ${uses}`);
    }
    if (RUNTIME_RE.test(run)) v.push(`${label}: run: にコマンド位置の pnpm/npm/npx/node/yarn/bun がある`);

    // 4. uses: はすべて 40 桁 SHA で固定
    if (uses && !PINNED_USES_RE.test(uses)) v.push(`${label}: uses が 40 桁 SHA で固定されていない: ${uses}`);

    // 5. secrets を参照してよいのは azure/login の step だけ・参照名は 3 つだけ
    const text = allStrings(st);
    const refs = [...text.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    const isAzureLogin = uses.startsWith('azure/login@');
    if (isAzureLogin) azureLoginSteps++;
    if (refs.length > 0 && !isAzureLogin) v.push(`${label}: azure/login 以外の step が secrets を参照している: ${refs.join(',')}`);
    for (const r of refs) {
      if (!ALLOWED_SECRETS.includes(r)) v.push(`${label}: 許されていない secret を参照している: ${r}`);
    }

    // 6. metadata.json を書く step: Endpoint・アカウントはリテラル・run と env に ${{ が無い
    if (/CodeSigningAccountName/.test(run)) {
      metadataSteps++;
      if (!run.includes(ENDPOINT)) v.push(`${label}: metadata に Endpoint のリテラル ${ENDPOINT} が無い`);
      if (!run.includes(ACCOUNT)) v.push(`${label}: metadata にアカウントのリテラル ${ACCOUNT} が無い`);
      if (run.includes('${{')) v.push(`${label}: metadata を書く run: に式 \${{ がある`);
      if (allStrings(st.env).includes('${{')) v.push(`${label}: metadata を書く step の env: に式 \${{ がある`);
    }

    // 7. 署名の step: TSA・/td SHA256・/fd SHA256
    if (/\/dlib\b/.test(run)) {
      signSteps++;
      if (!run.includes(`/tr ${TSA}`)) v.push(`${label}: 署名に /tr ${TSA} が無い`);
      if (!/\/td SHA256\b/.test(run)) v.push(`${label}: 署名に /td SHA256 が無い`);
      if (!/\/fd SHA256\b/.test(run)) v.push(`${label}: 署名に /fd SHA256 が無い`);
    }

    // 8. NuGet の取得 step: env: に版と SHA-256 が 2 組・run: に Get-FileHash
    if (/nuget\.org/i.test(run)) {
      nugetSteps++;
      const vals = Object.values(st.env ?? {}).map((x) => String(x));
      const versions = vals.filter((x) => VERSION_RE.test(x)).length;
      const hashes = vals.filter((x) => SHA256_RE.test(x)).length;
      if (versions < 2) v.push(`${label}: env: に版のリテラルが 2 つ無い（${versions}）`);
      if (hashes < 2) v.push(`${label}: env: に SHA-256 のリテラルが 2 つ無い（${hashes}）`);
      if (!/Get-FileHash/.test(run)) v.push(`${label}: run: に Get-FileHash が無い`);
      if (run.includes('${{')) v.push(`${label}: NuGet の取得 run: に式 \${{ がある`);
    }

    // 9. 入力を実行しない
    for (const [re, what] of [
      [/Start-Process/i, 'Start-Process'],
      [/Invoke-Expression/i, 'Invoke-Expression'],
      [/(^|[\s;|(])iex\s/im, 'iex'],
      [/cmd(\.exe)?\s+\/c/i, 'cmd /c'],
      [/&\s*\.\\/, '& .\\'],
    ]) {
      if (re.test(run)) v.push(`${label}: 実行の形 ${what} がある`);
    }
    for (const t of callTargets(run)) {
      if (t !== '$env:SIGNTOOL') v.push(`${label}: & で呼んでよいのは $env:SIGNTOOL だけ: ${t}`);
    }
    for (const dir of INPUT_DIRS) {
      // 入力のディレクトリの .exe を行頭（コマンド位置）で直接起動する形
      const re = new RegExp(`(^|[;|(])\\s*(\\.[\\\\/])?${dir}[\\\\/][^\\s]*\\.(exe|pe|com|bat|cmd|ps1)\\b`, 'im');
      if (re.test(run)) v.push(`${label}: 入力 ${dir} のファイルをコマンド位置で起動している`);
    }

    // 10. upload-artifact は retention-days を持つ
    if (uses.startsWith('actions/upload-artifact@') && st.with?.['retention-days'] == null) {
      v.push(`${label}: upload-artifact に retention-days が無い`);
    }
  });

  if (azureLoginSteps !== 1) v.push(`${jobName}: azure/login の step がちょうど 1 つでない（${azureLoginSteps}）`);
  if (metadataSteps < 1) v.push(`${jobName}: metadata.json を書く step が無い`);
  if (signSteps < 1) v.push(`${jobName}: 署名（/dlib）の step が無い`);
  if (nugetSteps < 1) v.push(`${jobName}: NuGet から署名ツールを取る step が無い`);
  return v;
}

export function checkPnpmPin(workflowText) {
  const v = [];
  workflowText.split('\n').forEach((line, i) => {
    if (!line.includes('pnpm/action-setup@')) return;
    const m = line.match(/pnpm\/action-setup@([^\s#'"]+)/);
    if (!m || `pnpm/action-setup@${m[1]}` !== PNPM_PIN) {
      v.push(`${i + 1} 行: pnpm/action-setup が m10 の PIN でない: ${line.trim()}`);
    }
  });
  return v;
}
