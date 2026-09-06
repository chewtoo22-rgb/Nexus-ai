import { bytesFromHex, timingSafeEqual, toHex } from "./security";

export interface Session {
  userId: string;
  email: string;
  token: string;
  createdAt: string;
  expiresAt: string;
}

const PBKDF2_ITERS = 100_000;

export async function createSession(env: any, userId: string, email: string): Promise<Session> {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const session: Session = {
    userId,
    email,
    token,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };
  await env.SESSIONS.put(`session:${token}`, JSON.stringify(session), { expirationTtl: 7 * 24 * 60 * 60 });
  return session;
}

export async function getSession(env: any, token: string): Promise<Session | null> {
  if (!token || token.length < 32) return null;
  const data = await env.SESSIONS.get(`session:${token}`, "text");
  if (!data) return null;
  try {
    const session = JSON.parse(data) as Session;
    if (session.expiresAt && Date.parse(session.expiresAt) < Date.now()) {
      await deleteSession(env, token);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export async function deleteSession(env: any, token: string): Promise<void> {
  await env.SESSIONS.delete(`session:${token}`);
}

export async function authenticateRequest(request: Request, env: any): Promise<Session | null> {
  const auth = request.headers.get("Authorization");
  let token = auth?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  if (!token && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    token = new URL(request.url).searchParams.get("token")?.trim() || undefined;
    if (!token) {
      const protocols = (request.headers.get("Sec-WebSocket-Protocol") || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const bearerIndex = protocols.findIndex((value) => value.toLowerCase() === "bearer");
      const accessTokenIndex = protocols.findIndex((value) => value.toLowerCase() === "access_token");
      token = bearerIndex >= 0
        ? protocols[bearerIndex + 1]
        : accessTokenIndex >= 0
          ? protocols[accessTokenIndex + 1]
          : protocols.find((value) => value.toLowerCase().startsWith("bearer."))?.slice(7) || (protocols.length === 1 ? protocols[0] : undefined);
    }
  }

  return token ? getSession(env, token) : null;
}

export async function requireUser(request: Request, env: any): Promise<Session> {
  const session = await authenticateRequest(request, env);
  if (!session) {
    const err = new Error("Authentication required");
    (err as Error & { status: number }).status = 401;
    throw err;
  }
  return session;
}

export async function registerUser(env: any, email: string, password: string): Promise<Session> {
  const normalized = normalizeEmail(email);
  assertEmail(normalized);
  assertPassword(password);
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(normalized).first();
  if (existing) {
    const err = new Error("Email already registered");
    (err as Error & { status: number }).status = 409;
    throw err;
  }
  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  await env.DB.prepare(
    "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, datetime('now'))",
  ).bind(userId, normalized, passwordHash).run();
  return createSession(env, userId, normalized);
}

export async function loginUser(env: any, email: string, password: string): Promise<Session | null> {
  const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?")
    .bind(normalizeEmail(email))
    .first() as { id: string; email: string; password_hash: string } | null;
  if (!user) {
    await hashPassword(password);
    return null;
  }
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return null;
  return createSession(env, user.id, user.email);
}

function normalizeEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

function assertEmail(email: string): void {
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const err = new Error("Valid email required");
    (err as Error & { status: number }).status = 400;
    throw err;
  }
}

function assertPassword(password: string): void {
  if (typeof password !== "string" || password.length < 10 || password.length > 200) {
    const err = new Error("Password must be 10–200 characters");
    (err as Error & { status: number }).status = 400;
    throw err;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await derive(password, salt, PBKDF2_ITERS);
  return `pbkdf2:${PBKDF2_ITERS}:${toHex(salt)}:${toHex(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith("pbkdf2:")) {
    const parts = stored.split(":");
    if (parts.length !== 4) return false;
    const iterations = Number(parts[1]);
    const salt = bytesFromHex(parts[2]);
    const expected = bytesFromHex(parts[3]);
    if (!iterations || salt.length === 0 || expected.length === 0) return false;
    const computed = await derive(password, salt, iterations);
    return timingSafeEqual(computed, expected);
  }
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const computed = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + password));
  return timingSafeEqual(new Uint8Array(computed), bytesFromHex(hash));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return new Uint8Array(bits);
}
