# Nexus AI

Cloudflare Workers agent workspace: five specialist agents, streaming chat, optional MCP, and Workers AI models.

This is a **worker + static UI**, not a complete “AI operating system.” Several advertised surfaces (OAuth connectors, plugin runtime, browser click automation, mission *execution*) are catalogs or CRUD stubs. Chat, rate limits, auth, sandbox (auth-gated), RAG ingest, and MCP search/translate tools are the real surface.

## What actually works

| Surface | Status |
|---|---|
| Streaming chat UI (`/api/chat`) | Live (SSE `type` field + `event:` name). Anonymous chat is rate-limited and limited to cheap tools. Signed-in turns persist. |
| Five agent prompts / model routing | Live |
| Auth (register/login, PBKDF2) | Live — required for sandbox, documents, plugins, stats, missions, projects, conversations |
| Rate limiting | Live on API + tighter cap on anonymous chat |
| MCP (`/mcp`) | Live — search/translate/knowledge. **No unauthenticated `run_code` or browser tools.** |
| Sandbox / `run_code` | Live **only with a Bearer token**, isolated per user |
| Connector install | Records a pending connection for that user; **does not complete OAuth** |
| Plugin install | Per-user catalog rows; **does not change the tool runtime** |
| Missions | Auth-gated CRUD and status. **Does not run agents.** |
| `browser_action` | Explicitly unimplemented |
| `delegate_to_agent` | One-shot specialist model call (auth only) |
| Agent WebSocket / voice | Live **only with a Bearer token**; Durable Objects are keyed per user |

## AI SDK

The worker is written against the Vercel AI SDK **v7** (`streamText` + `tool()` + `jsonSchema` + `stopWhen: stepCountIs(n)`). Tools are executed and fed back to the model. Major upgrades still need a dedicated pass — Dependabot majors for `ai` stay ignored.

## Deploy

1. Create Cloudflare resources (or run `npm run setup` on a machine with Wrangler):
   - D1: `nemotron-nexus-db`
   - R2: `nemotron-nexus-bucket`
   - KV: `CACHE`, `SESSIONS`
   - Vectorize: `nemotron-nexus-index` (1024, cosine)
   - Queue: `nemotron-nexus-docs`
2. Put real IDs in `wrangler.jsonc`. Deploy **will fail** while placeholders remain.
3. GitHub Actions secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
4. `npm run db:init` then push `main`.

```bash
npm install
npm run setup
# edit wrangler.jsonc
npm run db:init
npm run deploy
```

Wrangler / workerd does **not** work on Termux.

## Security notes

- Sandbox exec, code run, document ingest, plugin mutation, missions, conversations, artifacts, and listing stats require `Authorization: Bearer <token>`.
- Tenant rows are scoped by `user_id`. Unowned (`NULL`) legacy rows are not returned or claimed.
- Anonymous chat cannot call image gen, browser, TTS/STT, ingest, delegate, or `run_code`.
- Object reads (`/api/images/...`) only succeed for that user's key prefix.
- Agent WebSockets authenticate the session; they do **not** trust a client-supplied user header.
- Browser/fetch tools reject localhost, link-local, and RFC1918 targets. Redirects are not followed.
- Passwords are PBKDF2-SHA-256 (100k). Legacy `salt:sha256` hashes still verify.
- Public MCP no longer exposes code execution, screenshots, or image analysis.
- Plugin and document mutations are per-user. Built-in plugin catalog entries cannot be deleted.

## Endpoints

- WebSocket (auth): `/api/agent/:type`, `/voice`
- MCP: `/mcp`
- REST under `/api/` (`/health`, `/chat`, `/models`, `/auth/*`, gated `/sandbox/*`, `/code/run`, `/documents`, `/missions`, …)
