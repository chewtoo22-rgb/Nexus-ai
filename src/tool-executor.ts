import { MODELS } from "./models";

export interface ToolCallResult {
  result: string;
  data?: any;
  artifact?: { type: string; title: string; content?: string; r2_key?: string; language?: string };
}

export async function executeTool(toolName: string, args: any, env: any, ctx?: any): Promise<ToolCallResult> {
  switch (toolName) {
    case "web_search": { const q = encodeURIComponent(args.query); return await browserFetchMarkdown(env, `https://html.duckduckgo.com/html/?q=${q}`); }
    case "browser_navigate": return await browserFetchMarkdown(env, args.url);
    case "browser_screenshot": return await browserScreenshot(env, args.url);
    case "browser_extract": return await browserExtract(env, args.url, args.selector);
    case "browser_action": return { result: `Browser action '${args.action}' would use Puppeteer.` };
    case "analyze_image": { const r = await env.AI.run(MODELS.vision.fast, { prompt: args.question, image: args.image_url }); return { result: (r as any).description || (r as any).response || JSON.stringify(r) }; }
    case "generate_image": {
      const mm: Record<string, string> = { "flux-2-dev": MODELS.imageGen.flagship, "flux-2-klein-4b": MODELS.imageGen.fast, "flux-2-klein-9b": MODELS.imageGen.balanced, "flux-1-schnell": MODELS.imageGen.schnell, "leonardo": MODELS.imageGen.leonardo, "phoenix": MODELS.imageGen.phoenix };
      const model = mm[args.model] || MODELS.imageGen.balanced;
      const r = await env.AI.run(model, { prompt: args.prompt });
      const key = `images/${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
      const img = (r as any).image || (r as any);
      if (img instanceof Uint8Array || img instanceof ArrayBuffer) { await env.BUCKET.put(key, img); return { result: `Image saved: ${key}`, artifact: { type: "image", title: args.prompt, r2_key: key } }; }
      return { result: "Image generated but could not be stored." };
    }
    case "search_knowledge": {
      const emb = await env.AI.run(MODELS.embeddings.primary, { text: [args.query] });
      const v = (emb as any).data?.[0] ?? [];
      const r = await env.VECTORIZE.query(v, { topK: 5, returnMetadata: "all" });
      if (!r.matches?.length) return { result: "No relevant documents found." };
      return { result: r.matches.filter((m: any) => m.score > 0.5).map((m: any, i: number) => `[${i + 1}] ${m.metadata?.text ?? ""}`).join("\n\n") || "No results." };
    }
    case "ai_search": { try { return { result: JSON.stringify(await env.AI_SEARCH.search({ query: args.query })) }; } catch { return { result: "AI Search not configured." }; } }
    case "ingest_document": {
      const id = crypto.randomUUID(); const key = `documents/${id}/inline.txt`;
      await env.BUCKET.put(key, args.text);
      await env.DB.prepare("INSERT INTO documents (id, source, source_key, title, status) VALUES (?, 'upload', ?, ?, 'pending')").bind(id, key, args.title || "Inline text").run();
      await env.DOC_QUEUE.send({ documentId: id, source: "r2", sourceKey: key, title: args.title || "Inline text" });
      return { result: `Document queued. ID: ${id}` };
    }
    case "create_artifact": return { result: `Artifact "${args.title}" created.`, artifact: { type: args.type, title: args.title, content: args.content, language: args.language } };
    case "translate": { const r = await env.AI.run(MODELS.translation, { text: args.text, target_lang: args.target_lang, source_lang: "en" }); return { result: (r as any).translated_text || JSON.stringify(r) }; }
    case "text_to_speech": { const m = args.lang === "es" ? MODELS.tts.es : args.lang === "multi" ? MODELS.tts.multi : MODELS.tts.en; const r = await env.AI.run(m, { text: args.text, prompt: "Speak naturally" }); if ((r as any).audio) { const k = `audio/tts/${Date.now()}.mp3`; await env.BUCKET.put(k, (r as any).audio); return { result: `Audio saved: ${k}` }; } return { result: "TTS completed." }; }
    case "speech_to_text": { const ar = await fetch(args.audio_url); const ab = await ar.blob(); const r = await env.AI.run(MODELS.stt.batch, { audio: [...new Uint8Array(await ab.arrayBuffer())] }); return { result: (r as any).text || JSON.stringify(r) }; }
    case "save_memory": { if (ctx?.storage) await ctx.storage.put(`memory:${args.key}`, args.value); return { result: `Memory saved: ${args.key}` }; }
    case "get_memory": { if (ctx?.storage) { const v = await ctx.storage.get(`memory:${args.key}`); return { result: v || `No memory for: ${args.key}` }; } return { result: "Memory not available." }; }
    case "delegate_to_agent": return { result: `Delegating to ${args.agent}... Task: ${args.task}` };
    case "run_code": { const { runCodeTool } = await import("./code-exec"); return await runCodeTool(args, env); }
    default: return { result: `Unknown tool: ${toolName}` };
  }
}

function stripDangerousBlocks(input: string): string {
  let previous: string;
  let current = input;
  do {
    previous = current;
    current = current
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "");
  } while (current !== previous);
  return current;
}

async function browserFetchMarkdown(env: any, url: string): Promise<ToolCallResult> {
  try { const r = await env.BROWSER.quickAction("markdown", { url }); return { result: (await r.text()).slice(0, 8000) }; }
  catch { const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } }); const h = await r.text(); const sanitized = stripDangerousBlocks(h); return { result: sanitized.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 8000) }; }
}
async function browserScreenshot(env: any, url: string): Promise<ToolCallResult> {
  try { const r = await env.BROWSER.quickAction("screenshot", { url }); const k = `screenshots/${Date.now()}-${Math.random().toString(36).slice(2)}.png`; await env.BUCKET.put(k, await r.arrayBuffer()); return { result: `Screenshot saved: ${k}`, artifact: { type: "image", title: `Screenshot of ${url}`, r2_key: k } }; }
  catch { return { result: "Failed to take screenshot." }; }
}
async function browserExtract(env: any, url: string, selector: string): Promise<ToolCallResult> {
  try { const r = await env.BROWSER.quickAction("json", { url, selector }); return { result: (await r.text()).slice(0, 8000) }; }
  catch { return { result: "Failed to extract." }; }
}
