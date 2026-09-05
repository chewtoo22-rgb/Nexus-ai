import { streamText } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { getToolsForAgent } from "./tools";
import { executeTool } from "./tool-executor";

export interface StreamConfig {
  model: string; systemPrompt: string; messages: any[]; tools?: any[]; agentType: string; env: any;
  onToken?: (t: string) => void; onToolCall?: (t: string, a: any) => void; onToolResult?: (t: string, r: string) => void; onArtifact?: (a: any) => void; onComplete?: (t: string, u: any) => void; onError?: (e: string) => void;
}

export async function streamChat(config: StreamConfig): Promise<void> {
  const workersai = createWorkersAI({ binding: config.env.AI });
  const tools = config.tools || getToolsForAgent(config.agentType);
  try {
    const result = streamText({
      model: workersai(config.model), system: config.systemPrompt, messages: config.messages,
      tools: tools.map(t => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } })),
      maxTokens: 4096, temperature: 0.7,
      onError: ({ error }) => config.onError?.(String(error)),
    });
    let fullText = "";
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta": fullText += part.textDelta; config.onToken?.(part.textDelta); break;
        case "tool-call": config.onToolCall?.(part.toolName, part.input); const tr = await executeTool(part.toolName, part.input, config.env); if (tr.artifact) config.onArtifact?.(tr.artifact); config.onToolResult?.(part.toolName, tr.result.slice(0, 500)); break;
        case "error": config.onError?.(String(part.error)); break;
        case "finish": config.onComplete?.(fullText, { input_tokens: part.usage?.promptTokens || 0, output_tokens: part.usage?.completionTokens || 0 }); break;
      }
    }
  } catch (err) {
    config.onError?.(`Streaming failed: ${String(err)}`);
    try {
      const result = await config.env.AI.run(config.model, { messages: config.messages, tools: tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })), max_tokens: 4096, temperature: 0.7 });
      const responseText = (result as any).response || "";
      config.onToken?.(responseText);
      config.onComplete?.(responseText, { input_tokens: (result as any).usage?.prompt_tokens || 0, output_tokens: (result as any).usage?.completion_tokens || 0 });
    } catch (e) { config.onError?.(`Fallback failed: ${String(e)}`); }
  }
}

export function sseSend(controller: ReadableStreamDefaultController, event: string, data: any): void {
  controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}
