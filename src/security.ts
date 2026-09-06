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

function mappedIPv4(host: string): string | null {
  const match = host.match(/^(?:::|0:0:0:0:0:)ffff:(.+)$/i);
  if (!match) return null;
  if (match[1].includes(".")) return match[1];
  const parts = match[1].split(":");
  if (parts.length !== 2 || parts.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
  const high = parseInt(parts[0], 16);
  const low = parseInt(parts[1], 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

function clientError(message: string): Error {
  const err = new Error(message);
  (err as Error & { status: number }).status = 400;
  return err;
}

export function assertPublicHttpUrl(raw: unknown): URL {
  if (typeof raw !== "string" || !raw.trim()) throw clientError("URL required");
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw clientError("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw clientError("Only http(s) URLs are allowed");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.has(host) || BLOCKED_HOSTS.has(url.hostname.toLowerCase())) {
    throw clientError("URL host is not allowed");
  }
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
    throw clientError("URL host is not allowed");
  }
  const firstIPv6Group = host.includes(":") ? parseInt(host.split(":")[0], 16) : NaN;
  const embeddedIPv4 = mappedIPv4(host);
  const isUniqueLocal = Number.isFinite(firstIPv6Group) && (firstIPv6Group & 0xfe00) === 0xfc00;
  if (isPrivateIPv4(host) || (embeddedIPv4 !== null && isPrivateIPv4(embeddedIPv4)) || isUniqueLocal || host.startsWith("fe80") || host === "::" || host === "0:0:0:0:0:0:0:1") {
    throw clientError("Private addresses are not allowed");
  }
  return url;
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function bytesFromHex(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-f]/gi, "");
  if (clean.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function parseJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw clientError("Invalid JSON body");
  }
}
