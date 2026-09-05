export interface ToolDef { name: string; description: string; parameters: Record<string, any>; }

export const ALL_TOOLS: ToolDef[] = [
  { name: "web_search", description: "Search the web.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "browser_navigate", description: "Navigate to URL, get markdown.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "browser_screenshot", description: "Screenshot a website.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "browser_extract", description: "Extract data via CSS selector.", parameters: { type: "object", properties: { url: { type: "string" }, selector: { type: "string" } }, required: ["url", "selector"] } },
  { name: "browser_action", description: "Browser action.", parameters: { type: "object", properties: { action: { type: "string", enum: ["click", "type", "scroll", "wait", "evaluate"] }, selector: { type: "string" }, text: { type: "string" }, script: { type: "string" } }, required: ["action"] } },
  { name: "analyze_image", description: "Analyze an image.", parameters: { type: "object", properties: { image_url: { type: "string" }, question: { type: "string" } }, required: ["image_url", "question"] } },
  { name: "generate_image", description: "Generate an image from text.", parameters: { type: "object", properties: { prompt: { type: "string" }, model: { type: "string", enum: ["flux-2-dev", "flux-2-klein-4b", "flux-2-klein-9b", "flux-1-schnell", "leonardo", "phoenix"] } }, required: ["prompt"] } },
  { name: "search_knowledge", description: "Search Vectorize knowledge base.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "ai_search", description: "Search AI Search AutoRAG.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "ingest_document", description: "Upload text to knowledge base.", parameters: { type: "object", properties: { text: { type: "string" }, title: { type: "string" } }, required: ["text"] } },
  { name: "create_artifact", description: "Create an artifact.", parameters: { type: "object", properties: { type: { type: "string", enum: ["code", "html", "svg", "document", "markdown"] }, title: { type: "string" }, language: { type: "string" }, content: { type: "string" } }, required: ["type", "title", "content"] } },
  { name: "translate", description: "Translate text.", parameters: { type: "object", properties: { text: { type: "string" }, target_lang: { type: "string" } }, required: ["text", "target_lang"] } },
  { name: "text_to_speech", description: "Text to speech.", parameters: { type: "object", properties: { text: { type: "string" }, lang: { type: "string", enum: ["en", "es", "multi"] } }, required: ["text"] } },
  { name: "speech_to_text", description: "Speech to text.", parameters: { type: "object", properties: { audio_url: { type: "string" } }, required: ["audio_url"] } },
  { name: "save_memory", description: "Save a memory.", parameters: { type: "object", properties: { key: { type: "string" }, value: { type: "string" } }, required: ["key", "value"] } },
  { name: "get_memory", description: "Get a memory.", parameters: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } },
  { name: "delegate_to_agent", description: "Delegate to a specialized agent.", parameters: { type: "object", properties: { agent: { type: "string", enum: ["builder", "researcher", "creative", "analyst"] }, task: { type: "string" } }, required: ["agent", "task"] } },
  { name: "run_code", description: "Execute Python/JS/TS in a sandbox.", parameters: { type: "object", properties: { code: { type: "string" }, language: { type: "string", enum: ["python", "javascript", "typescript"] } }, required: ["code", "language"] } },
];

export const NEXUS_TOOLS = ALL_TOOLS;
export const BUILDER_TOOLS = ALL_TOOLS.filter(t => ["web_search", "browser_navigate", "browser_screenshot", "browser_extract", "browser_action", "analyze_image", "generate_image", "search_knowledge", "ai_search", "ingest_document", "create_artifact", "save_memory", "get_memory", "delegate_to_agent", "run_code"].includes(t.name));
export const RESEARCHER_TOOLS = ALL_TOOLS.filter(t => ["web_search", "browser_navigate", "browser_screenshot", "browser_extract", "analyze_image", "search_knowledge", "ai_search", "ingest_document", "translate", "save_memory", "get_memory", "delegate_to_agent"].includes(t.name));
export const CREATIVE_TOOLS = ALL_TOOLS.filter(t => ["web_search", "browser_navigate", "browser_screenshot", "analyze_image", "generate_image", "search_knowledge", "ai_search", "create_artifact", "translate", "text_to_speech", "save_memory", "get_memory", "delegate_to_agent"].includes(t.name));
export const ANALYST_TOOLS = ALL_TOOLS.filter(t => ["web_search", "browser_navigate", "browser_screenshot", "browser_extract", "browser_action", "analyze_image", "search_knowledge", "ai_search", "ingest_document", "create_artifact", "translate", "save_memory", "get_memory", "delegate_to_agent", "run_code"].includes(t.name));

export function getToolsForAgent(agentType: string): ToolDef[] {
  switch (agentType) {
    case "builder": return BUILDER_TOOLS;
    case "researcher": return RESEARCHER_TOOLS;
    case "creative": return CREATIVE_TOOLS;
    case "analyst": return ANALYST_TOOLS;
    default: return NEXUS_TOOLS;
  }
}
