import { AGENT_MODELS, MODELS } from "./models";

export type AgentModelKey = keyof typeof AGENT_MODELS;
export type ModelRouteReason = "requested" | "agent-primary" | "vision" | "fast" | "fallback";

const CHAT_MODELS = new Set(Object.values(MODELS.chat));
const VISION_MODELS = new Set([
  MODELS.chat.multimodal,
  MODELS.chat.vision,
  MODELS.chat.mistralVision,
  MODELS.chat.fast,
]);

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

export function isVisionCapableModel(value: unknown): value is string {
  return typeof value === "string" && VISION_MODELS.has(value);
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

  // Never route image-bearing requests to a text-only model, even when the client
  // supplied a valid but incompatible model ID. This prevents opaque provider
  // failures and preserves a predictable multimodal path for the UI.
  if (input.hasImages) {
    if (requested && isVisionCapableModel(requested)) {
      return { model: requested, agent, reason: "requested", requested, downgraded: false };
    }
    const model = isVisionCapableModel(policy.fast) ? policy.fast : MODELS.chat.multimodal;
    return { model, agent, reason: "vision", requested, downgraded: Boolean(requested) };
  }

  if (requested && isSupportedChatModel(requested)) {
    return { model: requested, agent, reason: "requested", requested, downgraded: false };
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
