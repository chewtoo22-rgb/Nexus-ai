import type { Env } from "./env";

export type Usage = { input_tokens?: number; output_tokens?: number };

export type ArtifactRecord = {
  type?: string;
  title?: string;
  language?: string;
  content?: string;
  r2_key?: string;
};

export async function ensureConversation(
  env: Env,
  id: string,
  agentType: string,
  userId: string,
): Promise<void> {
  const existing = await env.DB.prepare(
    "SELECT id, user_id FROM conversations WHERE id = ?",
  )
    .bind(id)
    .first<{ id: string; user_id: string | null }>();
  if (existing) {
    if (existing.user_id !== userId) {
      throw Object.assign(new Error("Conversation not found"), { status: 404 });
    }
    return;
  }
  await env.DB.prepare(
    "INSERT INTO conversations (id, agent_type, title, user_id) VALUES (?, ?, 'New conversation', ?)",
  )
    .bind(id, agentType, userId)
    .run();
}

export async function persistTurn(
  env: Env,
  conversationId: string | undefined,
  userContent: string,
  assistant: string,
  model: string,
  agentType: string,
  usage: Usage,
  latency: number,
  artifacts: ArtifactRecord[],
  userId?: string | null,
): Promise<void> {
  if (!conversationId || !env?.DB || !userId) return;
  await ensureConversation(env, conversationId, agentType, userId);
  const artifactJson = artifacts.length ? JSON.stringify(artifacts) : null;
  await env.DB.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, model, agent_type, tokens_in, tokens_out, latency_ms, artifacts) VALUES (?, ?, 'user', ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), conversationId, userContent, model, agentType, 0, 0, 0, null)
    .run();
  await env.DB.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, model, agent_type, tokens_in, tokens_out, latency_ms, artifacts) VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      conversationId,
      assistant,
      model,
      agentType,
      usage.input_tokens || 0,
      usage.output_tokens || 0,
      latency,
      artifactJson,
    )
    .run();
  for (const artifact of artifacts) {
    await env.DB.prepare(
      "INSERT INTO artifacts (id, conversation_id, type, title, language, content, r2_key) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        crypto.randomUUID(),
        conversationId,
        artifact?.type || "code",
        artifact?.title || null,
        artifact?.language || null,
        artifact?.content || null,
        artifact?.r2_key || null,
      )
      .run();
  }
  await env.DB.prepare(
    "INSERT INTO usage (conversation_id, agent_type, model, input_tokens, output_tokens, latency_ms, tool_calls, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      conversationId,
      agentType,
      model,
      usage.input_tokens || 0,
      usage.output_tokens || 0,
      latency,
      artifacts.length,
      userId,
    )
    .run();
  await env.DB.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?")
    .bind(conversationId)
    .run();
}

export async function ownedRow(
  db: D1Database,
  table: "conversations" | "documents" | "projects" | "missions" | "mcp_connections",
  id: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  return db
    .prepare(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .first();
}
