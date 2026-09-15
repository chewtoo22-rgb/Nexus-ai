import { AGENT_MODELS, MODELS } from "./models";

export type AgentModelKey = keyof typeof AGENT_MODELS;
export type ModelRouteReason = "requested" | "agent-primary" | "vision" | "fast" | "fallback";

const CHAT_MODELS = new Set(Object.values(MODELS.chat));

export interface ModelRoute {
  model: string;
  agent: AgentModelKey;
  reason: ModelRouteReason;
  requested?: string;
  downgraded: boolean;
}

export function isSupportedChatModel(value: unknown): value is string {
  return typeof value === "string" && CHAT_MODELS.has(value);
}

export function normalizeAgentKey(value: unknown): AgentModelKey {
  if (value === "builder" || value === "researcher" || value === "creative" || value === "analyst") return value;
  return "nexus";
}

export function resolveChatModel(input: {
  agent?: unknown;
  requestedModel?: unknown;
  fast?: boolean;
  hasImages?: boolean;
}): ModelRoute {
  const agent = normalizeAgentKey(input.agent);
  const policy = AGENT_MODELS[agent];
  const requested = typeof input.requestedModel === "string" ? input.requestedModel.trim() : undefined;

  if (requested && isSupportedChatModel(requested)) {
    return { model: requested, agent, reason: "requested", requested, downgraded: false };
  }

  if (input.hasImages) {
    const model = policy.fast === MODELS.chat.fast ? MODELS.chat.multimodal : policy.fast;
    return { model, agent, reason: "vision", requested, downgraded: Boolean(requested) };
  }

  if (input.fast) {
    return { model: policy.fast, agent, reason: "fast", requested, downgraded: Boolean(requested) };
  }

  return {
    model: requested ? policy.fallback : policy.primary,
    agent,
    reason: requested ? "fallback" : "agent-primary",
    requested,
    downgraded: Boolean(requested),
  };
}

export function modelCatalog(): string[] {
  return [...CHAT_MODELS].sort();
}
