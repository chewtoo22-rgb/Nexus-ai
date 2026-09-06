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
import { createMission, getMission, listMissions, setMissionStatus, addMissionStep, setStepStatus, normalizeAgent, type MissionStatus } from "./missions";

export { NexusAgent, BuilderAgent, ResearcherAgent, CreativeAgent, AnalystAgent, RAGWorkflow, NexusMCP, NexusVoiceAgent, Sandbox };
export interface Env { AI: Ai; BROWSER: Fetcher; VECTORIZE: VectorizeIndex; DB: D1Database; BUCKET: R2Bucket; CACHE: KVNamespace; SESSIONS: KVNamespace; AI_SEARCH: any; NEXUS_AGENT: DurableObjectNamespace; BUILDER_AGENT: DurableObjectNamespace; RESEARCHER_AGENT: DurableObjectNamespace; CREATIVE_AGENT: DurableObjectNamespace; ANALYST_AGENT: DurableObjectNamespace; NEXUS_MCP: DurableObjectNamespace; VOICE_AGENT: DurableObjectNamespace; SANDBOX: DurableObjectNamespace; RAG_WORKFLOW: Workflow; DOC_QUEUE: Queue<any>; ASSETS: Fetcher; }
const AGENT_MAP = { nexus: "NEXUS_AGENT", sirius: "ANALYST_AGENT", ana: "BUILDER_AGENT", nova: "RESEARCHER_AGENT", creative: "CREATIVE_AGENT", builder: "BUILDER_AGENT", researcher: "RESEARCHER_AGENT", analyst: "ANALYST_AGENT" } as const;
const AGENT_PROMPTS: Record<string, string> = { nexus: "You are Nexus, a frontier-grade AI.", sirius: "You are Sirius, Mission Control and the primary orchestrator.", ana: "You are Ana, the autonomous Builder Agent.", nova: "You are Nova, the autonomous Research Agent.", creative: "You are the Creative Agent.", builder: "You are Ana, the autonomous Builder Agent.", researcher: "You are Nova, the autonomous Research Agent.", analyst: "You are Sirius, Mission Control and the primary orchestrator." };
const AUTH_PREFIXES = ["/api/sandbox", "/api/code/", "/api/tools/execute", "/api/documents", "/api/ingest", "/api/plugins", "/api/connectors/install", "/api/stats", "/api/missions"];
function needsAuth(path: string, method: string): boolean { if (AUTH_PREFIXES.some((p) => path === p || path.startsWith(p))) return true; if (path === "/api/conversations" && method === "GET") return true; if (path === "/api/artifacts" && method === "GET") return true; if (path.startsWith("/api/projects") && method !== "GET") return true; if (path.startsWith("/api/connectors/") && method === "DELETE") return true; return false; }
function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...extra } }); }
function httpError(err: unknown): Response { const message = err instanceof Error ? err.message : "Request failed"; const status = typeof (err as { status?: number })?.status === "number" ? (err as { status: number }).status : 400; return json({ error: message }, status); }
export default { async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> { const url = new URL(request.url); const path = url.pathname; if (!path.startsWith("/api/") && path !== "/mcp" && !path.startsWith("/voice")) { if (env.ASSETS) return env.ASSETS.fetch(request); return new Response("Static assets not configured. Add assets.directory in wrangler.jsonc.", { status: 503 }); } const clientIP = request.headers.get("CF-Connecting-IP") || "unknown"; const rl = await checkRateLimit(env, clientIP); const rlH = getRateLimitHeaders(rl); if (!rl.allowed) return json({ error: "Rate limit exceeded", remaining: 0 }, 429, { "Retry-After": String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))), ...rlH }); if (path === "/mcp" || path === "/mcp/") return env.NEXUS_MCP.get(env.NEXUS_MCP.idFromName("default")).fetch(request); if (path === "/voice" && request.headers.get("Upgrade") === "websocket") return env.VOICE_AGENT.get(env.VOICE_AGENT.idFromName("default")).fetch(request); if (path.startsWith("/api/agent/") && request.headers.get("Upgrade") === "websocket") { const agentType = path.split("/")[3]; const bindingName = AGENT_MAP[agentType as keyof typeof AGENT_MAP]; if (!bindingName) return new Response("Unknown agent", { status: 404 }); const agentId = url.searchParams.get("id") || "default"; return (env as any)[bindingName].get((env as any)[bindingName].idFromName(agentId)).fetch(request); } if (needsAuth(path, request.method)) { const session = await authenticateRequest(request, env); if (!session) return json({ error: "Authentication required" }, 401, rlH); } const ok = (data: unknown, status = 200) => json(data, status, rlH); try { return await handleApi(request, env, path, url, ok, rlH); } catch (err) { const res = httpError(err); const headers = new Headers(res.headers); for (const [k, v] of Object.entries(rlH)) headers.set(k, v); return new Response(res.body, { status: res.status, headers }); } }, async queue(batch: MessageBatch<any>, env: Env): Promise<void> { for (const m of batch.messages) { try { await env.RAG_WORKFLOW.create({ params: m.body }); m.ack(); } catch (e) { console.error(e); m.retry(); } } } } satisfies ExportedHandler<Env>;

