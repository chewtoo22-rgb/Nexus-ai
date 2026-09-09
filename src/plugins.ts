export interface Plugin {
  id: string;
  name: string;
  description: string;
  icon: string;
  tools: unknown[];
  enabled: boolean;
  installedAt: string;
  userId?: string;
}

export const BUILTIN_PLUGINS: Omit<Plugin, "id" | "installedAt">[] = [
  { name: "Web Research", description: "Enhanced web research", icon: "search", enabled: true, tools: [{ name: "web_search" }, { name: "browser_navigate" }, { name: "browser_screenshot" }] },
  { name: "Code Runner", description: "Execute Python/JS/TS in sandboxes", icon: "code", enabled: true, tools: [{ name: "run_code" }] },
  { name: "Image Studio", description: "Generate and analyze images", icon: "image", enabled: true, tools: [{ name: "generate_image" }, { name: "analyze_image" }] },
  { name: "Knowledge Base", description: "RAG knowledge base", icon: "book", enabled: true, tools: [{ name: "search_knowledge" }, { name: "ai_search" }, { name: "ingest_document" }] },
  { name: "Translator", description: "Translate 100+ languages", icon: "languages", enabled: true, tools: [{ name: "translate" }] },
  { name: "Voice", description: "TTS and STT", icon: "audio", enabled: true, tools: [{ name: "text_to_speech" }, { name: "speech_to_text" }] },
  { name: "Artifact Creator", description: "Create code, HTML, SVG, documents", icon: "package", enabled: true, tools: [{ name: "create_artifact" }] },
];

function builtins(): Plugin[] {
  return BUILTIN_PLUGINS.map((p, i) => ({
    ...p,
    id: `builtin-${i}`,
    installedAt: "builtin",
  }));
}

function parseTools(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function getEnabledPlugins(db: D1Database, userId: string): Promise<Plugin[]> {
  try {
    const r = await db
      .prepare("SELECT * FROM plugins WHERE enabled = 1 AND user_id = ? ORDER BY installed_at DESC")
      .bind(userId)
      .all<Record<string, unknown>>();
    const extra = r.results.map((p) => ({
      id: String(p.id),
      name: String(p.name),
      description: String(p.description || ""),
      icon: String(p.icon || ""),
      tools: parseTools(p.tools),
      enabled: Boolean(p.enabled),
      installedAt: String(p.installed_at || ""),
      userId,
    }));
    return [...builtins(), ...extra];
  } catch {
    return builtins();
  }
}

export async function installPlugin(
  db: D1Database,
  plugin: { name: string; description?: string; icon?: string; tools?: unknown; enabled?: boolean },
  userId: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO plugins (id, name, description, icon, tools, enabled, installed_at, user_id) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)",
    )
    .bind(
      id,
      plugin.name,
      plugin.description || "",
      plugin.icon || "",
      JSON.stringify(plugin.tools || []),
      plugin.enabled ? 1 : 0,
      userId,
    )
    .run();
  return id;
}

export async function togglePlugin(
  db: D1Database,
  id: string,
  enabled: boolean,
  userId: string,
): Promise<boolean> {
  if (id.startsWith("builtin-")) return false;
  const row = await db.prepare("SELECT id FROM plugins WHERE id = ? AND user_id = ?").bind(id, userId).first();
  if (!row) return false;
  await db.prepare("UPDATE plugins SET enabled = ? WHERE id = ? AND user_id = ?").bind(enabled ? 1 : 0, id, userId).run();
  return true;
}

export async function uninstallPlugin(db: D1Database, id: string, userId: string): Promise<boolean> {
  if (id.startsWith("builtin-")) return false;
  const row = await db.prepare("SELECT id FROM plugins WHERE id = ? AND user_id = ?").bind(id, userId).first();
  if (!row) return false;
  await db.prepare("DELETE FROM plugins WHERE id = ? AND user_id = ?").bind(id, userId).run();
  return true;
}
