/**
 * nov26-m7-t1: 署名専用ジョブ（Azure Artifact Signing・OIDC の id-token を持つジョブ）の規則の正本。
 *
 * t1 の疎通 workflow（.github/workflows/artifact-signing-probe.yml の probe-sign）と、t2 で入る署名専用ジョブが
 * **同じ規則で検査される**ように、規則をこの 1 か所に置く。各 smoke は自前で規則を書き直さず、ここを呼ぶ。
 *
 * 署名専用ジョブは OIDC の要求口（id-token: write）をジョブの間ずっと持つ。そのため:
 *   - リポジトリのコード・依存を一切実行しない（checkout・pnpm・npm・node を持たない）
 *   - 外部 action は first-party の actions/* も含めて 40 桁 SHA で固定する
 *   - secrets は azure/login の 3 つだけ（.名前・['名前'] の両方の記法で数え、toJSON(secrets) 等の丸渡しは拒む）
 *   - github.token を参照しない
 *   - 署名先の Endpoint・アカウントは step の中のリテラル（式や前段の出力から作らない）
 *   - 入力（署名する PE）を実行しない。& で呼んでよいのは $env:SIGNTOOL だけ。run: の shell は pwsh に限る
 *     （拒否リストは完全にできないので、shell を 1 つに絞り、& の対象を許可リストにしたうえで、既知の起動手段
 *     〔Start-Process・Invoke-Item・ii・[Diagnostics.Process]::Start・Start-Job・powershell -・cmd /c 等〕と、
 *     ワークスペースの絶対パスから入力のディレクトリを指す形を拒む。nov26-m7-t2・B24-MIN-2）
 *   - permissions は { id-token: write } だけ（contents: read も持たない。同じ run の artifact の受け渡しは runtime の
 *     トークンで行われ GITHUB_TOKEN を使わない。nov26-m7-t3）
 *   - 署名の記録（signing-record.json）を job summary にも表で書く（artifact は 1 日で消えるが summary は run と同じだけ残る。
 *     probe は除く。nov26-m7-t3 規則 11）
 *   - & の対象 $env:SIGNTOOL・/dlib の $env:DLIB を付け替えさせない（NOV26-M7T2-B31-MIN2 の E1〜E4。nov26-m7-t3 規則 12〜14）:
 *     SIGNTOOL・DLIB への代入（$env:X = ・Set-Item env:X・SetEnvironmentVariable）と step の env: での上書きを拒む。
 *     GITHUB_ENV へ書いてよいのは NuGet の step（ちょうど 1 つ）の SIGNTOOL・DLIB と、許可した名前（UNSIGNED_SHA256）だけで、
 *     行の頭がリテラルの "名前= でなければ拒む。GITHUB_PATH は誰にも書かせない。ドット・ソース（. <パス>）と
 *     Diagnostics.Process（New-Object・::new・::Start）を拒む
 *
 * checkSigningJob(jobName, job, opts?) → string[]（違反の一覧。空なら合格）
 *   opts.requireSummary（既定: jobName !== 'probe-sign'）… 規則 11 を課すか
 * checkPnpmPin(workflowText) → string[]（pnpm/action-setup の行がすべて m10 の PIN か）
 * secretRefs(value) / hasSecretRef(value) → secrets の参照（名前・丸渡し）を拾う（nov26-m7-t2・B24-MIN-1）
 */

export const ENDPOINT = 'https://jpe.codesigning.azure.net';
export const ACCOUNT = 'nayutasigning';
export const TSA = 'http://timestamp.acs.microsoft.com';
export const PNPM_PIN = 'pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413';

/** azure/login の step が参照してよい secrets */
export const ALLOWED_SECRETS = ['AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_SUBSCRIPTION_ID'];

/** 署名の step が使う、NuGet の step だけが GITHUB_ENV で決めてよい名前（付け替えさせない） */
export const PROTECTED_ENV = ['SIGNTOOL', 'DLIB'];
/** NuGet の step 以外が GITHUB_ENV へ書いてよい名前（probe の入力の SHA-256） */
export const GITHUB_ENV_ALLOWED = ['UNSIGNED_SHA256'];

/** 署名専用ジョブが受け取る入力のディレクトリ（t1 は probe-in・t2 は sign-in） */
export const INPUT_DIRS = ['probe-in', 'sign-in'];

/** コマンド位置のパッケージマネージャ・JS 実行系（m6-t12 AC11 の正規表現に yarn|bun を足したもの） */
const RUNTIME_RE = /(^|[\s;&|(])(pnpm|npm|npx|node|yarn|bun)\s/m;
/** owner/repo[/path]@<40 桁 hex> */
const PINNED_USES_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_./-]+)?@[0-9a-f]{40}$/;
const VERSION_RE = /^\d+(\.\d+){2,3}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

