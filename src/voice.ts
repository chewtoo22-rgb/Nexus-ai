import { Agent } from "agents";
import {
  withVoice,
  WorkersAIFluxSTT,
  WorkersAITTS,
  type VoiceTurnContext,
} from "@cloudflare/voice";
import { streamText } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { MODELS } from "./models";

const VoiceAgent = withVoice(Agent);

export class NexusVoiceAgent extends VoiceAgent {
  transcriber = new WorkersAIFluxSTT(this.env.AI);
  tts = new WorkersAITTS(this.env.AI);

  async onTurn(transcript: string, context: VoiceTurnContext) {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const result = streamText({
      model: workersai(MODELS.chat.flagship),
      system: "You are Nexus, a helpful voice assistant. Keep responses concise and conversational.",
      messages: [
        ...context.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user" as const, content: transcript },
      ],
      abortSignal: context.signal,
    });
    return result.textStream;
  }
}
