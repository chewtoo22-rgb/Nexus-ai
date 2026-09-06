const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.internal",
]);

/**
 * Checks if a hostname is a private IPv4 address.
 * Detects RFC 1918 private ranges, loopback, link-local, and shared address space.
 * @param host The hostname to check.
 * @returns True if the address is private, false otherwise.
 */
function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return true;
  const [a, b] = o;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/**
 * Validates and parses a URL, ensuring it is a public HTTP(S) URL and not targeting private infrastructure.
 * Blocks localhost, private IPs, metadata endpoints, and special TLDs.
 * @param raw The raw URL string.
 * @returns A parsed URL object if valid and public.
 * @throws Error if URL is invalid, not HTTP(S), or targets private/blocked infrastructure.
 */
export function assertPublicHttpUrl(raw: unknown): URL {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("URL required");
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.has(host) || BLOCKED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("URL host is not allowed");
  }
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
    throw new Error("URL host is not allowed");
  }
  if (isPrivateIPv4(host) || host.startsWith("fd") || host.startsWith("fe80") || host === "::" || host === "0:0:0:0:0:0:0:1") {
    throw new Error("Private addresses are not allowed");
  }
  return url;
}

/**
 * Compares two byte arrays in constant time to prevent timing attacks.
 * @param a The first byte array.
 * @param b The second byte array.
 * @returns True if arrays are equal, false otherwise.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Converts a hexadecimal string to a byte array.
 * @param hex The hexadecimal string.
 * @returns A Uint8Array of the decoded bytes.
 */
export function bytesFromHex(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-f]/gi, "");
  if (clean.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Converts a byte array to a hexadecimal string.
 * @param bytes The byte array.
 * @returns A lowercase hexadecimal string.
 */
export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Parses JSON from a request body, throwing a descriptive error on failure.
 * @param request The incoming HTTP request.
 * @returns The parsed JSON object.
 * @throws Error if JSON parsing fails.
 */
export async function parseJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("Invalid JSON body");
  }
}
