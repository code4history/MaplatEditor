// Smoke: the local MCP server never writes secrets to its output.
//
// Runs the boundaries smoke (one full pass over the server, the controller and the IPC handlers) and the read
// tools smoke (every read tool against a fixture save folder) and the render region smoke (pictures of a fixture
// map), and checks everything they printed, stdout and
// stderr together, for:
//   (i)   any token issued during the run, or any 8+ character tail of one
//   (ii)  "Bearer " followed by 20 or more token characters
//   (iii) a run of 200 or more base64 characters
//   (iv)  any coordinate value of the fixture's ground control points (read tools run), or any piece of an
//         encoded picture (render region run)
// The detector is tested first on lines that must be caught, and each run must have produced a minimum number
// of lines, so an empty or broken run cannot pass.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

export function findSecrets(text, tokens, values = []) {
  const hits = [];
  for (const value of values) if (value && text.includes(value)) hits.push('fixture coordinate value');
  for (const token of tokens) {
    if (!token) continue;
    for (let len = token.length; len >= 8; len -= 1) {
      if (text.includes(token.slice(-len))) {
        hits.push(`token tail of ${len} characters`);
        break;
      }
    }
    if (text.includes(token)) hits.push('full token');
  }
  if (/Bearer [A-Za-z0-9_\-+/=.]{20,}/.test(text)) hits.push('bearer value');
  if (/[A-Za-z0-9+/_-]{200,}={0,2}/.test(text)) hits.push('long base64');
  return hits;
}

// Detector self-test: each of the three kinds must be found.
{
  // Made at run time so that no token-like literal lives in the source.
  const sampleToken = randomBytes(32).toString('base64url');
  assert.ok(findSecrets(`[mcp] something ${sampleToken} leaked`, [sampleToken]).length > 0, 'detector finds a token');
  assert.ok(findSecrets('Authorization: Bearer xxxxxxxxxxxxxxxxxxxxxxxx', []).includes('bearer value'), 'detector finds a bearer value');
  assert.ok(findSecrets(`data ${'QUJD'.repeat(75)}`, []).includes('long base64'), 'detector finds 300 characters of base64');
  assert.ok(findSecrets('[mcp] gcps 15551332.863820316', [], ['15551332.863820316']).includes('fixture coordinate value'), 'detector finds a coordinate value');
  assert.deepEqual(findSecrets('[mcp] editor.ping ok bytes=170 ms=1', [sampleToken], ['15551332.863820316']), [], 'detector passes a normal log line');
  console.log('ok: detector self-test (token, bearer value, long base64, coordinate value are all found; a normal line passes)');
}

const scratch = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratch, { recursive: true });

async function readLines(file) {
  try {
    return (await readFile(file, 'utf8')).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** Runs one smoke and checks its whole output. */
async function checkRun({ script, minLines, minServerLines, minTokens, withValues }) {
  const dir = await mkdtemp(path.join(scratch, 'mcp-log-redaction-'));
  const tokenFile = path.join(dir, 'tokens.txt');
  const valueFile = path.join(dir, 'values.txt');
  try {
    let output;
    try {
      const { stdout, stderr } = await execFileAsync(process.execPath, [path.join(projectRoot, script)], {
        cwd: projectRoot,
        timeout: 300000,
        maxBuffer: 1024 * 1024 * 32,
        env: { ...process.env, MCP_SMOKE_TOKEN_FILE: tokenFile, ...(withValues ? { MCP_SMOKE_SECRET_FILE: valueFile } : {}) },
      });
      output = `${stdout}\n${stderr}`;
    } catch (error) {
      // Show why the run failed, with every issued token and fixture value replaced first: the raw output may
      // contain exactly what this smoke guards against.
      const issued = await readLines(tokenFile);
      const values = await readLines(valueFile);
      let text = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
      for (const t of issued) text = text.split(t).join('<token>');
      for (const v of values) text = text.split(v).join('<value>');
      text = text.replace(/Bearer [A-Za-z0-9_\-+/=.]{20,}/g, 'Bearer <redacted>').replace(/[A-Za-z0-9+/_-]{200,}={0,2}/g, '<long>');
      const tail = text.split('\n').filter((l) => !l.startsWith('[mcp] ') && !l.startsWith('[ipc] ')).slice(-40).join('\n');
      console.log(tail);
      throw new Error(`mcp-log-redaction: ${script} failed (exit ${error.code ?? 'unknown'})`, { cause: error });
    }
    const tokens = await readLines(tokenFile);
    assert.ok(tokens.length >= minTokens, `${script}: the run issued tokens (${tokens.length})`);
    assert.ok(tokens.every((t) => /^[A-Za-z0-9_-]{43}$/.test(t)), `${script}: issued tokens are 43 base64url characters`);
    const values = withValues ? await readLines(valueFile) : [];
    if (withValues) assert.ok(values.length >= 10, `${script}: the fixture's coordinate values were recorded (${values.length})`);
    const lines = output.split('\n').filter((l) => l.trim() !== '');
    assert.ok(lines.length >= minLines, `${script}: the run produced at least ${minLines} lines (${lines.length})`);
    assert.ok(lines.filter((l) => l.startsWith('[mcp] ')).length >= minServerLines, `${script}: the run produced server log lines`);
    const hits = findSecrets(output, tokens, values);
    assert.deepEqual(hits, [], `${script}: no secrets in the output (${hits.join(', ')})`);
    console.log(`ok: ${script}: ${lines.length} lines checked against ${tokens.length} issued tokens${withValues ? ` and ${values.length} coordinate values` : ''}: none found`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await checkRun({ script: 'scripts/mcp-server-boundaries-smoke.mjs', minLines: 100, minServerLines: 50, minTokens: 5, withValues: false });
await checkRun({ script: 'scripts/mcp-read-tools-smoke.mjs', minLines: 40, minServerLines: 30, minTokens: 1, withValues: true });
await checkRun({ script: 'scripts/mcp-render-region-smoke.mjs', minLines: 10, minServerLines: 30, minTokens: 1, withValues: true });
