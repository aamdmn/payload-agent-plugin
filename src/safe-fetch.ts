import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF-resistant fetch. The agent can be asked to upload a file "from a URL",
 * which would otherwise let a chat user point the server at internal services
 * or the cloud metadata endpoint. This module restricts outbound requests to
 * http(s) and to publicly routable addresses, validating every redirect hop.
 */

/** Resolves a hostname to its IP addresses. */
export type HostLookup = (hostname: string) => Promise<string[]>;

export interface SafeFetchOptions {
  fetchImpl?: typeof fetch;
  lookup?: HostLookup;
  maxRedirects?: number;
  signal?: AbortSignal;
}

const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const V4_MAPPED_DOTTED = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;
const V4_MAPPED_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;
const LEADING_BRACKET = /^\[/;
const TRAILING_BRACKET = /\]$/;

const V4_BYTE = 256;

// IPv4 ranges that must never be reachable: this host, private networks,
// link-local (incl. 169.254.169.254 cloud metadata), CGNAT, and reserved space.
const V4_PRIVATE_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
  ["255.255.255.255", 32],
];

function ipv4ToInt(ip: string): number {
  let value = 0;
  for (const part of ip.split(".")) {
    value = value * V4_BYTE + Number(part);
  }
  return value;
}

// Compare CIDR membership with arithmetic (this codebase forbids bitwise ops):
// two addresses share a /bits prefix when they fall in the same block of size
// 2^(32-bits).
function isPrivateV4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return V4_PRIVATE_BLOCKS.some(([base, bits]) => {
    const blockSize = 2 ** (32 - bits);
    return (
      Math.floor(value / blockSize) === Math.floor(ipv4ToInt(base) / blockSize)
    );
  });
}

/** Pull the embedded IPv4 out of an IPv4-mapped IPv6 address, if present. */
function mappedV4(addr: string): null | string {
  const dotted = V4_MAPPED_DOTTED.exec(addr);
  if (dotted) {
    return dotted[1];
  }

  const hex = V4_MAPPED_HEX.exec(addr);
  if (hex) {
    const high = Number.parseInt(hex[1], 16);
    const low = Number.parseInt(hex[2], 16);
    return `${Math.floor(high / V4_BYTE)}.${high % V4_BYTE}.${Math.floor(low / V4_BYTE)}.${low % V4_BYTE}`;
  }

  return null;
}

function isPrivateV6(ip: string): boolean {
  const addr = ip.toLowerCase();

  const mapped = mappedV4(addr);
  if (mapped) {
    return isPrivateV4(mapped);
  }

  if (addr === "::1" || addr === "::") {
    return true;
  }

  const head = addr.split(":")[0];
  if (!head) {
    return false;
  }

  const first = Number.parseInt(head, 16);
  const isUniqueLocal = first >= 0xfc_00 && first <= 0xfd_ff;
  const isLinkLocal = first >= 0xfe_80 && first <= 0xfe_bf;
  const isMulticast = first >= 0xff_00;
  return isUniqueLocal || isLinkLocal || isMulticast;
}

/**
 * True for any address that is not publicly routable (loopback, private,
 * link-local, reserved) or not a valid IP at all. Conservative by design: an
 * unparseable address is treated as unsafe.
 */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    return isPrivateV4(ip);
  }
  if (family === 6) {
    return isPrivateV6(ip);
  }
  return true;
}

async function defaultLookup(hostname: string): Promise<string[]> {
  const results = await dnsLookup(hostname, { all: true });
  return results.map((result) => result.address);
}

/**
 * Validate that a URL is http(s) and resolves only to public addresses. Returns
 * the parsed URL. Throws an agent-recoverable error otherwise.
 */
export async function assertPublicUrl(
  url: string,
  lookup: HostLookup = defaultLookup
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Unsupported URL scheme "${parsed.protocol}". Only http and https are allowed.`
    );
  }

  const host = parsed.hostname
    .replace(LEADING_BRACKET, "")
    .replace(TRAILING_BRACKET, "");
  if (!host) {
    throw new Error(`URL has no host: ${url}`);
  }

  const addresses = isIP(host) ? [host] : await lookup(host);
  if (addresses.length === 0) {
    throw new Error(`Could not resolve host: ${host}`);
  }

  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error(
        `Refusing to fetch a private or reserved address (${address}) for host ${host}.`
      );
    }
  }

  return parsed;
}

/**
 * Fetch a URL, following redirects manually so every hop is re-validated as
 * public. Returns the final (non-redirect) response without reading its body.
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {}
): Promise<Response> {
  const {
    fetchImpl = fetch,
    lookup,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    signal,
  } = options;

  let currentUrl = url;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const parsed = await assertPublicUrl(currentUrl, lookup);
    const response = await fetchImpl(parsed.href, {
      redirect: "manual",
      signal,
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }

    currentUrl = new URL(location, parsed).href;
  }

  throw new Error(`Too many redirects while fetching ${url}`);
}

/**
 * Read a response body into a Buffer, aborting if it exceeds `maxBytes`. Reads
 * incrementally so an oversized or unbounded body never fully buffers.
 */
export async function readBodyCapped(
  response: Response,
  maxBytes: number
): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error(`Response exceeds the ${maxBytes}-byte limit`);
    }
    return buffer;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  let chunk = await reader.read();

  while (!chunk.done) {
    total += chunk.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Response exceeds the ${maxBytes}-byte limit`);
    }
    chunks.push(Buffer.from(chunk.value));
    chunk = await reader.read();
  }

  return Buffer.concat(chunks);
}
