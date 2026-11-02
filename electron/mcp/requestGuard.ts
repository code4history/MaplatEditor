// Checks run on every request before the MCP SDK sees it. Pure functions: no electron, no I/O.
import { createHash, timingSafeEqual } from 'node:crypto';

export const MCP_PATH = '/mcp';

/** The request target must be exactly /mcp (no trailing slash, no query). Absolute-form targets are parsed the same way. */
export function checkPath(requestTarget: string | undefined): boolean {
  if (typeof requestTarget !== 'string' || requestTarget.length === 0) return false;
  try {
    const url = new URL(requestTarget, 'http://127.0.0.1');
    return url.pathname === MCP_PATH && url.search === '';
  } catch {
    return false;
  }
}

function allowedHosts(port: number): [string, string] {
  return [`127.0.0.1:${port}`, `localhost:${port}`];
}

/**
 * Host must literally be 127.0.0.1:<port> or localhost:<port>. No normalisation at all: case, trailing dots,
 * short IPv4 forms, IPv6 and a missing port are all refused. A missing header is refused.
 * When the request line is in absolute form, its host part has to pass the same check.
 */
export function checkHost(hostHeader: string | string[] | undefined, port: number, requestTarget?: string): boolean {
  if (typeof hostHeader !== 'string') return false;
  const allowed = allowedHosts(port);
  if (!allowed.includes(hostHeader)) return false;
  if (typeof requestTarget === 'string' && !requestTarget.startsWith('/')) {
    let targetHost: string;
    try {
      targetHost = new URL(requestTarget).host;
    } catch {
      return false;
    }
    if (!allowed.includes(targetHost)) return false;
  }
  return true;
}

/** Browsers attach Origin to cross-origin requests. MCP clients do not, so any Origin header is refused. */
export function checkOrigin(originHeader: string | string[] | undefined): boolean {
  return originHeader === undefined;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** `Authorization: Bearer <token>` (any case of "Bearer") compared in constant time (both sides hashed so length does not leak). */
export function checkBearer(authorizationHeader: string | string[] | undefined, expectedToken: string): boolean {
  if (typeof authorizationHeader !== 'string' || !expectedToken) return false;
  // The scheme name is case-insensitive (RFC 9110); the token is compared exactly.
  const match = /^Bearer ([^\s]+)$/i.exec(authorizationHeader);
  if (!match) return false;
  return timingSafeEqual(digest(match[1]), digest(expectedToken));
}

/**
 * Slows down guessing without locking anyone out. Failures are counted per second in a ring of 60 slots;
 * the delay before the next bearer check is min(failures in the last 60 s, cap) x step. The clock is passed in.
 */
export class FailureDelay {
  private readonly slots = new Array<number>(60).fill(0);
  private readonly slotSecond = new Array<number>(60).fill(-1);

  constructor(
    private readonly stepMs: number,
    private readonly cap: number,
  ) {}

  private slotFor(nowMs: number): number {
    const second = Math.floor(nowMs / 1000);
    const index = ((second % 60) + 60) % 60;
    if (this.slotSecond[index] !== second) {
      this.slotSecond[index] = second;
      this.slots[index] = 0;
    }
    return index;
  }

  recordFailure(nowMs: number): void {
    this.slots[this.slotFor(nowMs)] += 1;
  }

  failures(nowMs: number): number {
    const second = Math.floor(nowMs / 1000);
    let total = 0;
    for (let i = 0; i < 60; i += 1) {
      if (this.slotSecond[i] > second - 60 && this.slotSecond[i] <= second) total += this.slots[i];
    }
    return total;
  }

  delayMs(nowMs: number): number {
    return Math.min(this.failures(nowMs), this.cap) * this.stepMs;
  }
}
