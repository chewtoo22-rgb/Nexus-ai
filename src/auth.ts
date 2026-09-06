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

/**
 * Retrieves a session by token, checking expiration and auto-deleting expired sessions.
 * @param env The environment containing the SESSIONS KV namespace.
 * @param token The session token.
 * @returns The session if valid and not expired, otherwise null.
 */
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
  if (!auth?.startsWith("Bearer ")) return null;
  return getSession(env, auth.slice(7).trim());
}

/**
 * Requires authentication for a request, throwing a 401 error if not authenticated.
 * @param request The incoming HTTP request.
 * @param env The environment containing SESSIONS KV namespace.
 * @returns The authenticated session.
 * @throws Error with status 401 if authentication fails.
 */
export async function requireUser(request: Request, env: any): Promise<Session> {
  const session = await authenticateRequest(request, env);
  if (!session) {
    const err = new Error("Authentication required");
    (err as Error & { status: number }).status = 401;
    throw err;
  }
  return session;
}

/**
 * Registers a new user with email and password, creating a session on success.
 * @param env The environment containing DB and SESSIONS bindings.
 * @param email The user's email address.
 * @param password The user's password (must be 10-200 characters).
 * @returns A new session for the registered user.
 * @throws Error with status 409 if email already registered, 400 if password invalid.
 */
export async function registerUser(env: any, email: string, password: string): Promise<Session> {
  const normalized = normalizeEmail(email);
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

/**
 * Authenticates a user with email and password, creating a session on success.
 * Includes timing-attack mitigation by hashing password even when user not found.
 * @param env The environment containing DB and SESSIONS bindings.
 * @param email The user's email address.
 * @param password The user's password.
 * @returns A new session if credentials valid, otherwise null.
 */
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

/**
 * Normalizes an email address to lowercase and trimmed form.
 * @param email The email address.
 * @returns The normalized email.
 */
function normalizeEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

/**
 * Validates password length requirements.
 * @param password The password to validate.
 * @throws Error with status 400 if password is not 10-200 characters.
 */
function assertPassword(password: string): void {
  if (typeof password !== "string" || password.length < 10 || password.length > 200) {
    const err = new Error("Password must be 10–200 characters");
    (err as Error & { status: number }).status = 400;
    throw err;
  }
}

/**
 * Hashes a password using PBKDF2 with a random salt.
 * @param password The plaintext password.
 * @returns A hash string in format "pbkdf2:iterations:salt:hash".
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await derive(password, salt, PBKDF2_ITERS);
  return `pbkdf2:${PBKDF2_ITERS}:${toHex(salt)}:${toHex(bits)}`;
}

/**
 * Verifies a password against a stored hash. Supports both PBKDF2 and legacy SHA-256 formats.
 * Uses timing-safe comparison to prevent timing attacks.
 * @param password The plaintext password.
 * @param stored The stored hash string.
 * @returns True if password matches, false otherwise.
 */
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

/**
 * Derives a cryptographic key from a password using PBKDF2-SHA256.
 * @param password The plaintext password.
 * @param salt The salt bytes.
 * @param iterations The number of PBKDF2 iterations.
 * @returns The derived key as a Uint8Array.
 */
async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return new Uint8Array(bits);
}
