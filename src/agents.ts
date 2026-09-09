import { Agent, type ConnectionContext, type WSMessage } from "agents";
import { authenticateRequest } from "./auth";
import { AGENT_MODELS } from "./models";
import { persistTurn } from "./persist";
import { streamChat } from "./streaming";
import { executeTool } from "./tool-executor";
import { getToolsForAgent } from "./tools";

const CORE = `You are a frontier-grade AI agent. Optimize for correctness, useful action, and efficient reasoning. Classify the task internally before acting. Use tools when they materially improve accuracy or capability. Never invent facts, tool results, citations, files, or completed actions. For complex tasks, check constraints, alternatives, risks, and verification before answering. Keep private reasoning hidden; expose concise conclusions, evidence, assumptions, and actionable steps. Avoid filler and unnecessary questions. Preserve important context and verify changing facts when tools can resolve uncertainty.`;
export const NEXUS_PROMPT = `${CORE}\nYou are Nexus, the primary AI interface. Coordinate reasoning, tools, coding, browser/search, vision, artifacts, MCP, and specialist agents.`;
export const BUILDER_PROMPT = `${CORE}\nYou are Ana, the autonomous Builder Agent. You are a senior software architect and implementation engineer. Inspect existing code before changing it, preserve working behavior, fix root causes, reduce complexity, and produce production-quality implementations. Prefer small verifiable changes over speculative rewrites.`;
export const RESEARCHER_PROMPT = `${CORE}\nYou are Nova, the autonomous Research Agent. Gather primary sources when possible, cross-check important claims, distinguish facts from inference, and synthesize findings. For current information, verify freshness instead of relying on memory.`;
export const CREATIVE_PROMPT = `${CORE}\nYou are the Creative Agent. Turn rough ideas into polished visual, written, audio, and multimedia outputs. Follow constraints precisely and favor intentional design over decorative noise.`;
export const ANALYST_PROMPT = `${CORE}\nYou are Sirius, Mission Control and the primary orchestrator. Turn goals into executable missions, decompose work into verifiable steps, coordinate Ana and Nova in parallel when useful, track state, recover from failures, and never claim completion without verification.`;

export const AGENT_SYSTEM_PROMPTS: Record<string, string> = {
  nexus: NEXUS_PROMPT,
  builder: BUILDER_PROMPT,
  researcher: RESEARCHER_PROMPT,
  creative: CREATIVE_PROMPT,
  analyst: ANALYST_PROMPT,
  ana: BUILDER_PROMPT,
  nova: RESEARCHER_PROMPT,
  sirius: ANALYST_PROMPT,
};

type AgentLike = Agent & { systemPrompt: string; agentType: string; models: typeof AGENT_MODELS.nexus; state: any; env: any };

export class NexusAgent extends Agent {
  systemPrompt = NEXUS_PROMPT;
  agentType = "nexus";
  models = AGENT_MODELS.nexus;
  async onConnect(c: any, ctx: ConnectionContext) { await connectAgent(this as any, c, ctx); }
  async onMessage(c: any, m: WSMessage) { await handleAgentMessage(this as any, c, m); }
}
export class BuilderAgent extends Agent {
  systemPrompt = BUILDER_PROMPT;
  agentType = "builder";
  models = AGENT_MODELS.builder;
  async onConnect(c: any, ctx: ConnectionContext) { await connectAgent(this as any, c, ctx); }
  async onMessage(c: any, m: WSMessage) { await handleAgentMessage(this as any, c, m); }
}
export class ResearcherAgent extends Agent {
  systemPrompt = RESEARCHER_PROMPT;
  agentType = "researcher";
  models = AGENT_MODELS.researcher;
  async onConnect(c: any, ctx: ConnectionContext) { await connectAgent(this as any, c, ctx); }
  async onMessage(c: any, m: WSMessage) { await handleAgentMessage(this as any, c, m); }
}
export class CreativeAgent extends Agent {
  systemPrompt = CREATIVE_PROMPT;
  agentType = "creative";
  models = AGENT_MODELS.creative;
  async onConnect(c: any, ctx: ConnectionContext) { await connectAgent(this as any, c, ctx); }
  async onMessage(c: any, m: WSMessage) { await handleAgentMessage(this as any, c, m); }
}
export class AnalystAgent extends Agent {
  systemPrompt = ANALYST_PROMPT;
  agentType = "analyst";
  models = AGENT_MODELS.analyst;
  async onConnect(c: any, ctx: ConnectionContext) { await connectAgent(this as any, c, ctx); }
  async onMessage(c: any, m: WSMessage) { await handleAgentMessage(this as any, c, m); }
}

async function connectAgent(agent: AgentLike, conn: any, context: ConnectionContext): Promise<void> {
  const session = await authenticateRequest(context.request, agent.env);
  if (!session) {
    conn.close(1008, "Authentication required");
    return;
  }
  agent.state = { ...(agent.state || {}), userId: session.userId, history: agent.state?.history || [] };
  conn.send(JSON.stringify({ type: "agent_connected", agent: agent.agentType, model: agent.models.primary }));
}

