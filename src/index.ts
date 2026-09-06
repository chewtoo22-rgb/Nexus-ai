import { NexusAgent, BuilderAgent, ResearcherAgent, CreativeAgent, AnalystAgent } from "./agents";
import { RAGWorkflow } from "./workflows";
import { NexusMCP } from "./mcp-server";
import { NexusVoiceAgent } from "./voice";
import { MODELS, AGENT_MODELS } from "./models";
import { executeTool } from "./tool-executor";
import { runCodeTool } from "./code-exec";
import { streamChat, sseSend } from "./streaming";
import { CONNECTORS, getConnectorsByCategory, getConnector } from "./connectors";
import { getEnabledPlugins, installPlugin, togglePlugin, uninstallPlugin, BUILTIN_PLUGINS } from "./plugins";
import { authenticateRequest, deleteSession, loginUser, registerUser, type Session } from "./auth";
import { checkRateLimit, getRateLimitHeaders } from "./rate-limit";
import { assertPublicHttpUrl, parseJson } from "./security";
import { Sandbox } from "@cloudflare/sandbox";

export {
  NexusAgent,
  BuilderAgent,
  ResearcherAgent,
  CreativeAgent,
  AnalystAgent,
  RAGWorkflow,
  NexusMCP,
  NexusVoiceAgent,
  Sandbox,
};

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
  DOC_QUEUE: Queue<any>;
  ASSETS: Fetcher;
}

const AGENT_MAP = {
  nexus: "NEXUS_AGENT",
  builder: "BUILDER_AGENT",
  researcher: "RESEARCHER_AGENT",
  creative: "CREATIVE_AGENT",
  analyst: "ANALYST_AGENT",
} as const;

const AGENT_PROMPTS: Record<string, string> = {
  nexus: "You are Nexus, a frontier-grade AI.",
  builder: "You are Ana, the Builder Agent.",
  researcher: "You are Nova, the Researcher Agent.",
  creative: "You are the Creative Agent.",
  analyst: "You are Sirius, the Analyst Agent.",
};

const AUTH_PREFIXES = [
  "/mcp",
  "/voice",
  "/api/agent/",
  "/api/chat",
  "/api/browser",
  "/api/sandbox",
  "/api/code/",
  "/api/tools/execute",
  "/api/conversations",
  "/api/documents",
  "/api/ingest",
  "/api/artifacts",
  "/api/images/",
  "/api/projects",
  "/api/plugins",
  "/api/connectors/install",
  "/api/stats",
];

function needsAuth(path: string, method: string): boolean {
  if (AUTH_PREFIXES.some((p) => path === p || path.startsWith(p))) return true;
  if (path.startsWith("/api/connectors/") && method === "DELETE") return true;
  return false;
}

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

function httpError(err: unknown): Response {
  const explicitStatus = typeof (err as { status?: number })?.status === "number" ? (err as { status: number }).status : undefined;
  if (explicitStatus !== undefined && explicitStatus >= 400 && explicitStatus < 500) {
    return json({ error: err instanceof Error ? err.message : "Request failed" }, explicitStatus);
  }
  return json({ error: "Internal server error" }, 500);
}

function requireSession(session: Session | null): Session {
  if (session) return session;
  const err = new Error("Authentication required");
  (err as Error & { status: number }).status = 401;
  throw err;
}

