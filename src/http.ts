import type { Session } from "./auth";

const AUTH_PREFIXES = [
  "/api/sandbox",
  "/api/code",
  "/api/tools",
  "/api/documents",
  "/api/ingest",
  "/api/plugins",
  "/api/stats",
  "/api/missions",
  "/api/conversations",
  "/api/artifacts",
  "/api/browser",
  "/api/search",
  "/api/ai-search",
  "/api/images",
];

export function matchesPath(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function needsAuth(path: string, method: string): boolean {
  if (AUTH_PREFIXES.some((prefix) => matchesPath(path, prefix))) return true;
  if (path === "/api/connectors/install" || path === "/api/connectors/installed") return true;
  if (path.startsWith("/api/connectors/") && method === "DELETE") return true;
  if (matchesPath(path, "/api/projects")) return true;
  return false;
}

export function json(
  data: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

export function httpError(err: unknown): Response {
  const message = err instanceof Error ? err.message : "Request failed";
  const status =
    typeof (err as { status?: number })?.status === "number"
      ? (err as { status: number }).status
      : 400;
  return json({ error: message }, status);
}

export function requireSession(session: Session | null): Session {
  if (!session) {
    throw Object.assign(new Error("Authentication required"), { status: 401 });
  }
  return session;
}

export function notFound(message = "Not found"): never {
  throw Object.assign(new Error(message), { status: 404 });
}
