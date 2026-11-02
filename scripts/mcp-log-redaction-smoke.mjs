// Smoke: the local MCP server never writes secrets to its output.
//
// Runs the boundaries smoke (one full pass over the server, the controller and the IPC handlers) and checks
// everything it printed, stdout and stderr together, for:
//   (i)   any token issued during the run, or any 8+ character tail of one
//   (ii)  "Bearer " followed by 20 or more token characters
//   (iii) a run of 200 or more base64 characters
// The detector is tested first on lines that must be caught, and the run must have produced at least 100
// lines, so an empty or broken run cannot pass.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

export function findSecrets(text, tokens) {
  const hits = [];
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
  const sampleToken = 'Qm9ndXNUb2tlbkZvclNlbGZUZXN0MDEyMzQ1Njc4OWFi';
  assert.ok(findSecrets(`[mcp] something ${sampleToken} leaked`, [sampleToken]).length > 0, 'detector finds a token');
  assert.ok(findSecrets('Authorization: Bearer xxxxxxxxxxxxxxxxxxxxxxxx', []).includes('bearer value'), 'detector finds a bearer value');
  assert.ok(findSecrets(`data ${'QUJD'.repeat(75)}`, []).includes('long base64'), 'detector finds 300 characters of base64');
  assert.deepEqual(findSecrets('[mcp] editor.ping ok bytes=170 ms=1', [sampleToken]), [], 'detector passes a normal log line');
  console.log('ok: detector self-test (token, bearer value, long base64 are all found; a normal line passes)');
}

const scratch = path.join(projectRoot, '.tmp-smoke');
await mkdir(scratch, { recursive: true });
const dir = await mkdtemp(path.join(scratch, 'mcp-log-redaction-'));
const tokenFile = path.join(dir, 'tokens.txt');
try {
  let output;
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [path.join(projectRoot, 'scripts/mcp-server-boundaries-smoke.mjs')], {
      cwd: projectRoot,
      timeout: 300000,
      maxBuffer: 1024 * 1024 * 32,
      env: { ...process.env, MCP_SMOKE_TOKEN_FILE: tokenFile },
    });
    output = `${stdout}\n${stderr}`;
  } catch (error) {
    // Do not print the child's output here: if it failed, it may be exactly what this smoke guards against.
    throw new Error(`mcp-log-redaction: the server run failed (exit ${error.code ?? 'unknown'})`);
  }
  const tokens = (await readFile(tokenFile, 'utf8')).split('\n').filter(Boolean);
  assert.ok(tokens.length >= 5, `the run issued tokens (${tokens.length})`);
  assert.ok(tokens.every((t) => /^[A-Za-z0-9_-]{43}$/.test(t)), 'issued tokens are 43 base64url characters');
  const lines = output.split('\n').filter((l) => l.trim() !== '');
  assert.ok(lines.length >= 100, `the run produced at least 100 lines (${lines.length})`);
  assert.ok(lines.filter((l) => l.startsWith('[mcp] ')).length >= 50, 'the run produced server log lines');
  const hits = findSecrets(output, tokens);
  assert.deepEqual(hits, [], `no secrets in the output (${hits.join(', ')})`);
  console.log(`ok: ${lines.length} lines checked against ${tokens.length} issued tokens: no token, bearer value or long base64`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