async function persistChatTurn(
  env: Env,
  conversationId: string,
  message: string,
  response: string,
  model: string,
  agentType: string,
  usage: { input_tokens?: number; output_tokens?: number },
  artifacts: any[],
): Promise<void> {
  const statements = [
    env.DB.prepare(
      "INSERT INTO messages (id, conversation_id, role, content, model, agent_type) VALUES (?, ?, 'user', ?, ?, ?)",
    ).bind(crypto.randomUUID(), conversationId, message, model, agentType),
    env.DB.prepare(
      "INSERT INTO messages (id, conversation_id, role, content, model, agent_type, tokens_in, tokens_out, artifacts) VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), conversationId, response, model, agentType, usage.input_tokens || 0, usage.output_tokens || 0, artifacts.length ? JSON.stringify(artifacts) : null),
    env.DB.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").bind(conversationId),
    ...artifacts.map((artifact) => env.DB.prepare(
      "INSERT INTO artifacts (id, conversation_id, type, title, language, content, r2_key) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), conversationId, artifact?.type || "code", artifact?.title || null, artifact?.language || null, artifact?.content || null, artifact?.r2_key || null)),
  ];
  await env.DB.batch(statements);
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!path.startsWith("/api/") && path !== "/mcp" && !path.startsWith("/voice")) {
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response("Static assets not configured. Add assets.directory in wrangler.jsonc.", { status: 503 });
    }

    const clientIP = request.headers.get("CF-Connecting-IP") || "unknown";
    const rl = await checkRateLimit(env, clientIP);
    const rlH = getRateLimitHeaders(rl);
    if (!rl.allowed) {
      return json(
        { error: "Rate limit exceeded", remaining: 0 },
        429,
        { "Retry-After": String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))), ...rlH },
      );
    }

    const session = await authenticateRequest(request, env);
    if (needsAuth(path, request.method) && !session) {
      return json({ error: "Authentication required" }, 401, rlH);
    }

    if (path === "/mcp" || path === "/mcp/") {
      return env.NEXUS_MCP.get(env.NEXUS_MCP.idFromName(requireSession(session).userId)).fetch(request);
    }
    if (path === "/voice" && request.headers.get("Upgrade") === "websocket") {
      return env.VOICE_AGENT.get(env.VOICE_AGENT.idFromName(requireSession(session).userId)).fetch(request);
    }
    if (path.startsWith("/api/agent/") && request.headers.get("Upgrade") === "websocket") {
      const agentType = path.split("/")[3];
      const bindingName = AGENT_MAP[agentType as keyof typeof AGENT_MAP];
      if (!bindingName) return new Response("Unknown agent", { status: 404 });
      const agentId = url.searchParams.get("id") || "default";
      const user = requireSession(session);
      const scopedAgentId = `${user.userId}:${agentId}`;
      const headers = new Headers(request.headers);
      headers.set("X-Nexus-User-Id", user.userId);
      return (env as any)[bindingName].get((env as any)[bindingName].idFromName(scopedAgentId)).fetch(new Request(request, { headers }));
    }

    const ok = (data: unknown, status = 200) => json(data, status, rlH);

    try {
      return await handleApi(request, env, path, url, ok, rlH, session);
    } catch (err) {
      const res = httpError(err);
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(rlH)) headers.set(k, v);
      return new Response(res.body, { status: res.status, headers });
    }
  },

  async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
    for (const m of batch.messages) {
      try {
        await env.RAG_WORKFLOW.create({ params: m.body });
        m.ack();
      } catch (e) {
        console.error(e);
        m.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;

async function handleApi(
  request: Request,
  env: Env,
  path: string,
  url: URL,
  ok: (data: unknown, status?: number) => Response,
  rlH: Record<string, string>,
  session: Session | null,
): Promise<Response> {
  if (path === "/api/health") {
    return ok({
      name: "nexus-ai",
      version: "3.0.1",
      status: "online",
      agents: Object.keys(AGENT_MAP),
      features: ["mcp-server", "streaming", "sandbox", "connectors", "plugins", "voice", "auth", "rate-limiting", "projects"],
      models: { chat: Object.values(MODELS.chat), vision: Object.values(MODELS.vision), imageGen: Object.values(MODELS.imageGen) },
      connectors: CONNECTORS.length,
      plugins: BUILTIN_PLUGINS.length,
    });
  }

  if (path === "/api/chat" && request.method === "POST") {
    const user = requireSession(session);
    const body = await parseJson<{ message?: string; agent?: string; conversationId?: string; sessionId?: string; model?: string; images?: string[]; stream?: boolean }>(request);
    const message = String(body.message || "").trim();
    if (!message) return ok({ error: "message required" }, 400);
    const agentType = body.agent || "nexus";
    const bindingName = AGENT_MAP[agentType as keyof typeof AGENT_MAP];
    if (!bindingName) return ok({ error: "Unknown agent" }, 400);
    const selectedModel = body.model || AGENT_MODELS[agentType as keyof typeof AGENT_MODELS].primary;
    const requestedId = body.conversationId ?? body.sessionId;
    if (requestedId !== undefined && (typeof requestedId !== "string" || !requestedId.trim())) return ok({ error: "Invalid conversationId" }, 400);
    const sid = requestedId?.trim() || crypto.randomUUID();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO conversations (id, agent_type, title, model, user_id) VALUES (?, ?, ?, ?, ?)",
    ).bind(sid, agentType, message.slice(0, 80), selectedModel, user.userId).run();
    const conversation = await env.DB.prepare("SELECT user_id FROM conversations WHERE id = ?").bind(sid).first<{ user_id: string | null }>();
    if (!conversation || conversation.user_id !== user.userId) return ok({ error: "Conversation not found" }, 404);
    const historyResult = await env.DB.prepare(
      "SELECT m.role, m.content FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.conversation_id = ? AND c.user_id = ? ORDER BY m.created_at DESC LIMIT 24",
    ).bind(sid, user.userId).all<{ role: string; content: string }>();
    const history = [...(historyResult.results || [])].reverse().map((row) => ({ role: row.role, content: row.content }));
    if (body.stream) {
      const artifacts: any[] = [];
      const readable = new ReadableStream({
        async start(controller) {
          await streamChat({
            model: selectedModel,
            systemPrompt: AGENT_PROMPTS[agentType] || AGENT_PROMPTS.nexus,
            messages: [...history, { role: "user", content: message }],
            agentType,
            env,
            userId: user.userId,
            onToken: (t) => sseSend(controller, "token", { token: t }),
            onToolCall: (tool, args) => sseSend(controller, "tool_call", { tool, args }),
            onToolResult: (tool, result) => sseSend(controller, "tool_result", { tool, result }),
            onArtifact: (a) => {
              artifacts.push(a);
              sseSend(controller, "artifact", a);
            },
            onComplete: async (fullText, usage) => {
              await persistChatTurn(env, sid, message, fullText, selectedModel, agentType, usage, artifacts);
              sseSend(controller, "done", { content: fullText, model: selectedModel, usage, sessionId: sid });
              controller.close();
            },
            onError: (error) => {
              sseSend(controller, "error", { error });
              controller.close();
            },
          });
        },
      });
      return new Response(readable, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", ...rlH },
      });
    }
    return (env as any)[bindingName]
      .get((env as any)[bindingName].idFromName(`${user.userId}:${sid}`))
      .fetch("https://do/chat", {
        method: "POST",
        body: JSON.stringify({ content: message, conversationId: sid, images: body.images, model: body.model }),
        headers: { "Content-Type": "application/json" },
      });
  }

  if (path === "/api/conversations" && request.method === "GET") {
    const user = requireSession(session);
    const r = await env.DB.prepare("SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100").bind(user.userId).all();
    return ok(r.results);
  }
  if (path === "/api/conversations" && request.method === "POST") {
    const user = requireSession(session);
    const { agentType, title, projectId } = await parseJson<any>(request);
    if (projectId) {
      const project = await env.DB.prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?").bind(projectId, user.userId).first();
      if (!project) return ok({ error: "Project not found" }, 404);
    }
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO conversations (id, agent_type, title, project_id, user_id) VALUES (?, ?, ?, ?, ?)")
      .bind(id, agentType || "nexus", title || "New conversation", projectId || null, user.userId)
      .run();
    return ok({ id });
  }
  if (path.startsWith("/api/conversations/") && request.method === "GET") {
    const user = requireSession(session);
    const c = path.split("/")[3];
    const conv = await env.DB.prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?").bind(c, user.userId).first();
    if (!conv) return ok({ error: "Not found" }, 404);
    const msgs = await env.DB.prepare(
      "SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.conversation_id = ? AND c.user_id = ? ORDER BY m.created_at ASC",
    ).bind(c, user.userId).all();
    return ok({ conversation: conv, messages: msgs.results });
  }
  if (path.startsWith("/api/conversations/") && request.method === "DELETE") {
    const user = requireSession(session);
    const c = path.split("/")[3];
    const conv = await env.DB.prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?").bind(c, user.userId).first();
    if (!conv) return ok({ error: "Not found" }, 404);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE id = ? AND user_id = ?)").bind(c, user.userId),
      env.DB.prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?").bind(c, user.userId),
    ]);
    return ok({ ok: true });
  }

  if (path === "/api/documents" && request.method === "POST") {
    const user = requireSession(session);
    const fd = await request.formData();
    const file = fd.get("file") as File | null;
    if (!file) return ok({ error: "file required" }, 400);
    const id = crypto.randomUUID();
    const key = `documents/${id}/${file.name}`;
    await env.BUCKET.put(key, file.stream());
    await env.DB.prepare("INSERT INTO documents (id, source, source_key, title, status, user_id) VALUES (?, 'r2', ?, ?, 'pending', ?)")
      .bind(id, key, file.name, user.userId)
      .run();
    await env.DOC_QUEUE.send({ documentId: id, source: "r2", sourceKey: key, title: file.name });
    return ok({ documentId: id, status: "queued" });
  }
  if (path === "/api/documents" && request.method === "GET") {
    const user = requireSession(session);
    const r = await env.DB.prepare("SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC LIMIT 100").bind(user.userId).all();
    return ok(r.results);
  }
  if (path.startsWith("/api/documents/") && request.method === "GET") {
    const user = requireSession(session);
    const document = await env.DB.prepare("SELECT * FROM documents WHERE id = ? AND user_id = ?").bind(path.split("/")[3], user.userId).first();
    if (!document) return ok({ error: "Not found" }, 404);
    return ok(document);
  }
  if (path === "/api/ingest" && request.method === "POST") {
    const user = requireSession(session);
    const { text, title } = await parseJson<any>(request);
    if (!text) return ok({ error: "text required" }, 400);
    const id = crypto.randomUUID();
    const key = `documents/${id}/inline.txt`;
    await env.BUCKET.put(key, text);
    await env.DB.prepare("INSERT INTO documents (id, source, source_key, title, status, user_id) VALUES (?, 'upload', ?, ?, 'pending', ?)")
      .bind(id, key, title || "Inline text", user.userId)
      .run();
    await env.DOC_QUEUE.send({ documentId: id, source: "r2", sourceKey: key, title: title || "Inline text" });
    return ok({ documentId: id, status: "queued" });
  }

  if (path === "/api/search" && request.method === "POST") {
    const { query } = await parseJson<any>(request);
    const emb = await env.AI.run(MODELS.embeddings.primary, { text: [query] });
    const v = (emb as any).data?.[0] ?? [];
    const r = await env.VECTORIZE.query(v, { topK: 10, returnMetadata: "all" });
    return ok({ query, results: r.matches ?? [] });
  }
  if (path === "/api/ai-search" && request.method === "POST") {
    const { query } = await parseJson<any>(request);
    try {
      return ok(await env.AI_SEARCH.search({ query }));
    } catch {
      return ok({ error: "AI Search not configured" }, 502);
    }
  }

  if (path === "/api/artifacts" && request.method === "GET") {
    const user = requireSession(session);
    const cId = url.searchParams.get("conversationId");
    if (cId) {
      const r = await env.DB.prepare(
        "SELECT a.* FROM artifacts a JOIN conversations c ON c.id = a.conversation_id WHERE a.conversation_id = ? AND c.user_id = ? ORDER BY a.created_at DESC",
      ).bind(cId, user.userId).all();
      return ok(r.results);
    }
    const r = await env.DB.prepare(
      "SELECT a.* FROM artifacts a JOIN conversations c ON c.id = a.conversation_id WHERE c.user_id = ? ORDER BY a.created_at DESC LIMIT 100",
    ).bind(user.userId).all();
    return ok(r.results);
  }
  if (path.startsWith("/api/artifacts/") && request.method === "GET") {
    const user = requireSession(session);
    const a = await env.DB.prepare(
      "SELECT a.* FROM artifacts a JOIN conversations c ON c.id = a.conversation_id WHERE a.id = ? AND c.user_id = ?",
    ).bind(path.split("/")[3], user.userId).first();
    if (!a) return ok({ error: "Not found" }, 404);
    if (a.r2_key) {
      const obj = await env.BUCKET.get(a.r2_key as string);
      if (obj) return new Response(obj.body, { headers: { "Content-Type": "image/png" } });
    }
    return ok(a);
  }
  if (path.startsWith("/api/images/") && request.method === "GET") {
    const user = requireSession(session);
    const key = path.slice("/api/images/".length);
    const artifact = await env.DB.prepare(
      "SELECT a.r2_key FROM artifacts a JOIN conversations c ON c.id = a.conversation_id WHERE a.r2_key = ? AND c.user_id = ? LIMIT 1",
    ).bind(key, user.userId).first<{ r2_key: string }>();
    if (!artifact) return new Response("Not found", { status: 404 });
    const obj = await env.BUCKET.get(artifact.r2_key);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "image/png" } });
  }

  if (path === "/api/models" && request.method === "GET") {
    return ok({ chat: MODELS.chat, vision: MODELS.vision, imageGen: MODELS.imageGen, stt: MODELS.stt, tts: MODELS.tts, embeddings: MODELS.embeddings, agentModels: AGENT_MODELS });
  }
  if (path === "/api/stats" && request.method === "GET") {
    const t = await env.DB.prepare("SELECT COUNT(*) as count, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens FROM usage").first();
    const byA = await env.DB.prepare("SELECT agent_type, COUNT(*) as count, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens FROM usage GROUP BY agent_type").all();
    return ok({ total: t, byAgent: byA.results });
  }

  if (path === "/api/projects" && request.method === "GET") {
    const user = requireSession(session);
    const r = await env.DB.prepare("SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC").bind(user.userId).all();
    return ok(r.results);
  }
  if (path === "/api/projects" && request.method === "POST") {
    const user = requireSession(session);
    const { name, description, systemPrompt } = await parseJson<any>(request);
    if (!name) return ok({ error: "name required" }, 400);
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO projects (id, name, description, system_prompt, user_id) VALUES (?, ?, ?, ?, ?)")
      .bind(id, name, description || "", systemPrompt || "", user.userId)
      .run();
    return ok({ id, name });
  }
  if (path.startsWith("/api/projects/") && request.method === "GET") {
    const user = requireSession(session);
    const id = path.split("/")[3];
    const p = await env.DB.prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?").bind(id, user.userId).first();
    if (!p) return ok({ error: "Not found" }, 404);
    const convs = await env.DB.prepare("SELECT * FROM conversations WHERE project_id = ? AND user_id = ? ORDER BY updated_at DESC").bind(id, user.userId).all();
    return ok({ project: p, conversations: convs.results });
  }
  if (path.startsWith("/api/projects/") && request.method === "DELETE") {
    const user = requireSession(session);
    await env.DB.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").bind(path.split("/")[3], user.userId).run();
    return ok({ ok: true });
  }

  if (path === "/api/connectors" && request.method === "GET") return ok(getConnectorsByCategory(url.searchParams.get("category") || undefined));
  if (path === "/api/connectors/installed" && request.method === "GET") {
    const r = await env.DB.prepare("SELECT * FROM mcp_connections ORDER BY created_at DESC").all();
    return ok(r.results);
  }
  if (path === "/api/connectors/install" && request.method === "POST") {
    const { connectorId, name } = await parseJson<any>(request);
    const c = getConnector(connectorId);
    if (!c) return ok({ error: "Not found" }, 404);
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO mcp_connections (id, name, url, status, tools) VALUES (?, ?, ?, 'pending_auth', '[]')")
      .bind(id, name || c.name, c.mcpUrl)
      .run();
    return ok({ id, connector: c, status: "pending_auth" });
  }
  if (path.startsWith("/api/connectors/") && request.method === "GET") {
    const c = getConnector(path.split("/")[3]);
    if (!c) return ok({ error: "Not found" }, 404);
    return ok(c);
  }
  if (path.startsWith("/api/connectors/") && request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM mcp_connections WHERE id = ?").bind(path.split("/")[3]).run();
    return ok({ ok: true });
  }

  if (path === "/api/plugins" && request.method === "GET") return ok(await getEnabledPlugins(env.DB));
  if (path === "/api/plugins" && request.method === "POST") {
    const p = await parseJson<any>(request);
    const id = await installPlugin(env.DB, p);
    return ok({ id, ...p });
  }
  if (path.startsWith("/api/plugins/") && request.method === "PATCH") {
    const { enabled } = await parseJson<any>(request);
    await togglePlugin(env.DB, path.split("/")[3], enabled);
    return ok({ ok: true });
  }
  if (path.startsWith("/api/plugins/") && request.method === "DELETE") {
    await uninstallPlugin(env.DB, path.split("/")[3]);
    return ok({ ok: true });
  }

  if (path === "/api/code/run" && request.method === "POST") {
    const user = requireSession(session);
    const { code, language } = await parseJson<any>(request);
    if (!code) return ok({ error: "code required" }, 400);
    return ok(await runCodeTool({ code, language }, env, user.userId));
  }
  if (path === "/api/sandbox/exec" && request.method === "POST") {
    const user = requireSession(session);
    const { command, args } = await parseJson<any>(request);
    if (!command || typeof command !== "string") return ok({ error: "command required" }, 400);
    const { getSandbox } = await import("@cloudflare/sandbox");
    const s = getSandbox(env.SANDBOX, user.userId);
    const r = await s.exec(command, args || []);
    return ok({ stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode });
  }
  if (path === "/api/sandbox/write" && request.method === "POST") {
    const user = requireSession(session);
    const { path: fp, content } = await parseJson<any>(request);
    if (!fp || typeof fp !== "string") return ok({ error: "path required" }, 400);
    const { getSandbox } = await import("@cloudflare/sandbox");
    const s = getSandbox(env.SANDBOX, user.userId);
    await s.writeFile(fp, content);
    return ok({ ok: true });
  }
  if (path === "/api/sandbox/read" && request.method === "POST") {
    const user = requireSession(session);
    const { path: fp } = await parseJson<any>(request);
    if (!fp || typeof fp !== "string") return ok({ error: "path required" }, 400);
    const { getSandbox } = await import("@cloudflare/sandbox");
    const s = getSandbox(env.SANDBOX, user.userId);
    return ok({ content: await s.readFile(fp) });
  }

  if (path === "/api/tools/execute" && request.method === "POST") {
    const user = requireSession(session);
    const { tool, args } = await parseJson<any>(request);
    if (!tool) return ok({ error: "tool required" }, 400);
    return ok(await executeTool(tool, args, env, { userId: user.userId }));
  }
  if (path === "/api/browser/screenshot" && request.method === "POST") {
    requireSession(session);
    const { url: t } = await parseJson<any>(request);
    const safe = assertPublicHttpUrl(t);
    const r = await (env.BROWSER as any).quickAction("screenshot", { url: safe.toString() });
    return new Response(r.body, { headers: { "Content-Type": "image/png" } });
  }
  if (path === "/api/browser/markdown" && request.method === "POST") {
    requireSession(session);
    const { url: t } = await parseJson<any>(request);
    const safe = assertPublicHttpUrl(t);
    const r = await (env.BROWSER as any).quickAction("markdown", { url: safe.toString() });
    return new Response(r.body, { headers: { "Content-Type": "text/markdown" } });
  }

  if (path === "/api/auth/register" && request.method === "POST") {
    const { email, password } = await parseJson<any>(request);
    if (!email || !password) return ok({ error: "email and password required" }, 400);
    try {
      const s = await registerUser(env, email, password);
      return ok({ token: s.token, userId: s.userId, email: s.email });
    } catch (err) {
      return httpError(err);
    }
  }
  if (path === "/api/auth/login" && request.method === "POST") {
    const { email, password } = await parseJson<any>(request);
    const s = await loginUser(env, email, password);
    if (!s) return ok({ error: "Invalid credentials" }, 401);
    return ok({ token: s.token, userId: s.userId, email: s.email });
  }
  if (path === "/api/auth/me" && request.method === "GET") {
    const s = await authenticateRequest(request, env);
    if (!s) return ok({ error: "Not authenticated" }, 401);
    return ok({ userId: s.userId, email: s.email });
  }
  if (path === "/api/auth/logout" && request.method === "POST") {
    const a = request.headers.get("Authorization");
    if (a?.startsWith("Bearer ")) await deleteSession(env, a.slice(7).trim());
    return ok({ ok: true });
  }

  return new Response("Not found", { status: 404, headers: rlH });
}