async function handleAgentMessage(agent: AgentLike, conn: any, message: WSMessage) {
  const userId = agent.state?.userId as string | undefined;
  if (!userId) {
    conn.send(JSON.stringify({ type: "error", error: "Authentication required" }));
    return;
  }

  let msg: any;
  try { msg = typeof message === "string" ? JSON.parse(message) : message; }
  catch { conn.send(JSON.stringify({ type: "error", error: "Invalid message" })); return; }

  if (msg.type === "clear") { agent.state = { ...(agent.state || {}), history: [] }; conn.send(JSON.stringify({ type: "cleared" })); return; }
  if (msg.type === "history") { conn.send(JSON.stringify({ type: "history", messages: agent.state?.history || [] })); return; }
  if (msg.type !== "chat") return;

  const { content, conversationId, images, model } = msg;
  if (!content || typeof content !== "string") { conn.send(JSON.stringify({ type: "error", error: "content required" })); return; }
  const history = (agent.state?.history || []) as Array<{ role: string; content: unknown }>;
  const selectedModel = model || agent.models.primary;
  const allArtifacts: any[] = [];
  const start = Date.now();

  await streamChat({
    model: selectedModel,
    systemPrompt: agent.systemPrompt,
    messages: [
      ...history.slice(-24),
      images?.length
        ? { role: "user", content: [{ type: "text", text: content }, ...images.map((u: string) => ({ type: "image_url", image_url: { url: u } }))] }
        : { role: "user", content },
    ],
    agentType: agent.agentType,
    env: agent.env,
    userId,
    onToken: (t) => conn.send(JSON.stringify({ type: "stream_token", token: t })),
    onToolCall: (toolName, args) => conn.send(JSON.stringify({ type: "tool_call", tool: toolName, args })),
    onToolResult: (toolName, result) => conn.send(JSON.stringify({ type: "tool_result", tool: toolName, result: String(result).slice(0, 500) })),
    onArtifact: (a) => { allArtifacts.push(a); conn.send(JSON.stringify({ type: "artifact", artifact: a })); },
    onComplete: async (fullText, usage) => {
      const latency = Date.now() - start;
      agent.state = { ...(agent.state || {}), history: [...history, { role: "user", content }, { role: "assistant", content: fullText }].slice(-48) };
      await persistTurn(agent.env, conversationId, content, fullText, selectedModel, agent.agentType, usage, latency, allArtifacts, userId);
      conn.send(JSON.stringify({ type: "response", content: fullText, model: selectedModel, agent: agent.agentType, latency_ms: latency, artifacts: allArtifacts, usage, streamed: true }));
    },
    onError: async (error) => {
      try {
        await fallbackToolLoop(agent, conn, content, conversationId, images, selectedModel, history, userId, allArtifacts, start);
      } catch {
        conn.send(JSON.stringify({ type: "error", error: String(error) }));
      }
    },
  });
}

async function fallbackToolLoop(
  agent: AgentLike,
  conn: any,
  content: string,
  conversationId: string | undefined,
  images: string[] | undefined,
  selectedModel: string,
  history: Array<{ role: string; content: unknown }>,
  userId: string,
  allArtifacts: any[],
  start: number,
) {
    const tools = getToolsForAgent(agent.agentType, { authenticated: true });
  let currentMessages: any[] = [
    { role: "system", content: agent.systemPrompt },
    ...history.slice(-24),
    images?.length
      ? { role: "user", content: [{ type: "text", text: content }, ...images.map((u: string) => ({ type: "image_url", image_url: { url: u } }))] }
      : { role: "user", content },
  ];
  let rounds = 5;
  while (rounds-- > 0) {
    const result = await agent.env.AI.run(selectedModel, {
      messages: currentMessages,
      tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
      max_tokens: 4096,
      temperature: 0.4,
    });
    const latency = Date.now() - start;
    const toolCalls = (result as any).tool_calls || (result as any).toolCalls;
    if (toolCalls?.length) {
      const toolResults: any[] = [];
      for (const tc of toolCalls) {
        const fnName = tc.function?.name || tc.name;
        let fnArgs: any;
        try { fnArgs = typeof tc.function?.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function?.arguments || tc.arguments || {}; }
        catch { conn.send(JSON.stringify({ type: "error", error: "Invalid tool arguments" })); return; }
        conn.send(JSON.stringify({ type: "tool_call", tool: fnName, args: fnArgs }));
        const tr = await executeTool(fnName, fnArgs, agent.env, { storage: (agent as any).storage, userId });
        if (tr.artifact) { allArtifacts.push(tr.artifact); conn.send(JSON.stringify({ type: "artifact", artifact: tr.artifact })); }
        const text = String(tr.result ?? "");
        toolResults.push({ role: "tool", name: fnName, content: text, tool_call_id: tc.id });
        conn.send(JSON.stringify({ type: "tool_result", tool: fnName, result: text.slice(0, 500) }));
      }
      currentMessages = [...currentMessages, { role: "assistant", content: (result as any).response || "", tool_calls: toolCalls }, ...toolResults];
      continue;
    }
    const responseText = (result as any).response || "";
    agent.state = { ...(agent.state || {}), history: [...history, { role: "user", content }, { role: "assistant", content: responseText }].slice(-48) };
    const usage = { input_tokens: (result as any).usage?.prompt_tokens || 0, output_tokens: (result as any).usage?.completion_tokens || 0 };
    await persistTurn(agent.env, conversationId, content, responseText, selectedModel, agent.agentType, usage, latency, allArtifacts, userId);
    conn.send(JSON.stringify({ type: "response", content: responseText, model: selectedModel, agent: agent.agentType, latency_ms: latency, artifacts: allArtifacts, usage }));
    return;
  }
  conn.send(JSON.stringify({ type: "error", error: "Maximum tool calling rounds exceeded" }));
}
