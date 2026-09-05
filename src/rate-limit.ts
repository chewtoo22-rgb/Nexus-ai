export interface RateLimitConfig { maxRequests: number; windowSeconds: number; }
const DEFAULT_LIMIT: RateLimitConfig = { maxRequests: 100, windowSeconds: 3600 };
const AGENT_LIMITS: Record<string, RateLimitConfig> = {
  nexus: { maxRequests: 100, windowSeconds: 3600 }, builder: { maxRequests: 50, windowSeconds: 3600 },
  researcher: { maxRequests: 50, windowSeconds: 3600 }, creative: { maxRequests: 50, windowSeconds: 3600 }, analyst: { maxRequests: 50, windowSeconds: 3600 },
};

export async function checkRateLimit(env: any, identifier: string, agentType?: string): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const config = agentType ? (AGENT_LIMITS[agentType] || DEFAULT_LIMIT) : DEFAULT_LIMIT;
  const key = `ratelimit:${agentType || "default"}:${identifier}`;
  const now = Date.now(); const windowStart = now - config.windowSeconds * 1000;
  const data = await env.CACHE.get(key, "text");
  let requests: number[] = [];
  if (data) { try { requests = JSON.parse(data).filter((ts: number) => ts > windowStart); } catch {} }
  if (requests.length >= config.maxRequests) { return { allowed: false, remaining: 0, resetAt: Math.min(...requests) + config.windowSeconds * 1000 }; }
  requests.push(now);
  await env.CACHE.put(key, JSON.stringify(requests), { expirationTtl: config.windowSeconds });
  return { allowed: true, remaining: config.maxRequests - requests.length, resetAt: now + config.windowSeconds * 1000 };
}

export function getRateLimitHeaders(result: { remaining: number; resetAt: number }): Record<string, string> {
  return { "X-RateLimit-Remaining": String(result.remaining), "X-RateLimit-Reset": String(Math.floor(result.resetAt / 1000)) };
}
