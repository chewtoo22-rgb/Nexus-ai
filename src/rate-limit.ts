export interface RateLimitConfig { maxRequests: number; windowSeconds: number; }

const DEFAULT_LIMIT: RateLimitConfig = { maxRequests: 100, windowSeconds: 3600 };
const AGENT_LIMITS: Record<string, RateLimitConfig> = {
  nexus: { maxRequests: 100, windowSeconds: 3600 },
  builder: { maxRequests: 50, windowSeconds: 3600 },
  researcher: { maxRequests: 50, windowSeconds: 3600 },
  creative: { maxRequests: 50, windowSeconds: 3600 },
  analyst: { maxRequests: 50, windowSeconds: 3600 },
  "anon-chat": { maxRequests: 30, windowSeconds: 3600 },
};

type Counter = { n: number; start: number };

export async function checkRateLimit(
  env: { CACHE: KVNamespace },
  identifier: string,
  agentType?: string,
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const config = agentType ? (AGENT_LIMITS[agentType] || DEFAULT_LIMIT) : DEFAULT_LIMIT;
  const key = `ratelimit:${agentType || "default"}:${identifier}`;
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const stored = await env.CACHE.get(key, "json") as Counter | number[] | null;
  let n = 0;
  let start = now;
  if (Array.isArray(stored)) {
    const fresh = stored.filter((ts) => ts > now - windowMs);
    n = fresh.length;
    start = fresh[0] || now;
  } else if (stored && typeof stored.n === "number") {
    if (now - stored.start < windowMs) {
      n = stored.n;
      start = stored.start;
    }
  }
  if (n >= config.maxRequests) {
    return { allowed: false, remaining: 0, resetAt: start + windowMs };
  }
  const next: Counter = { n: n + 1, start };
  await env.CACHE.put(key, JSON.stringify(next), { expirationTtl: config.windowSeconds });
  return { allowed: true, remaining: config.maxRequests - next.n, resetAt: start + windowMs };
}

export function getRateLimitHeaders(result: { remaining: number; resetAt: number }): Record<string, string> {
  return {
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.floor(result.resetAt / 1000)),
  };
}
