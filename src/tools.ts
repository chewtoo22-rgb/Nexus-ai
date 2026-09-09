export interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, Record<string, unknown>>;
    required: string[];
  };
}

export const ALL_TOOLS: ToolDef[] = [
  { name: "web_search", description: "Search the web.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "browser_navigate", description: "Navigate to URL, get markdown.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "browser_screenshot", description: "Screenshot a website.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "browser_extract", description: "Extract data via CSS selector.", parameters: { type: "object", properties: { url: { type: "string" }, selector: { type: "string" } }, required: ["url", "selector"] } },
  { name: "browser_action", description: "Not implemented. Use browser_navigate, browser_extract, or browser_screenshot.", parameters: { type: "object", properties: { action: { type: "string", enum: ["click", "type", "scroll", "wait", "evaluate"] }, selector: { type: "string" }, text: { type: "string" }, script: { type: "string" } }, required: ["action"] } },
  { name: "analyze_image", description: "Analyze an image.", parameters: { type: "object", properties: { image_url: { type: "string" }, question: { type: "string" } }, required: ["image_url", "question"] } },
  { name: "generate_image", description: "Generate an image from text.", parameters: { type: "object", properties: { prompt: { type: "string" }, model: { type: "string", enum: ["flux-2-dev", "flux-2-klein-4b", "flux-2-klein-9b", "flux-1-schnell", "leonardo", "phoenix"] } }, required: ["prompt"] } },
  { name: "search_knowledge", description: "Search Vectorize knowledge base for the current user.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "ai_search", description: "Search AI Search AutoRAG.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "ingest_document", description: "Upload text to the current user's knowledge base.", parameters: { type: "object", properties: { text: { type: "string" }, title: { type: "string" } }, required: ["text"] } },
  { name: "create_artifact", description: "Create an artifact.", parameters: { type: "object", properties: { type: { type: "string", enum: ["code", "html", "svg", "document", "markdown"] }, title: { type: "string" }, language: { type: "string" }, content: { type: "string" } }, required: ["type", "title", "content"] } },
  { name: "translate", description: "Translate text.", parameters: { type: "object", properties: { text: { type: "string" }, target_lang: { type: "string" } }, required: ["text", "target_lang"] } },
  { name: "text_to_speech", description: "Text to speech.", parameters: { type: "object", properties: { text: { type: "string" }, lang: { type: "string", enum: ["en", "es", "multi"] } }, required: ["text"] } },
  { name: "speech_to_text", description: "Speech to text.", parameters: { type: "object", properties: { audio_url: { type: "string" } }, required: ["audio_url"] } },
  { name: "save_memory", description: "Save a memory.", parameters: { type: "object", properties: { key: { type: "string" }, value: { type: "string" } }, required: ["key", "value"] } },
  { name: "get_memory", description: "Get a memory.", parameters: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } },
  { name: "delegate_to_agent", description: "Delegate to a specialized agent.", parameters: { type: "object", properties: { agent: { type: "string", enum: ["builder", "researcher", "creative", "analyst"] }, task: { type: "string" } }, required: ["agent", "task"] } },
  { name: "run_code", description: "Execute Python/JS/TS in a per-user sandbox. Requires auth.", parameters: { type: "object", properties: { code: { type: "string" }, language: { type: "string", enum: ["python", "javascript", "typescript"] } }, required: ["code", "language"] } },
];

const NAMES = (names: string[]) => ALL_TOOLS.filter((t) => names.includes(t.name));

export const NEXUS_TOOLS = ALL_TOOLS;
export const BUILDER_TOOLS = NAMES([
  "web_search", "browser_navigate", "browser_screenshot", "browser_extract", "analyze_image",
  "generate_image", "search_knowledge", "ai_search", "ingest_document", "create_artifact",
  "save_memory", "get_memory", "delegate_to_agent", "run_code",
]);
export const RESEARCHER_TOOLS = NAMES([
  "web_search", "browser_navigate", "browser_screenshot", "browser_extract", "analyze_image",
  "search_knowledge", "ai_search", "ingest_document", "translate", "save_memory", "get_memory",
  "delegate_to_agent",
]);
export const CREATIVE_TOOLS = NAMES([
  "web_search", "browser_navigate", "browser_screenshot", "analyze_image", "generate_image",
  "search_knowledge", "ai_search", "create_artifact", "translate", "text_to_speech",
  "save_memory", "get_memory", "delegate_to_agent",
]);
export const ANALYST_TOOLS = NAMES([
  "web_search", "browser_navigate", "browser_screenshot", "browser_extract", "analyze_image",
  "search_knowledge", "ai_search", "ingest_document", "create_artifact", "translate",
  "save_memory", "get_memory", "delegate_to_agent", "run_code",
]);

/** Cheap, non-mutating tools allowed on anonymous chat. */
export const ANON_TOOL_NAMES = new Set([
  "web_search",
  "translate",
  "search_knowledge",
  "create_artifact",
  "save_memory",
  "get_memory",
]);

export function getToolsForAgent(
  agentType: string,
  opts: { authenticated?: boolean } = {},
): ToolDef[] {
  const key =
    agentType === "ana" ? "builder" :
    agentType === "nova" ? "researcher" :
    agentType === "sirius" ? "analyst" :
    agentType;
  let tools: ToolDef[];
  switch (key) {
    case "builder":
      tools = BUILDER_TOOLS;
      break;
    case "researcher":
      tools = RESEARCHER_TOOLS;
      break;
    case "creative":
      tools = CREATIVE_TOOLS;
      break;
    case "analyst":
      tools = ANALYST_TOOLS;
      break;
    default:
      tools = NEXUS_TOOLS;
  }
  if (!opts.authenticated) {
    tools = tools.filter((t) => ANON_TOOL_NAMES.has(t.name));
  }
  return tools;
}
