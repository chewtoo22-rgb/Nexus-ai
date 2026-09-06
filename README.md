# Nexus AI

Cloudflare Workers agent workspace: five specialist agents, streaming chat, optional MCP, and Workers AI models.

This is a **worker + static UI**, not a complete “AI operating system.” Several advertised surfaces (OAuth connectors, plugin runtime, browser click automation) are catalogs or stubs. Chat, rate limits, auth, sandbox (auth-gated), RAG ingest, and MCP search/translate tools are the real surface.

## What actually works

| Surface | Status |
|---|---|
| Streaming chat UI (`/api/chat`) | Live (SSE `type` field + `event:` name) |
| Five agent prompts / model routing | Live |
| Auth (register/login, PBKDF2) | Live — required for sandbox, documents, plugins, stats |
| Rate limiting | Live on API + upgrade routes |
| MCP (`/mcp`) | Live — search/navigate/translate/knowledge. **No unauthenticated `run_code`.** |
| Sandbox / `run_code` | Live **only with a Bearer token** |
| Connector install | Records a pending connection; **does not complete OAuth** |
| `browser_action` | Explicitly unimplemented |
| `delegate_to_agent` | One-shot specialist model call |

## Do not merge Dependabot `ai@7`

The worker is written against the Vercel AI SDK **v4** (`streamText` + `textDelta` / `promptTokens`). Jumping to v7 is a breaking rewrite, not a patch.

## Deploy

1. Create Cloudflare resources (or run `npm run setup` on a machine with Wrangler):
   - D1: `nemotron-nexus-db`
   - R2: `nemotron-nexus-bucket`
   - KV: `CACHE`, `SESSIONS`
   - Vectorize: `nemotron-nexus-index` (1024, cosine)
   - Queue: `nemotron-nexus-docs`
2. Put real IDs in `wrangler.jsonc` (replace every `REPLACE_WITH_...`). Deploy **will fail** while placeholders remain.
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

- Sandbox exec, code run, document ingest, plugin mutation, and listing all conversations require `Authorization: Bearer <token>`.
- Browser/fetch tools reject localhost, link-local, and RFC1918 targets.
- Passwords are PBKDF2-SHA-256 (100k). Legacy `salt:sha256` hashes still verify.
- Public MCP no longer exposes code execution.

## Endpoints

- WebSocket: `/api/agent/:type`, `/voice`
- MCP: `/mcp`
- REST under `/api/` (`/health`, `/chat`, `/models`, `/auth/*`, gated `/sandbox/*`, `/code/run`, `/documents`, …)
