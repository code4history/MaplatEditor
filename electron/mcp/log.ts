// One line per request. Arguments, results, tokens and header values are never written.
// console.log is used on purpose: warn and error are forwarded to the renderer.

const SAFE_NAME = /^[A-Za-z][A-Za-z0-9._/-]{0,63}$/;

/** Tool and method names come from the client, so only plain identifiers are written. */
export function safeName(name: unknown): string {
  return typeof name === 'string' && SAFE_NAME.test(name) ? name : 'unknown';
}

export type RejectReason =
  | 'path'
  | 'host'
  | 'origin'
  | 'method'
  | 'auth'
  | 'auth-queue-full'
  | 'busy'
  | 'body-too-large'
  | 'timeout'
  | 'client-closed'
  | 'batch';

export function logRequest(name: string, outcome: 'ok' | `error:${string}`, bytes: number, ms: number): void {
  console.log(`[mcp] ${safeName(name)} ${outcome} bytes=${Math.max(0, Math.round(bytes))} ms=${Math.max(0, Math.round(ms))}`);
}

export function logRejected(reason: RejectReason): void {
  console.log(`[mcp] rejected ${reason}`);
}

export function logLifecycle(event: 'listening' | 'stopped' | 'port-in-use' | 'listen-failed' | 'server-error', port: number): void {
  console.log(`[mcp] ${event} port=${Math.round(port)}`);
}
