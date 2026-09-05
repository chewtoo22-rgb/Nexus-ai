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
import { createSession, getSession, deleteSession, authenticateRequest, registerUser, loginUser } from "./auth";
import { checkRateLimit, getRateLimitHeaders } from "./rate-limit";

export { NexusAgent, BuilderAgent, ResearcherAgent, CreativeAgent, AnalystAgent, RAGWorkflow, NexusMCP, NexusVoiceAgent };

export interface Env {
  AI: Ai; BROWSER: Fetcher; VECTORIZE: VectorizeIndex; DB: D1Database; BUCKET: R2Bucket;
  CACHE: KVNamespace; SESSIONS: KVNamespace; AI_SEARCH: any;
  NEXUS_AGENT: DurableObjectNamespace; BUILDER_AGENT: DurableObjectNamespace; RESEARCHER_AGENT: DurableObjectNamespace;
  CREATIVE_AGENT: DurableObjectNamespace; ANALYST_AGENT: DurableObjectNamespace;
  NEXUS_MCP: DurableObjectNamespace; VOICE_AGENT: DurableObjectNamespace; SANDBOX: DurableObjectNamespace;
  RAG_WORKFLOW: Workflow; DOC_QUEUE: Queue<any>; ASSETS: Fetcher;
}

const AGENT_MAP = { nexus: "NEXUS_AGENT", builder: "BUILDER_AGENT", researcher: "RESEARCHER_AGENT", creative: "CREATIVE_AGENT", analyst: "ANALYST_AGENT" } as const;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url); const path = url.pathname;
    if (!path.startsWith("/api/") && path !== "/mcp" && !path.startsWith("/voice")) return env.ASSETS.fetch(request);
    if (path === "/mcp" || path === "/mcp/") { return env.NEXUS_MCP.get(env.NEXUS_MCP.idFromName("default")).fetch(request); }
    if (path === "/voice" && request.headers.get("Upgrade") === "websocket") { return env.VOICE_AGENT.get(env.VOICE_AGENT.idFromName("default")).fetch(request); }
    if (path.startsWith("/api/agent/") && request.headers.get("Upgrade") === "websocket") {
      const agentType = path.split("/")[3]; const bindingName = AGENT_MAP[agentType as keyof typeof AGENT_MAP];
      if (!bindingName) return new Response("Unknown agent", { status: 404 });
      const agentId = url.searchParams.get("id") || "default";
      return (env as any)[bindingName].get((env as any)[bindingName].idFromName(agentId)).fetch(request);
    }
    const clientIP = request.headers.get("CF-Connecting-IP") || "unknown";
    const rl = await checkRateLimit(env, clientIP); const rlH = getRateLimitHeaders(rl);
    const json = (d: any, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", ...rlH } });

    if (path === "/api/health") return json({ name: "nemotron-nexus", version: "3.0.0", status: "online", agents: Object.keys(AGENT_MAP), features: ["mcp-server", "streaming", "sandbox", "connectors", "plugins", "voice", "auth", "rate-limiting", "projects"], models: { chat: Object.values(MODELS.chat), vision: Object.values(MODELS.vision), imageGen: Object.values(MODELS.imageGen) }, connectors: CONNECTORS.length, plugins: BUILTIN_PLUGINS.length });

    if (path === "/api/chat" && request.method === "POST") {
      const { message, agent, sessionId, model, images, stream } = await request.json() as any;
      const agentType = agent || "nexus"; const bindingName = AGENT_MAP[agentType as keyof typeof AGENT_MAP];
      if (!bindingName) return json({ error: "Unknown agent" }, 400);
      const selectedModel = model || AGENT_MODELS[agentType as keyof typeof AGENT_MODELS].primary;
      const sid = sessionId || crypto.randomUUID();
      if (stream) {
        const readable = new ReadableStream({ async start(controller) {
          const sp: Record<string, string> = { nexus: "You are Nexus, a frontier-grade AI.", builder: "You are the Builder Agent.", researcher: "You are the Researcher Agent.", creative: "You are the Creative Agent.", analyst: "You are the Analyst Agent." };
          await streamChat({ model: selectedModel, systemPrompt: sp[agentType] || sp.nexus, messages: [{ role: "user", content: message }], agentType, env,
            onToken: (t) => sseSend(controller, "token", { token: t }), onToolCall: (tool, args) => sseSend(controller, "tool_call", { tool, args }),
            onToolResult: (tool, result) => sseSend(controller, "tool_result", { tool, result }), onArtifact: (a) => sseSend(controller, "artifact", a),
            onComplete: (fullText, usage) => { sseSend(controller, "done", { content: fullText, model: selectedModel, usage, sessionId: sid }); controller.close(); },
            onError: (error) => { sseSend(controller, "error", { error }); controller.close(); } });
        } });
        return new Response(readable, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", ...rlH } });
      }
      return (env as any)[bindingName].get((env as any)[bindingName].idFromName(sid)).fetch("https://do/chat", { method: "POST", body: JSON.stringify({ content: message, conversationId: sid, images, model }), headers: { "Content-Type": "application/json" } });
    }

    if (path === "/api/conversations" && request.method === "GET") { const r = await env.DB.prepare("SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 100").all(); return json(r.results); }
    if (path === "/api/conversations" && request.method === "POST") { const { agentType, title, projectId } = await request.json() as any; const id = crypto.randomUUID(); await env.DB.prepare("INSERT INTO conversations (id, agent_type, title, project_id) VALUES (?, ?, ?, ?)").bind(id, agentType || "nexus", title || "New conversation", projectId || null).run(); return json({ id }); }
    if (path.startsWith("/api/conversations/") && request.method === "GET") { const c = path.split("/")[3]; const conv = await env.DB.prepare("SELECT * FROM conversations WHERE id = ?").bind(c).first(); const msgs = await env.DB.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC").bind(c).all(); return json({ conversation: conv, messages: msgs.results }); }
    if (path.startsWith("/api/conversations/") && request.method === "DELETE") { const c = path.split("/")[3]; await env.DB.prepare("DELETE FROM messages WHERE conversation_id = ?").bind(c).run(); await env.DB.prepare("DELETE FROM conversations WHERE id = ?").bind(c).run(); return json({ ok: true }); }

    if (path === "/api/documents" && request.method === "POST") { const fd = await request.formData(); const file = fd.get("file") as File; if (!file) return json({ error: "file required" }, 400); const id = crypto.randomUUID(); const key = `documents/${id}/${file.name}`; await env.BUCKET.put(key, file.stream()); await env.DB.prepare("INSERT INTO documents (id, source, source_key, title, status) VALUES (?, 'r2', ?, ?, 'pending')").bind(id, key, file.name).run(); await env.DOC_QUEUE.send({ documentId: id, source: "r2", sourceKey: key, title: file.name }); return json({ documentId: id, status: "queued" }); }
    if (path === "/api/documents" && request.method === "GET") { const r = await env.DB.prepare("SELECT * FROM documents ORDER BY created_at DESC LIMIT 100").all(); return json(r.results); }
    if (path === "/api/ingest" && request.method === "POST") { const { text, title } = await request.json() as any; if (!text) return json({ error: "text required" }, 400); const id = crypto.randomUUID(); const key = `documents/${id}/inline.txt`; await env.BUCKET.put(key, text); await env.DB.prepare("INSERT INTO documents (id, source, source_key, title, status) VALUES (?, 'upload', ?, ?, 'pending')").bind(id, key, title || "Inline text").run(); await env.DOC_QUEUE.send({ documentId: id, source: "r2", sourceKey: key, title: title || "Inline text" }); return json({ documentId: id, status: "queued" }); }

    if (path === "/api/search" && request.method === "POST") { const { query } = await request.json() as any; const emb = await env.AI.run(MODELS.embeddings.primary, { text: [query] }); const v = (emb as any).data?.[0] ?? []; const r = await env.VECTORIZE.query(v, { topK: 10, returnMetadata: "all" }); return json({ query, results: r.matches ?? [] }); }
    if (path === "/api/ai-search" && request.method === "POST") { const { query } = await request.json() as any; try { return json(await env.AI_SEARCH.search({ query })); } catch { return json({ error: "AI Search not configured" }, 502); } }

    if (path === "/api/artifacts" && request.method === "GET") { const cId = url.searchParams.get("conversationId"); if (cId) { const r = await env.DB.prepare("SELECT * FROM artifacts WHERE conversation_id = ? ORDER BY created_at DESC").bind(cId).all(); return json(r.results); } const r = await env.DB.prepare("SELECT * FROM artifacts ORDER BY created_at DESC LIMIT 100").all(); return json(r.results); }
    if (path.startsWith("/api/artifacts/") && request.method === "GET") { const a = await env.DB.prepare("SELECT * FROM artifacts WHERE id = ?").bind(path.split("/")[3]).first(); if (!a) return json({ error: "Not found" }, 404); if (a.r2_key) { const obj = await env.BUCKET.get(a.r2_key as string); if (obj) return new Response(obj.body, { headers: { "Content-Type": "image/png" } }); } return json(a); }
    if (path.startsWith("/api/images/") && request.method === "GET") { const obj = await env.BUCKET.get(path.slice("/api/images/".length)); if (!obj) return new Response("Not found", { status: 404 }); return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "image/png" } }); }

    if (path === "/api/models" && request.method === "GET") return json({ chat: MODELS.chat, vision: MODELS.vision, imageGen: MODELS.imageGen, stt: MODELS.stt, tts: MODELS.tts, embeddings: MODELS.embeddings, agentModels: AGENT_MODELS });
    if (path === "/api/stats" && request.method === "GET") { const t = await env.DB.prepare("SELECT COUNT(*) as count, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens FROM usage").first(); const byA = await env.DB.prepare("SELECT agent_type, COUNT(*) as count, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens FROM usage GROUP BY agent_type").all(); return json({ total: t, byAgent: byA.results }); }

    if (path === "/api/projects" && request.method === "GET") { const r = await env.DB.prepare("SELECT * FROM projects ORDER BY created_at DESC").all(); return json(r.results); }
    if (path === "/api/projects" && request.method === "POST") { const { name, description, systemPrompt } = await request.json() as any; const id = crypto.randomUUID(); await env.DB.prepare("INSERT INTO projects (id, name, description, system_prompt) VALUES (?, ?, ?, ?)").bind(id, name, description || "", systemPrompt || "").run(); return json({ id, name }); }
    if (path.startsWith("/api/projects/") && request.method === "GET") { const p = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(path.split("/")[3]).first(); if (!p) return json({ error: "Not found" }, 404); const convs = await env.DB.prepare("SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC").bind(path.split("/")[3]).all(); return json({ project: p, conversations: convs.results }); }
    if (path.startsWith("/api/projects/") && request.method === "DELETE") { await env.DB.prepare("DELETE FROM projects WHERE id = ?").bind(path.split("/")[3]).run(); return json({ ok: true }); }

    if (path === "/api/connectors" && request.method === "GET") return json(getConnectorsByCategory(url.searchParams.get("category") || undefined));
    if (path.startsWith("/api/connectors/") && request.method === "GET") { const c = getConnector(path.split("/")[3]); if (!c) return json({ error: "Not found" }, 404); return json(c); }
    if (path === "/api/connectors/install" && request.method === "POST") { const { connectorId, name } = await request.json() as any; const c = getConnector(connectorId); if (!c) return json({ error: "Not found" }, 404); const id = crypto.randomUUID(); await env.DB.prepare("INSERT INTO mcp_connections (id, name, url, status, tools) VALUES (?, ?, ?, 'connected', '[]')").bind(id, name || c.name, c.mcpUrl).run(); return json({ id, connector: c, status: "connected" }); }
    if (path.startsWith("/api/connectors/") && request.method === "DELETE") { await env.DB.prepare("DELETE FROM mcp_connections WHERE id = ?").bind(path.split("/")[3]).run(); return json({ ok: true }); }
    if (path === "/api/connectors/installed" && request.method === "GET") { const r = await env.DB.prepare("SELECT * FROM mcp_connections ORDER BY created_at DESC").all(); return json(r.results); }

    if (path === "/api/plugins" && request.method === "GET") { return json(await getEnabledPlugins(env.DB)); }
    if (path === "/api/plugins" && request.method === "POST") { const p = await request.json() as any; const id = await installPlugin(env.DB, p); return json({ id, ...p }); }
    if (path.startsWith("/api/plugins/") && request.method === "PATCH") { const { enabled } = await request.json() as any; await togglePlugin(env.DB, path.split("/")[3], enabled); return json({ ok: true }); }
    if (path.startsWith("/api/plugins/") && request.method === "DELETE") { await uninstallPlugin(env.DB, path.split("/")[3]); return json({ ok: true }); }

    if (path === "/api/code/run" && request.method === "POST") { const { code, language } = await request.json() as any; return json(await runCodeTool({ code, language }, env)); }
    if (path === "/api/sandbox/exec" && request.method === "POST") { const { command, args } = await request.json() as any; const { getSandbox } = await import("@cloudflare/sandbox"); const s = getSandbox(env.SANDBOX, "default"); const r = await s.exec(command, args || []); return json({ stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }); }
    if (path === "/api/sandbox/write" && request.method === "POST") { const { path: fp, content } = await request.json() as any; const { getSandbox } = await import("@cloudflare/sandbox"); const s = getSandbox(env.SANDBOX, "default"); await s.writeFile(fp, content); return json({ ok: true }); }
    if (path === "/api/sandbox/read" && request.method === "POST") { const { path: fp } = await request.json() as any; const { getSandbox } = await import("@cloudflare/sandbox"); const s = getSandbox(env.SANDBOX, "default"); return json({ content: await s.readFile(fp) }); }

    if (path === "/api/tools/execute" && request.method === "POST") { const { tool, args } = await request.json() as any; return json(await executeTool(tool, args, env)); }
    if (path === "/api/browser/screenshot" && request.method === "POST") { const { url: t } = await request.json() as any; const r = await (env.BROWSER as any).quickAction("screenshot", { url: t }); return new Response(r.body, { headers: { "Content-Type": "image/png" } }); }
    if (path === "/api/browser/markdown" && request.method === "POST") { const { url: t } = await request.json() as any; const r = await (env.BROWSER as any).quickAction("markdown", { url: t }); return new Response(r.body, { headers: { "Content-Type": "text/markdown" } }); }

    if (path === "/api/auth/register" && request.method === "POST") { const { email, password } = await request.json() as any; if (!email || !password) return json({ error: "email and password required" }, 400); try { const s = await registerUser(env, email, password); return json({ token: s.token, userId: s.userId, email: s.email }); } catch { return json({ error: "Registration failed" }, 400); } }
    if (path === "/api/auth/login" && request.method === "POST") { const { email, password } = await request.json() as any; const s = await loginUser(env, email, password); if (!s) return json({ error: "Invalid credentials" }, 401); return json({ token: s.token, userId: s.userId, email: s.email }); }
    if (path === "/api/auth/me" && request.method === "GET") { const s = await authenticateRequest(request, env); if (!s) return json({ error: "Not authenticated" }, 401); return json({ userId: s.userId, email: s.email }); }
    if (path === "/api/auth/logout" && request.method === "POST") { const a = request.headers.get("Authorization"); if (a?.startsWith("Bearer ")) await deleteSession(env, a.slice(7)); return json({ ok: true }); }

    return new Response("Not found", { status: 404 });
  },
  async queue(batch: MessageBatch<any>, env: Env): Promise<void> { for (const m of batch.messages) { try { await env.RAG_WORKFLOW.create({ params: m.body }); m.ack(); } catch (e) { console.error(e); m.retry(); } } },
} satisfies ExportedHandler<Env>;
