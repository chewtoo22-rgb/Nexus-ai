# nemotron-nexus v3

Full AI platform on Cloudflare Workers. 5 agents, 20+ AI models, MCP server, streaming, sandbox code execution, 13 connectors, 7 plug-ins, voice mode, auth, rate limiting, projects.

## Deploy with GitHub Actions (recommended)

1. **Create Cloudflare resources** (one-time, from any machine that supports Wrangler, or via the Cloudflare dashboard):
   - D1 database: `nemotron-nexus-db`
   - R2 bucket: `nemotron-nexus-bucket`
   - KV namespaces: `CACHE` and `SESSIONS`
   - Vectorize index: `nemotron-nexus-index` (1024 dimensions, cosine)
   - Queue: `nemotron-nexus-docs`

2. Put the real IDs into `wrangler.jsonc` (replace every `REPLACE_WITH_...`).

3. In your GitHub repo go to **Settings → Secrets and variables → Actions** and add:
   - `CLOUDFLARE_API_TOKEN` – create at https://dash.cloudflare.com/profile/api-tokens  
     (use the "Edit Cloudflare Workers" template or a custom token with Workers + D1 + R2 + KV + Vectorize + Queues permissions)
   - `CLOUDFLARE_ACCOUNT_ID` – found in the Cloudflare dashboard sidebar / Workers overview

4. Push to `main` (or go to the **Actions** tab and click **Run workflow**).  
   The workflow will install dependencies and run `wrangler deploy`.

## Local setup (Linux / macOS / Windows / WSL)
```bash
npm install
npm run setup          # creates the Cloudflare resources
# Edit wrangler.jsonc with the printed IDs
npm run db:init
npm run deploy
```

> **Note:** Wrangler / workerd does **not** work on Termux (Android).

## Features
- 5 agents (Nexus, Builder, Researcher, Creative, Analyst)
- MCP server at /mcp (connect from Claude Desktop, Cursor)
- Token-by-token streaming (WebSocket + SSE)
- Sandbox code execution (Python/JS/TS)
- 13 connectors (GitHub, Google Drive, Slack, Notion, Cloudflare, etc.)
- 7 built-in plug-ins
- Voice mode (STT + TTS)
- Auth (register/login/sessions)
- Rate limiting
- Projects with scoped knowledge
- Artifacts with live previews
- RAG (Vectorize + AI Search)
- Browser use, vision, image gen, translation, speech

## Endpoints
- WebSocket: `/api/agent/:type`, `/voice`
- MCP: `/mcp`
- 35+ REST API endpoints under `/api/`

<!-- deployment trigger: 2026-09-05 -->
