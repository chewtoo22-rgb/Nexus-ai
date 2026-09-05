export interface Session { userId: string; email: string; token: string; createdAt: string; expiresAt: string; }

export async function createSession(env: any, userId: string, email: string): Promise<Session> {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const now = new Date(); const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const session: Session = { userId, email, token, createdAt: now.toISOString(), expiresAt: expires.toISOString() };
  await env.SESSIONS.put(`session:${token}`, JSON.stringify(session), { expirationTtl: 7 * 24 * 60 * 60 });
  return session;
}

export async function getSession(env: any, token: string): Promise<Session | null> {
  const data = await env.SESSIONS.get(`session:${token}`, "text");
  if (!data) return null;
  try { return JSON.parse(data) as Session; } catch { return null; }
}

export async function deleteSession(env: any, token: string): Promise<void> { await env.SESSIONS.delete(`session:${token}`); }

export async function authenticateRequest(request: Request, env: any): Promise<Session | null> {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return await getSession(env, auth.slice(7));
}

export async function registerUser(env: any, email: string, password: string): Promise<Session> {
  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  await env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, datetime('now'))").bind(userId, email, passwordHash).run();
  return await createSession(env, userId, email);
}

export async function loginUser(env: any, email: string, password: string): Promise<Session | null> {
  const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first() as any;
  if (!user) return null;
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return null;
  return await createSession(env, user.id, email);
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder(); const salt = crypto.randomUUID();
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(salt + password));
  return salt + ":" + [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  const computed = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + password));
  return hash === [...new Uint8Array(computed)].map(b => b.toString(16).padStart(2, "0")).join("");
}