async function handleApi(request: Request, env: Env, path: string, url: URL, ok: (data: unknown, status?: number) => Response, rlH: Record<string, string>): Promise<Response> {
  if (path === "/api/health") return ok({ name: "nexus-ai", version: "3.0.2", status: "online", agents: ["sirius", "ana", "nova", "creative"], features: ["mcp-server", "streaming", "sandbox", "connectors", "plugins", "voice", "auth", "rate-limiting", "projects", "mission-control"], models: { chat: Object.values(MODELS.chat), vision: Object.values(MODELS.vision), imageGen: Object.values(MODELS.imageGen) }, connectors: CONNECTORS.length, plugins: BUILTIN_PLUGINS.length });
  if (path === "/api/chat" && request.method === "POST") { const body = await parseJson<{ message?: string; agent?: string; sessionId?: string; model?: string; images?: string[]; stream?: boolean }>(request); const message = String(body.message || "").trim(); if (!message) return ok({ error: "message required" }, 400); const agentType = body.agent || "nexus"; const bindingName = AGENT_MAP[agentType as keyof typeof AGENT_MAP]; if (!bindingName) return ok({ error: "Unknown agent" }, 400); const modelKey = agentType === "sirius" ? "analyst" : agentType === "ana" ? "builder" : agentType === "nova" ? "researcher" : agentType; const selectedModel = body.model || AGENT_MODELS[modelKey as keyof typeof AGENT_MODELS].primary; const sid = body.sessionId || crypto.randomUUID(); if (body.stream) { const readable = new ReadableStream({ async start(controller) { await streamChat({ model: selectedModel, systemPrompt: AGENT_PROMPTS[agentType] || AGENT_PROMPTS.nexus, messages: [{ role: "user", content: message }], agentType: modelKey, env, onToken: (t) => sseSend(controller, "token", { token: t }), onToolCall: (tool, args) => sseSend(controller, "tool_call", { tool, args }), onToolResult: (tool, result) => sseSend(controller, "tool_result", { tool, result }), onArtifact: (a) => sseSend(controller, "artifact", a), onComplete: (fullText, usage) => { sseSend(controller, "done", { content: fullText, model: selectedModel, usage, sessionId: sid }); controller.close(); }, onError: (error) => { sseSend(controller, "error", { error }); controller.close(); } }); } }); return new Response(readable, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", ...rlH } }); } return (env as any)[bindingName].get((env as any)[bindingName].idFromName(sid)).fetch("https://do/chat", { method: "POST", body: JSON.stringify({ content: message, conversationId: sid, images: body.images, model: body.model }), headers: { "Content-Type": "application/json" } }); }
  if (path === "/api/missions" && request.method === "GET") return ok(await listMissions(env.DB));
  if (path === "/api/missions" && request.method === "POST") { const body = await parseJson<any>(request); const goal = String(body.goal || "").trim(); if (!goal) return ok({ error: "goal required" }, 400); const mission = await createMission(env.DB, goal, body.projectId || null); const rawSteps = Array.isArray(body.steps) ? body.steps : []; const steps = []; for (let i = 0; i < rawSteps.length; i++) { const step = rawSteps[i] || {}; if (!step.task) continue; steps.push(await addMissionStep(env.DB, mission.id, i, normalizeAgent(step.agent), String(step.title || `Step ${i + 1}`), String(step.task))); } if (steps.length) await setMissionStatus(env.DB, mission.id, "running"); return ok({ ...mission, status: steps.length ? "running" : mission.status, steps }, 201); }
  if (path.startsWith("/api/missions/") && path.endsWith("/status") && request.method === "PATCH") { const id = path.split("/")[3]; const body = await parseJson<any>(request); const status = String(body.status || "") as MissionStatus; if (!["queued", "planning", "running", "completed", "failed", "cancelled"].includes(status)) return ok({ error: "invalid status" }, 400); await setMissionStatus(env.DB, id, status, body.result ?? null, body.error ?? null); return ok(await getMission(env.DB, id)); }
  if (path.startsWith("/api/missions/") && path.endsWith("/steps") && request.method === "POST") { const id = path.split("/")[3]; const body = await parseJson<any>(request); if (!body.task) return ok({ error: "task required" }, 400); const current = await getMission(env.DB, id); const index = Number.isInteger(body.index) ? body.index : current.steps.length; const step = await addMissionStep(env.DB, id, index, normalizeAgent(body.agent), String(body.title || `Step ${index + 1}`), String(body.task)); await setMissionStatus(env.DB, id, "running"); return ok(step, 201); }
  if (path.startsWith("/api/missions/") && path.includes("/steps/") && path.endsWith("/status") && request.method === "PATCH") { const parts = path.split("/"); const stepId = parts[5]; const body = await parseJson<any>(request); const status = String(body.status || "") as any; if (!["queued", "running", "completed", "failed"].includes(status)) return ok({ error: "invalid step status" }, 400); await setStepStatus(env.DB, stepId, status, body.result ?? null); return ok({ ok: true }); }
  if (path.startsWith("/api/missions/") && request.method === "GET") return ok(await getMission(env.DB, path.split("/")[3]));
  if (path === "/api/conversations" && request.method === "GET") { const r = await env.DB.prepare("SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 100").all(); return ok(r.results); }
  if (path === "/api/conversations" && request.method === "POST") { const { agentType, title, projectId } = await parseJson<any>(request); const id = crypto.randomUUID(); await env.DB.prepare("INSERT INTO conversations (id, agent_type, title, project_id) VALUES (?, ?, ?, ?)").bind(id, agentType || "nexus", title || "New conversation", projectId || null).run(); return ok({ id }); }
  if (path.startsWith("/api/conversations/") && request.method === "GET") { const c = path.split("/")[3]; const conv = await env.DB.prepare("SELECT * FROM conversations WHERE id = ?").bind(c).first(); const msgs = await env.DB.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC").bind(c).all(); return ok({ conversation: conv, messages: msgs.results }); }
  if (path.startsWith("/api/conversations/") && request.method === "DELETE") { const session = await authenticateRequest(request, env); if (!session) return ok({ error: "Authentication required" }, 401); const c = path.split("/")[3]; await env.DB.prepare("DELETE FROM messages WHERE conversation_id = ?").bind(c).run(); await env.DB.prepare("DELETE FROM conversations WHERE id = ?").bind(c).run(); return ok({ ok: true }); }
  if (path === "/api/documents" && request.method === "POST") { const fd = await request.formData(); const file = fd.get("file") as File | null; if (!file) return ok({ error: "file required" }, 400); const id = crypto.randomUUID(); const key = `documents/${id}/${file.name}`; await env.BUCKET.put(key, file.stream()); await env.DB.prepare("INSERT INTO documents (id, source, source_key, title, status) VALUES (?, 'r2', ?, ?, 'pending')").bind(id, key, file.name).run(); await env.DOC_QUEUE.send({ documentId: id, source: "r2", sourceKey: key, title: file.name }); return ok({ documentId: id, status: "queued" }); }
  if (path === "/api/documents" && request.method === "GET") { const r = await env.DB.prepare("SELECT * FROM documents ORDER BY created_at DESC LIMIT 100").all(); return ok(r.results); }
  if (path === "/api/ingest" && request.method === "POST") { const { text, title } = await parseJson<any>(request); if (!text) return ok({ error: "text required" }, 400); const id = crypto.randomUUID(); const key = `documents/${id}/inline.txt`; await env.BUCKET.put(key, text); await env.DB.prepare("INSERT INTO documents (id, source, source_key, title, status) VALUES (?, 'upload', ?, ?, 'pending')").bind(id, key, title || "Inline text").run(); await env.DOC_QUEUE.send({ documentId: id, source: "r2", sourceKey: key, title: title || "Inline text" }); return ok({ documentId: id, status: "queued" }); }
  if (path === "/api/search" && request.method === "POST") { const { query } = await parseJson<any>(request); const emb = await env.AI.run(MODELS.embeddings.primary, { text: [query] }); const v = (emb as any).data?.[0] ?? []; const r = await env.VECTORIZE.query(v, { topK: 10, returnMetadata: "all" }); return ok({ query, results: r.matches ?? [] }); }
  if (path === "/api/ai-search" && request.method === "POST") { const { query } = await parseJson<any>(request); try { return ok(await env.AI_SEARCH.search({ query })); } catch { return ok({ error: "AI Search not configured" }, 502); } }
  if (path === "/api/artifacts" && request.method === "GET") { const cId = url.searchParams.get("conversationId"); if (cId) { const r = await env.DB.prepare("SELECT * FROM artifacts WHERE conversation_id = ? ORDER BY created_at DESC").bind(cId).all(); return ok(r.results); } const r = await env.DB.prepare("SELECT * FROM artifacts ORDER BY created_at DESC LIMIT 100").all(); return ok(r.results); }
  if (path.startsWith("/api/artifacts/") && request.method === "GET") { const a = await env.DB.prepare("SELECT * FROM artifacts WHERE id = ?").bind(path.split("/")[3]).first(); if (!a) return ok({ error: "Not found" }, 404); if (a.r2_key) { const obj = await env.BUCKET.get(a.r2_key as string); if (obj) return new Response(obj.body, { headers: { "Content-Type": "image/png" } }); } return ok(a); }
  if (path.startsWith("/api/images/") && request.method === "GET") { const obj = await env.BUCKET.get(path.slice("/api/images/".length)); if (!obj) return new Response("Not found", { status: 404 }); return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "image/png" } }); }
  if (path === "/api/models" && request.method === "GET") return ok({ chat: MODELS.chat, vision: MODELS.vision, imageGen: MODELS.imageGen, stt: MODELS.stt, tts: MODELS.tts, embeddings: MODELS.embeddings, agentModels: AGENT_MODELS });
  if (path === "/api/stats" && request.method === "GET") { const t = await env.DB.prepare("SELECT COUNT(*) as count, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens FROM usage").first(); const byA = await env.DB.prepare("SELECT agent_type, COUNT(*) as count, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens FROM usage GROUP BY agent_type").all(); return ok({ total: t, byAgent: byA.results }); }
  if (path === "/api/projects" && request.method === "GET") { const r = await env.DB.prepare("SELECT * FROM projects ORDER BY created_at DESC").all(); return ok(r.results); }
  if (path === "/api/projects" && request.method === "POST") { const { name, description, systemPrompt } = await parseJson<any>(request); if (!name) return ok({ error: "name required" }, 400); const id = crypto.randomUUID(); await env.DB.prepare("INSERT INTO projects (id, name, description, system_prompt) VALUES (?, ?, ?, ?)").bind(id, name, description || "", systemPrompt || "").run(); return ok({ id, name }); }
  if (path.startsWith("/api/projects/") && request.method === "GET") { const id = path.split("/")[3]; const p = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first(); if (!p) return ok({ error: "Not found" }, 404); const convs = await env.DB.prepare("SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC").bind(id).all(); return ok({ project: p, conversations: convs.results }); }
  if (path.startsWith("/api/projects/") && request.method === "DELETE") { await env.DB.prepare("DELETE FROM projects WHERE id = ?").bind(path.split("/")[3]).run(); return ok({ ok: true }); }
  if (path === "/api/connectors" && request.method === "GET") return ok(getConnectorsByCategory(url.searchParams.get("category") || undefined));
  if (path === "/api/connectors/installed" && request.method === "GET") { const r = await env.DB.prepare("SELECT * FROM mcp_connections ORDER BY created_at DESC").all(); return ok(r.results); }
  if (path === "/api/connectors/install" && request.method === "POST") { const { connectorId, name } = await parseJson<any>(request); const c = getConnector(connectorId); if (!c) return ok({ error: "Not found" }, 404); const id = crypto.randomUUID(); await env.DB.prepare("INSERT INTO mcp_connections (id, name, url, status, tools) VALUES (?, ?, ?, 'pending_auth', '[]')").bind(id, name || c.name, c.mcpUrl).run(); return ok({ id, connector: c, status: "pending_auth" }); }
  if (path.startsWith("/api/connectors/") && request.method === "GET") { const c = getConnector(path.split("/")[3]); if (!c) return ok({ error: "Not found" }, 404); return ok(c); }
  if (path.startsWith("/api/connectors/") && request.method === "DELETE") { await env.DB.prepare("DELETE FROM mcp_connections WHERE id = ?").bind(path.split("/")[3]).run(); return ok({ ok: true }); }
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

  if (path === "/api/plugins" && request.method === "POST") { const p = await parseJson<any>(request); const id = await installPlugin(env.DB, p); return ok({ id, ...p }); }
  if (path.startsWith("/api/plugins/") && request.method === "PATCH") { const { enabled } = await parseJson<any>(request); await togglePlugin(env.DB, path.split("/")[3], enabled); return ok({ ok: true }); }
  if (path.startsWith("/api/plugins/") && request.method === "DELETE") { await uninstallPlugin(env.DB, path.split("/")[3]); return ok({ ok: true }); }
  if (path === "/api/code/run" && request.method === "POST") { const { code, language } = await parseJson<any>(request); if (!code) return ok({ error: "code required" }, 400); return ok(await runCodeTool({ code, language }, env)); }
  if (path === "/api/sandbox/exec" && request.method === "POST") { const { command, args } = await parseJson<any>(request); if (!command || typeof command !== "string") return ok({ error: "command required" }, 400); const { getSandbox } = await import("@cloudflare/sandbox"); const s = getSandbox(env.SANDBOX, "default"); const r = await s.exec(command, args || []); return ok({ stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }); }
  if (path === "/api/sandbox/write" && request.method === "POST") { const { path: fp, content } = await parseJson<any>(request); if (!fp || typeof fp !== "string") return ok({ error: "path required" }, 400); const { getSandbox } = await import("@cloudflare/sandbox"); const s = getSandbox(env.SANDBOX, "default"); await s.writeFile(fp, content); return ok({ ok: true }); }
  if (path === "/api/sandbox/read" && request.method === "POST") { const { path: fp } = await parseJson<any>(request); if (!fp || typeof fp !== "string") return ok({ error: "path required" }, 400); const { getSandbox } = await import("@cloudflare/sandbox"); const s = getSandbox(env.SANDBOX, "default"); return ok({ content: await s.readFile(fp) }); }
  if (path === "/api/tools/execute" && request.method === "POST") { const { tool, args } = await parseJson<any>(request); if (!tool) return ok({ error: "tool required" }, 400); return ok(await executeTool(tool, args, env)); }
  if (path === "/api/browser/screenshot" && request.method === "POST") { const { url: t } = await parseJson<any>(request); const r = await (env.BROWSER as any).quickAction("screenshot", { url: t }); return new Response(r.body, { headers: { "Content-Type": "image/png" } }); }
  if (path === "/api/browser/markdown" && request.method === "POST") { const { url: t } = await parseJson<any>(request); const r = await (env.BROWSER as any).quickAction("markdown", { url: t }); return new Response(r.body, { headers: { "Content-Type": "text/markdown" } }); }
  if (path === "/api/auth/register" && request.method === "POST") { const { email, password } = await parseJson<any>(request); if (!email || !password) return ok({ error: "email and password required" }, 400); try { const s = await registerUser(env, email, password); return ok({ token: s.token, userId: s.userId, email: s.email }); } catch (err) { return httpError(err); } }
  if (path === "/api/auth/login" && request.method === "POST") { const { email, password } = await parseJson<any>(request); const s = await loginUser(env, email, password); if (!s) return ok({ error: "Invalid credentials" }, 401); return ok({ token: s.token, userId: s.userId, email: s.email }); }
  if (path === "/api/auth/me" && request.method === "GET") { const s = await authenticateRequest(request, env); if (!s) return ok({ error: "Not authenticated" }, 401); return ok({ userId: s.userId, email: s.email }); }
  if (path === "/api/auth/logout" && request.method === "POST") { const a = request.headers.get("Authorization"); if (a?.startsWith("Bearer ")) await deleteSession(env, a.slice(7)); return ok({ ok: true }); }
  return new Response("Not found", { status: 404, headers: rlH });
}