const GITHUB_TOKEN_RE = /\bgithub\s*(\.\s*token\b|\[\s*['"]token['"]\s*\])/;

const stepLabel = (jobName, i, st) => `${jobName}.steps[${i}]${st?.name ? `「${st.name}」` : ''}`;

/** オブジェクト中の文字列をすべて連結する（secrets・式の参照を位置を問わず拾う） */
function allStrings(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v !== 'object') return String(v);
  return Object.entries(v).map(([k, x]) => `${k}\n${allStrings(x)}`).join('\n');
}

/**
 * secrets の参照を拾う。名前は `secrets.X`・`secrets['X']`・`secrets["X"]` の 3 つの形で数え、それ以外の
 * `secrets`（式の中の toJSON(secrets)・secrets[format(...)] 等の丸渡し・動的な添字）は bulk として数える。
 * @returns {{names: string[], bulk: string[]}}
 */
export function secretRefs(value) {
  const text = allStrings(value);
  const NAMED = /\bsecrets\s*(?:\.\s*([A-Za-z0-9_]+)|\[\s*(['"])([A-Za-z0-9_]+)\2\s*\])/g;
  const names = [...text.matchAll(NAMED)].map((m) => m[1] ?? m[3]);
  // 名前つきの参照を消したあとも式の中に残る secrets は、丸渡し（toJSON(secrets)）か動的な添字
  const bulk = [...text.matchAll(/\$\{\{([\s\S]*?)\}\}/g)]
    .filter((m) => /\bsecrets\b/.test(m[1].replace(NAMED, '')))
    .map((m) => m[0]);
  return { names, bulk };
}
export const hasSecretRef = (value) => {
  const r = secretRefs(value);
  return r.names.length > 0 || r.bulk.length > 0;
};

/** run: の中の呼び出し演算子 & の対象を列挙する（2>&1 や && は対象にしない） */
function callTargets(run) {
  const out = [];
  for (const m of run.matchAll(/(^|[\s;|({])&(?!&)\s*([^\s;|)]+)/gm)) {
    out.push(m[2].replace(/^["']|["']$/g, ''));
  }
  return out;
}

export function checkSigningJob(jobName, job, opts = {}) {
  const requireSummary = opts.requireSummary ?? jobName !== 'probe-sign';
  const v = [];
  if (!job || typeof job !== 'object') return [`${jobName}: ジョブが無い`];

  // 1. permissions は { id-token: write } と完全一致（nov26-m7-t3: contents: read も外す）
  const perm = job.permissions;
  const permKeys = perm && typeof perm === 'object' ? Object.keys(perm) : [];
  if (!(permKeys.length === 1 && permKeys[0] === 'id-token' && perm['id-token'] === 'write')) {
    v.push(`${jobName}: permissions が { id-token: write } と一致しない: ${JSON.stringify(perm)}`);
  }

  // 2. environment は文字列 release（式でない）
  if (job.environment !== 'release') {
    v.push(`${jobName}: environment が文字列 release でない: ${JSON.stringify(job.environment)}`);
  }

  // 12. ジョブの env: で SIGNTOOL・DLIB を決めない（NuGet の step が GITHUB_ENV で決める）
  for (const k of Object.keys(job.env ?? {})) {
    if (PROTECTED_ENV.includes(k.toUpperCase())) v.push(`${jobName}: ジョブの env: で ${k} を決めている`);
  }

  // ジョブ全体（steps 以外）で secrets を参照しない（env: 等で全 step へ配らない）
  const { steps: rawSteps, ...rest } = job;
  if (hasSecretRef(rest)) v.push(`${jobName}: ジョブレベルで secrets を参照している`);
  // github.token を参照しない（署名ジョブは GitHub に何も書かない・読まない。B24-Info-5）
  if (GITHUB_TOKEN_RE.test(allStrings(job))) v.push(`${jobName}: github.token を参照している`);
  const defaultShell = job.defaults?.run?.shell;

  const steps = Array.isArray(rawSteps) ? rawSteps : [];
  if (steps.length === 0) v.push(`${jobName}: steps が無い`);

  let metadataSteps = 0;
  let signSteps = 0;
  let nugetSteps = 0;
  let azureLoginSteps = 0;
  let summarySteps = 0;

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

    // 5. secrets を参照してよいのは azure/login の step だけ・参照名は 3 つだけ・丸渡しは誰にも許さない
    const { names: refs, bulk } = secretRefs(st);
    const isAzureLogin = uses.startsWith('azure/login@');
    if (isAzureLogin) azureLoginSteps++;
    if ((refs.length > 0 || bulk.length > 0) && !isAzureLogin) {
      v.push(`${label}: azure/login 以外の step が secrets を参照している: ${[...refs, ...bulk].join(',')}`);
    }
    for (const b of bulk) v.push(`${label}: secrets を名前でなく丸ごと・動的に参照している: ${b}`);
    for (const r of refs) {
      if (!ALLOWED_SECRETS.includes(r)) v.push(`${label}: 許されていない secret を参照している: ${r}`);
    }

    // run: の shell は pwsh に限る（bash・cmd・powershell 5.1 で拒否リストを迂回させない）
    if (run !== '' && (st.shell ?? defaultShell) !== 'pwsh') {
      v.push(`${label}: run: の shell が pwsh でない: ${JSON.stringify(st.shell ?? defaultShell ?? '(既定)')}`);
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
      [/(^|[\s;|(])saps\s/im, 'saps'],
      [/Invoke-Expression/i, 'Invoke-Expression'],
      [/(^|[\s;|(])iex\s/im, 'iex'],
      [/Invoke-Item/i, 'Invoke-Item'],
      [/(^|[\s;|({])ii\s/im, 'ii'],
      [/Invoke-Command/i, 'Invoke-Command'],
      [/Invoke-CimMethod|Invoke-WmiMethod|\bwmic\b/i, 'WMI からの起動'],
      [/Process\]\s*::\s*Start/i, '[Diagnostics.Process]::Start'],
      [/ProcessStartInfo/i, 'ProcessStartInfo'],
      [/Start-(Thread)?Job/i, 'Start-Job'],
      [/(^|[\s;|(&])(powershell|pwsh)(\.exe)?\s+-/im, 'powershell -・pwsh -'],
      [/cmd(\.exe)?\s+\/[ck]/i, 'cmd /c'],
      [/\b(rundll32|regsvr32|mshta|cscript|wscript)\b/i, 'rundll32 等'],
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
      // ワークスペースの絶対パスから入力のディレクトリを指す形（"$GITHUB_WORKSPACE/probe-in/…exe" 等）
      const ws = new RegExp(`(GITHUB_WORKSPACE|github\\.workspace)[^\\n]*${dir}`, 'i');
      if (ws.test(run)) v.push(`${label}: ワークスペースの絶対パスから入力 ${dir} を指している`);
    }

    // 11. 署名の記録の step は job summary へ表を書く（probe は除く）
    if (/signing-record\.json/.test(run) && /GITHUB_STEP_SUMMARY/.test(run) && /\|\s*in\b[^\n]*\|\s*out\b[^\n]*\|\s*status\s*\|/.test(run)) {
      summarySteps++;
    }

    // 12. SIGNTOOL・DLIB を付け替えない（E1）
    for (const k of Object.keys(st.env ?? {})) {
      if (PROTECTED_ENV.includes(k.toUpperCase())) v.push(`${label}: step の env: で ${k} を上書きしている`);
    }
    for (const [re, what] of [
      [/\$\{?env:(SIGNTOOL|DLIB)\}?\s*(\+|-|\?\?)?=(?!=)/i, '$env:SIGNTOOL・DLIB への代入'],
      [/(^|[^$\w{])env:(SIGNTOOL|DLIB)\b/im, 'env: ドライブの SIGNTOOL・DLIB（Set-Item 等）'],
      [/SetEnvironmentVariable/i, 'SetEnvironmentVariable'],
      [/Set-Variable|(^|[\s;|(])(sv|set)\s/im, 'Set-Variable'],
    ]) {
      if (re.test(run)) v.push(`${label}: ${what} がある`);
    }

    // 13. GITHUB_ENV・GITHUB_PATH（E2）: NuGet の step の SIGNTOOL・DLIB と、許可した名前だけ・行の頭はリテラルの "名前=
    const isNuget = /nuget\.org/i.test(run);
    for (const line of run.split('\n')) {
      if (/GITHUB_PATH/i.test(line)) v.push(`${label}: GITHUB_PATH に触れている`);
      if (!/GITHUB_ENV/i.test(line)) continue;
      const m = line.match(/^\s*"([A-Za-z0-9_]+)=[^"\n]*"\s*\|\s*Out-File -FilePath \$env:GITHUB_ENV -Append -Encoding utf8\s*$/);
      const allowed = isNuget ? PROTECTED_ENV : GITHUB_ENV_ALLOWED;
      if (!m) v.push(`${label}: GITHUB_ENV へ決まった形（"名前=…" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8）以外で触れている`);
      else if (!allowed.includes(m[1].toUpperCase())) v.push(`${label}: GITHUB_ENV へ ${m[1]} を書いている（許されるのは ${allowed.join('・')}）`);
    }

    // 14. ドット・ソース（E3）と Diagnostics.Process（E4）
    if (/(^|[;|({]|&&|\|\|)\s*\.\s+\S/m.test(run)) v.push(`${label}: ドット・ソース（. <パス>）がある`);
    if (/Diagnostics\.Process\b/i.test(run)) v.push(`${label}: Diagnostics.Process がある`);

    // 10. upload-artifact は retention-days を持つ
    if (uses.startsWith('actions/upload-artifact@') && st.with?.['retention-days'] == null) {
      v.push(`${label}: upload-artifact に retention-days が無い`);
    }
  });

  if (azureLoginSteps !== 1) v.push(`${jobName}: azure/login の step がちょうど 1 つでない（${azureLoginSteps}）`);
  if (metadataSteps < 1) v.push(`${jobName}: metadata.json を書く step が無い`);
  if (signSteps < 1) v.push(`${jobName}: 署名（/dlib）の step が無い`);
  if (nugetSteps !== 1) v.push(`${jobName}: NuGet から署名ツールを取る step がちょうど 1 つでない（${nugetSteps}）`);
  if (requireSummary && summarySteps < 1) v.push(`${jobName}: 署名の記録を job summary へ表で書く step が無い（規則 11）`);
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
