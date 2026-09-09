import type { Sandbox } from "@cloudflare/sandbox";

export interface Env {
  AI: Ai;
  BROWSER: Fetcher;
  VECTORIZE: VectorizeIndex;
  DB: D1Database;
  BUCKET: R2Bucket;
  CACHE: KVNamespace;
  SESSIONS: KVNamespace;
  AI_SEARCH: any;
  NEXUS_AGENT: DurableObjectNamespace;
  BUILDER_AGENT: DurableObjectNamespace;
  RESEARCHER_AGENT: DurableObjectNamespace;
  CREATIVE_AGENT: DurableObjectNamespace;
  ANALYST_AGENT: DurableObjectNamespace;
  NEXUS_MCP: DurableObjectNamespace;
  VOICE_AGENT: DurableObjectNamespace;
  SANDBOX: DurableObjectNamespace<Sandbox>;
  RAG_WORKFLOW: Workflow;
  DOC_QUEUE: Queue<Record<string, unknown>>;
  ASSETS: Fetcher;
}

export const AGENT_BINDINGS = {
  nexus: "NEXUS_AGENT",
  sirius: "ANALYST_AGENT",
  ana: "BUILDER_AGENT",
  nova: "RESEARCHER_AGENT",
  creative: "CREATIVE_AGENT",
  builder: "BUILDER_AGENT",
  researcher: "RESEARCHER_AGENT",
  analyst: "ANALYST_AGENT",
} as const;

export type AgentAlias = keyof typeof AGENT_BINDINGS;
