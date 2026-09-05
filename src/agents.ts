import { Agent } from "agents";
import { getToolsForAgent } from "./tools";
import { AGENT_MODELS } from "./models";
import { executeTool } from "./tool-executor";
import { streamChat } from "./streaming";

const NEXUS_PROMPT = `You are Nexus, a frontier-grade AI comparable to Claude and GPT. Capabilities: text generation, reasoning, coding, vision, browser, web search, RAG, image gen, translation, speech, artifacts, memory, MCP. Be concise but thorough.`;
const BUILDER_PROMPT = `You are the Builder Agent — world-class software engineer and vibe coder. Full-stack app building, coding, debugging, artifacts with live previews, Cloudflare Workers. Always create artifacts for code. Write production-quality code.`;
const RESEARCHER_PROMPT = `You are the Researcher Agent — deep research specialist. Finding and synthesizing information, reading web pages, competitive analysis, fact-checking, long-context (1M tokens). Always cite sources.`;
const CREATIVE_PROMPT = `You are the Creative Agent — creative AI for content, design, multimedia. Image gen, creative writing, visual design, SVG, multilingual, TTS. Always create artifacts for visual content.`;
const ANALYST_PROMPT = `You are the Analyst Agent — data analysis and strategy specialist. Data interpretation, BI, market analysis, technical evaluation. Provide structured, evidence-based analysis.`;

export class NexusAgent extends Agent { systemPrompt = NEXUS_PROMPT; agentType = "nexus"; models = AGENT_MODELS.nexus;
  async onConnect(c: any) { c.send(JSON.stringify({ type: "agent_connected", agent: this.agentType, model: this.models.primary })); }
  async onMessage(c: any, m: WSMessage) { await handleAgentMessage(this, c, m); } }
export class BuilderAgent extends Agent { systemPrompt = BUILDER_PROMPT; agentType = "builder"; models = AGENT_MODELS.builder;
  async onConnect(c: any) { c.send(JSON.stringify({ type: "agent_connected", agent: this.agentType, model: this.models.primary })); }
  async onMessage(c: any, m: WSMessage) { await handleAgentMessage(this, c, m); } }
export class ResearcherAgent extends Agent { systemPrompt = RESEARCHER_PROMPT; agentType = "researcher"; models = AGENT_MODELS.researcher;
  async onConnect(c: any) { c.send(JSON.stringify({ type: "agent_connected", agent: this.agentType, model: this.models.primary })); }
  async onMessage(c: any, m: WSMessage) { await handleAgentMessage(this, c, m); } }
export class CreativeAgent extends Agent { systemPrompt = CREATIVE_PROMPT; agentType = "creative"; models = AGENT_MODELS.creative;
  async onConnect(c: any) { c.send(JSON.stringify({ type: "agent_connected", agent: this.agentType, model: this.models.primary })); }
  async onMessage(c: any, m: WSMessage) { await handleAgentMessage(this, c, m); } }
export class AnalystAgent extends Agent { systemPrompt = ANALYST_PROMPT; agentType = "analyst"; models = AGENT_MODELS.analyst;
  async onConnect(c: any) { c.send(JSON.stringify({ type: "agent_connected", agent: this.agentType, model: this.models.primary })); }
  async onMessage(c: any, m: WSMessage) { await handleAgentMessage(this, c, m); } }

