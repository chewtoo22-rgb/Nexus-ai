import { jsonSchema, stepCountIs, streamText, tool } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { getToolsForAgent, type ToolDef } from "./tools";
import { executeTool, type ToolCallResult } from "./tool-executor";

export interface StreamConfig {
  model: string;
  systemPrompt: string;
  messages: Array<{ role: string; content: unknown }>;
  tools?: ToolDef[];
  agentType: string;
  env: any;
  userId?: string;
  onToken?: (t: string) => void;
  onToolCall?: (t: string, a: unknown) => void;
  onToolResult?: (t: string, r: string) => void;
  onArtifact?: (a: ToolCallResult["artifact"]) => void;
  onComplete?: (t: string, u: { input_tokens: number; output_tokens: number }) => void | Promise<void>;
  onError?: (e: string) => void;
}

function toSdkTools(defs: ToolDef[], env: any, userId?: string) {
  return Object.fromEntries(
    defs.map((def) => [
      def.name,
      tool({
        description: def.description,
        inputSchema: jsonSchema<Record<string, unknown>>(def.parameters),
        execute: async (input) => {
          const tr = await executeTool(def.name, input, env, { userId });
          return tr;
        },
      }),
    ]),
  );
}

function asText(part: { textDelta?: string; text?: string; delta?: string }): string {
  return part.textDelta ?? part.text ?? part.delta ?? "";
}

function toolOutput(part: Record<string, unknown>): ToolCallResult | undefined {
  const raw = (part.output ?? part.result ?? part.delta) as ToolCallResult | undefined;
  return raw && typeof raw === "object" ? raw : undefined;
}

/** Streams AI chat completion with bounded tool execution and a non-streaming fallback. */
export async function streamChat(config: StreamConfig): Promise<void> {
  const workersai = createWorkersAI({ binding: config.env.AI });
  const tools = config.tools || getToolsForAgent(config.agentType, { authenticated: Boolean(config.userId) });
  let completed = false;
  try {
    let streamError: unknown;
    const result = streamText({
      model: workersai(config.model),
      system: config.systemPrompt,
      messages: config.messages as any,
      tools: toSdkTools(tools, config.env, config.userId),
      stopWhen: stepCountIs(5),
      maxOutputTokens: 4096,
      temperature: 0.4,
      onError: ({ error }) => {
        streamError = error;
      },
    });
    let fullText = "";
    for await (const part of result.fullStream) {
      const typed = part as { type: string } & Record<string, unknown>;
      switch (typed.type) {
        case "text-delta": {
          const text = asText(typed as { textDelta?: string; text?: string });
          fullText += text;
          if (text) config.onToken?.(text);
          break;
        }
        case "tool-call": {
          const toolName = String(typed.toolName || "");
          const input = typed.input ?? typed.args ?? {};
          if (toolName) config.onToolCall?.(toolName, input);
          break;
        }
        case "tool-result": {
          const toolName = String(typed.toolName || "");
          const output = toolOutput(typed);
          if (output?.artifact) config.onArtifact?.(output.artifact);
          config.onToolResult?.(toolName, String(output?.result ?? "").slice(0, 500));
          break;
        }
        case "error":
          throw typed.error;
        case "finish": {
          completed = true;
          await config.onComplete?.(fullText, {
            input_tokens:
              Number((typed.usage as { promptTokens?: number; inputTokens?: number } | undefined)?.promptTokens) ||
              Number((typed.usage as { inputTokens?: number } | undefined)?.inputTokens) ||
              0,
            output_tokens:
              Number((typed.usage as { completionTokens?: number; outputTokens?: number } | undefined)?.completionTokens) ||
              Number((typed.usage as { outputTokens?: number } | undefined)?.outputTokens) ||
              0,
          });
          break;
        }
      }
    }
    if (streamError) throw streamError;
    if (!completed) {
      completed = true;
      await config.onComplete?.(fullText, { input_tokens: 0, output_tokens: 0 });
    }
  } catch (err) {
    if (completed) {
      config.onError?.(`Streaming failed: ${String(err)}`);
      return;
    }
    try {
      const result = await config.env.AI.run(config.model, {
        messages: [{ role: "system", content: config.systemPrompt }, ...config.messages],
        tools: tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        max_tokens: 4096,
        temperature: 0.4,
      });
      const responseText = (result as { response?: string }).response || "";
      config.onToken?.(responseText);
      await config.onComplete?.(responseText, {
        input_tokens: (result as { usage?: { prompt_tokens?: number } }).usage?.prompt_tokens || 0,
        output_tokens: (result as { usage?: { completion_tokens?: number } }).usage?.completion_tokens || 0,
      });
    } catch (e) {
      config.onError?.(`Fallback failed: ${String(e)}`);
    }
  }
}

export function sseSend(
  controller: ReadableStreamDefaultController,
  event: string,
  data: Record<string, unknown>,
): void {
  const payload = { type: event, ...data };
  controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
}
