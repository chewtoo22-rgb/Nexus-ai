import { VoiceAgent, WorkersAIFluxSTT, WorkersAITTS } from "agents/voice";
import { streamText } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { MODELS } from "./models";

export class NexusVoiceAgent extends VoiceAgent {
  transcriber = new WorkersAIFluxSTT(this.env.AI);
  tts = new WorkersAITTS(this.env.AI);

  async onTurn(transcript: string, context: any) {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const result = streamText({
      model: workersai(MODELS.chat.flagship),
      system: "You are Nexus, a helpful voice assistant. Keep responses concise and conversational.",
      messages: [...context.messages.map((m: any) => ({ role: m.role, content: m.content })), { role: "user", content: transcript }],
      abortSignal: context.signal,
    });
    return result.textStream;
  }
}
