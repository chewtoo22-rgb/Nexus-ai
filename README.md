# nemotron-nexus v3

Full AI platform on Cloudflare Workers. 5 agents, 20+ AI models, MCP server, streaming, sandbox code execution, 13 connectors, 7 plug-ins, voice mode, auth, rate limiting, projects.

## Setup
```bash
npm install && npm run setup
# Update wrangler.jsonc with IDs
npm run db:init && npm run deploy
```

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
- WebSocket: /api/agent/:type, /voice
- MCP: /mcp
- 35+ REST API endpoints under /api/