async function handleAgentMessage(agent: any, conn: any, message: WSMessage) {
  const msg = typeof message === "string" ? JSON.parse(message) : message;
  if (msg.type === "chat") {
    const { content, conversationId, images, model, stream } = msg;
    const history = (agent.state.history || []) as any[];
    const tools = getToolsForAgent(agent.agentType);
    const selectedModel = model || agent.models.primary;
    const messages: any[] = [{ role: "system", content: agent.systemPrompt }, ...history.slice(-20)];
    if (images?.length) { messages.push({ role: "user", content: [{ type: "text", text: content }, ...images.map((u: string) => ({ type: "image_url", image_url: { url: u } }))] }); }
    else { messages.push({ role: "user", content }); }

    if (stream) {
      let fullText = ""; let allArtifacts: any[] = []; const start = Date.now();
      await streamChat({
        model: selectedModel, systemPrompt: agent.systemPrompt, messages: messages.slice(1), agentType: agent.agentType, env: agent.env,
        onToken: (t) => { fullText += t; conn.send(JSON.stringify({ type: "stream_token", token: t })); },
        onToolCall: (tool, args) => conn.send(JSON.stringify({ type: "tool_call", tool, args })),
        onToolResult: (tool, result) => conn.send(JSON.stringify({ type: "tool_result", tool, result: result.slice(0, 500) })),
        onArtifact: (a) => { allArtifacts.push(a); conn.send(JSON.stringify({ type: "artifact", artifact: a })); },
        onComplete: async (fullText, usage) => {
          const latency = Date.now() - start;
          agent.state.history = [...history, { role: "user", content }, { role: "assistant", content: fullText }].slice(-40);
          if (conversationId) {
            await agent.env.DB.prepare("INSERT INTO messages (id, conversation_id, role, content, model, agent_type, tokens_in, tokens_out, latency_ms, artifacts) VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), conversationId, fullText, selectedModel, agent.agentType, usage.input_tokens, usage.output_tokens, latency, allArtifacts.length ? JSON.stringify(allArtifacts) : null).run();
            await agent.env.DB.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").bind(conversationId).run();
          }
          conn.send(JSON.stringify({ type: "response", content: fullText, model: selectedModel, agent: agent.agentType, latency_ms: latency, artifacts: allArtifacts, usage, streamed: true }));
        },
        onError: (error) => conn.send(JSON.stringify({ type: "error", error })),
      });
      return;
    }

    let maxRounds = 5; let currentMessages = messages; let allArtifacts: any[] = [];
    while (maxRounds-- > 0) {
      const start = Date.now();
      const result = await agent.env.AI.run(selectedModel, { messages: currentMessages, tools: tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })), max_tokens: 4096, temperature: 0.7 });
      const latency = Date.now() - start;
      const toolCalls = (result as any).tool_calls || (result as any).toolCalls;
      if (toolCalls && toolCalls.length > 0) {
        const toolResults: any[] = [];
        for (const tc of toolCalls) {
          const fnName = tc.function?.name || tc.name;
          const fnArgs = typeof tc.function?.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function?.arguments || tc.arguments || {};
          conn.send(JSON.stringify({ type: "tool_call", tool: fnName, args: fnArgs }));
          const tr = await executeTool(fnName, fnArgs, agent.env, agent);
          if (tr.artifact) { allArtifacts.push(tr.artifact); conn.send(JSON.stringify({ type: "artifact", artifact: tr.artifact })); }
          toolResults.push({ role: "tool", name: fnName, content: tr.result, tool_call_id: tc.id });
          conn.send(JSON.stringify({ type: "tool_result", tool: fnName, result: tr.result.slice(0, 500) }));
        }
        currentMessages = [...currentMessages, { role: "assistant", content: (result as any).response || "", tool_calls: toolCalls }, ...toolResults];
        continue;
      }
      const responseText = (result as any).response || "";
      agent.state.history = [...history, { role: "user", content }, { role: "assistant", content: responseText }].slice(-40);
      if (conversationId) {
        await agent.env.DB.prepare("INSERT INTO messages (id, conversation_id, role, content, model, agent_type, tokens_in, tokens_out, latency_ms, artifacts) VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), conversationId, responseText, selectedModel, agent.agentType, (result as any).usage?.prompt_tokens || 0, (result as any).usage?.completion_tokens || 0, latency, allArtifacts.length ? JSON.stringify(allArtifacts) : null).run();
        await agent.env.DB.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").bind(conversationId).run();
      }
      conn.send(JSON.stringify({ type: "response", content: responseText, model: selectedModel, agent: agent.agentType, latency_ms: latency, artifacts: allArtifacts, usage: { input_tokens: (result as any).usage?.prompt_tokens || 0, output_tokens: (result as any).usage?.completion_tokens || 0 } }));
      return;
    }
    conn.send(JSON.stringify({ type: "error", error: "Maximum tool calling rounds exceeded" }));
  }
  if (msg.type === "clear") { agent.state.history = []; conn.send(JSON.stringify({ type: "cleared" })); }
  if (msg.type === "history") { conn.send(JSON.stringify({ type: "history", messages: agent.state.history || [] })); }
}
