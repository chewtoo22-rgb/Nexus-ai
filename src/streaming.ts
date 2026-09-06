import { streamText } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { getToolsForAgent } from "./tools";
import { executeTool } from "./tool-executor";

export interface StreamConfig {
  model: string;
  systemPrompt: string;
  messages: any[];
  tools?: any[];
  agentType: string;
  env: any;
  onToken?: (t: string) => void;
  onToolCall?: (t: string, a: any) => void;
  onToolResult?: (t: string, r: string) => void;
  onArtifact?: (a: any) => void;
  onComplete?: (t: string, u: any) => void;
  onError?: (e: string) => void;
}

/**
 * Streams a chat completion with tool calling support and fallback to non-streaming on error.
 * Handles text deltas, tool calls, artifacts, and usage reporting via callbacks.
 * @param config Configuration object with model, messages, tools, and event callbacks.
 */
export async function streamChat(config: StreamConfig): Promise<void> {
  const workersai = createWorkersAI({ binding: config.env.AI });
  const tools = config.tools || getToolsForAgent(config.agentType);
  try {
    const result = streamText({
      model: workersai(config.model),
      system: config.systemPrompt,
      messages: config.messages,
      tools: tools.map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      maxTokens: 4096,
      temperature: 0.7,
      onError: ({ error }) => config.onError?.(String(error)),
    });
    let fullText = "";
    let completed = false;
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          fullText += (part as any).textDelta ?? (part as any).text ?? "";
          config.onToken?.((part as any).textDelta ?? (part as any).text ?? "");
          break;
        case "tool-call": {
          const toolName = (part as any).toolName;
          const input = (part as any).input ?? (part as any).args;
          config.onToolCall?.(toolName, input);
          const tr = await executeTool(toolName, input, config.env);
          if (tr.artifact) config.onArtifact?.(tr.artifact);
          config.onToolResult?.(toolName, tr.result.slice(0, 500));
          break;
        }
        case "error":
          config.onError?.(String((part as any).error));
          break;
        case "finish":
          completed = true;
          config.onComplete?.(fullText, {
            input_tokens: (part as any).usage?.promptTokens || (part as any).usage?.inputTokens || 0,
            output_tokens: (part as any).usage?.completionTokens || (part as any).usage?.outputTokens || 0,
          });
          break;
      }
    }
    if (!completed) config.onComplete?.(fullText, { input_tokens: 0, output_tokens: 0 });
  } catch (err) {
    config.onError?.(`Streaming failed: ${String(err)}`);
    try {
      const result = await config.env.AI.run(config.model, {
        messages: config.messages,
        tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
        max_tokens: 4096,
        temperature: 0.7,
      });
      const responseText = (result as any).response || "";
      config.onToken?.(responseText);
      config.onComplete?.(responseText, {
        input_tokens: (result as any).usage?.prompt_tokens || 0,
        output_tokens: (result as any).usage?.completion_tokens || 0,
      });
    } catch (e) {
      config.onError?.(`Fallback failed: ${String(e)}`);
    }
  }
}

/**
 * Sends a Server-Sent Event (SSE) message to the stream controller.
 * @param controller The ReadableStream controller.
 * @param event The event type name.
 * @param data The data payload to include in the event.
 */
export function sseSend(controller: ReadableStreamDefaultController, event: string, data: Record<string, unknown>): void {
  const payload = { type: event, ...data };
  controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
}
