// 宛先の分類。DOM にも Node にも依らない純粋な TS。
// main（electron/services/iiifFetch.ts）と renderer の両方が同じものを import する。
//
// 分類の規則: 文字列を IP として読み、IPv4 を写した IPv6 は中の IPv4 で判定する。
// 表の行は「拒む範囲」だけを持つ（表の最後の「その他＝通す」は、どの行にも
// 当たらなかったときの戻り値が担う）。

export type IpClassification = {
  /** 拒むなら真。 */
  blocked: boolean;
  /** 拒むと決めた表の行の種別名（表の行に当たったとき）。 */
  kind?: string;
  /** 表の行に当たらない拒み方の理由（IP として読めないなど）。 */
  reason?: string;
};

/** 範囲が写す IPv4 の取り出し方。 */
export type EmbeddedIpv4 = 'last-32' | 'six-to-four';

export type AddressRange = {
  /** CIDR 表記。単独のアドレスは /32・/128 として扱う。 */
  cidr: string;
  /** この範囲が写す IPv4 の取り出し方。無ければアドレスそのものを判定する。 */
  embeddedIpv4?: EmbeddedIpv4;
  /**
   * 範囲そのものが拒むなら真（既定）。偽なら、写した IPv4 の判定に委ねる。
   * 宛先の分類の表で「中の IPv4 で判定する」とされた行だけが偽。
   */
  wholeRangeBlocks?: boolean;
};

export type AddressRangeRow = {
  /** 種別名。smoke が表の行を数えるときの名前。 */
  kind: string;
  ranges: AddressRange[];
};

export const BLOCKED_ADDRESS_RANGES: AddressRangeRow[] = [
  {
    // クラウドのメタデータは最優先で拒む（資格情報が返る）。
    kind: 'cloud-metadata',
    ranges: [
      { cidr: '169.254.169.254/32' },
      { cidr: 'fd00:ec2::254/128' },
      { cidr: '100.100.100.200/32' },
    ],
  },
  {
    kind: 'loopback',
    ranges: [{ cidr: '127.0.0.0/8' }, { cidr: '::1/128' }],
  },
  {
    kind: 'private',
    ranges: [
      { cidr: '10.0.0.0/8' },
      { cidr: '172.16.0.0/12' },
      { cidr: '192.168.0.0/16' },
      { cidr: 'fc00::/7' },
    ],
  },
  {
    kind: 'link-local',
    ranges: [{ cidr: '169.254.0.0/16' }, { cidr: 'fe80::/10' }],
  },
  {
    kind: 'unspecified',
    ranges: [{ cidr: '0.0.0.0/8' }, { cidr: '::/128' }],
  },
  {
    // この行だけは範囲そのものを拒まず、中の IPv4 で判定する。
    kind: 'ipv4-mapped',
    ranges: [{ cidr: '::ffff:0:0/96', embeddedIpv4: 'last-32', wholeRangeBlocks: false }],
  },
  {
    kind: 'cgnat',
    ranges: [{ cidr: '100.64.0.0/10' }],
  },
  {
    kind: 'multicast',
    ranges: [{ cidr: '224.0.0.0/4' }, { cidr: 'ff00::/8' }],
  },
  {
    kind: 'reserved',
    ranges: [
      { cidr: '192.0.0.0/24' },
      { cidr: '192.0.2.0/24' },
      { cidr: '198.18.0.0/15' },
      { cidr: '198.51.100.0/24' },
      { cidr: '203.0.113.0/24' },
      { cidr: '240.0.0.0/4' },
      { cidr: '2001:db8::/32' },
      { cidr: '64:ff9b::/96', embeddedIpv4: 'last-32' },
      { cidr: '2002::/16', embeddedIpv4: 'six-to-four' },
    ],
  },
  {
    kind: 'reserved-extra',
    ranges: [
      { cidr: '::/96', embeddedIpv4: 'last-32' },
      { cidr: '::ffff:0:0:0/96', embeddedIpv4: 'last-32' },
      { cidr: '64:ff9b:1::/48' },
      { cidr: '2001::/32' },
      { cidr: 'fec0::/10' },
      { cidr: '100::/64' },
      { cidr: '192.88.99.0/24' },
    ],
  },
];

type ParsedIp = { family: 4 | 6; value: bigint };
type ParsedRange = { family: 4 | 6; network: bigint; mask: bigint };

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HEX_GROUP_PATTERN = /^[0-9a-fA-F]{1,4}$/;
const PREFIX_PATTERN = /^\d{1,3}$/;

/** `[ ]` 付きの IPv6 のリテラルを外す（`new URL().hostname` は `[::1]` の形で返る）。 */
function stripBrackets(address: string): string {
  const text = address.trim();
  if (text.startsWith('[') && text.endsWith(']')) return text.slice(1, -1);
  return text;
}

function parseIpv4(text: string): bigint | null {
  const match = IPV4_PATTERN.exec(text);
  if (!match) return null;
  const octets = [match[1], match[2], match[3], match[4]].map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
  return (
    (BigInt(octets[0]) << 24n) |
    (BigInt(octets[1]) << 16n) |
    (BigInt(octets[2]) << 8n) |
    BigInt(octets[3])
  );
}

function parseGroup(group: string): number | null {
  if (!HEX_GROUP_PATTERN.test(group)) return null;
  return Number.parseInt(group, 16);
}

