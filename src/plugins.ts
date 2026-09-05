export interface Plugin { id: string; name: string; description: string; icon: string; tools: any[]; enabled: boolean; installedAt: string; }

export const BUILTIN_PLUGINS: Omit<Plugin, "id" | "installedAt">[] = [
  { name: "Web Research", description: "Enhanced web research", icon: "🔬", enabled: true, tools: [{ name: "web_search", handler: "web_search" }, { name: "browser_navigate", handler: "browser_navigate" }, { name: "browser_screenshot", handler: "browser_screenshot" }] },
  { name: "Code Runner", description: "Execute Python/JS/TS in sandboxes", icon: "💻", enabled: true, tools: [{ name: "run_code", handler: "run_code" }] },
  { name: "Image Studio", description: "Generate and analyze images", icon: "🎨", enabled: true, tools: [{ name: "generate_image", handler: "generate_image" }, { name: "analyze_image", handler: "analyze_image" }] },
  { name: "Knowledge Base", description: "RAG knowledge base", icon: "📚", enabled: true, tools: [{ name: "search_knowledge", handler: "search_knowledge" }, { name: "ai_search", handler: "ai_search" }, { name: "ingest_document", handler: "ingest_document" }] },
  { name: "Translator", description: "Translate 100+ languages", icon: "🌍", enabled: true, tools: [{ name: "translate", handler: "translate" }] },
  { name: "Voice", description: "TTS and STT", icon: "🗣️", enabled: true, tools: [{ name: "text_to_speech", handler: "text_to_speech" }, { name: "speech_to_text", handler: "speech_to_text" }] },
  { name: "Artifact Creator", description: "Create code, HTML, SVG, documents", icon: "📦", enabled: true, tools: [{ name: "create_artifact", handler: "create_artifact" }] },
];

export async function getEnabledPlugins(db: D1Database): Promise<Plugin[]> {
  try { const r = await db.prepare("SELECT * FROM plugins WHERE enabled = 1 ORDER BY installed_at DESC").all(); if (r.results.length > 0) return r.results.map((p: any) => ({ ...p, tools: JSON.parse(p.tools || "[]") })) as Plugin[]; } catch {}
  return BUILTIN_PLUGINS.map((p, i) => ({ ...p, id: `builtin-${i}`, installedAt: new Date().toISOString() }));
}
export async function installPlugin(db: D1Database, plugin: any): Promise<string> { const id = crypto.randomUUID(); await db.prepare("INSERT INTO plugins (id, name, description, icon, tools, enabled, installed_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))").bind(id, plugin.name, plugin.description, plugin.icon, JSON.stringify(plugin.tools), plugin.enabled ? 1 : 0).run(); return id; }
export async function togglePlugin(db: D1Database, id: string, enabled: boolean): Promise<void> { await db.prepare("UPDATE plugins SET enabled = ? WHERE id = ?").bind(enabled ? 1 : 0, id).run(); }
export async function uninstallPlugin(db: D1Database, id: string): Promise<void> { await db.prepare("DELETE FROM plugins WHERE id = ?").bind(id).run(); }
