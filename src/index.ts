import {
  AGENT_SYSTEM_PROMPTS,
  AnalystAgent,
  BuilderAgent,
  CreativeAgent,
  NexusAgent,
  ResearcherAgent,
} from "./agents";
import { authenticateRequest, deleteSession, loginUser, registerUser, type Session } from "./auth";
import { runCodeTool } from "./code-exec";
import { CONNECTORS, getConnector, getConnectorsByCategory } from "./connectors";
import { AGENT_BINDINGS, type Env } from "./env";
import { httpError, json, needsAuth, notFound, requireSession } from "./http";
import { NexusMCP } from "./mcp-server";
import { AGENT_MODELS, MODELS, modelKeyForAgent } from "./models";
import {
  addMissionStep,
  createMission,
  getMission,
  listMissions,
  normalizeAgent,
  setMissionStatus,
  setStepStatus,
  type MissionStatus,
} from "./missions";
import { persistTurn } from "./persist";
import { BUILTIN_PLUGINS, getEnabledPlugins, installPlugin, togglePlugin, uninstallPlugin } from "./plugins";
import { checkRateLimit, getRateLimitHeaders } from "./rate-limit";
import { assertPublicHttpUrl, isOwnedObjectKey, isUploadedFile, parseJson } from "./security";
import { sseSend, streamChat } from "./streaming";
import { executeTool } from "./tool-executor";
import { NexusVoiceAgent } from "./voice";
import { RAGWorkflow } from "./workflows";
import { Sandbox } from "@cloudflare/sandbox";

export {
  AnalystAgent,
  BuilderAgent,
  CreativeAgent,
  NexusAgent,
  NexusMCP,
  NexusVoiceAgent,
  RAGWorkflow,
  ResearcherAgent,
  Sandbox,
};
export type { Env };