function parseIpv6(text: string): bigint | null {
  if (!text.includes(':')) return null;
  let body = text;
  const zone = body.indexOf('%');
  if (zone >= 0) body = body.slice(0, zone);
  if (body === '') return null;

  // 末尾に IPv4 を埋めた表記（`::ffff:1.2.3.4`）は、2 つの 16 ビットの群に直す。
  if (body.includes('.')) {
    const lastColon = body.lastIndexOf(':');
    if (lastColon < 0) return null;
    const ipv4 = parseIpv4(body.slice(lastColon + 1));
    if (ipv4 === null) return null;
    const high = Number((ipv4 >> 16n) & 0xffffn).toString(16);
    const low = Number(ipv4 & 0xffffn).toString(16);
    body = body.slice(0, lastColon + 1) + high + ':' + low;
  }

  const doubleColon = body.indexOf('::');
  let headText: string;
  let tailText: string;
  if (doubleColon >= 0) {
    if (body.indexOf('::', doubleColon + 2) >= 0) return null;
    headText = body.slice(0, doubleColon);
    tailText = body.slice(doubleColon + 2);
  } else {
    headText = body;
    tailText = '';
  }

  const headGroups = headText === '' ? [] : headText.split(':');
  const tailGroups = tailText === '' ? [] : tailText.split(':');
  const groups: number[] = [];
  for (const group of headGroups) {
    const parsed = parseGroup(group);
    if (parsed === null) return null;
    groups.push(parsed);
  }
  const headCount = groups.length;
  const tail: number[] = [];
  for (const group of tailGroups) {
    const parsed = parseGroup(group);
    if (parsed === null) return null;
    tail.push(parsed);
  }

  if (doubleColon >= 0) {
    const zeros = 8 - headCount - tail.length;
    if (zeros < 1) return null;
    for (let index = 0; index < zeros; index += 1) groups.push(0);
    groups.push(...tail);
  } else {
    if (headCount !== 8) return null;
    groups.push(...tail);
  }

  return groups.reduce((value, group) => (value << 16n) | BigInt(group), 0n);
}

function parseIp(text: string): ParsedIp | null {
  const ipv4 = parseIpv4(text);
  if (ipv4 !== null) return { family: 4, value: ipv4 };
  const ipv6 = parseIpv6(text);
  if (ipv6 !== null) return { family: 6, value: ipv6 };
  return null;
}

function parsePrefix(text: string, bits: number): number | null {
  if (!PREFIX_PATTERN.test(text)) return null;
  const prefix = Number(text);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return null;
  return prefix;
}

function buildRange(family: 4 | 6, value: bigint, prefix: number): ParsedRange {
  const bits = family === 4 ? 32 : 128;
  const all = (1n << BigInt(bits)) - 1n;
  const mask = all ^ ((1n << BigInt(bits - prefix)) - 1n);
  return { family, network: value & mask, mask };
}

function parseCidr(text: string): ParsedRange | null {
  const trimmed = text.trim();
  const slash = trimmed.indexOf('/');
  const addressText = slash >= 0 ? trimmed.slice(0, slash) : trimmed;
  const prefixText = slash >= 0 ? trimmed.slice(slash + 1) : '';
  const ipv4 = parseIpv4(addressText);
  if (ipv4 !== null) {
    const prefix = prefixText === '' ? 32 : parsePrefix(prefixText, 32);
    if (prefix === null) return null;
    return buildRange(4, ipv4, prefix);
  }
  const ipv6 = parseIpv6(addressText);
  if (ipv6 !== null) {
    const prefix = prefixText === '' ? 128 : parsePrefix(prefixText, 128);
    if (prefix === null) return null;
    return buildRange(6, ipv6, prefix);
  }
  return null;
}

function inRange(ip: ParsedIp, range: ParsedRange): boolean {
  if (ip.family !== range.family) return false;
  return (ip.value & range.mask) === range.network;
}

function ipv4ToString(value: number): string {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join('.');
}

function extractEmbeddedIpv4(value: bigint, form: EmbeddedIpv4): string {
  const raw = form === 'six-to-four' ? (value >> 80n) & 0xffffffffn : value & 0xffffffffn;
  return ipv4ToString(Number(raw));
}

/**
 * 宛先のアドレスを、宛先の分類の表に従って分類する。
 *
 * IP として読めない文字列は安全側で拒む（名前を分類に渡すのは誤りなので、
 * `blocked: true`・`reason: "not-an-ip"` を返す）。
 */
export function classifyAddress(address: string): IpClassification {
  const ip = parseIp(stripBrackets(address));
  if (ip === null) return { blocked: true, reason: 'not-an-ip' };

  for (const row of BLOCKED_ADDRESS_RANGES) {
    for (const range of row.ranges) {
      const parsedRange = parseCidr(range.cidr);
      if (parsedRange === null) continue;
      if (!inRange(ip, parsedRange)) continue;
      if (range.embeddedIpv4 && ip.family === 6) {
        const inner = extractEmbeddedIpv4(ip.value, range.embeddedIpv4);
        const verdict = classifyAddress(inner);
        // 範囲そのものが拒む行は、中の IPv4 が公開でも拒む。
        if (range.wholeRangeBlocks === false) {
          if (verdict.blocked) return { blocked: true, kind: row.kind };
          continue;
        }
      }
      return { blocked: true, kind: row.kind };
    }
  }

  return { blocked: false };
}

/**
 * 地図の配信先として渡してよい URL か（文字列だけで判定する）。
 *
 * `https:` だけを通す。ホストが IP のリテラルなら classifyAddress に掛け、
 * 私的・loopback・link-local などを拒む。名前のホストはここでは拒まない
 * （名前の解決はここではできない ∴ その先は取得する側の CORS と CSP が守る）。
 * URL として読めない文字列は安全側で拒む。
 */
export function isAllowedDeliveryUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (_e) {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = stripBrackets(parsed.hostname);
  // IP のリテラルでなければ、ここでは拒まない（名前の解決はしない）。
  if (parseIp(host) === null) return true;
  return !classifyAddress(host).blocked;
}
