import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeTool } from "./tool-executor";

export class NexusMCP extends McpAgent {
  server = new McpServer({ name: "nexus-ai", version: "3.0.1" });
  async init() {
    this.server.resource("models", "mcp://resource/models", async (uri) => ({
      contents: [{ uri: uri.href, text: JSON.stringify({ chat: ["kimi-k2.7-code", "deepseek-v4-pro", "glm-5.3", "llama-3.3-70b", "qwen-3.8-27b"], vision: ["qwen-3.8-27b"], image: ["flux-2-dev", "flux-2-klein", "leonardo"] }) }],
    }));
    this.server.resource("agents", "mcp://resource/agents", async (uri) => ({
      contents: [{ uri: uri.href, text: JSON.stringify([{ name: "nexus" }, { name: "builder" }, { name: "researcher" }, { name: "creative" }, { name: "analyst" }]) }],
    }));
    this.server.tool("web_search", "Search the web", { query: z.string() }, async ({ query }) => {
      const r = await executeTool("web_search", { query }, this.env);
      return { content: [{ type: "text" as const, text: r.result }] };
    });
    this.server.tool("browser_navigate", "Navigate to URL", { url: z.string() }, async ({ url }) => {
      const r = await executeTool("browser_navigate", { url }, this.env);
      return { content: [{ type: "text" as const, text: r.result }] };
    });
    this.server.tool("analyze_image", "Analyze an image", { image_url: z.string(), question: z.string() }, async ({ image_url, question }) => {
      const r = await executeTool("analyze_image", { image_url, question }, this.env);
      return { content: [{ type: "text" as const, text: r.result }] };
    });
    this.server.tool("search_knowledge", "Search knowledge base", { query: z.string() }, async ({ query }) => {
      const r = await executeTool("search_knowledge", { query }, this.env);
      return { content: [{ type: "text" as const, text: r.result }] };
    });
    this.server.tool("translate", "Translate text", { text: z.string(), target_lang: z.string() }, async ({ text, target_lang }) => {
      const r = await executeTool("translate", { text, target_lang }, this.env);
      return { content: [{ type: "text" as const, text: r.result }] };
    });
    this.server.tool("create_artifact", "Create an artifact", { type: z.enum(["code", "html", "svg", "document", "markdown"]), title: z.string(), content: z.string(), language: z.string().optional() }, async (args) => {
      const r = await executeTool("create_artifact", args, this.env);
      return { content: [{ type: "text" as const, text: r.result }] };
    });
    this.server.prompt("research", "Deep research", { topic: z.string() }, ({ topic }) => ({
      messages: [{ role: "user", content: { type: "text", text: `Research: ${topic}` } }],
    }));
    this.server.prompt("build_app", "Build an app", { description: z.string() }, ({ description }) => ({
      messages: [{ role: "user", content: { type: "text", text: `Build: ${description}` } }],
    }));
  }
}
