export interface Connector { id: string; name: string; icon: string; description: string; mcpUrl: string; category: string; authRequired: boolean; authType?: string; }

export const CONNECTORS: Connector[] = [
  { id: "cf-docs", name: "Cloudflare Docs", icon: "☁️", description: "Search Cloudflare documentation", mcpUrl: "https://docs.mcp.cloudflare.com/mcp", category: "cloudflare", authRequired: false, authType: "none" },
  { id: "cf-observability", name: "Cloudflare Observability", icon: "📊", description: "Check Worker logs and analytics", mcpUrl: "https://observability.mcp.cloudflare.com/mcp", category: "cloudflare", authRequired: false, authType: "none" },
  { id: "cf-api", name: "Cloudflare API", icon: "🔧", description: "Full Cloudflare API access", mcpUrl: "https://api.mcp.cloudflare.com/mcp", category: "cloudflare", authRequired: true, authType: "oauth" },
  { id: "cf-radar", name: "Cloudflare Radar", icon: "📡", description: "Internet traffic trends", mcpUrl: "https://radar.mcp.cloudflare.com/mcp", category: "cloudflare", authRequired: false, authType: "none" },
  { id: "github", name: "GitHub", icon: "🐙", description: "Search repos, issues, PRs", mcpUrl: "https://mcp.github.com/mcp", category: "developer", authRequired: true, authType: "oauth" },
  { id: "gitlab", name: "GitLab", icon: "🦊", description: "Search projects and merge requests", mcpUrl: "https://mcp.gitlab.com/mcp", category: "developer", authRequired: true, authType: "oauth" },
  { id: "google-drive", name: "Google Drive", icon: "📁", description: "Search and read files", mcpUrl: "https://mcp.drive.google.com/mcp", category: "productivity", authRequired: true, authType: "oauth" },
  { id: "notion", name: "Notion", icon: "📝", description: "Search and edit pages", mcpUrl: "https://mcp.notion.com/mcp", category: "productivity", authRequired: true, authType: "oauth" },
  { id: "slack", name: "Slack", icon: "💬", description: "Search messages, send to channels", mcpUrl: "https://mcp.slack.com/mcp", category: "productivity", authRequired: true, authType: "oauth" },
  { id: "sentry", name: "Sentry", icon: "🚨", description: "Search error reports", mcpUrl: "https://mcp.sentry.io/mcp", category: "data", authRequired: true, authType: "oauth" },
  { id: "brave-search", name: "Brave Search", icon: "🦁", description: "Privacy-focused web search", mcpUrl: "https://mcp.brave.com/mcp", category: "search", authRequired: true, authType: "bearer" },
  { id: "exa", name: "Exa", icon: "🔍", description: "AI-optimized web search", mcpUrl: "https://mcp.exa.ai/mcp", category: "search", authRequired: true, authType: "bearer" },
  { id: "postgres", name: "PostgreSQL", icon: "🐘", description: "Query databases", mcpUrl: "", category: "data", authRequired: true, authType: "bearer" },
];

export function getConnectorsByCategory(category?: string): Connector[] { return category ? CONNECTORS.filter(c => c.category === category) : CONNECTORS; }
export function getConnector(id: string): Connector | undefined { return CONNECTORS.find(c => c.id === id); }