type Ok = (data: unknown, status?: number) => Response;

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
      return json({ error: "Rate limit exceeded", remaining: 0 }, 429, {
        "Retry-After": String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))),
        ...rlH,
      });
    }

    if (path === "/mcp" || path === "/mcp/") {
      return env.NEXUS_MCP.get(env.NEXUS_MCP.idFromName("default")).fetch(request);
    }

    if (path === "/voice" && request.headers.get("Upgrade") === "websocket") {
      const session = await authenticateRequest(request, env);
      if (!session) return json({ error: "Authentication required" }, 401, rlH);
      return env.VOICE_AGENT.get(env.VOICE_AGENT.idFromName(session.userId)).fetch(request);
    }

    if (path.startsWith("/api/agent/") && request.headers.get("Upgrade") === "websocket") {
      const session = await authenticateRequest(request, env);
      if (!session) return json({ error: "Authentication required" }, 401, rlH);
      const agentType = path.split("/")[3];
      const bindingName = AGENT_BINDINGS[agentType as keyof typeof AGENT_BINDINGS];
      if (!bindingName) return new Response("Unknown agent", { status: 404 });
      const rawId = url.searchParams.get("id") || "default";
      const ns = env[bindingName];
      return ns.get(ns.idFromName(`${session.userId}:${rawId}`)).fetch(request);
    }

    if (needsAuth(path, request.method)) {
      const session = await authenticateRequest(request, env);
      if (!session) return json({ error: "Authentication required" }, 401, rlH);
    }

    const ok: Ok = (data, status = 200) => json(data, status, rlH);
    try {
      return await handleApi(request, env, path, url, ok, rlH);
    } catch (err) {
      const res = httpError(err);
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(rlH)) headers.set(k, v);
      return new Response(res.body, { status: res.status, headers });
    }
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    for (const m of batch.messages) {
      try {
        const body =
          m.body && typeof m.body === "object" ? (m.body as Record<string, unknown>) : {};
        await env.RAG_WORKFLOW.create({ params: body });
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
  ok: Ok,
  rlH: Record<string, string>,
): Promise<Response> {
  const session = await authenticateRequest(request, env);

  if (path === "/api/health") {
    return ok({
      name: "nexus-ai",
      version: "3.0.4",
      status: "online",
      agents: ["sirius", "ana", "nova", "creative"],
      features: ["mcp-server", "streaming", "sandbox", "voice", "auth", "rate-limiting", "projects", "mission-control"],
      stubs: ["oauth-connectors", "plugin-runtime", "browser_action"],
      models: {
        chat: Object.values(MODELS.chat),
        vision: Object.values(MODELS.vision),
        imageGen: Object.values(MODELS.imageGen),
      },
      connectors: CONNECTORS.length,
      plugins: BUILTIN_PLUGINS.length,
    });
  }

  if (path === "/api/chat" && request.method === "POST") {
    return handleChat(request, env, session, ok, rlH);
  }

  if (path.startsWith("/api/missions")) return handleMissions(request, env, session, path, ok);
  if (path.startsWith("/api/conversations")) return handleConversations(request, env, session, path, ok);
  if (path.startsWith("/api/documents") || path === "/api/ingest") return handleDocuments(request, env, session, path, ok);
  if (path === "/api/search" && request.method === "POST") return handleSearch(request, env, session, ok);
  if (path === "/api/ai-search" && request.method === "POST") {
    requireSession(session);
    const { query } = await parseJson<{ query?: string }>(request);
    try {
      return ok(await env.AI_SEARCH.search({ query: String(query || "") }));
    } catch {
      return ok({ error: "AI Search not configured" }, 502);
    }
  }
  if (path.startsWith("/api/artifacts") || path.startsWith("/api/images/")) {
    return handleArtifacts(request, env, session, path, url, ok);
  }
  if (path === "/api/models" && request.method === "GET") {
    return ok({
      chat: MODELS.chat,
      vision: MODELS.vision,
      imageGen: MODELS.imageGen,
      stt: MODELS.stt,
      tts: MODELS.tts,
      embeddings: MODELS.embeddings,
      agentModels: AGENT_MODELS,
    });
  }
  if (path === "/api/stats" && request.method === "GET") {
    const user = requireSession(session);
    const t = await env.DB.prepare(
      "SELECT COUNT(*) as count, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens FROM usage WHERE user_id = ?",
    ).bind(user.userId).first();
    const byA = await env.DB.prepare(
      "SELECT agent_type, COUNT(*) as count, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens FROM usage WHERE user_id = ? GROUP BY agent_type",
    ).bind(user.userId).all();
    return ok({ total: t, byAgent: byA.results });
  }
  if (path.startsWith("/api/projects")) return handleProjects(request, env, session, path, ok);
  if (path.startsWith("/api/connectors")) return handleConnectors(request, env, session, path, url, ok);
  if (path.startsWith("/api/plugins")) return handlePlugins(request, env, session, path, ok);
  if (path === "/api/code/run" && request.method === "POST") {
    const user = requireSession(session);
    const { code, language } = await parseJson<{ code?: string; language?: string }>(request);
    if (!code) return ok({ error: "code required" }, 400);
    if (code.length > 80_000) return ok({ error: "code too large" }, 400);
    return ok(await runCodeTool({ code, language: language || "python" }, env, user.userId));
  }
  if (path.startsWith("/api/sandbox/")) return handleSandbox(request, env, session, path, ok);
  if (path === "/api/tools/execute" && request.method === "POST") {
    const user = requireSession(session);
    const { tool, args } = await parseJson<{ tool?: string; args?: unknown }>(request);
    if (!tool) return ok({ error: "tool required" }, 400);
    return ok(await executeTool(tool, args, env, { userId: user.userId }));
  }
  if (path.startsWith("/api/browser/")) return handleBrowser(request, env, session, path, ok);
  if (path.startsWith("/api/auth/")) return handleAuth(request, env, path, ok);

  return new Response("Not found", { status: 404, headers: rlH });
}

async function handleChat(
  request: Request,
  env: Env,
  session: Session | null,
  ok: Ok,
  rlH: Record<string, string>,
): Promise<Response> {
  const body = await parseJson<{
    message?: string;
    agent?: string;
    sessionId?: string;
    model?: string;
    images?: string[];
    stream?: boolean;
  }>(request);
  const message = String(body.message || "").trim();
  if (!message) return ok({ error: "message required" }, 400);
  if (message.length > 32_000) return ok({ error: "message too long" }, 400);

  if (!session) {
    const chatRl = await checkRateLimit(env, request.headers.get("CF-Connecting-IP") || "unknown", "anon-chat");
    if (!chatRl.allowed) {
      return json({ error: "Rate limit exceeded" }, 429, {
        "Retry-After": String(Math.max(1, Math.ceil((chatRl.resetAt - Date.now()) / 1000))),
        ...rlH,
        ...getRateLimitHeaders(chatRl),
      });
    }
  }

  const agentType = body.agent || "nexus";
  if (!(agentType in AGENT_BINDINGS)) return ok({ error: "Unknown agent" }, 400);
  const modelKey = modelKeyForAgent(agentType);
  const selectedModel = body.model || AGENT_MODELS[modelKey].primary;
  const sid = body.sessionId || crypto.randomUUID();
  const systemPrompt = AGENT_SYSTEM_PROMPTS[agentType] || AGENT_SYSTEM_PROMPTS.nexus;

  if (Array.isArray(body.images)) {
    for (const img of body.images) {
      if (typeof img === "string" && /^https?:\/\//i.test(img)) assertPublicHttpUrl(img);
    }
  }

  const userContent = body.images?.length
    ? [{ type: "text", text: message }, ...body.images.map((u) => ({ type: "image_url", image_url: { url: u } }))]
    : message;
  const history: Array<{ role: string; content: unknown }> = [];
  if (session) {
    const conv = await env.DB.prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?")
      .bind(sid, session.userId).first();
    if (conv) {
      const msgs = await env.DB.prepare(
        "SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
      ).bind(sid).all<{ role: string; content: string }>();
      for (const row of msgs.results.slice(-24)) {
        history.push({ role: row.role, content: row.content });
      }
    }
  }
  const chatMessages = [...history, { role: "user", content: userContent }];
  const artifacts: Array<{ type?: string; title?: string; language?: string; content?: string; r2_key?: string }> = [];
  const start = Date.now();
  const base = {
    model: selectedModel,
    systemPrompt,
    messages: chatMessages,
    agentType: modelKey,
    env,
    userId: session?.userId,
  };

  if (body.stream) {
    const readable = new ReadableStream({
      async start(controller) {
        await streamChat({
          ...base,
          onToken: (t) => sseSend(controller, "token", { token: t }),
          onToolCall: (tool, args) => sseSend(controller, "tool_call", { tool, args }),
          onToolResult: (tool, result) => sseSend(controller, "tool_result", { tool, result }),
          onArtifact: (a) => {
            if (a) artifacts.push(a);
            sseSend(controller, "artifact", a || {});
          },
          onComplete: async (fullText, usage) => {
            if (session) {
              await persistTurn(env, sid, message, fullText, selectedModel, modelKey, usage, Date.now() - start, artifacts, session.userId);
            }
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
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...rlH,
      },
    });
  }

  let content = "";
  let usage = { input_tokens: 0, output_tokens: 0 };
  let error = "";
  await streamChat({
    ...base,
    onArtifact: (a) => {
      if (a) artifacts.push(a);
    },
    onComplete: (full, u) => {
      content = full;
      usage = u;
    },
    onError: (e) => {
      error = e;
    },
  });
  if (error) return ok({ error }, 502);
  if (session) {
    await persistTurn(env, sid, message, content, selectedModel, modelKey, usage, Date.now() - start, artifacts, session.userId);
  }
  return ok({ content, model: selectedModel, usage, artifacts, sessionId: sid });
}

async function handleMissions(
  request: Request,
  env: Env,
  session: Session | null,
  path: string,
  ok: Ok,
): Promise<Response> {
  const user = requireSession(session);
  if (path === "/api/missions" && request.method === "GET") {
    return ok(await listMissions(env.DB, user.userId));
  }
  if (path === "/api/missions" && request.method === "POST") {
    const body = await parseJson<{ goal?: string; projectId?: string; steps?: Array<{ agent?: string; title?: string; task?: string }> }>(request);
    const goal = String(body.goal || "").trim();
    if (!goal) return ok({ error: "goal required" }, 400);
    const mission = await createMission(env.DB, goal, body.projectId || null, user.userId);
    const rawSteps = Array.isArray(body.steps) ? body.steps.slice(0, 40) : [];
    const steps = [];
    for (let i = 0; i < rawSteps.length; i++) {
      const step = rawSteps[i] || {};
      if (!step.task) continue;
      const created = await addMissionStep(env.DB, mission.id, user.userId, i, normalizeAgent(step.agent || "sirius"), String(step.title || `Step ${i + 1}`), String(step.task));
      if (created) steps.push(created);
    }
    if (steps.length) await setMissionStatus(env.DB, mission.id, user.userId, "running");
    return ok({ ...mission, status: steps.length ? "running" : mission.status, steps }, 201);
  }
  if (path.startsWith("/api/missions/") && path.endsWith("/status") && request.method === "PATCH" && !path.includes("/steps/")) {
    const id = path.split("/")[3];
    const body = await parseJson<{ status?: string; result?: string; error?: string }>(request);
    const status = String(body.status || "") as MissionStatus;
    if (!["queued", "planning", "running", "completed", "failed", "cancelled"].includes(status)) {
      return ok({ error: "invalid status" }, 400);
    }
    const updated = await setMissionStatus(env.DB, id, user.userId, status, body.result ?? null, body.error ?? null);
    if (!updated) notFound();
    return ok(await getMission(env.DB, id, user.userId));
  }
  if (path.startsWith("/api/missions/") && path.endsWith("/steps") && request.method === "POST") {
    const id = path.split("/")[3];
    const body = await parseJson<{ task?: string; index?: number; agent?: string; title?: string }>(request);
    if (!body.task) return ok({ error: "task required" }, 400);
    const current = await getMission(env.DB, id, user.userId);
    if (!current.mission) notFound();
    const index = Number.isInteger(body.index) ? Number(body.index) : current.steps.length;
    const step = await addMissionStep(env.DB, id, user.userId, index, normalizeAgent(body.agent || "sirius"), String(body.title || `Step ${index + 1}`), String(body.task));
    if (!step) return ok({ error: "mission not found or step limit reached" }, 400);
    await setMissionStatus(env.DB, id, user.userId, "running");
    return ok(step, 201);
  }
  if (path.startsWith("/api/missions/") && path.includes("/steps/") && path.endsWith("/status") && request.method === "PATCH") {
    const parts = path.split("/");
    const missionId = parts[3];
    const stepId = parts[5];
    const body = await parseJson<{ status?: string; result?: string }>(request);
    const status = String(body.status || "");
    if (!["queued", "running", "completed", "failed"].includes(status)) return ok({ error: "invalid step status" }, 400);
    const updated = await setStepStatus(env.DB, missionId, stepId, user.userId, status as "queued" | "running" | "completed" | "failed", body.result ?? null);
    if (!updated) notFound();
    return ok({ ok: true });
  }
  if (path.startsWith("/api/missions/") && request.method === "GET") {
    const result = await getMission(env.DB, path.split("/")[3], user.userId);
    if (!result.mission) notFound();
    return ok(result);
  }
  return new Response("Not found", { status: 404 });
}

async function handleConversations(
  request: Request,
  env: Env,
  session: Session | null,
  path: string,
  ok: Ok,
): Promise<Response> {
  const user = requireSession(session);
  if (path === "/api/conversations" && request.method === "GET") {
    const r = await env.DB.prepare("SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100")
      .bind(user.userId).all();
    return ok(r.results);
  }
  if (path === "/api/conversations" && request.method === "POST") {
    const { agentType, title, projectId } = await parseJson<{ agentType?: string; title?: string; projectId?: string }>(request);
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO conversations (id, agent_type, title, project_id, user_id) VALUES (?, ?, ?, ?, ?)")
      .bind(id, agentType || "nexus", title || "New conversation", projectId || null, user.userId).run();
    return ok({ id });
  }
  if (path.startsWith("/api/conversations/") && request.method === "GET") {
    const c = path.split("/")[3];
    const conv = await env.DB.prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?")
      .bind(c, user.userId).first();
    if (!conv) notFound();
    const msgs = await env.DB.prepare("SELECT * FROM messages WHERE conversation_id = ?").bind(c).all();
    return ok({ conversation: conv, messages: msgs.results });
  }
  if (path.startsWith("/api/conversations/") && request.method === "DELETE") {
    const c = path.split("/")[3];
    const conv = await env.DB.prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?")
      .bind(c, user.userId).first();
    if (!conv) notFound();
    await env.DB.prepare("DELETE FROM artifacts WHERE conversation_id = ?").bind(c).run();
    await env.DB.prepare("DELETE FROM messages WHERE conversation_id = ?").bind(c).run();
    await env.DB.prepare("DELETE FROM conversations WHERE id = ?").bind(c).run();
    return ok({ ok: true });
  }
  return new Response("Not found", { status: 404 });
}

async function handleDocuments(
  request: Request,
  env: Env,
  session: Session | null,
  path: string,
  ok: Ok,
): Promise<Response> {
  const user = requireSession(session);
  if (path === "/api/documents" && request.method === "POST") {
    const fd = await request.formData();
    const file = fd.get("file");
    if (!isUploadedFile(file)) return ok({ error: "file required" }, 400);
    if (typeof file.size === "number" && file.size > 8_000_000) return ok({ error: "file too large" }, 413);
    const id = crypto.randomUUID();
    const key = `documents/${user.userId}/${id}/${file.name}`;
    await env.BUCKET.put(key, file.stream());
    await env.DB.prepare("INSERT INTO documents (id, source, source_key, title, status, user_id) VALUES (?, 'r2', ?, ?, 'pending', ?)")
      .bind(id, key, file.name, user.userId).run();
    await env.DOC_QUEUE.send({ documentId: id, source: "r2", sourceKey: key, title: file.name, userId: user.userId });
    return ok({ documentId: id, status: "queued" });
  }
  if (path === "/api/documents" && request.method === "GET") {
    const r = await env.DB.prepare("SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC LIMIT 100")
      .bind(user.userId).all();
    return ok(r.results);
  }
  if (path === "/api/ingest" && request.method === "POST") {
    const { text, title } = await parseJson<{ text?: string; title?: string }>(request);
    if (!text) return ok({ error: "text required" }, 400);
    if (text.length > 200_000) return ok({ error: "text too large" }, 400);
    const id = crypto.randomUUID();
    const key = `documents/${user.userId}/${id}/inline.txt`;
    await env.BUCKET.put(key, text);
    await env.DB.prepare("INSERT INTO documents (id, source, source_key, title, status, user_id) VALUES (?, 'upload', ?, ?, 'pending', ?)")
      .bind(id, key, title || "Inline text", user.userId).run();
    await env.DOC_QUEUE.send({ documentId: id, source: "r2", sourceKey: key, title: title || "Inline text", userId: user.userId });
    return ok({ documentId: id, status: "queued" });
  }
  return new Response("Not found", { status: 404 });
}

async function handleSearch(request: Request, env: Env, session: Session | null, ok: Ok): Promise<Response> {
  const user = requireSession(session);
  const { query } = await parseJson<{ query?: string }>(request);
  const q = String(query || "").trim();
  if (!q) return ok({ error: "query required" }, 400);
  if (q.length > 2000) return ok({ error: "query too long" }, 400);
  const emb = await env.AI.run(MODELS.embeddings.primary, { text: [q] });
  const v = (emb as { data?: number[][] }).data?.[0] ?? [];
  const r = await env.VECTORIZE.query(v, {
    topK: 10,
    returnMetadata: "all",
    filter: { userId: { $eq: user.userId } },
  });
  return ok({ query: q, results: r.matches ?? [] });
}

async function handleArtifacts(
  request: Request,
  env: Env,
  session: Session | null,
  path: string,
  url: URL,
  ok: Ok,
): Promise<Response> {
  const user = requireSession(session);
  if (path === "/api/artifacts" && request.method === "GET") {
    const cId = url.searchParams.get("conversationId");
    if (cId) {
      const conv = await env.DB.prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?")
        .bind(cId, user.userId).first();
      if (!conv) notFound();
      const r = await env.DB.prepare("SELECT * FROM artifacts WHERE conversation_id = ? ORDER BY created_at DESC")
        .bind(cId).all();
      return ok(r.results);
    }
    const r = await env.DB.prepare(
      "SELECT a.* FROM artifacts a JOIN conversations c ON c.id = a.conversation_id WHERE c.user_id = ? ORDER BY a.created_at DESC LIMIT 100",
    ).bind(user.userId).all();
    return ok(r.results);
  }
  if (path.startsWith("/api/artifacts/") && request.method === "GET") {
    const a = await env.DB.prepare(
      "SELECT a.* FROM artifacts a JOIN conversations c ON c.id = a.conversation_id WHERE a.id = ? AND c.user_id = ?",
    ).bind(path.split("/")[3], user.userId).first();
    if (!a) notFound();
    if (a.r2_key) {
      const obj = await env.BUCKET.get(a.r2_key as string);
      if (obj) return new Response(obj.body, { headers: { "Content-Type": "image/png" } });
    }
    return ok(a);
  }
  if (path.startsWith("/api/images/") && request.method === "GET") {
    const key = decodeURIComponent(path.slice("/api/images/".length));
    if (!isOwnedObjectKey(key, user.userId)) notFound();
    const obj = await env.BUCKET.get(key);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "image/png" } });
  }
  return new Response("Not found", { status: 404 });
}

async function handleProjects(
  request: Request,
  env: Env,
  session: Session | null,
  path: string,
  ok: Ok,
): Promise<Response> {
  const user = requireSession(session);
  if (path === "/api/projects" && request.method === "GET") {
    const r = await env.DB.prepare("SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC")
      .bind(user.userId).all();
    return ok(r.results);
  }
  if (path === "/api/projects" && request.method === "POST") {
    const { name, description, systemPrompt } = await parseJson<{ name?: string; description?: string; systemPrompt?: string }>(request);
    if (!name) return ok({ error: "name required" }, 400);
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO projects (id, name, description, system_prompt, user_id) VALUES (?, ?, ?, ?, ?)")
      .bind(id, name, description || "", systemPrompt || "", user.userId).run();
    return ok({ id, name });
  }
  if (path.startsWith("/api/projects/") && request.method === "GET") {
    const id = path.split("/")[3];
    const p = await env.DB.prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?")
      .bind(id, user.userId).first();
    if (!p) notFound();
    const convs = await env.DB.prepare("SELECT * FROM conversations WHERE project_id = ? AND user_id = ? ORDER BY updated_at DESC")
      .bind(id, user.userId).all();
    return ok({ project: p, conversations: convs.results });
  }
  if (path.startsWith("/api/projects/") && request.method === "DELETE") {
    const id = path.split("/")[3];
    const p = await env.DB.prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?")
      .bind(id, user.userId).first();
    if (!p) notFound();
    await env.DB.prepare("DELETE FROM projects WHERE id = ?").bind(id).run();
    return ok({ ok: true });
  }
  return new Response("Not found", { status: 404 });
}

async function handleConnectors(
  request: Request,
  env: Env,
  session: Session | null,
  path: string,
  url: URL,
  ok: Ok,
): Promise<Response> {
  if (path === "/api/connectors" && request.method === "GET") {
    return ok(getConnectorsByCategory(url.searchParams.get("category") || undefined));
  }
  if (path === "/api/connectors/installed" && request.method === "GET") {
    const user = requireSession(session);
    const r = await env.DB.prepare("SELECT * FROM mcp_connections WHERE user_id = ? ORDER BY created_at DESC")
      .bind(user.userId).all();
    return ok(r.results);
  }
  if (path === "/api/connectors/install" && request.method === "POST") {
    const user = requireSession(session);
    const { connectorId, name } = await parseJson<{ connectorId?: string; name?: string }>(request);
    const c = getConnector(String(connectorId || ""));
    if (!c) notFound();
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO mcp_connections (id, name, url, status, tools, user_id) VALUES (?, ?, ?, 'pending_auth', '[]', ?)")
      .bind(id, name || c.name, c.mcpUrl, user.userId).run();
    return ok({ id, connector: c, status: "pending_auth" });
  }
  if (path.startsWith("/api/connectors/") && request.method === "GET") {
    const c = getConnector(path.split("/")[3]);
    if (!c) notFound();
    return ok(c);
  }
  if (path.startsWith("/api/connectors/") && request.method === "DELETE") {
    const user = requireSession(session);
    const id = path.split("/")[3];
    const row = await env.DB.prepare("SELECT id FROM mcp_connections WHERE id = ? AND user_id = ?")
      .bind(id, user.userId).first();
    if (!row) notFound();
    await env.DB.prepare("DELETE FROM mcp_connections WHERE id = ?").bind(id).run();
    return ok({ ok: true });
  }
  return new Response("Not found", { status: 404 });
}

async function handlePlugins(
  request: Request,
  env: Env,
  session: Session | null,
  path: string,
  ok: Ok,
): Promise<Response> {
  const user = requireSession(session);
  if (path === "/api/plugins" && request.method === "GET") return ok(await getEnabledPlugins(env.DB, user.userId));
  if (path === "/api/plugins" && request.method === "POST") {
    const p = await parseJson<{ name?: string; description?: string; icon?: string; tools?: unknown; enabled?: boolean }>(request);
    if (!p.name || typeof p.name !== "string") return ok({ error: "name required" }, 400);
    if (p.tools && !Array.isArray(p.tools)) return ok({ error: "tools must be an array" }, 400);
    const id = await installPlugin(
      env.DB,
      { name: p.name, description: p.description, icon: p.icon, tools: p.tools, enabled: p.enabled },
      user.userId,
    );
    return ok({ id, ...p });
  }
  if (path.startsWith("/api/plugins/") && request.method === "PATCH") {
    const { enabled } = await parseJson<{ enabled?: boolean }>(request);
    const updated = await togglePlugin(env.DB, path.split("/")[3], Boolean(enabled), user.userId);
    if (!updated) notFound();
    return ok({ ok: true });
  }
  if (path.startsWith("/api/plugins/") && request.method === "DELETE") {
    const removed = await uninstallPlugin(env.DB, path.split("/")[3], user.userId);
    if (!removed) notFound();
    return ok({ ok: true });
  }
  return new Response("Not found", { status: 404 });
}

async function handleSandbox(
  request: Request,
  env: Env,
  session: Session | null,
  path: string,
  ok: Ok,
): Promise<Response> {
  const user = requireSession(session);
  const { getSandbox } = await import("@cloudflare/sandbox");
  const s = getSandbox(env.SANDBOX, user.userId);
  if (path === "/api/sandbox/exec" && request.method === "POST") {
    const { command, args } = await parseJson<{ command?: string; args?: string[] }>(request);
    if (!command || typeof command !== "string") return ok({ error: "command required" }, 400);
    const extra = Array.isArray(args) ? args.map(String) : [];
    const cmd = [command, ...extra].join(" ").trim();
    if (!cmd || cmd.length > 4000) return ok({ error: "command too long" }, 400);
    const r = await s.exec(cmd, { timeout: 30_000 });
    return ok({ stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode });
  }
  if (path === "/api/sandbox/write" && request.method === "POST") {
    const { path: fp, content } = await parseJson<{ path?: string; content?: string }>(request);
    if (!fp || typeof fp !== "string") return ok({ error: "path required" }, 400);
    await s.writeFile(fp, content ?? "");
    return ok({ ok: true });
  }
  if (path === "/api/sandbox/read" && request.method === "POST") {
    const { path: fp } = await parseJson<{ path?: string }>(request);
    if (!fp || typeof fp !== "string") return ok({ error: "path required" }, 400);
    return ok({ content: await s.readFile(fp) });
  }
  return new Response("Not found", { status: 404 });
}

async function handleBrowser(
  request: Request,
  env: Env,
  session: Session | null,
  path: string,
  ok: Ok,
): Promise<Response> {
  requireSession(session);
  const { url: t } = await parseJson<{ url?: string }>(request);
  const safe = assertPublicHttpUrl(t);
  if (path === "/api/browser/screenshot" && request.method === "POST") {
    const r = await (env.BROWSER as unknown as { quickAction: (a: string, o: { url: string }) => Promise<Response> })
      .quickAction("screenshot", { url: safe.toString() });
    return new Response(r.body, { headers: { "Content-Type": "image/png" } });
  }
  if (path === "/api/browser/markdown" && request.method === "POST") {
    const r = await (env.BROWSER as unknown as { quickAction: (a: string, o: { url: string }) => Promise<Response> })
      .quickAction("markdown", { url: safe.toString() });
    return new Response(r.body, { headers: { "Content-Type": "text/markdown" } });
  }
  return new Response("Not found", { status: 404 });
}

async function handleAuth(request: Request, env: Env, path: string, ok: Ok): Promise<Response> {
  if (path === "/api/auth/register" && request.method === "POST") {
    const { email, password } = await parseJson<{ email?: string; password?: string }>(request);
    if (!email || !password) return ok({ error: "email and password required" }, 400);
    const s = await registerUser(env, email, password);
    return ok({ token: s.token, userId: s.userId, email: s.email });
  }
  if (path === "/api/auth/login" && request.method === "POST") {
    const { email, password } = await parseJson<{ email?: string; password?: string }>(request);
    if (!email || !password) return ok({ error: "email and password required" }, 400);
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
  return new Response("Not found", { status: 404 });
}
